import { DarkTheme, ThemeProvider } from "expo-router";
import { Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { AnimatedSplashOverlay } from "@/frontend/components/animated-icon";
import { supabase } from "@/frontend/config/supabase";
import { SpaceTheme } from "@/frontend/constants/theme";

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

export default function Layout() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
        router.replace("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!loading) {
      if (!session) {
        router.replace("/auth");
      }
    }
  }, [session, loading]);

  return (
    <ThemeProvider value={SpaceNavigationTheme}>
      <AnimatedSplashOverlay />
      <Stack>
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="showtimes" options={{ title: "Showtimes" }} />
        <Stack.Screen name="group" options={{ title: "Movie Group" }} />
        <Stack.Screen name="join" options={{ title: "Join Group" }} />
        <Stack.Screen name="movie" options={{ title: "Movie" }} />
        <Stack.Screen name="chat/[userId]" options={{ title: "Chat" }} />
        <Stack.Screen name="group-chat/[id]" options={{ title: "Group Chat" }} />
        <Stack.Screen name="create-space" options={{ title: "Create a Space" }} />
        <Stack.Screen name="rent-a-theater" options={{ title: "Rent a Theater" }} />
      </Stack>
    </ThemeProvider>
  );
}
