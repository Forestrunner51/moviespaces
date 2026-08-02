import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { authFetch } from "@/frontend/services/api";

interface NearbySpace {
  id: string;
  hostName: string;
  filmName: string;
  cinemaName: string;
  posterPath: string | null;
  showDate: string;
  showTime: string;
}

// Shape returned by GET /api/group/mine — a superset of NearbySpace, but
// kept as its own type since "my" cards need isPublic/screeningTime to sort
// and filter, which the public teaser feed above never needs.
interface MySpace {
  id: string;
  filmName: string;
  cinemaName: string;
  posterPath: string | null;
  showDate: string;
  showTime: string;
  screeningTime: string | null;
  isPublic: boolean;
  status: string;
}

// Shape returned by GET /api/group/community-spaces/discover, narrowed to
// clubs the user has already joined.
interface MyClub {
  id: string;
  displayName: string;
  genreCategory: string | null;
  memberCount: number;
  playedTodayCount: number;
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
  const [mySpaces, setMySpaces] = useState<MySpace[]>([]);
  const [mySpacesLoading, setMySpacesLoading] = useState(true);
  const [myClubs, setMyClubs] = useState<MyClub[]>([]);

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
  }, []);

  // Refetched on focus (not just mount) so a Space created or joined
  // elsewhere shows up here the moment the user lands back on Home — this is
  // now the primary watch-party hub, so "did my new Space actually appear"
  // has to hold on every return trip, not just app cold-start.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/mine`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data: MySpace[]) => {
          if (cancelled) return;
          const now = Date.now();
          const upcoming = (data || [])
            // Community Spaces have their own row below — this section is
            // for real one-off gatherings/rentals the user is actually
            // attending. Same past/evergreen logic as group.tsx's hasPassed.
            .filter((s) => !s.isPublic && s.status !== "cancelled")
            .filter((s) => !s.screeningTime || new Date(s.screeningTime).getTime() >= now)
            .sort((a, b) => {
              if (!a.screeningTime) return 1;
              if (!b.screeningTime) return -1;
              return new Date(a.screeningTime).getTime() - new Date(b.screeningTime).getTime();
            });
          setMySpaces(upcoming.slice(0, 5));
        })
        .catch((err) => console.warn("Failed to load my spaces for home screen:", err))
        .finally(() => {
          if (!cancelled) setMySpacesLoading(false);
        });

      authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/community-spaces/discover`)
        .then((res) => (res.ok ? res.json() : { spaces: [] }))
        .then((data: { spaces: (MyClub & { isJoined: boolean })[] }) => {
          if (cancelled) return;
          setMyClubs((data.spaces || []).filter((s) => s.isJoined));
        })
        .catch((err) => console.warn("Failed to load my clubs for home screen:", err));

      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <Starfield>
      <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
        <Text style={[styles.title, SpaceStyles.glowText, SpaceStyles.wordmark, styles.titleSpacing]}>MovieSpaces</Text>
        <Text style={styles.chooseSubtitle}>What do you want to do?</Text>

        <Text style={styles.sectionTitle}>My Upcoming Spaces</Text>
        {mySpacesLoading ? (
          <ActivityIndicator color={SpaceTheme.glowCyan} style={styles.sectionLoading} />
        ) : mySpaces.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionText}>
              Nothing on your calendar yet — host one below or join with a code.
            </Text>
          </View>
        ) : (
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={mySpaces}
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
              </TouchableOpacity>
            )}
          />
        )}

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

        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.codeEntryLink}
          onPress={() => router.push("/join-by-code")}
        >
          <Ionicons name="key-outline" size={15} color={SpaceTheme.mutedOrbit} />
          <Text style={styles.codeEntryLinkText}>Have a Space code?</Text>
        </TouchableOpacity>

        {myClubs.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>My Community Clubs</Text>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={myClubs}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.carouselContent}
              renderItem={({ item }) => (
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.clubChip}
                  onPress={() => router.push({ pathname: "/group", params: { groupId: item.id } })}
                >
                  <Text style={styles.clubChipTitle} numberOfLines={1}>
                    {item.displayName}
                  </Text>
                  <Text style={styles.clubChipSubtitle}>
                    {item.memberCount} members
                    {item.playedTodayCount > 0 ? ` • ${item.playedTodayCount} played today` : ""}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        {/* Demoted from the app's front door: still one tap away, but no
            longer the first card on Home — Watch Parties leads now. */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.chooseCard, styles.cineMindCard]}
          onPress={() => router.push("/cinemind")}
        >
          <Text style={styles.cineMindEmoji}>🧠</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.chooseCardTitle}>CineMind</Text>
            <Text style={styles.chooseCardSubtitle}>
              Today&apos;s 3-minute movie puzzle — one play a day
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={SpaceTheme.accentGold} />
        </TouchableOpacity>

        {/* Replaces the old "Surprise Me" carousel below, which was really
            just a plain movie list — never actually random. A real spin,
            plus a one-off practice CineMind challenge, is what that name
            should have meant. */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.chooseCard, styles.rouletteCard]}
          onPress={() => router.push("/roulette")}
        >
          <Ionicons name="shuffle" size={26} color={SpaceTheme.supernovaPink} />
          <View style={{ flex: 1 }}>
            <Text style={styles.chooseCardTitle}>Movie Roulette</Text>
            <Text style={styles.chooseCardSubtitle}>
              Spin for a random film and a practice trivia challenge
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={SpaceTheme.supernovaPink} />
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Nearby Public Gatherings</Text>
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
      </ScrollView>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 40,
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
  cineMindCard: {
    borderColor: "rgba(245, 197, 24, 0.45)",
    backgroundColor: "rgba(245, 197, 24, 0.07)",
  },
  cineMindEmoji: { fontSize: 26, width: 28, textAlign: "center" },
  rouletteCard: {
    borderColor: "rgba(236, 72, 153, 0.4)",
    backgroundColor: "rgba(236, 72, 153, 0.06)",
  },
  codeEntryLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    marginBottom: 6,
  },
  codeEntryLinkText: { color: SpaceTheme.mutedOrbit, fontSize: 13, fontWeight: "600" },
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
  clubChip: {
    ...SpaceStyles.glassCard,
    width: 160,
    padding: 14,
  },
  clubChipTitle: { fontSize: 14, fontWeight: "700", color: SpaceTheme.starWhite, marginBottom: 4 },
  clubChipSubtitle: { fontSize: 12, color: SpaceTheme.mutedOrbit },
});
