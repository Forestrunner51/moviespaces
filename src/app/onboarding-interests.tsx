import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { completeOnboarding } from "@/frontend/services/onboarding";

// Genres match seeded public Community Spaces' GenreCategory exactly (see
// GroupController.SeedCommunitySpaces) — this list and the seed data are
// deliberately 1:1, not an open set. Adding a genre here without a matching
// seeded club just means an empty discovery screen for that pick.
const GENRES = [
  { key: "Blockbusters", label: "Blockbusters", emoji: "🍿" },
  { key: "Sci-Fi", label: "Sci-Fi", emoji: "🔮" },
  { key: "Horror", label: "Horror", emoji: "🩸" },
  { key: "Indie", label: "Indie / Arthouse", emoji: "🎨" },
  { key: "Action", label: "Action", emoji: "⚡" },
] as const;

// Shown once, right after auth succeeds (see auth.tsx). Solves the empty-room
// problem: a brand new user with no real-life friends on the app yet would
// otherwise have zero Spaces and a permanently empty CineMind leaderboard.
// Picking genres here doesn't join anything by itself — it hands off to
// /space-discovery, which previews the matching clubs and makes joining an
// explicit choice, not something that happens silently on your behalf.
export default function OnboardingInterestsScreen() {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (genre: string) => {
    setSelected((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]));
  };

  const handleFindSpaces = () => {
    router.push({ pathname: "/space-discovery", params: { genres: selected.join(",") } });
  };

  return (
    <Starfield>
      <View style={styles.container}>
        <Ionicons name="film-outline" size={40} color={SpaceTheme.glowCyan} />
        <Text style={styles.title}>What do you like to watch?</Text>
        <Text style={styles.subtitle}>
          Pick a few genres to find Community Spaces with people who watch the same stuff —
          instant leaderboards, no friends required yet.
        </Text>

        <View style={styles.pillRow}>
          {GENRES.map(({ key, label, emoji }) => {
            const active = selected.includes(key);
            return (
              <TouchableOpacity
                key={key}
                activeOpacity={0.8}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => toggle(key)}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {emoji} {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.button, selected.length === 0 && styles.buttonDisabled]}
          onPress={handleFindSpaces}
          disabled={selected.length === 0}
        >
          <Text style={styles.buttonText}>Find My Spaces</Text>
        </TouchableOpacity>

        <TouchableOpacity activeOpacity={0.7} onPress={completeOnboarding}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
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
  pill: { ...SpaceStyles.glassCard, paddingVertical: 12, paddingHorizontal: 18 },
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
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: SpaceTheme.backgroundVoid, fontSize: 16, fontWeight: "700" },
  skipText: { color: SpaceTheme.mutedOrbit, fontSize: 13, marginTop: 18, textDecorationLine: "underline" },
});
