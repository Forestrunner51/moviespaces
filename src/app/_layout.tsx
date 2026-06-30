import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import { Stack, router } from "expo-router";
import { useColorScheme } from "react-native";
import { useEffect, useState } from "react";
import { AnimatedSplashOverlay } from "@/frontend/components/animated-icon";
import { supabase } from "@/frontend/config/supabase";

export default function Layout() {
  const colorScheme = useColorScheme();
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
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack>
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="showtimes" options={{ title: "Showtimes" }} />
        <Stack.Screen name="group" options={{ title: "Movie Group" }} />
        <Stack.Screen name="join" options={{ title: "Join Group" }} />
        <Stack.Screen name="confirm" options={{ title: "Confirm" }} />
        <Stack.Screen name="movie" options={{ title: "Movie" }} />
      </Stack>
    </ThemeProvider>
  );
}
