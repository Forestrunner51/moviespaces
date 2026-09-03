// Must load before supabase-js constructs its client. See the module itself
// for why this is guarded rather than an unconditional polyfill import.
import { hasRandomValuesNativeModule } from "@/frontend/services/random-values-polyfill";
import { DarkTheme, ThemeProvider, Stack, router, usePathname } from "expo-router";
import type { ErrorBoundaryProps } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import * as Sentry from "@sentry/react-native";
import { useFonts, BebasNeue_400Regular } from "@expo-google-fonts/bebas-neue";
import {
  Karla_400Regular,
  Karla_400Regular_Italic,
  Karla_500Medium,
  Karla_600SemiBold,
  Karla_700Bold,
} from "@expo-google-fonts/karla";
import "@/frontend/services/sentry";
import { AnimatedSplashOverlay } from "@/frontend/components/animated-icon";
import { supabase } from "@/frontend/config/supabase";
import { Text } from "@/frontend/components/scaled-text";
import { SpaceTheme, Palette, Type, Radius } from "@/frontend/constants/theme";
import { registerForPushNotifications } from "@/frontend/services/push-notifications";
import {
  configureNotificationHandler,
  startNotificationRouting,
} from "@/frontend/services/notification-routing";
import { FriendsProvider } from "@/frontend/hooks/use-friends";
import { resetBlockedIds } from "@/frontend/services/moderation";
import { setPendingRedirect } from "@/frontend/services/pending-redirect";
import { ToastProvider } from "@/frontend/components/toast";

// Module scope, once per cold start. Foreground pushes are invisible on iOS
// without a handler registered before the first one arrives.
configureNotificationHandler();

// The polyfill silently skips installing when its native module isn't linked
// (see the module) — supabase-js then falls back to Math.random() for PKCE
// verifiers. That's tolerable in an old dev build but must not ship, so a
// TestFlight build without it shows up in Sentry.
if (!hasRandomValuesNativeModule) {
  Sentry.captureMessage("random-values native module missing; PKCE using insecure fallback", "warning");
}

// Font-scaling cap lives in @/frontend/components/scaled-text (a wrapper
// Text/TextInput every screen imports) — the old Text.defaultProps
// assignment here was a no-op under React 19.

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
  const [fontsLoaded, fontError] = useFonts({
    BebasNeue_400Regular,
    Karla_400Regular,
    // Two screens set fontStyle: "italic" on a Type token; without a loaded
    // italic face iOS silently renders them upright.
    Karla_400Regular_Italic,
    Karla_500Medium,
    Karla_600SemiBold,
    Karla_700Bold,
  });
  const fontsReady = fontsLoaded || !!fontError;
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
        // The next account must not inherit this one's cached block list.
        resetBlockedIds();
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

  // Tap-to-open routing for pushes (and the tap that cold-started the app).
  // Waits for a session and a mounted navigator so router.push has somewhere
  // to go; the auth redirect above wins for a signed-out user.
  useEffect(() => {
    if (!session || !fontsReady) return;
    return startNotificationRouting();
  }, [session, fontsReady]);

  // Hold on the animated splash until the display font is ready (keeps titles
  // from flashing in the system font). The overlay covers the blank frame.
  // A font load *failure* also proceeds — otherwise the app sits on the
  // splash forever with the system font available the whole time.
  if (!fontsReady) {
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
        <Stack.Screen name="tour" options={{ headerShown: false }} />
        <Stack.Screen name="roulette" options={{ title: "Movie Roulette" }} />
        <Stack.Screen name="onboarding-interests" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding-taste" options={{ headerShown: false }} />
        <Stack.Screen name="space-discovery" options={{ headerShown: false }} />
        <Stack.Screen name="create-club" options={{ headerShown: false }} />
        <Stack.Screen name="match" options={{ headerShown: false }} />
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
      <FriendsProvider>
        <Layout />
      </FriendsProvider>
    </ToastProvider>
  );
}

// Production error boundary: expo-router renders this instead of a white
// screen (or a dev red box) when a screen throws. Deliberately plain — no
// hooks that could themselves throw, no fonts assumed, just the app's dark
// palette and a way back.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <View style={errorStyles.screen}>
      <Text style={errorStyles.title}>Something went wrong</Text>
      <Text style={errorStyles.message}>{error?.message || "An unexpected error occurred."}</Text>
      <TouchableOpacity activeOpacity={0.8} style={errorStyles.button} onPress={() => retry()}>
        <Text style={errorStyles.buttonText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

const errorStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: SpaceTheme.backgroundVoid,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  title: { ...Type.body, color: SpaceTheme.starWhite, fontWeight: "700", marginBottom: 8 },
  message: { ...Type.small, color: SpaceTheme.mutedOrbit, textAlign: "center", marginBottom: 24 },
  button: {
    backgroundColor: Palette.accent,
    borderRadius: Radius.pill,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonText: { ...Type.small, color: Palette.base, fontWeight: "700" },
});

export default Sentry.wrap(RootLayout);
