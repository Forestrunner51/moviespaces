import { useEffect } from "react";
import { StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withDelay,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { SpaceTheme } from "@/frontend/constants/theme";

const { width } = Dimensions.get("window");

// Fraction of each cycle spent actually streaking across — the rest is an
// invisible pause, so a streak "shoots" then rests rather than moving
// continuously.
const TRAVEL = 0.28;

interface StreakConfig {
  startX: number;
  startY: number;
  length: number;
  duration: number;
  delay: number;
}

// A single diagonal streak that shoots across, fades out, pauses, repeats.
// Only one View is animated per streak (three total), so this is cheap even
// though it loops forever — safe to sit behind the auth screen.
function Streak({ startX, startY, length, duration, delay }: StreakConfig) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1),
    );
  }, [progress, duration, delay]);

  const animatedStyle = useAnimatedStyle(() => {
    const t = progress.value;
    // Clamp travel to [0,1] so the streak parks at its end point during the
    // pause portion of the cycle (it's invisible then anyway).
    const travelT = Math.min(t / TRAVEL, 1);
    return {
      opacity: interpolate(t, [0, 0.02, TRAVEL * 0.7, TRAVEL, 1], [0, 0.9, 0.9, 0, 0]),
      transform: [
        { translateX: startX + travelT * length },
        { translateY: startY + travelT * length * 0.5 },
        { rotateZ: "27deg" },
      ],
    };
  });

  return <Animated.View style={[styles.streak, animatedStyle]} />;
}

// Staggered so the three streaks don't all fire at once.
const STREAKS: StreakConfig[] = [
  { startX: width * 0.1, startY: -30, length: width * 0.95, duration: 3600, delay: 0 },
  { startX: width * 0.45, startY: 30, length: width * 0.7, duration: 4200, delay: 1400 },
  { startX: -40, startY: 130, length: width * 0.85, duration: 3900, delay: 2600 },
];

// Decorative shooting-star overlay. pointerEvents="none" (via the streak
// style) keeps it from intercepting touches on whatever it sits over.
export function ShootingStars() {
  return (
    <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none">
      {STREAKS.map((cfg, i) => (
        <Streak key={i} {...cfg} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  streak: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 90,
    height: 2,
    borderRadius: 2,
    backgroundColor: SpaceTheme.starWhite,
    shadowColor: SpaceTheme.glowCyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
});
