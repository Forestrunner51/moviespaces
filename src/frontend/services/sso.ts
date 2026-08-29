import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import { supabase } from "@/frontend/config/supabase";

export type SsoResult = { success: boolean; error?: string; cancelled?: boolean };

// Must match a URL registered in the Supabase dashboard under Authentication
// → URL Configuration → Redirect URLs (e.g. "moviespaces://auth/callback").
// It doesn't need to correspond to an actual expo-router screen — the OAuth
// result is read directly from openAuthSessionAsync's return value below, not
// via app navigation.
const OAUTH_REDIRECT_URL = "moviespaces://auth/callback";

// Pulls params out of BOTH the query string and the fragment of a callback
// URL. OAuth errors can come back in either depending on how far the request
// got (Supabase-level rejections land in the query, provider-level ones can
// land in the fragment), and React Native's URL implementation only exposes
// the query — so parse the raw string rather than relying on URL.searchParams.
// The callback URL carries the one-time auth code (and possibly tokens in
// the fragment) — log only the scheme/host/path, never the query or fragment.
function redactCallbackUrl(url: string): string {
  return url.split(/[?#]/)[0];
}

function parseCallbackParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const marker of ["?", "#"]) {
    const start = url.indexOf(marker);
    if (start === -1) continue;
    // A fragment can follow a query string; stop the query at the '#'.
    const raw = marker === "?" ? url.slice(start + 1).split("#")[0] : url.slice(start + 1);
    for (const pair of raw.split("&")) {
      if (!pair) continue;
      const [key, value = ""] = pair.split("=");
      if (key) params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, " "));
    }
  }
  return params;
}

// Google has no equivalent to Apple's native "must use their SDK" App Store
// requirement, so this uses Supabase's generic OAuth (web) flow rather than
// a native Google Sign-In SDK — no extra native module/config needed beyond
// the custom URL scheme this app already registers.
export async function signInWithGoogle(): Promise<SsoResult> {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: OAUTH_REDIRECT_URL,
        skipBrowserRedirect: true,
      },
    });
    if (error) return { success: false, error: error.message };
    if (!data?.url) return { success: false, error: "Couldn't start Google sign-in." };

    const result = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT_URL);
    if (result.type !== "success" || !result.url) {
      return { success: false, cancelled: true };
    }

    const params = parseCallbackParams(result.url);

    // Surface what actually came back rather than a generic "no code" message.
    // The usual cause is dashboard config, not the app: the Google provider
    // isn't enabled/keyed in Supabase, or this redirect URL isn't allow-listed
    // — both make Supabase redirect back with an error instead of a code.
    if (params.error || params.error_description) {
      console.error("Google OAuth callback error:", redactCallbackUrl(result.url), params.error);
      return {
        success: false,
        error: params.error_description || params.error,
      };
    }

    const code = params.code;
    if (!code) {
      console.error("Google OAuth callback had no code:", redactCallbackUrl(result.url));
      return {
        success: false,
        error:
          "Google sign-in didn't return a code. Check that the Google provider is enabled in Supabase and that " +
          `"${OAUTH_REDIRECT_URL}" is listed under Authentication → URL Configuration → Redirect URLs.`,
      };
    }

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) return { success: false, error: exchangeError.message };

    return { success: true };
  } catch (err: any) {
    console.error("Google sign-in failed:", err);
    return { success: false, error: err.message || "Please try again." };
  }
}

// Apple requires the native Sign in with Apple API (not a web OAuth popup)
// per App Store guideline 4.8 — the identity token it returns is handed
// straight to Supabase's native token-exchange endpoint, no browser involved.
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function signInWithApple(): Promise<SsoResult> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      return { success: false, error: "Apple didn't return an identity token." };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: credential.identityToken,
    });
    if (error) return { success: false, error: error.message };

    // Apple's identity token has no name — the name only ever arrives in
    // `credential.fullName`, and only on the very first authorization. If we
    // don't capture it now, the account is stuck as "Unknown User" (the
    // profiles trigger's default) forever. Persist it to both user_metadata
    // (so the rest of the app's name-reading paths see it) and the profiles
    // row (the actual display name).
    const appleName = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (appleName) {
      await supabase.auth.updateUser({ data: { full_name: appleName } });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("profiles").update({ display_name: appleName }).eq("id", user.id);
      }
    }

    return { success: true };
  } catch (err: any) {
    // Apple's own "user tapped Cancel" error — not a real failure.
    if (err.code === "ERR_REQUEST_CANCELED") {
      return { success: false, cancelled: true };
    }
    console.error("Apple sign-in failed:", err);
    return { success: false, error: err.message || "Please try again." };
  }
}
