import { useState } from "react";
import { View, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceStyles, Palette, Type, Radius } from "@/frontend/constants/theme";
import { completeOnboarding } from "@/frontend/services/onboarding";

// Genres match seeded public Community Spaces' GenreCategory exactly (see
// GroupController.SeedCommunitySpaces) — this list and the seed data are
// deliberately 1:1, not an open set. Adding a genre here without a matching
// seeded club just means an empty discovery screen for that pick.
const GENRES = [
  { key: "Blockbusters", label: "Blockbusters", icon: "film-outline" },
  { key: "Sci-Fi", label: "Sci-Fi", icon: "planet-outline" },
  { key: "Horror", label: "Horror", icon: "skull-outline" },
  { key: "Indie", label: "Indie / Arthouse", icon: "color-palette-outline" },
  { key: "Action", label: "Action", icon: "flash-outline" },
  { key: "Comedy", label: "Comedy", icon: "happy-outline" },
  { key: "Thriller", label: "Thriller / Mystery", icon: "eye-outline" },
  { key: "Anime", label: "Anime", icon: "sparkles-outline" },
  { key: "Romance", label: "Romance", icon: "heart-outline" },
  { key: "Classics", label: "Classics", icon: "time-outline" },
  { key: "Documentary", label: "Documentary", icon: "earth-outline" },
  { key: "Family", label: "Family / Animation", icon: "balloon-outline" },
] as const;

// Shown once, right after auth succeeds (see auth.tsx). Solves the empty-room
// problem: a brand new user with no real-life friends on the app yet would
// otherwise have zero Spaces and a permanently empty CineMind leaderboard.
// Picking genres here doesn't join anything by itself — it hands off to
// /space-discovery, which previews the matching clubs and makes joining an
// explicit choice, not something that happens silently on your behalf.
export default function OnboardingInterestsScreen() {
  const [selected, setSelected] = useState<string[]>([]);
  const insets = useSafeAreaInsets();

  const toggle = (genre: string) => {
    setSelected((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]));
  };

  const handleFindSpaces = () => {
    // Genres → taste (top-3s, skippable) → club discovery. "Skip for now"
    // below stays the fast lane straight into the app.
    router.push({ pathname: "/onboarding-taste", params: { genres: selected.join(",") } });
  };

  return (
    <Starfield>
      {/* Scrolling pills, PINNED controls. App Review rejected 1.0 (37)
          under guideline 4: on an iPad Air, "Find My Spaces" and "Skip all"
          were below the fold — 12 genre pills at two per row plus a 90px top
          pad ran past the bottom of the window (an iPhone-compat window on
          iPadOS is resizable and can be far shorter than any phone; large
          Dynamic Type does the same on a phone).

          A plain ScrollView would make them reachable but still not VISIBLE,
          and "not visible" is the exact wording of the rejection — a reviewer
          repeating the test sees the same first screenful. So only the pills
          scroll; both controls live in a fixed footer and are on screen at
          every window size. */}
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.container}>
            <Ionicons name="film-outline" size={40} color={Palette.accent} />
            <Text style={styles.title}>What do you like to watch?</Text>
            <Text style={styles.subtitle}>
              Pick a few genres to find Community Spaces with people who watch the same stuff —
              instant leaderboards, no friends required yet.
            </Text>

            <View style={styles.pillRow}>
              {GENRES.map(({ key, label, icon }) => {
                const active = selected.includes(key);
                return (
                  <TouchableOpacity
                    key={key}
                    activeOpacity={0.8}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => toggle(key)}
                  >
                    <Ionicons
                      name={icon}
                      size={14}
                      color={active ? Palette.base : Palette.textMuted}
                    />
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
          <View style={styles.footerColumn}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.button, selected.length === 0 && styles.buttonDisabled]}
              onPress={handleFindSpaces}
              disabled={selected.length === 0}
            >
              <Text style={styles.buttonText}>Find My Spaces</Text>
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={0.7} onPress={completeOnboarding}>
              <Text style={styles.skipText}>Skip all — jump straight in</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center", alignItems: "center" },
  // Sits above the scroll area, always on screen. Bordered so it reads as a
  // deliberate action bar rather than content that happens to be last.
  footer: {
    borderTopWidth: 1,
    borderTopColor: Palette.border,
    backgroundColor: Palette.base,
    paddingHorizontal: 24,
    paddingTop: 14,
    alignItems: "center",
  },
  footerColumn: { width: "100%", maxWidth: 520, alignItems: "center" },
  container: {
    width: "100%",
    // Caps the column on a wide iPad so the pills stay a readable block.
    maxWidth: 520,
    alignItems: "center",
    padding: 24,
    // Half the old 90px: the rest of the vertical centring is now done by
    // the scroll container, which adapts to the window height instead of
    // assuming a phone's.
    paddingTop: 48,
    gap: 6,
  },
  title: {
    ...Type.title,
    fontWeight: "700",
    color: Palette.text,
    marginTop: 14,
    textAlign: "center",
  },
  subtitle: {
    ...Type.small,
    color: Palette.textMuted,
    textAlign: "center",
    marginBottom: 28,
  },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 8 },
  pill: {
    ...SpaceStyles.field,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
  },
  pillActive: { borderColor: Palette.accent, backgroundColor: Palette.accent },
  pillText: { ...Type.small, color: Palette.textMuted, fontWeight: "600" },
  pillTextActive: { color: Palette.base, fontWeight: "700" },
  button: {
    width: "100%",
    backgroundColor: Palette.accent,
    borderRadius: Radius.medium,
    paddingVertical: 15,
    alignItems: "center",
  },
  // 0.4 on a dark ground made the primary CTA read as absent rather than
  // disabled — one plausible reading of App Review's "was not visible", and
  // cheap insurance either way. Still clearly inert, still legible.
  buttonDisabled: { opacity: 0.55 },
  buttonText: { ...Type.body, color: Palette.base, fontWeight: "700" },
  // Full-strength text, not textMuted: this is the escape hatch out of
  // onboarding, so it has to read as a control rather than as fine print.
  skipText: {
    ...Type.small,
    color: Palette.text,
    fontWeight: "600",
    marginTop: 18,
    paddingVertical: 8,
    paddingHorizontal: 16,
    textDecorationLine: "underline",
  },
});
