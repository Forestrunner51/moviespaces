import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles, Palette } from "@/frontend/constants/theme";
import { authFetch } from "@/frontend/services/api";
import { completeOnboarding } from "@/frontend/services/onboarding";

interface DiscoverSpace {
  id: string;
  displayName: string;
  spaceCode: string | null;
  genreCategory: string | null;
  memberCount: number;
  playedTodayCount: number;
  todayAvgScore: number | null;
  isJoined: boolean;
}

// Icons rather than emoji — see event-categories.ts for the reasoning.
const ICON_BY_GENRE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Blockbusters: "film-outline",
  "Sci-Fi": "planet-outline",
  Horror: "skull-outline",
  Indie: "color-palette-outline",
  Action: "flash-outline",
  General: "videocam-outline",
};

// Preview-before-joining: reached from onboarding's genre picker (with
// selected genres as a param) or, in principle, anywhere else that wants to
// let someone browse Community Spaces — the genres param is optional, and an
// empty one just shows every public club.
export default function SpaceDiscoveryScreen() {
  const { genres } = useLocalSearchParams<{ genres?: string }>();
  const [spaces, setSpaces] = useState<DiscoverSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const query = genres ? `?genres=${encodeURIComponent(genres)}` : "";
      const res = await authFetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/community-spaces/discover${query}`,
      );
      if (!res.ok) throw new Error(`Couldn't load Spaces (${res.status}).`);
      const data = await res.json();
      setSpaces(data.spaces ?? []);
    } catch (err: any) {
      setErrorText(err?.message || "Couldn't load Community Spaces.");
    } finally {
      setLoading(false);
    }
  }, [genres]);

  useEffect(() => {
    load();
  }, [load]);

  const handleJoin = async (space: DiscoverSpace) => {
    setJoiningId(space.id);
    try {
      const res = await authFetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/${space.id}/join`,
        { method: "POST", body: JSON.stringify({ name: "" }) },
      );
      if (res.ok) {
        setSpaces((prev) => prev.map((s) => (s.id === space.id ? { ...s, isJoined: true } : s)));
      }
      // A failed join here isn't fatal to the flow — the card just stays in
      // its "Join" state and the user can retry, same as any other tap.
    } finally {
      setJoiningId(null);
    }
  };

  const handleContinue = async () => {
    setFinishing(true);
    await completeOnboarding();
  };

  return (
    <Starfield>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Discover Your Cinema Clubs</Text>
        <Text style={styles.subtitle}>
          {genres ? "Matching your picks" : "Every public Community Space"} — join any that look good.
        </Text>

        {loading && <ActivityIndicator color={SpaceTheme.glowCyan} style={styles.loading} />}

        {errorText && !loading && (
          <View style={styles.card}>
            <Text style={styles.errorText}>{errorText}</Text>
            <TouchableOpacity activeOpacity={0.85} style={styles.retryButton} onPress={load}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !errorText && spaces.length === 0 && (
          <View style={styles.card}>
            <Text style={styles.emptyText}>No Community Spaces matched — try different genres.</Text>
          </View>
        )}

        {!loading &&
          spaces.map((space) => (
            <View key={space.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons
                  name={ICON_BY_GENRE[space.genreCategory ?? ""] ?? "videocam-outline"}
                  size={22}
                  color={Palette.accent}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{space.displayName}</Text>
                  {!!space.genreCategory && <Text style={styles.genreBadge}>{space.genreCategory}</Text>}
                </View>
              </View>

              <View style={styles.statsRow}>
                <Text style={styles.statText}>{space.memberCount} members</Text>
                <Text style={styles.statText}>
                  {space.playedTodayCount > 0
                    ? `${space.playedTodayCount} played today · avg ${space.todayAvgScore}`
                    : "No plays yet today"}
                </Text>
              </View>

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.previewButton}
                  onPress={() => router.push({ pathname: "/group", params: { groupId: space.id } })}
                >
                  <Text style={styles.previewButtonText}>Preview</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.joinButton, space.isJoined && styles.joinButtonJoined]}
                  onPress={() => handleJoin(space)}
                  disabled={space.isJoined || joiningId === space.id}
                >
                  {joiningId === space.id ? (
                    <ActivityIndicator size="small" color={SpaceTheme.backgroundVoid} />
                  ) : (
                    <Text style={[styles.joinButtonText, space.isJoined && styles.joinButtonTextJoined]}>
                      {space.isJoined ? "Joined ✓" : "Join Space"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ))}

        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.continueButton, finishing && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={finishing}
        >
          {finishing ? (
            <ActivityIndicator color={SpaceTheme.backgroundVoid} />
          ) : (
            <Text style={styles.continueButtonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: "700", color: SpaceTheme.starWhite, textAlign: "center" },
  subtitle: {
    fontSize: 13,
    color: SpaceTheme.mutedOrbit,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 24,
  },
  loading: { marginVertical: 24 },
  card: { ...SpaceStyles.glassCard, padding: 16, marginBottom: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  emoji: { fontSize: 30 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: SpaceTheme.starWhite },
  genreBadge: {
    fontSize: 11,
    color: SpaceTheme.glowCyan,
    fontWeight: "700",
    textTransform: "uppercase",
    marginTop: 2,
  },
  statsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  statText: { fontSize: 12, color: SpaceTheme.mutedOrbit },
  actionsRow: { flexDirection: "row", gap: 10 },
  previewButton: {
    ...SpaceStyles.glassCard,
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
  },
  previewButtonText: { color: SpaceTheme.mutedOrbit, fontSize: 13, fontWeight: "700" },
  joinButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: SpaceTheme.glowCyan,
    borderRadius: 10,
    paddingVertical: 11,
  },
  joinButtonJoined: { backgroundColor: "rgba(255,255,255,0.08)" },
  joinButtonText: { color: SpaceTheme.backgroundVoid, fontSize: 13, fontWeight: "700" },
  joinButtonTextJoined: { color: SpaceTheme.mutedOrbit },
  errorText: { color: SpaceTheme.starWhite, fontSize: 14, textAlign: "center", marginBottom: 12 },
  retryButton: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 16 },
  retryButtonText: { color: SpaceTheme.glowCyan, fontSize: 13, fontWeight: "700" },
  emptyText: { color: SpaceTheme.mutedOrbit, fontSize: 14, textAlign: "center" },
  continueButton: {
    backgroundColor: SpaceTheme.accentGold,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  continueButtonDisabled: { opacity: 0.6 },
  continueButtonText: { color: SpaceTheme.backgroundVoid, fontSize: 16, fontWeight: "700" },
});
