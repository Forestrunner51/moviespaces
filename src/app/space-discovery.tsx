import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceStyles, Palette, Type, Display, Radius } from "@/frontend/constants/theme";
import { useToast } from "@/frontend/components/toast";
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
  const { showToast } = useToast();
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
      } else {
        // Was silent — a first-run user tapping Join on flaky signal saw
        // nothing happen and couldn't tell if it worked. Tell them.
        const body = await res.json().catch(() => null);
        showToast(body?.error || "Couldn't join that club. Please try again.");
      }
    } catch {
      showToast("Network error — please try again.");
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

        {loading && <ActivityIndicator color={Palette.accent} style={styles.loading} />}

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
                  {space.playedTodayCount === 0
                    ? "No plays yet today"
                    : space.todayAvgScore != null
                      ? `${space.playedTodayCount} played today · avg ${space.todayAvgScore}`
                      : `${space.playedTodayCount} played today`}
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
                    <ActivityIndicator size="small" color={Palette.base} />
                  ) : (
                    <Text style={[styles.joinButtonText, space.isJoined && styles.joinButtonTextJoined]}>
                      {space.isJoined ? "Joined" : "Join Space"}
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
            <ActivityIndicator color={Palette.base} />
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
  title: { ...Display.heading, color: Palette.text, textAlign: "center" },
  subtitle: {
    ...Type.small,
    color: Palette.textMuted,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 24,
  },
  loading: { marginVertical: 24 },
  card: { ...SpaceStyles.glassCard, padding: 16, marginBottom: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  cardTitle: { ...Type.body, fontWeight: "700", color: Palette.text },
  genreBadge: {
    ...Type.caption,
    color: Palette.accent,
    fontWeight: "700",
    textTransform: "uppercase",
    marginTop: 2,
  },
  statsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  statText: { ...Type.caption, color: Palette.textMuted },
  actionsRow: { flexDirection: "row", gap: 10 },
  previewButton: {
    ...SpaceStyles.field,
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
  },
  previewButtonText: { ...Type.small, color: Palette.textMuted, fontWeight: "700" },
  joinButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Palette.accent,
    borderRadius: Radius.small,
    paddingVertical: 11,
  },
  joinButtonJoined: { backgroundColor: Palette.surfaceHover },
  joinButtonText: { ...Type.small, color: Palette.base, fontWeight: "700" },
  joinButtonTextJoined: { color: Palette.textMuted },
  errorText: { ...Type.small, color: Palette.text, textAlign: "center", marginBottom: 12 },
  retryButton: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 16 },
  retryButtonText: { ...Type.small, color: Palette.accent, fontWeight: "700" },
  emptyText: { ...Type.small, color: Palette.textMuted, textAlign: "center" },
  continueButton: {
    backgroundColor: Palette.accent,
    borderRadius: Radius.medium,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  continueButtonDisabled: { opacity: 0.6 },
  continueButtonText: { ...Type.body, color: Palette.base, fontWeight: "700" },
});
