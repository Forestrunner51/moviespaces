import { useEffect, useState } from "react";
import { View, StyleSheet, TouchableOpacity, Share } from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import { Ionicons } from "@expo/vector-icons";
import { SpaceTheme, SpaceStyles, Palette } from "@/frontend/constants/theme";
import { formatCountdown, formatDuration } from "@/frontend/services/cinemind";

interface LockedStateViewProps {
  puzzleNumber: number;
  score: number;
  maxScore: number;
  timeTakenMs: number;
  streakCount: number;
  // Seconds until midnight UTC, from the server. Used as the starting point
  // rather than computing locally so a device with a skewed clock (or a
  // different timezone) still counts down to the real reset.
  secondsUntilNextPuzzle: number;
  shareText?: string | null;
}

export function LockedStateView({
  puzzleNumber,
  score,
  maxScore,
  timeTakenMs,
  streakCount,
  secondsUntilNextPuzzle,
  shareText,
}: LockedStateViewProps) {
  const [remaining, setRemaining] = useState(secondsUntilNextPuzzle);

  useEffect(() => {
    // Anchored to an absolute deadline rather than decrementing a counter:
    // a backgrounded or throttled interval fires late and irregularly, and a
    // decrementing timer would drift permanently behind real time. Recomputing
    // from the deadline self-corrects on every tick.
    //
    // Deliberately impure — reading the real clock is the entire point here.
    // eslint-disable-next-line react-hooks/purity -- see comment above
    const deadline = Date.now() + secondsUntilNextPuzzle * 1000;

    const interval = setInterval(() => {
      setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    }, 1000);

    return () => clearInterval(interval);
  }, [secondsUntilNextPuzzle]);

  const handleShare = async () => {
    if (!shareText) return;
    try {
      await Share.share({ message: shareText });
    } catch {
      // User dismissed the sheet — not an error worth surfacing.
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.lockBadge}>
        <Ionicons name="checkmark-circle" size={40} color={SpaceTheme.glowCyan} />
      </View>

      <Text style={styles.title}>CineMind #{puzzleNumber} complete</Text>
      <Text style={styles.subtitle}>You&apos;ve already played today.</Text>

      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text style={styles.statValue}>
            {score}
            <Text style={styles.statValueMuted}>/{maxScore}</Text>
          </Text>
          <Text style={styles.statLabel}>Score</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBlock}>
          <Text style={styles.statValue}>{formatDuration(timeTakenMs)}</Text>
          <Text style={styles.statLabel}>Time</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBlock}>
          <Text style={styles.statValue}>{streakCount}</Text>
          <Text style={styles.statLabel}>Streak</Text>
        </View>
      </View>

      <View style={styles.countdownCard}>
        <Text style={styles.countdownLabel}>Next CineMind in</Text>
        <Text style={styles.countdownValue}>{formatCountdown(remaining)}</Text>
        {remaining === 0 && (
          <Text style={styles.countdownReady}>New puzzle ready — pull to refresh.</Text>
        )}
      </View>

      {shareText && (
        <TouchableOpacity activeOpacity={0.85} style={styles.shareButton} onPress={handleShare}>
          <Ionicons name="share-outline" size={18} color={SpaceTheme.backgroundVoid} />
          <Text style={styles.shareButtonText}>Share Result</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", paddingVertical: 24 },
  lockBadge: { marginBottom: 12 },
  title: { fontSize: 22, fontWeight: "700", color: SpaceTheme.starWhite, textAlign: "center" },
  subtitle: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginTop: 4, marginBottom: 24 },
  statsRow: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 12,
    width: "100%",
  },
  statBlock: { flex: 1, alignItems: "center" },
  statDivider: { width: 1, height: 32, backgroundColor: Palette.border },
  statValue: { fontSize: 20, fontWeight: "700", color: SpaceTheme.starWhite },
  statValueMuted: { fontSize: 14, color: SpaceTheme.mutedOrbit, fontWeight: "600" },
  statLabel: {
    fontSize: 11,
    color: SpaceTheme.mutedOrbit,
    marginTop: 4,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  countdownCard: {
    ...SpaceStyles.glassCard,
    alignItems: "center",
    paddingVertical: 20,
    width: "100%",
    marginTop: 16,
    borderColor: Palette.accentBorder,
  },
  countdownLabel: {
    fontSize: 12,
    color: SpaceTheme.mutedOrbit,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  countdownValue: {
    fontSize: 30,
    fontWeight: "700",
    color: SpaceTheme.glowCyan,
    marginTop: 6,
    fontVariant: ["tabular-nums"],
  },
  countdownReady: { fontSize: 12, color: SpaceTheme.accentGold, marginTop: 8 },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: SpaceTheme.glowCyan,
    borderRadius: 12,
    paddingVertical: 14,
    width: "100%",
    marginTop: 20,
  },
  shareButtonText: { color: SpaceTheme.backgroundVoid, fontSize: 15, fontWeight: "700" },
});
