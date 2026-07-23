import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { getNowPlaying, TmdbMovie } from "@/frontend/services/tmdb";
import { MoviePoster } from "@/frontend/components/movie-poster";

interface NearbySpace {
  id: string;
  hostName: string;
  filmName: string;
  cinemaName: string;
  posterPath: string | null;
  showDate: string;
  showTime: string;
}

// Fisher-Yates-ish partial shuffle — good enough for picking a handful of
// items out of at most 50 (GetOpenSpaces already caps the feed at that).
function pickRandom<T>(arr: T[], count: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

export default function HomeScreen() {
  const [nearbySpaces, setNearbySpaces] = useState<NearbySpace[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(true);
  const [nowPlaying, setNowPlaying] = useState<TmdbMovie[]>([]);
  const [moviesLoading, setMoviesLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/open`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: NearbySpace[]) => {
        // Picked once here (not recomputed on every render) so the sample
        // doesn't reshuffle every time this screen re-renders. Capped at 2 —
        // more than that made the row look sparse/off-center with a small
        // local feed, and this is meant as a teaser, not the full list
        // (Explore already covers that).
        setNearbySpaces(pickRandom(data || [], 2));
      })
      .catch((err) => {
        console.warn("Failed to load open spaces for home screen:", err);
        setNearbySpaces([]);
      })
      .finally(() => setSpacesLoading(false));

    getNowPlaying()
      .then(setNowPlaying)
      .catch((err) => {
        console.warn("Failed to load now-playing movies:", err);
        setNowPlaying([]);
      })
      .finally(() => setMoviesLoading(false));
  }, []);

  return (
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.title, SpaceStyles.glowText, SpaceStyles.wordmark, styles.titleSpacing]}>MovieSpaces</Text>
        <Text style={styles.chooseSubtitle}>What do you want to do?</Text>

        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.chooseCard}
          onPress={() =>
            router.push({ pathname: "/create-space", params: { spaceType: "public_gathering" } })
          }
        >
          <Ionicons name="film-outline" size={28} color={SpaceTheme.glowCyan} />
          <View style={{ flex: 1 }}>
            <Text style={styles.chooseCardTitle}>Watch a Movie</Text>
            <Text style={styles.chooseCardSubtitle}>
              Pick a movie and a nearby theater, then start a Space with friends
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={SpaceTheme.mutedOrbit} />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.chooseCard}
          onPress={() => router.push("/rent-a-theater")}
        >
          <Ionicons name="storefront-outline" size={28} color={SpaceTheme.supernovaPink} />
          <View style={{ flex: 1 }}>
            <Text style={styles.chooseCardTitle}>Host a Watch Party</Text>
            <Text style={styles.chooseCardSubtitle}>
              Organize a movie night, fight night, or screening at a theater, local venue, or
              custom space
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={SpaceTheme.mutedOrbit} />
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Upcoming Spaces</Text>
        {spacesLoading ? (
          <ActivityIndicator color={SpaceTheme.glowCyan} style={styles.sectionLoading} />
        ) : nearbySpaces.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionText}>
              No spaces available — you can check Explore for a larger list of spaces.
            </Text>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => router.push({ pathname: "/(tabs)/explore" })}
            >
              <Text style={styles.emptySectionLink}>Go to Explore →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={nearbySpaces}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.carouselContent}
            renderItem={({ item }) => (
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.spaceCard}
                onPress={() => router.push({ pathname: "/group", params: { groupId: item.id } })}
              >
                <MoviePoster uri={item.posterPath} width={132} style={styles.spaceCardPoster} />
                <Text style={styles.spaceCardTitle} numberOfLines={1}>
                  {item.filmName}
                </Text>
                <Text style={styles.spaceCardSubtitle} numberOfLines={1}>
                  {item.cinemaName}
                </Text>
                <Text style={styles.spaceCardTime} numberOfLines={1}>
                  {item.showDate} • {item.showTime}
                </Text>
                <Text style={styles.spaceCardHost} numberOfLines={1}>
                  Hosted by {item.hostName}
                </Text>
              </TouchableOpacity>
            )}
          />
        )}

        <Text style={styles.sectionTitle}>Popular in Theaters</Text>
        {moviesLoading ? (
          <ActivityIndicator color={SpaceTheme.glowCyan} style={styles.sectionLoading} />
        ) : nowPlaying.length === 0 ? (
          <Text style={styles.emptySectionText}>Couldn&apos;t load movies right now.</Text>
        ) : (
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={nowPlaying}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.carouselContent}
            renderItem={({ item }) => (
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.movieCard}
                onPress={() =>
                  router.push({
                    pathname: "/create-space",
                    params: {
                      spaceType: "public_gathering",
                      movieName: item.title,
                      tmdbMovieId: item.id.toString(),
                      posterPath: item.posterPath ?? "",
                    },
                  })
                }
              >
                {item.posterPath ? (
                  <Image source={{ uri: item.posterPath }} style={styles.moviePoster} />
                ) : (
                  <View style={[styles.moviePoster, styles.moviePosterFallback]}>
                    <Ionicons name="film-outline" size={24} color={SpaceTheme.mutedOrbit} />
                  </View>
                )}
                <Text style={styles.movieTitle} numberOfLines={2}>
                  {item.title}
                </Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: SpaceTheme.starWhite,
  },
  titleSpacing: { marginBottom: 16 },
  chooseSubtitle: { fontSize: 15, color: SpaceTheme.mutedOrbit, marginBottom: 20 },
  chooseCard: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    marginBottom: 16,
  },
  chooseCardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginBottom: 4,
  },
  chooseCardSubtitle: { fontSize: 13, color: SpaceTheme.mutedOrbit, lineHeight: 18 },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginTop: 12,
    marginBottom: 12,
  },
  sectionLoading: { marginBottom: 16, alignItems: "flex-start" },
  emptySection: { marginBottom: 20 },
  emptySectionText: { fontSize: 13, color: SpaceTheme.mutedOrbit, marginBottom: 8 },
  emptySectionLink: { fontSize: 13, color: SpaceTheme.glowCyan, fontWeight: "700" },
  // flexGrow: 0 + alignItems: "flex-start" keeps items packed to the left of
  // the horizontal scroll area — without it, a short row (e.g. just one or
  // two cards) stretches to fill the FlatList's width and ends up looking
  // centered instead of scrolling from the start like the rest of the app.
  carouselContent: {
    flexGrow: 0,
    alignItems: "flex-start",
    gap: 12,
    paddingBottom: 20,
  },
  spaceCard: {
    ...SpaceStyles.glassCard,
    width: 160,
    padding: 14,
  },
  spaceCardPoster: { marginBottom: 10 },
  spaceCardTitle: { fontSize: 15, fontWeight: "700", color: SpaceTheme.starWhite, marginBottom: 2 },
  spaceCardSubtitle: { fontSize: 12, color: SpaceTheme.mutedOrbit, marginBottom: 4 },
  spaceCardTime: { fontSize: 12, color: SpaceTheme.glowCyan, fontWeight: "600", marginBottom: 6 },
  spaceCardHost: { fontSize: 11, color: SpaceTheme.mutedOrbit },
  movieCard: { width: 120 },
  moviePoster: {
    width: 120,
    height: 180,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    marginBottom: 6,
  },
  moviePosterFallback: { alignItems: "center", justifyContent: "center" },
  movieTitle: { fontSize: 13, fontWeight: "600", color: SpaceTheme.starWhite },
});
