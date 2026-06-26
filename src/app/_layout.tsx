import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import { Stack } from "expo-router";
import { useColorScheme } from "react-native";
import { AnimatedSplashOverlay } from "@/frontend/components/animated-icon";

export default function Layout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack>
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
