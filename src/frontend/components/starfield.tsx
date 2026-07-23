import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { SpaceTheme } from "@/frontend/constants/theme";

interface StarfieldProps {
  children?: ReactNode;
  starCount?: number;
  // Opt-in — a handful of stars occasionally dim/flare instead of staying
  // static. Off by default: this wraps every screen in the app, so only
  // turn it on where a bit of extra motion (e.g. the auth screens) is worth
  // animating a few views for.
  twinkle?: boolean;
}

interface Star {
  key: number;
  left: number;
  top: number;
  size: number;
  opacity: number;
}

// How many stars actually twinkle, regardless of starCount — keeps the
// animated-view count fixed and cheap even if starCount is turned way up.
const TWINKLE_COUNT = 10;

// A single star that occasionally dips and flares back — not a continuous
// pulse. Random per-star delay/pause so the whole field doesn't twinkle in
// unison.
function TwinkleStar({ star }: { star: Star }) {
  const opacity = useSharedValue(star.opacity);

  useEffect(() => {
    // Deliberately impure (Math.random for timing) — see the same exception
    // already taken in the useMemo below; this is decorative-only motion,
    // recomputing it doesn't affect correctness anywhere else.
    const initialDelay = Math.random() * 4000;
    const pause = 2500 + Math.random() * 4000;
    opacity.value = withDelay(
      initialDelay,
      withRepeat(
        withSequence(
          withTiming(star.opacity * 0.2, { duration: 350 }),
          withTiming(star.opacity, { duration: 350 }),
          withDelay(pause, withTiming(star.opacity, { duration: 0 })),
        ),
        -1,
      ),
    );
  }, [opacity, star.opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        styles.star,
        { left: star.left, top: star.top, width: star.size, height: star.size },
        animatedStyle,
      ]}
    />
  );
}

// Procedural background wrapper — screens render their content as children
// so it sits on top of a fixed field of stars. Star positions are memoized
// per mount so they don't reshuffle on re-render.
export function Starfield({ children, starCount = 90, twinkle = false }: StarfieldProps) {
  const { width, height } = Dimensions.get("window");

  // Deliberately impure inside useMemo: a purely decorative, randomized star
  // field that's meant to reshuffle only when starCount/width/height change
  // (e.g. device rotation), not on every re-render. There's no correctness
  // requirement for determinism here (unlike data derived from props/state),
  // so this is a safe, intentional exception to the purity rule rather than
  // an oversight.
  /* eslint-disable react-hooks/purity -- see comment above */
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
  const twinkleKeys = useMemo(() => {
    if (!twinkle) return new Set<number>();
    const shuffled = [...stars].sort(() => Math.random() - 0.5);
    return new Set(shuffled.slice(0, Math.min(TWINKLE_COUNT, stars.length)).map((s) => s.key));
  }, [stars, twinkle]);
  /* eslint-enable react-hooks/purity */

  return (
    <View style={styles.container}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {stars.map((star) =>
          twinkleKeys.has(star.key) ? (
            <TwinkleStar key={star.key} star={star} />
          ) : (
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
          ),
        )}
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
