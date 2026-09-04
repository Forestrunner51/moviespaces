import { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles, Palette, Type, Radius, Display } from "@/frontend/constants/theme";
import {
  fetchGlobalLeaderboard,
  formatDuration,
  GlobalLeaderboard,
  LeaderboardEntry,
} from "@/frontend/services/cinemind";

interface GlobalLeaderboardViewProps {
  // Formerly its own tab/route (/leaderboard) — now a mode within the
  // CineMind tab, so this is how it hands control back to the puzzle view
  // instead of a router.push.
  onBack: () => void;
}

// Today's CineMind standings across every player.
//
// Deliberately global rather than per-Space: the Space board only exists
// inside a Space, so a player with no Spaces finished a puzzle and had
// nowhere to see where they landed. This is the screen that always works.
export function GlobalLeaderboardView({ onBack }: GlobalLeaderboardViewProps) {
  const [period, setPeriod] = useState<"today" | "week">("today");
  const [data, setData] = useState<GlobalLeaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // The initial run deliberately sets no state before its first await:
  // `loading` already starts true, and a synchronous setState inside an
  // effect body triggers a cascading render. Retry and pull-to-refresh are
  // user-initiated, so they're free to update state immediately.
  const load = useCallback(async (mode: "initial" | "retry" | "refresh" = "initial") => {
    if (mode === "refresh") setRefreshing(true);
    if (mode === "retry") {
      setLoading(true);
      setError(null);
    }

    try {
      const next = await fetchGlobalLeaderboard(period);
      setData(next);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Couldn't load the leaderboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Starfield>
        <ActivityIndicator size="large" color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
      </Starfield>
    );
  }

  // Ranked below the visible cutoff — pinned separately so you can always
  // find yourself without scrolling a list you aren't on.
  const youAreListed = data?.leaderboard.some((entry) => entry.isYou) ?? false;
  const showPinnedYou = !!data?.you && !youAreListed;

  return (
    <Starfield>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load("refresh")}
            tintColor={SpaceTheme.glowCyan}
          />
        }
      >
        <TouchableOpacity activeOpacity={0.7} style={styles.backRow} onPress={onBack} hitSlop={10}>
          <Ionicons name="chevron-back" size={18} color={SpaceTheme.mutedOrbit} />
          <Text style={styles.backRowText}>Back to Puzzle</Text>
        </TouchableOpacity>

        <Text style={styles.title}>
          {period === "week" ? "This Week\u2019s Leaderboard" : "Today\u2019s Leaderboard"}
        </Text>
        {!!data && (
          <Text style={styles.subtitle}>
            {data.playedCount} {data.playedCount === 1 ? "player" : "players"}{" "}
            {period === "week" ? "this week — scores add up across the days you play" : "today"}
          </Text>
        )}

        <View style={styles.periodRow}>
          {(["today", "week"] as const).map((p) => (
            <TouchableOpacity
              key={p}
              activeOpacity={0.85}
              style={[styles.periodChip, period === p && styles.periodChipOn]}
              onPress={() => {
                if (p !== period) {
                  setPeriod(p);
                  setLoading(true);
                  setError(null);
                }
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: period === p }}
            >
              <Text style={[styles.periodChipText, period === p && styles.periodChipTextOn]}>
                {p === "today" ? "Today" : "This Week"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {error && (
          <View style={styles.card}>
            <Ionicons name="alert-circle-outline" size={28} color={SpaceTheme.danger} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity activeOpacity={0.85} style={styles.button} onPress={() => load("retry")}>
              <Text style={styles.buttonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {!error && data?.leaderboard.length === 0 && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>
              {period === "week" ? "Nobody has played this week." : "Nobody has played yet today."}
            </Text>
            <Text style={styles.emptyText}>Be the first on the board.</Text>
            <TouchableOpacity activeOpacity={0.85} style={styles.button} onPress={onBack}>
              <Text style={styles.buttonText}>Play Today&apos;s Puzzle</Text>
            </TouchableOpacity>
          </View>
        )}

        {!error && !!data && data.leaderboard.length > 0 && (
          <View style={styles.card}>
            {data.leaderboard.map((entry) => (
              <Row key={entry.rank} entry={entry} />
            ))}
            {data.isTruncated && (
              <Text style={styles.truncatedNote}>
                Showing the top {data.leaderboard.length} of {data.playedCount}.
              </Text>
            )}
          </View>
        )}

        {showPinnedYou && data?.you && (
          <View style={styles.card}>
            <Text style={styles.pinnedLabel}>Your rank</Text>
            <Row entry={data.you} />
          </View>
        )}

        {!error && !data?.you && (data?.leaderboard.length ?? 0) > 0 && (
          <TouchableOpacity activeOpacity={0.85} style={styles.button} onPress={onBack}>
            <Text style={styles.buttonText}>Play Today&apos;s Puzzle</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </Starfield>
  );
}

function Row({ entry }: { entry: LeaderboardEntry }) {
  return (
    <View style={[styles.row, entry.isYou && styles.rowYou]}>
      <Text style={styles.rank}>{medalFor(entry.rank)}</Text>
      <Text style={[styles.name, entry.isYou && styles.nameYou]} numberOfLines={1}>
        {entry.name}
        {entry.isYou ? " (you)" : ""}
      </Text>
      {entry.streakCount > 1 && <Text style={styles.streak}>🔥{entry.streakCount}</Text>}
      <Text style={styles.time}>{formatDuration(entry.timeTakenMs)}</Text>
      <Text style={styles.score}>{entry.score}</Text>
    </View>
  );
}

// Medals for the top three, plain numbers below — matches the Space board so
// a rank reads the same way on both screens.
function medalFor(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `${rank}`;
}

const styles = StyleSheet.create({
  // paddingTop matches the other full-screen Starfield layouts in this app
  // (Explore, Home) — it was 16 before, which put "Back to Puzzle" right at
  // the top edge/notch area and made it unreliable to tap.
  content: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 40 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 2, marginBottom: 16, paddingVertical: 6 },
  backRowText: { ...Type.small, color: SpaceTheme.mutedOrbit, fontWeight: "600" },
  title: { ...Type.title, fontWeight: "700", color: SpaceTheme.starWhite, textAlign: "center" },
  subtitle: {
    ...Type.small,
    color: SpaceTheme.mutedOrbit,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 16,
  },
  periodRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  periodChip: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.raised,
  },
  periodChipOn: { backgroundColor: Palette.accentDim, borderColor: Palette.accentBorder },
  periodChipText: { ...Type.small, color: Palette.textMuted, fontWeight: "600" },
  periodChipTextOn: { color: Palette.accent },
  card: { ...SpaceStyles.glassCard, padding: 16, marginBottom: 16, alignItems: "stretch" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
  },
  rowYou: { backgroundColor: Palette.accentDim, borderRadius: Radius.small, paddingHorizontal: 6 },
  rank: { ...Type.small, width: 30, color: SpaceTheme.mutedOrbit, fontWeight: "700" },
  name: { flex: 1, ...Type.small, color: SpaceTheme.starWhite },
  nameYou: { fontWeight: "700", color: SpaceTheme.glowCyan },
  streak: { ...Type.caption, color: SpaceTheme.accentGold },
  time: { ...Type.caption, color: SpaceTheme.mutedOrbit, fontVariant: ["tabular-nums"] },
  score: {
    ...Type.body,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    width: 40,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  pinnedLabel: {
    ...Type.caption,
    color: SpaceTheme.mutedOrbit,
    textTransform: "uppercase",
    fontWeight: "700",
    marginBottom: 2,
  },
  truncatedNote: { ...Type.caption, color: SpaceTheme.mutedOrbit, textAlign: "center", marginTop: 10 },
  emptyTitle: { ...Type.body, fontWeight: "700", color: SpaceTheme.starWhite, textAlign: "center" },
  emptyText: {
    ...Type.small,
    color: SpaceTheme.mutedOrbit,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 14,
  },
  errorText: {
    ...Type.small,
    color: SpaceTheme.starWhite,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 14,
  },
  button: {
    backgroundColor: SpaceTheme.accentGold,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonText: { color: SpaceTheme.backgroundVoid, ...Type.small, fontWeight: "700" },
});
