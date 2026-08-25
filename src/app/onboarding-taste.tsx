import { useRef, useState } from "react";
import { View, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { Text, TextInput } from "@/frontend/components/scaled-text";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { SpaceStyles, Palette, Type, Radius, Font } from "@/frontend/constants/theme";
import { supabase } from "@/frontend/config/supabase";
import { searchMovies, Movie } from "@/frontend/services/movies";

// Second onboarding step (genres → HERE → club discovery): top-3 movies you
// love and top-3 you couldn't stand. Pure taste signal for the profile —
// nothing downstream requires it, so both halves and the whole step are
// skippable; the fastest path into the app stays "Skip".
type Pick = { imdbId: string; title: string; posterPath: string | null };
const MAX = 3;

function TastePicker({
  title,
  hint,
  picks,
  onChange,
}: {
  title: string;
  hint: string;
  picks: Pick[];
  onChange: (next: Pick[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const handleSearch = (text: string) => {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    const q = text.trim();
    if (q.length < 2) {
      seq.current += 1;
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const s = ++seq.current;
    timer.current = setTimeout(async () => {
      try {
        const outcome = await searchMovies(q);
        if (s !== seq.current) return;
        setResults(outcome.results.slice(0, 5));
      } catch {
        /* transient */
      } finally {
        if (s === seq.current) setSearching(false);
      }
    }, 350);
  };

  const add = (m: Movie) => {
    if (picks.length >= MAX || picks.some((p) => p.imdbId === m.imdbId)) return;
    onChange([...picks, { imdbId: m.imdbId, title: m.title, posterPath: m.posterPath }]);
    setQuery("");
    setResults([]);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionHint}>{hint}</Text>
      <View style={styles.slotRow}>
        {Array.from({ length: MAX }).map((_, i) => {
          const p = picks[i];
          return p ? (
            <TouchableOpacity
              key={p.imdbId}
              activeOpacity={0.8}
              style={styles.slotFilled}
              onPress={() => onChange(picks.filter((x) => x.imdbId !== p.imdbId))}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${p.title}`}
            >
              <MoviePoster uri={p.posterPath} width={72} />
              <View style={styles.slotRemove}>
                <Ionicons name="close" size={12} color={Palette.base} />
              </View>
            </TouchableOpacity>
          ) : (
            <View key={`empty-${i}`} style={styles.slotEmpty}>
              <Text style={styles.slotNumber}>{i + 1}</Text>
            </View>
          );
        })}
      </View>
      {picks.length < MAX && (
        <>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={16} color={Palette.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search a movie…"
              placeholderTextColor={Palette.textFaint}
              value={query}
              onChangeText={handleSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color={Palette.accent} />}
          </View>
          {results.length > 0 && (
            <View style={styles.resultList}>
              {results.map((m) => (
                <TouchableOpacity
                  key={m.imdbId}
                  activeOpacity={0.8}
                  style={styles.resultRow}
                  onPress={() => add(m)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${m.title}`}
                >
                  <MoviePoster uri={m.posterPath} width={26} />
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {m.title}
                    {m.releaseYear ? `  ·  ${m.releaseYear}` : ""}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

export default function OnboardingTasteScreen() {
  const { genres } = useLocalSearchParams<{ genres?: string }>();
  const [loves, setLoves] = useState<Pick[]>([]);
  const [hates, setHates] = useState<Pick[]>([]);
  const [saving, setSaving] = useState(false);

  const next = () =>
    router.push({ pathname: "/space-discovery", params: { genres: genres ?? "", onboarding: "1" } });

  const saveAndContinue = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user && (loves.length > 0 || hates.length > 0)) {
        await supabase
          .from("profiles")
          .update({
            favorite_movies: loves.length > 0 ? loves : null,
            least_favorite_movies: hates.length > 0 ? hates : null,
          })
          .eq("id", user.id);
      }
    } catch {
      /* taste is a nice-to-have — never block onboarding on it */
    } finally {
      setSaving(false);
      next();
    }
  };

  const hasAny = loves.length > 0 || hates.length > 0;

  return (
    <Starfield>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Your taste, in six movies</Text>
        <Text style={styles.subtitle}>
          Shows on your profile so a crew knows who they&apos;re watching with. Totally optional.
        </Text>

        <TastePicker
          title="Three you love"
          hint="The ones you make people watch."
          picks={loves}
          onChange={setLoves}
        />
        <TastePicker
          title="Three you couldn't stand"
          hint="Great taste is also knowing what you hate."
          picks={hates}
          onChange={setHates}
        />

        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.button, !hasAny && styles.buttonDisabled]}
          onPress={saveAndContinue}
          disabled={!hasAny || saving}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color={Palette.base} />
          ) : (
            <Text style={styles.buttonText}>Save and continue</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.7} onPress={next} accessibilityRole="button">
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </ScrollView>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 80, paddingBottom: 60 },
  title: { ...Type.title, fontFamily: Font.bold, color: Palette.text, textAlign: "center" },
  subtitle: { ...Type.small, color: Palette.textMuted, textAlign: "center", marginTop: 6, marginBottom: 26 },
  section: { marginBottom: 26 },
  sectionTitle: { ...Type.body, fontFamily: Font.bold, color: Palette.text },
  sectionHint: { ...Type.caption, color: Palette.textFaint, marginTop: 2, marginBottom: 10 },
  slotRow: { flexDirection: "row", gap: 12, marginBottom: 10 },
  slotFilled: { position: "relative" },
  slotRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  slotEmpty: {
    width: 72,
    height: 108,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Palette.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  slotNumber: { ...Type.title, color: Palette.textFaint },
  searchBox: {
    ...SpaceStyles.field,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, ...Type.small, color: Palette.text, padding: 0 },
  resultList: { ...SpaceStyles.glassCard, marginTop: 6, overflow: "hidden" },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  resultTitle: { ...Type.small, color: Palette.text, flex: 1 },
  button: {
    backgroundColor: Palette.accent,
    borderRadius: Radius.medium,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { ...Type.body, fontFamily: Font.bold, color: Palette.base },
  skipText: { ...Type.small, color: Palette.textMuted, textAlign: "center", marginTop: 16, textDecorationLine: "underline" },
});
