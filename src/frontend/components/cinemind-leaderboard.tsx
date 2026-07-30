import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import {
  fetchSpaceLeaderboard,
  formatDuration,
  SpaceLeaderboard,
} from "@/frontend/services/cinemind";

interface CineMindLeaderboardProps {
  spaceId: string;
}

// Today's CineMind standings for one Space, shown inside the Space screen.
//
// Renders nothing at all when nobody in the Space has played yet — an empty
// leaderboard is just noise on a screen that's primarily about a screening,
// and a Space whose members don't play the game shouldn't carry a permanent
// dead section.
export function CineMindLeaderboard({ spaceId }: CineMindLeaderboardProps) {
  const [data, setData] = useState<SpaceLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchSpaceLeaderboard(spaceId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  if (loading) {
    return <ActivityIndicator color={SpaceTheme.glowCyan} style={styles.loading} />;
  }

  // Null covers both "request failed" and "not a member" — the leaderboard is
  // supplementary, so neither should surface as an error on this screen.
  if (!data) return null;

  const youPlayed = data.leaderboard.some((entry) => entry.isYou);

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>🧠 CineMind Today</Text>
        <Text style={styles.playedCount}>
          {data.playedCount}/{data.memberCount} played
        </Text>
      </View>

      {data.leaderboard.length === 0 ? (
        <Text style={styles.emptyText}>Nobody here has played today&apos;s puzzle yet.</Text>
      ) : (
        data.leaderboard.map((entry) => (
          <View key={entry.userId} style={[styles.row, entry.isYou && styles.rowYou]}>
            <Text style={styles.rank}>{medalFor(entry.rank)}</Text>
            <Text style={[styles.name, entry.isYou && styles.nameYou]} numberOfLines={1}>
              {entry.name}
              {entry.isYou ? " (you)" : ""}
            </Text>
            {entry.streakCount > 1 && <Text style={styles.streak}>🔥{entry.streakCount}</Text>}
            <Text style={styles.time}>{formatDuration(entry.timeTakenMs)}</Text>
            <Text style={styles.score}>{entry.score}</Text>
          </View>
        ))
      )}

      {!youPlayed && (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.playButton}
          onPress={() => router.push("/cinemind")}
        >
          <Text style={styles.playButtonText}>Play Today&apos;s Puzzle</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Medals for the top three, plain numbers below — the visual reward is the
// point of a daily leaderboard.
function medalFor(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `${rank}`;
}

const styles = StyleSheet.create({
  loading: { marginVertical: 16 },
  section: { ...SpaceStyles.glassCard, padding: 16, marginTop: 16 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: SpaceTheme.starWhite },
  playedCount: { fontSize: 12, color: SpaceTheme.mutedOrbit },
  emptyText: { fontSize: 13, color: SpaceTheme.mutedOrbit, marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  rowYou: { backgroundColor: "rgba(56,189,248,0.08)", borderRadius: 8, paddingHorizontal: 6 },
  rank: { fontSize: 14, width: 26, color: SpaceTheme.mutedOrbit, fontWeight: "700" },
  name: { flex: 1, fontSize: 14, color: SpaceTheme.starWhite },
  nameYou: { fontWeight: "700", color: SpaceTheme.glowCyan },
  streak: { fontSize: 12, color: SpaceTheme.accentGold },
  time: { fontSize: 12, color: SpaceTheme.mutedOrbit, fontVariant: ["tabular-nums"] },
  score: {
    fontSize: 15,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    width: 40,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  playButton: {
    backgroundColor: SpaceTheme.accentGold,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    marginTop: 12,
  },
  playButtonText: { color: SpaceTheme.backgroundVoid, fontSize: 14, fontWeight: "700" },
});
