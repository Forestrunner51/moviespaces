import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { authFetch } from "@/frontend/services/api";
import { consumePendingRedirect } from "@/frontend/services/pending-redirect";

// Genres match the seeded public Community Spaces' GenreCategory exactly
// (see GroupController.SeedCommunitySpaces) — picking "Horror" here has to
// name the same club auto-join is matching against on the backend.
const GENRES = ["Horror", "Sci-Fi", "Blockbusters"] as const;

const ONBOARDED_KEY = "hasOnboardedInterests";

// Shown once, right after auth succeeds (see auth.tsx). Solves the empty-room
// problem: a brand new user with no real-life friends on the app yet would
// otherwise have zero Spaces and a permanently empty CineMind leaderboard —
// this gets them into at least one populated, evergreen Community Space
// before they ever see the home screen.
export default function OnboardingInterestsScreen() {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const finish = async () => {
    await AsyncStorage.setItem(ONBOARDED_KEY, "1");
    router.replace(consumePendingRedirect() ?? "/");
  };

  const toggle = (genre: string) => {
    setSelected((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]));
  };

  const handleContinue = async () => {
    setLoading(true);
    try {
      const displayName = (await AsyncStorage.getItem("userName")) || "";
      const res = await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/community-spaces/auto-join`, {
        method: "POST",
        body: JSON.stringify({ genres: selected, displayName }),
      });
      // Best-effort: a failed auto-join shouldn't strand a new user on the
      // onboarding screen — they land in the app either way and can join
      // Community Spaces manually later via Explore. Still logged (fetch
      // doesn't throw on 4xx/5xx) so a real server-side failure isn't
      // completely invisible in dev.
      if (!res.ok) console.warn("Auto-join returned", res.status);
    } catch (err) {
      console.warn("Auto-join failed:", err);
    } finally {
      setLoading(false);
      await finish();
    }
  };

  return (
    <Starfield>
      <View style={styles.container}>
        <Ionicons name="film-outline" size={40} color={SpaceTheme.glowCyan} />
        <Text style={styles.title}>What do you like to watch?</Text>
        <Text style={styles.subtitle}>
          Pick a few genres and we&apos;ll drop you into matching Community Spaces —
          instant leaderboards, no friends required yet.
        </Text>

        <View style={styles.pillRow}>
          {GENRES.map((genre) => {
            const active = selected.includes(genre);
            return (
              <TouchableOpacity
                key={genre}
                activeOpacity={0.8}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => toggle(genre)}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{genre}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={SpaceTheme.backgroundVoid} />
          ) : (
            <Text style={styles.buttonText}>
              {selected.length > 0 ? "Join My Communities" : "Continue"}
            </Text>
          )}
        </TouchableOpacity>

        {selected.length === 0 && (
          <TouchableOpacity activeOpacity={0.7} onPress={finish} disabled={loading}>
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        )}
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", padding: 24, paddingTop: 90, gap: 6 },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginTop: 14,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: SpaceTheme.mutedOrbit,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 28,
  },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 32 },
  pill: { ...SpaceStyles.glassCard, paddingVertical: 12, paddingHorizontal: 20 },
  pillActive: { borderColor: SpaceTheme.glowCyan, backgroundColor: "rgba(56,189,248,0.14)" },
  pillText: { color: SpaceTheme.mutedOrbit, fontSize: 15, fontWeight: "600" },
  pillTextActive: { color: SpaceTheme.glowCyan, fontWeight: "700" },
  button: {
    width: "100%",
    backgroundColor: SpaceTheme.glowCyan,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: SpaceTheme.backgroundVoid, fontSize: 16, fontWeight: "700" },
  skipText: { color: SpaceTheme.mutedOrbit, fontSize: 13, marginTop: 18, textDecorationLine: "underline" },
});
