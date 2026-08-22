import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { SpaceStyles, Palette, Type, Display, Radius } from "@/frontend/constants/theme";
import { useToast } from "@/frontend/components/toast";
import { authFetch } from "@/frontend/services/api";
import { supabase } from "@/frontend/config/supabase";
import { searchMovies, Movie } from "@/frontend/services/movies";

// Keep in sync with GroupController.MatchCrewSize.
export const MATCH_CREW_SIZE = 6;

// Movie Crew: the Timeleft pattern applied to movies. Timeleft seats you at
// a dinner table of six strangers; here you pick a film and get seated in a
// crew of up to six who picked it too. Nothing is scheduled by us — the
// crew decides the showtime together in chat once it's formed.
const STEPS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: "film-outline",
    title: "Pick a film",
    body: "Anything you actually want to see on a big screen.",
  },
  {
    icon: "people-outline",
    title: "Get seated",
    body: `We put you in a crew of up to ${MATCH_CREW_SIZE} who picked the same film.`,
  },
  {
    icon: "chatbubbles-outline",
    title: "Plan it together",
    body: "Agree a theater and showtime in the crew chat, then go.",
  },
];

export default function MatchScreen() {
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [searching, setSearching] = useState(false);
  const [matchingId, setMatchingId] = useState<string | null>(null);

  const handleSearch = async (text: string) => {
    setQuery(text);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const outcome = await searchMovies(text.trim());
      setResults(outcome.results);
    } catch {
      /* transient — leave prior results */
    } finally {
      setSearching(false);
    }
  };

  const handleMatch = async (movie: Movie) => {
    if (matchingId) return;
    setMatchingId(movie.imdbId);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const hostName = (user?.user_metadata?.full_name as string) || "A Movie Fan";
      const res = await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/match`, {
        method: "POST",
        body: JSON.stringify({
          MovieTitle: movie.title,
          ImdbId: movie.imdbId,
          PosterPath: movie.posterPath,
          HostName: hostName,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(body?.error || "Couldn't seat you right now. Please try again.");
        return;
      }
      // The group page does the reveal ("you're first in" vs "you're in with
      // N others") — a toast here would just be dismissed mid-navigation.
      const matched = body.created ? "created" : body.joined ? "joined" : "already";
      router.replace({ pathname: "/group", params: { groupId: body.groupId, matched } });
    } catch {
      showToast("Network error — please try again.");
    } finally {
      setMatchingId(null);
    }
  };

  const showSteps = query.trim().length < 2;

  return (
    <Starfield>
      <View style={styles.content}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.backButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/explore"))}
        >
          <Ionicons name="chevron-back" size={22} color={Palette.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.kicker}>MOVIE CREW</Text>
        <Text style={styles.title}>Which film do you want to see?</Text>

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={Palette.textMuted} />
          <TextInput
            style={styles.input}
            placeholder="Search a movie…"
            placeholderTextColor={Palette.textMuted}
            value={query}
            onChangeText={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoFocus
          />
        </View>

        {searching && <ActivityIndicator color={Palette.accent} style={{ marginTop: 14 }} />}

        {showSteps ? (
          <View style={styles.steps}>
            {STEPS.map((step, i) => (
              <View key={step.title} style={styles.step}>
                <View style={styles.stepIcon}>
                  <Ionicons name={step.icon} size={20} color={Palette.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>
                    {i + 1}. {step.title}
                  </Text>
                  <Text style={styles.stepBody}>{step.body}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.fineprint}>
              Crews are small on purpose. When one fills, the next person starts a new one.
            </Text>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(m) => m.imdbId}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingTop: 8 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.row}
                onPress={() => handleMatch(item)}
                disabled={matchingId !== null}
                accessibilityRole="button"
                accessibilityLabel={`Get seated for ${item.title}`}
              >
                <MoviePoster uri={item.posterPath} width={44} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.releaseYear ? <Text style={styles.rowYear}>{item.releaseYear}</Text> : null}
                </View>
                {matchingId === item.imdbId ? (
                  <ActivityIndicator color={Palette.accent} />
                ) : (
                  <View style={styles.seatPill}>
                    <Text style={styles.seatPillText}>Get seated</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              !searching ? (
                <Text style={styles.empty}>No matches — check the spelling?</Text>
              ) : null
            }
          />
        )}
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 2,
    marginBottom: 8,
    paddingVertical: 4,
    paddingRight: 8,
  },
  backText: { ...Type.body, color: Palette.text },
  kicker: { ...Display.section, color: Palette.accent, marginBottom: 4 },
  title: { ...Display.heading, color: Palette.text, marginBottom: 16 },
  searchBox: {
    ...SpaceStyles.field,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  input: { flex: 1, ...Type.body, color: Palette.text, padding: 0 },
  steps: { marginTop: 28, gap: 18 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  stepTitle: { ...Type.body, fontWeight: "700", color: Palette.text, marginBottom: 2 },
  stepBody: { ...Type.small, color: Palette.textMuted },
  fineprint: { ...Type.caption, color: Palette.textFaint, marginTop: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  rowTitle: { ...Type.body, color: Palette.text },
  rowYear: { ...Type.small, color: Palette.textMuted, marginTop: 2 },
  seatPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
  },
  seatPillText: { ...Type.caption, fontWeight: "700", color: Palette.accent },
  empty: { ...Type.small, color: Palette.textMuted, textAlign: "center", marginTop: 24 },
});
