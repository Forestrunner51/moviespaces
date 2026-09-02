import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import { Ionicons } from "@expo/vector-icons";
import { Palette, Type } from "@/frontend/constants/theme";

// The projector-warming-up lines. Ordered so the first one shown (index 0)
// works everywhere; the rest rotate in for anyone staring at a slow network.
const LINES = [
  "Rolling film…",
  "Dimming the lights…",
  "Finding your seats…",
  "Buttering the popcorn…",
  "Cueing the trailers…",
  "Quiet on set…",
  "Splicing the reel…",
  "One ticket, please…",
];

// A film-reel spinner with a rotating one-liner — the app's page-level
// loading state. Keep plain ActivityIndicator for tiny inline waits (inside
// buttons, next to a search box); this is for "the screen isn't here yet".
export function FilmLoader({
  line,
  full,
  style,
}: {
  // Fixed caption instead of the rotating lines (e.g. "Loading crews…").
  line?: string;
  // Fill and center in the available space (page-level loading).
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  // useState initializer, not useRef.current — the React Compiler purity
  // rule forbids reading a ref during render.
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1700,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const [lineIndex, setLineIndex] = useState(0);
  useEffect(() => {
    if (line) return;
    const t = setInterval(() => setLineIndex((v) => (v + 1) % LINES.length), 2200);
    return () => clearInterval(t);
  }, [line]);

  return (
    <View style={[styles.wrap, full && styles.full, style]} accessibilityLabel="Loading">
      <Animated.View
        style={{
          transform: [
            { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
          ],
        }}
      >
        <Ionicons name="aperture" size={34} color={Palette.accent} />
      </Animated.View>
      <Text style={styles.caption}>{line ?? LINES[lineIndex]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 18 },
  full: { flex: 1 },
  caption: { ...Type.caption, color: Palette.textMuted, fontStyle: "italic" },
});
