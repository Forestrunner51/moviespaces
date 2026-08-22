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
import { SpaceStyles, Palette, Type, Display } from "@/frontend/constants/theme";
import { useToast } from "@/frontend/components/toast";
import { authFetch } from "@/frontend/services/api";
import { supabase } from "@/frontend/config/supabase";
import { searchMovies, Movie } from "@/frontend/services/movies";

// Match mode: pick a movie you want to see and land in the open group for it.
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
        showToast(body?.error || "Couldn't match right now. Please try again.");
        return;
      }
      const n = body.memberCount ?? 1;
      showToast(
        body.created
          ? "Started a new crew for this movie — invite friends to fill it!"
          : `Matched! You're one of ${n} in this crew.`,
        "success",
      );
      router.replace({ pathname: "/group", params: { groupId: body.groupId } });
    } catch {
      showToast("Network error — please try again.");
    } finally {
      setMatchingId(null);
    }
  };

  return (
    <Starfield>
      <View style={styles.content}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.backButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        >
          <Ionicons name="chevron-back" size={22} color={Palette.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Find Your Movie Crew</Text>
        <Text style={styles.subtitle}>
          Pick a movie you want to see — we&apos;ll drop you into a group with others who want to see
          it too. First one in starts the crew; everyone after joins it.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Search a movie…"
          placeholderTextColor={Palette.textMuted}
          value={query}
          onChangeText={handleSearch}
          autoCapitalize="none"
          autoFocus
        />

        {searching && <ActivityIndicator color={Palette.accent} style={{ marginTop: 14 }} />}

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
            >
              <MoviePoster uri={item.posterPath} width={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.releaseYear ? <Text style={styles.rowYear}>{item.releaseYear}</Text> : null}
              </View>
              {matchingId === item.imdbId ? (
                <ActivityIndicator color={Palette.accent} />
              ) : (
                <Ionicons name="people-outline" size={20} color={Palette.accent} />
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            query.trim().length >= 2 && !searching ? (
              <Text style={styles.empty}>No matches — check the spelling?</Text>
            ) : null
          }
        />
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  backButton: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 2, marginBottom: 8, paddingVertical: 4, paddingRight: 8 },
  backText: { ...Type.body, color: Palette.text },
  title: { ...Display.heading, color: Palette.text, marginBottom: 6 },
  subtitle: { ...Type.small, color: Palette.textMuted, marginBottom: 20, lineHeight: 20 },
  input: { ...SpaceStyles.field, color: Palette.text, padding: 14, ...Type.body },
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
  empty: { ...Type.small, color: Palette.textMuted, textAlign: "center", marginTop: 24 },
});
