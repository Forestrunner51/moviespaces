import { View, Text, StyleSheet } from "react-native";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { CineMindStats } from "@/frontend/services/cinemind";

interface CineMindStatsCardProps {
  stats: CineMindStats;
}

// Lifetime stats for the player — the part of a daily game that gives a
// single day's score any meaning. Shown after a round and on the locked
// screen, which is where a returning player actually lands.
export function CineMindStatsCard({ stats }: CineMindStatsCardProps) {
  // Nothing to summarize yet on someone's very first day; the result they're
  // already looking at says everything a one-row history could.
  if (stats.gamesPlayed <= 1) return null;

  const bars = [
    { label: "5/5", count: stats.distribution.solved5 },
    { label: "4/5", count: stats.distribution.solved4 },
    { label: "3/5", count: stats.distribution.solved3 },
    { label: "2/5", count: stats.distribution.solved2 },
    { label: "1/5", count: stats.distribution.solved1 },
    { label: "0/5", count: stats.distribution.solved0 },
  ];
  // Scale bars to the most common outcome rather than games played, so the
  // shape of the distribution is readable even when it's lopsided.
  const peak = Math.max(...bars.map((b) => b.count), 1);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Your Stats</Text>

      <View style={styles.statsRow}>
        <Stat value={stats.gamesPlayed} label="Played" />
        <Stat value={stats.currentStreak} label="Streak" />
        <Stat value={stats.maxStreak} label="Max" />
        <Stat value={stats.averageScore} label="Avg" />
      </View>

      <Text style={styles.distributionLabel}>Score distribution</Text>
      {bars.map((bar) => (
        <View key={bar.label} style={styles.barRow}>
          <Text style={styles.barLabel}>{bar.label}</Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                // Always leaves a visible stub for a nonzero count, so a rare
                // outcome doesn't render as an invisible sliver.
                { width: `${bar.count === 0 ? 0 : Math.max(8, (bar.count / peak) * 100)}%` },
                bar.label === "5/5" && styles.barFillPerfect,
              ]}
            />
          </View>
          <Text style={styles.barCount}>{bar.count}</Text>
        </View>
      ))}

      {stats.perfectCount > 0 && (
        <Text style={styles.perfectNote}>
          🏆 {stats.perfectCount} perfect {stats.perfectCount === 1 ? "game" : "games"}
        </Text>
      )}
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.statBlock}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...SpaceStyles.glassCard, padding: 16, marginBottom: 16 },
  title: {
    fontSize: 11,
    color: SpaceTheme.mutedOrbit,
    textTransform: "uppercase",
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 12,
  },
  statsRow: { flexDirection: "row", alignItems: "center", marginBottom: 18 },
  statBlock: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "800", color: SpaceTheme.starWhite },
  statLabel: {
    fontSize: 10,
    color: SpaceTheme.mutedOrbit,
    marginTop: 2,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  distributionLabel: {
    fontSize: 10,
    color: SpaceTheme.mutedOrbit,
    textTransform: "uppercase",
    fontWeight: "700",
    marginBottom: 8,
  },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  barLabel: {
    width: 26,
    fontSize: 12,
    color: SpaceTheme.mutedOrbit,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  barTrack: {
    flex: 1,
    height: 18,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 5, backgroundColor: "rgba(56,189,248,0.55)" },
  barFillPerfect: { backgroundColor: SpaceTheme.accentGold },
  barCount: {
    width: 24,
    fontSize: 12,
    color: SpaceTheme.starWhite,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  perfectNote: {
    fontSize: 12,
    color: SpaceTheme.accentGold,
    textAlign: "center",
    marginTop: 10,
    fontWeight: "600",
  },
});
