// Must load before supabase-js constructs its client. See the module itself
// for why this is guarded rather than an unconditional polyfill import.
import "@/frontend/services/random-values-polyfill";
import { DarkTheme, ThemeProvider, Stack, router, usePathname } from "expo-router";
import { useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import { useFonts, BebasNeue_400Regular } from "@expo-google-fonts/bebas-neue";
import "@/frontend/services/sentry";
import { AnimatedSplashOverlay } from "@/frontend/components/animated-icon";
import { supabase } from "@/frontend/config/supabase";
import { SpaceTheme, Palette } from "@/frontend/constants/theme";
import { registerForPushNotifications } from "@/frontend/services/push-notifications";
import { setPendingRedirect } from "@/frontend/services/pending-redirect";
import { ToastProvider } from "@/frontend/components/toast";
import { Text as RNText, TextInput as RNTextInput } from "react-native";

// Cap OS "Larger Text" / Dynamic-Type scaling app-wide. Without a cap, a large
// accessibility text setting scales every label without limit and blows copy
// past its container — the "text looks stretched / overflows on some screens"
// report. 1.3 keeps real accessibility scaling while staying inside layouts.
type Scalable = { defaultProps?: { maxFontSizeMultiplier?: number } };
(RNText as unknown as Scalable).defaultProps = {
  ...(RNText as unknown as Scalable).defaultProps,
  maxFontSizeMultiplier: 1.3,
};
(RNTextInput as unknown as Scalable).defaultProps = {
  ...(RNTextInput as unknown as Scalable).defaultProps,
  maxFontSizeMultiplier: 1.3,
};

// Every screen uses the cosmic theme now, regardless of system light/dark
// mode — so the native header (back button, title bar) should match rather
// than following the device's color scheme.
const SpaceNavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: SpaceTheme.glowCyan,
    background: SpaceTheme.backgroundVoid,
    card: SpaceTheme.deepSpace,
    text: SpaceTheme.starWhite,
    border: Palette.border,
    notification: SpaceTheme.supernovaPink,
  },
};

function Layout() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // Display font for the wordmark/titles. Rendering waits for it so titles
  // don't flash in the system font first, then snap to Bebas Neue.
  const [fontsLoaded] = useFonts({ BebasNeue_400Regular });
  const pathname = usePathname();
  // Read via ref (not the `pathname` closure) inside the callbacks below —
  // those are registered once by a mount-only effect, so a plain closure
  // would keep seeing whatever pathname was current on mount forever instead
  // of wherever the user actually is when their session drops. Updated in an
  // effect, not during render — mutating a ref directly in the render body
  // breaks under concurrent rendering / StrictMode's double-invoke.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // A Space invite link (the only deep-link target this app registers) can
  // open the app before the user is signed in. Stash where they were headed
  // so auth.tsx can send them there after sign-in instead of dropping them on
  // the home tab.
  const stashDeepLinkAndRedirectToAuth = () => {
    if (pathnameRef.current?.startsWith("/space/")) {
      setPendingRedirect(pathnameRef.current as any);
    }
    router.replace("/auth");
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        stashDeepLinkAndRedirectToAuth();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!loading) {
      if (!session) {
        stashDeepLinkAndRedirectToAuth();
      }
    }
  }, [session, loading]);

  useEffect(() => {
    if (session) {
      // Registration is best-effort by contract (see its own comment) — a
      // rejection here must never become an unhandled one at app launch.
      registerForPushNotifications().catch(() => {});
    }
  }, [session]);

  // Hold on the animated splash until the display font is ready (keeps titles
  // from flashing in the system font). The overlay covers the blank frame.
  if (!fontsLoaded) {
    return <AnimatedSplashOverlay />;
  }

  return (
    <ThemeProvider value={SpaceNavigationTheme}>
      <AnimatedSplashOverlay />
      <Stack>
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        {/* headerShown: false hides the header while ON the tabs, but the
            back button of whatever screen gets pushed on top still needs a
            real title — without one, iOS falls back to the raw route name
            ("(tabs)") for that back label. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Home" }} />
        {/* Titles use the app's own vocabulary — Space / Watch Party — rather
            than the pre-pivot "Group"/"Rent a Theater" wording. "Rent a
            Theater" in particular contradicted that screen's own copy, which
            covers bars, community spaces and your own place, and states the
            app doesn't handle booking. */}
        <Stack.Screen name="group" options={{ title: "Space" }} />
        <Stack.Screen name="space/[id]" options={{ title: "Opening Space..." }} />
        <Stack.Screen name="join" options={{ title: "Join Space" }} />
        <Stack.Screen name="join-by-code" options={{ title: "Enter Code" }} />
        <Stack.Screen name="chat/[userId]" options={{ title: "Chat" }} />
        <Stack.Screen name="group-chat/[id]" options={{ title: "Space Chat" }} />
        <Stack.Screen name="create-space" options={{ title: "Create a Space" }} />
        <Stack.Screen name="rent-a-theater" options={{ title: "Host a Watch Party" }} />
        <Stack.Screen name="legal/terms" options={{ title: "Terms of Service" }} />
        <Stack.Screen name="legal/privacy" options={{ title: "Privacy Policy" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="roulette" options={{ title: "Movie Roulette" }} />
        <Stack.Screen name="onboarding-interests" options={{ headerShown: false }} />
        <Stack.Screen name="space-discovery" options={{ headerShown: false }} />
        <Stack.Screen name="create-club" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}

// ToastProvider wraps the navigator rather than living inside a screen so a
// toast survives navigation and renders above the header, and so every screen
// can reach useToast() without threading props.
function RootLayout() {
  return (
    <ToastProvider>
      <Layout />
    </ToastProvider>
  );
}

export default Sentry.wrap(RootLayout);
