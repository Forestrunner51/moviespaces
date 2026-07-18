import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import { SpaceTheme } from "@/frontend/constants/theme";

interface StarfieldProps {
  children?: ReactNode;
  starCount?: number;
}

interface Star {
  key: number;
  left: number;
  top: number;
  size: number;
  opacity: number;
}

// Procedural background wrapper — screens render their content as children
// so it sits on top of a fixed field of stars. Star positions are memoized
// per mount so they don't reshuffle on re-render.
export function Starfield({ children, starCount = 90 }: StarfieldProps) {
  const { width, height } = Dimensions.get("window");

  const stars = useMemo<Star[]>(
    () =>
      Array.from({ length: starCount }, (_, i) => ({
        key: i,
        left: Math.random() * width,
        top: Math.random() * height,
        size: Math.random() * 2 + 1,
        opacity: Math.random() * 0.6 + 0.3,
      })),
    [starCount, width, height],
  );

  return (
    <View style={styles.container}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {stars.map((star) => (
          <View
            key={star.key}
            style={[
              styles.star,
              {
                left: star.left,
                top: star.top,
                width: star.size,
                height: star.size,
                opacity: star.opacity,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SpaceTheme.backgroundVoid },
  star: {
    position: "absolute",
    backgroundColor: SpaceTheme.starWhite,
    borderRadius: 999,
  },
  content: { flex: 1, backgroundColor: "transparent" },
});
