import { DarkTheme, ThemeProvider, Stack, router, usePathname } from "expo-router";
import { useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import "@/frontend/services/sentry";
import { AnimatedSplashOverlay } from "@/frontend/components/animated-icon";
import { supabase } from "@/frontend/config/supabase";
import { SpaceTheme } from "@/frontend/constants/theme";
import { registerForPushNotifications } from "@/frontend/services/push-notifications";
import { setPendingRedirect } from "@/frontend/services/pending-redirect";

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
    border: "rgba(255, 255, 255, 0.08)",
    notification: SpaceTheme.supernovaPink,
  },
};

function Layout() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
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
      registerForPushNotifications();
    }
  }, [session]);

  return (
    <ThemeProvider value={SpaceNavigationTheme}>
      <AnimatedSplashOverlay />
      <Stack>
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="group" options={{ title: "Movie Group" }} />
        <Stack.Screen name="space/[id]" options={{ title: "Opening Space..." }} />
        <Stack.Screen name="join" options={{ title: "Join Group" }} />
        <Stack.Screen name="chat/[userId]" options={{ title: "Chat" }} />
        <Stack.Screen name="group-chat/[id]" options={{ title: "Group Chat" }} />
        <Stack.Screen name="create-space" options={{ title: "Create a Space" }} />
        <Stack.Screen name="rent-a-theater" options={{ title: "Rent a Theater" }} />
        <Stack.Screen name="legal/terms" options={{ title: "Terms of Service" }} />
        <Stack.Screen name="legal/privacy" options={{ title: "Privacy Policy" }} />
      </Stack>
    </ThemeProvider>
  );
}

export default Sentry.wrap(Layout);
