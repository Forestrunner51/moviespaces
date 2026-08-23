import { useRef, useState } from "react";
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
import {
  SpaceStyles,
  Palette,
  Type,
  Display,
  Radius,
  Font,
} from "@/frontend/constants/theme";
import { useToast } from "@/frontend/components/toast";
import { authFetch } from "@/frontend/services/api";
import { resolveDisplayName } from "@/frontend/services/display-name";
import { searchMovies, Movie } from "@/frontend/services/movies";

// Keep in sync with GroupController.MatchCrewSize.
const MATCH_CREW_SIZE = 6;

// Movie Crew: the Timeleft pattern applied to movies. Timeleft seats you at
// a dinner table of six strangers; here you pick how you want to watch and
// which film, and get seated in a crew of up to six who picked the same.
// Nothing is scheduled by us — the crew decides the details in chat.
//
// Two kinds of crew, mirroring the two kinds of Space: meet at a theater
// showing, or a hosted watch party at someone's venue. Same film, different
// plan — so they're matched separately (the kind is part of the backend key).
type CrewKind = "theater" | "venue";

const KINDS: {
  kind: CrewKind;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  planStep: string;
}[] = [
  {
    kind: "theater",
    icon: "film-outline",
    title: "At a theater",
    body: "Meet a crew at a showing near you. Tickets are on you, company is on us.",
    planStep: "Agree a theater and showtime in the crew chat, then go.",
  },
  {
    kind: "venue",
    icon: "home-outline",
    title: "At a venue",
    body: "A watch party — someone's place, a bar, a rented room. The crew hosts it together.",
    planStep: "Pick who hosts and when in the crew chat, then show up.",
  },
];

const STEPS = (
  kind: CrewKind,
): { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] => [
  {
    icon: "film-outline",
    title: "Pick a film",
    body: "Anything you actually want to see with other people.",
  },
  {
    icon: "people-outline",
    title: "Get seated",
    body: `We put you in a crew of up to ${MATCH_CREW_SIZE} who picked the same film.`,
  },
  {
    icon: "chatbubbles-outline",
    title: "Plan it together",
    body: KINDS.find((k) => k.kind === kind)!.planStep,
  },
];

export default function MatchScreen() {
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [searching, setSearching] = useState(false);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [kind, setKind] = useState<CrewKind | null>(null);
  // Debounce + stale-response guard: one request per pause in typing, and a
  // slow earlier response can never overwrite a newer one (or drop the
  // spinner while a newer query is still in flight).
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);

  const handleSearch = (text: string) => {
    setQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = text.trim();
    if (q.length < 2) {
      searchSeq.current += 1;
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    searchTimer.current = setTimeout(async () => {
      try {
        const outcome = await searchMovies(q);
        if (seq !== searchSeq.current) return;
        setResults(outcome.results);
      } catch {
        /* transient — leave prior results */
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 350);
  };

  const handleMatch = async (movie: Movie) => {
    if (matchingId) return;
    setMatchingId(movie.imdbId);
    try {
      const hostName = await resolveDisplayName();
      const res = await authFetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/match`,
        {
          method: "POST",
          body: JSON.stringify({
            MovieTitle: movie.title,
            ImdbId: movie.imdbId,
            PosterPath: movie.posterPath,
            HostName: hostName,
            Kind: kind ?? "theater",
          }),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(
          body?.error || "Couldn't seat you right now. Please try again.",
        );
        return;
      }
      // The group page does the reveal ("you're first in" vs "you're in with
      // N others") — a toast here would just be dismissed mid-navigation.
      const matched = body.created
        ? "created"
        : body.joined
          ? "joined"
          : "already";
      router.replace({
        pathname: "/group",
        params: { groupId: body.groupId, matched },
      });
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
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(tabs)/explore")
          }
        >
          <Ionicons name="chevron-back" size={22} color={Palette.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.kicker}>MOVIE CREW</Text>

        {kind === null ? (
          <>
            <Text style={styles.title}>How do you want to watch?</Text>
            <View style={styles.kinds}>
              {KINDS.map((k) => (
                <TouchableOpacity
                  key={k.kind}
                  activeOpacity={0.85}
                  style={styles.kindCard}
                  onPress={() => setKind(k.kind)}
                  accessibilityRole="button"
                  accessibilityLabel={k.title}
                >
                  <View style={styles.kindIcon}>
                    <Ionicons name={k.icon} size={22} color={Palette.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kindTitle}>{k.title}</Text>
                    <Text style={styles.kindBody}>{k.body}</Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={Palette.textMuted}
                  />
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fineprint}>
              Either way you end up in a crew of up to {MATCH_CREW_SIZE} who
              picked the same film.
            </Text>
          </>
        ) : (
          <>
            <View style={styles.kindRow}>
              <Ionicons
                name={KINDS.find((k) => k.kind === kind)!.icon}
                size={14}
                color={Palette.accent}
              />
              <Text style={styles.kindRowText}>
                {KINDS.find((k) => k.kind === kind)!.title}
              </Text>
              <TouchableOpacity
                onPress={() => setKind(null)}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={styles.kindRowChange}>Change</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.title}>Which film do you want to see?</Text>

            <View style={styles.searchBox}>
              <Ionicons
                name="search-outline"
                size={18}
                color={Palette.textMuted}
              />
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

            {searching && (
              <ActivityIndicator
                color={Palette.accent}
                style={{ marginTop: 14 }}
              />
            )}

            {showSteps ? (
              <View style={styles.steps}>
                {STEPS(kind).map((step, i) => (
                  <View key={step.title} style={styles.step}>
                    <View style={styles.stepIcon}>
                      <Ionicons
                        name={step.icon}
                        size={20}
                        color={Palette.accent}
                      />
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
                  Crews are small on purpose. When one fills, the next person
                  starts a new one.
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
                      {item.releaseYear ? (
                        <Text style={styles.rowYear}>{item.releaseYear}</Text>
                      ) : null}
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
                    <Text style={styles.empty}>
                      No matches — check the spelling?
                    </Text>
                  ) : null
                }
              />
            )}
          </>
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
  kinds: { gap: 12, marginTop: 4 },
  kindCard: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
  },
  kindIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  kindTitle: {
    ...Type.body,
    fontFamily: Font.bold,
    color: Palette.text,
    marginBottom: 2,
  },
  kindBody: { ...Type.small, color: Palette.textMuted },
  kindRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  kindRowText: {
    ...Type.small,
    fontFamily: Font.semibold,
    color: Palette.accent,
  },
  kindRowChange: {
    ...Type.small,
    color: Palette.textMuted,
    textDecorationLine: "underline",
    marginLeft: 6,
  },
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
  stepTitle: {
    ...Type.body,
    fontFamily: Font.bold,
    color: Palette.text,
    marginBottom: 2,
  },
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
  seatPillText: {
    ...Type.caption,
    fontFamily: Font.bold,
    color: Palette.accent,
  },
  empty: {
    ...Type.small,
    color: Palette.textMuted,
    textAlign: "center",
    marginTop: 24,
  },
});
