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

    const code = new URL(result.url).searchParams.get("code");
    if (!code) return { success: false, error: "Google sign-in didn't return a valid code." };

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
