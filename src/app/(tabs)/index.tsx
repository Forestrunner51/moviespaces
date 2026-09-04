import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import { FilmLoader } from "@/frontend/components/film-loader";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { LoadError } from "@/frontend/components/load-error";
import { SpaceStyles, Palette, Type, Display, Font, Radius } from "@/frontend/constants/theme";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { Avatar, AvatarStack } from "@/frontend/components/avatar";
import { useProfileSheet } from "@/frontend/components/profile-sheet";
import { CoachTip } from "@/frontend/components/coach-tip";
import { useProfiles } from "@/frontend/hooks/use-profiles";
import { formatEventDate } from "@/frontend/utils/event-date";
import { EVENT_CATEGORIES, eventCategoryOf } from "@/frontend/constants/event-categories";
import { authFetch } from "@/frontend/services/api";
import { resolveDisplayName } from "@/frontend/services/display-name";
import { useToast } from "@/frontend/components/toast";

// Members carry userId so the cards can show attendee faces (see useProfiles)
// — the API already returns them, these types just weren't asking.
interface SpaceMember {
  id: string;
  name: string;
  confirmed: boolean;
  userId: string;
  hasTicket?: boolean;
}

interface NearbySpace {
  id: string;
  // Host's Supabase id — the feed card leads with their face.
  userId: string;
  hostName: string;
  filmName: string;
  cinemaName: string;
  posterPath: string | null;
  showDate: string;
  showTime: string;
  screeningTime: string | null;
  spaceType: string;
  eventCategory: string | null;
  members: SpaceMember[];
  // Non-null = this is a Movie Crew (small cap, everyone's a peer) rather
  // than a hosted Space — the card leads with "started a crew" and shows
  // seats against the cap.
  matchMovieKey: string | null;
  maxCapacity: number;
}

// Shape returned by GET /api/group/mine — Home only needs ids (to keep the
// user's own Spaces out of the nearby feed); My Spaces owns the full view.
interface MySpace {
  id: string;
}

// Feed card — a person doing a thing, not a listing. Strava's feed is
// "Sam ran 5k", Kaya's is "Ola sent V4"; ours is "Bob is seeing The Caine
// Mutiny on Sunday". The host's face leads, the film is the subject, and
// the card has a reaction: "I'm in" joins on the spot.
function FeedCard({ space }: { space: NearbySpace }) {
  const { showToast } = useToast();
  const { openProfile } = useProfileSheet();
  const members = space.members ?? [];
  const profiles = useProfiles([space.userId, ...members.map((m) => m.userId)]);
  const host = profiles.get(space.userId);
  const eventDate = formatEventDate(space.screeningTime, space.showDate, space.showTime);
  const [joining, setJoining] = useState(false);
  const isWatchParty = space.spaceType === "private_rental";
  const isCrew = !!space.matchMovieKey;
  const others = members.filter((m) => m.userId !== space.userId);

  const imIn = async () => {
    if (joining) return;
    setJoining(true);
    try {
      const name = await resolveDisplayName("");
      const res = await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/${space.id}/join`, {
        method: "POST",
        body: JSON.stringify({ name, spaceCode: null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        showToast(body?.error || "Couldn't join right now — try again.");
        return;
      }
      router.push({ pathname: "/group", params: { groupId: space.id, matched: "joined" } });
    } catch {
      showToast("Network error — please try again.");
    } finally {
      setJoining(false);
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      style={styles.feedCard}
      onPress={() => router.push({ pathname: "/group", params: { groupId: space.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${space.hostName} is seeing ${space.filmName}`}
    >
      <View style={styles.feedHead}>
        <TouchableOpacity
          activeOpacity={0.7}
          disabled={!space.userId}
          onPress={() => openProfile(space.userId)}
          accessibilityLabel={`View ${space.hostName}'s profile`}
        >
          <Avatar uri={host?.avatarUrl} name={space.hostName} size={40} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.feedLead} numberOfLines={2}>
            <Text style={styles.feedName}>{space.hostName}</Text>
            {isCrew ? " started a crew for " : isWatchParty ? " is hosting " : " is seeing "}
            <Text style={styles.feedName}>{space.filmName}</Text>
          </Text>
          <Text style={styles.feedWhenLine} numberOfLines={1}>
            {eventDate.date}
            {eventDate.time ? ` · ${eventDate.time}` : ""}
            {space.cinemaName ? ` · ${space.cinemaName}` : ""}
            {isCrew
              ? ` · ${members.filter((m) => m.confirmed).length} of ${space.maxCapacity} seats`
              : ""}
          </Text>
        </View>
        {!!eventDate.relative && (
          <View style={styles.feedChip}>
            <Text style={styles.feedChipText}>{eventDate.relative}</Text>
          </View>
        )}
      </View>
      <View style={styles.feedBody}>
        <MoviePoster
          uri={space.posterPath}
          width={48}
          fallbackIcon={EVENT_CATEGORIES[eventCategoryOf(space.spaceType, space.eventCategory)].icon}
        />
        <View style={styles.feedPeople}>
          {others.length > 0 ? (
            <>
              <AvatarStack
                people={others.map((m) => ({
                  userId: m.userId,
                  name: m.name,
                  avatarUrl: profiles.get(m.userId)?.avatarUrl,
                }))}
                size={22}
                max={4}
              />
              <Text style={styles.feedMeta}>
                {others.length === 1 ? "1 other is in" : `${others.length} others are in`}
              </Text>
            </>
          ) : (
            <Text style={styles.feedMeta}>Be the first to join</Text>
          )}
        </View>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.imIn, joining && { opacity: 0.6 }]}
          onPress={imIn}
          disabled={joining}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`I'm in for ${space.filmName}`}
        >
          {joining ? (
            <ActivityIndicator color={Palette.base} size="small" />
          ) : (
            <>
              <Ionicons name="hand-right" size={14} color={Palette.base} />
              <Text style={styles.imInText}>I&apos;m in</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// Shape returned by GET /api/group/community-spaces/discover, narrowed to
// clubs the user has already joined.
interface MyClub {
  id: string;
  displayName: string;
  genreCategory: string | null;
  posterPath: string | null;
  memberCount: number;
  playedTodayCount: number;
}

// One of these per app open. Picked in a useState initializer so it's
// stable for the life of the screen and only changes when Home remounts.
const HEADLINES = [
  "Who are you\nwatching with?",
  "Big screen,\nnew faces.",
  "Pick a film.\nFind your crew.",
  "Nobody should\nsee it alone.",
  "What are we\nseeing tonight?",
  "Good movie.\nBetter company.",
];

export default function HomeScreen() {
  const [headline] = useState(() => HEADLINES[Math.floor(Math.random() * HEADLINES.length)]);
  // Raw, unfiltered feed — the random-2 pick and the "exclude my own"
  // filter both need the full list to draw from, not just whatever survived
  // an earlier pick.
  const [openSpacesRaw, setOpenSpacesRaw] = useState<NearbySpace[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(true);
  const [spacesError, setSpacesError] = useState(false);
  const [myClubs, setMyClubs] = useState<MyClub[]>([]);
  // Every Space the user belongs to at all (host or member, any type/status)
  // — deliberately broader than mySpaces' "upcoming, non-public" filter,
  // since this is purely for excluding self-overlap from the teaser below,
  // not for deciding what counts as "upcoming."
  const [myGroupIds, setMyGroupIds] = useState<Set<string>>(new Set());

  // Bumped by Retry; the effect below refetches on change. The spinner is
  // flipped on in the tap handler, so the effect itself only fetches.
  const [reloadKey, setReloadKey] = useState(0);
  const retryOpenSpaces = () => {
    setSpacesLoading(true);
    setReloadKey((k) => k + 1);
  };
  useEffect(() => {
    let cancelled = false;
    // authFetch, not bare fetch: /api/group/open blanks member/host userIds
    // for anonymous callers, which would degrade every avatar to initials.
    // authFetch still sends no header when there's no session.
    authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/open`)
      .then((res) => {
        // A non-OK response used to become `[]` — indistinguishable from
        // "nothing near you", which is the wrong story on a bad connection.
        if (!res.ok) throw new Error(`open spaces failed (status ${res.status})`);
        return res.json();
      })
      .then((data: NearbySpace[]) => {
        if (cancelled) return;
        setOpenSpacesRaw(data || []);
        setSpacesError(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("Failed to load open spaces for home screen:", err);
        setOpenSpacesRaw([]);
        setSpacesError(true);
      })
      .finally(() => {
        if (!cancelled) setSpacesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Derived, not stored — recomputes only when the raw feed or the user's
  // own-Space set actually changes (e.g. returning to Home after
  // joining/hosting something), not on every render. A Space the user is
  // already part of would otherwise show up twice: once here as a "new"
  // suggestion and again in "My Upcoming Spaces" above, which is exactly the
  // duplication this teaser shouldn't have. Capped at 2 — more than that made
  // the row look sparse/off-center with a small local feed, and this is
  // meant as a teaser, not the full list (Explore already covers that).
  const nearbySpaces = useMemo(() => {
    const notMine = openSpacesRaw.filter((s) => !myGroupIds.has(s.id));
    const t = (x: NearbySpace) =>
      x.screeningTime ? new Date(x.screeningTime).getTime() : Number.POSITIVE_INFINITY;
    return [...notMine].sort((a, b) => t(a) - t(b)).slice(0, 8);
  }, [openSpacesRaw, myGroupIds]);

  // Refetched on focus (not just mount) so a Space created or joined
  // elsewhere shows up here the moment the user lands back on Home — this is
  // now the primary watch-party hub, so "did my new Space actually appear"
  // has to hold on every return trip, not just app cold-start.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      // The nearby feed too — silently (no spinner): a crew you just joined
      // should stop showing "I'm in", and one that filled should drop off,
      // without the whole section flashing to a loading state.
      setReloadKey((k) => k + 1);

      authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/mine`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data: MySpace[]) => {
          if (cancelled) return;
          setMyGroupIds(new Set((data || []).map((s) => s.id)));
        })
        .catch((err) => console.warn("Failed to load my spaces for home screen:", err));

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

  // Read off the real clock, same as every relative label on this screen.
  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <Starfield>
      <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
        {/* Header reads top-down as brand → moment → question: a small
            tracked wordmark, today's date as the marquee line, then a
            headline in the body face asking the only thing that matters on
            this screen. The wordmark used to be the 32px headline itself,
            which spent the biggest type on the screen saying the app's own
            name to someone who already opened it. */}
        <View style={styles.header}>
          <Text style={[SpaceStyles.wordmark, styles.wordmark]}>MovieSpaces</Text>
          <Text style={styles.dateLine}>{todayLabel}</Text>
          <Text style={styles.headline}>{headline}</Text>
        </View>

        <CoachTip id="home-welcome" icon="hand-left-outline">
          Welcome! Start by joining a screening near you, or create your own — your Spaces,
          clubs, and the daily CineMind puzzle all live in the tabs below.
        </CoachTip>

        {/* The hero is the one thing on Home the tab bar can't reach: get
            seated with strangers for a film. Your own plans live in My
            Spaces — Home is for finding the next one. */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.heroCard}
          onPress={() => router.push("/match")}
          accessibilityRole="button"
          accessibilityLabel="Make new friends in a movie crew"
        >
          <View style={styles.heroIcon}>
            <Ionicons name="people" size={24} color={Palette.base} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroKicker}>Movie Crew</Text>
            <Text style={styles.heroTitle}>Make some new friends</Text>
            <Text style={styles.heroSubtitle}>
              Pick a film and a showing — we put you in a crew of up to 6 who picked the same
            </Text>
          </View>
          <View style={styles.heroArrow}>
            <Ionicons name="arrow-forward" size={18} color={Palette.accent} />
          </View>
        </TouchableOpacity>

        {/* Hosting: two cards with a line each on what they mean, under the
            crew hero so joining still leads. */}
        <Text style={styles.sectionTitle}>Or host your own</Text>
        <View style={styles.hostRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.hostCard}
            onPress={() => router.push({ pathname: "/create-space", params: { spaceType: "public_gathering" } })}
            accessibilityRole="button"
            accessibilityLabel="Host at a theater"
          >
            <View style={styles.hostIcon}>
              <Ionicons name="film-outline" size={20} color={Palette.accent} />
            </View>
            <Text style={styles.hostTitle}>At a theater</Text>
            <Text style={styles.hostBody}>
              Pick a real showing near you and open it up — friends or anyone can join.
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.hostCard}
            onPress={() => router.push("/rent-a-theater")}
            accessibilityRole="button"
            accessibilityLabel="Host at your own place"
          >
            <View style={styles.hostIcon}>
              <Ionicons name="home-outline" size={20} color={Palette.accent} />
            </View>
            <Text style={styles.hostTitle}>At your place</Text>
            <Text style={styles.hostBody}>
              A watch party at home, a bar, or a rented room. You set the time and the guest list.
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.codeLink}
          onPress={() => router.push("/join-by-code")}
          accessibilityRole="button"
        >
          <Ionicons name="key-outline" size={14} color={Palette.textMuted} />
          <Text style={styles.codeLinkText}>Have a Space code?</Text>
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
                  <MoviePoster
                    uri={item.posterPath}
                    width={132}
                    height={82}
                    fallbackIcon="videocam-outline"
                    style={{ marginBottom: 10 }}
                  />
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

        {/* The feed. Vertical, full-width, soonest first — Home scrolls like
            a list of real events happening near you. */}
        <View style={styles.feedHeader}>
          <Text style={[styles.sectionTitle, { marginTop: 0, marginBottom: 0 }]}>Happening near you</Text>
          <TouchableOpacity activeOpacity={0.7} onPress={() => router.push({ pathname: "/(tabs)/explore" })} hitSlop={8}>
            <Text style={styles.feedSeeAll}>See all</Text>
          </TouchableOpacity>
        </View>
        {spacesLoading ? (
          <FilmLoader style={styles.sectionLoading} />
        ) : spacesError ? (
          <LoadError compact onRetry={retryOpenSpaces} />
        ) : nearbySpaces.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionText}>
              Nothing public near you yet. Start a crew and be the first thing on this list.
            </Text>
            <TouchableOpacity activeOpacity={0.8} onPress={() => router.push("/match")}>
              <Text style={styles.emptySectionLink}>Find a crew</Text>
            </TouchableOpacity>
          </View>
        ) : (
          nearbySpaces.map((space) => <FeedCard key={space.id} space={space} />)
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
  header: { marginBottom: 18 },
  wordmark: { fontSize: 16, lineHeight: 20, color: Palette.textFaint, marginBottom: 14 },
  dateLine: { ...Display.section, color: Palette.accent, marginBottom: 6 },
  headline: {
    fontFamily: Font.bold,
    fontSize: 30,
    lineHeight: 35,
    letterSpacing: -0.4,
    color: Palette.text,
  },
  heroCard: {
    ...SpaceStyles.glassCard,
    borderColor: Palette.accentBorder,
    backgroundColor: Palette.accentDim,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    marginBottom: 6,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  heroKicker: {
    ...Type.caption,
    fontFamily: Font.semibold,
    color: Palette.accent,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  heroTitle: { fontFamily: Font.bold, fontSize: 19, lineHeight: 24, color: Palette.text },
  heroSubtitle: { ...Type.small, color: Palette.textMuted, marginTop: 3 },
  heroArrow: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  hostRow: { flexDirection: "row", gap: 12 },
  hostCard: {
    ...SpaceStyles.glassCard,
    flex: 1,
    padding: 14,
    alignItems: "flex-start",
  },
  hostIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  hostTitle: { fontFamily: Font.bold, fontSize: 17, lineHeight: 22, color: Palette.text, marginBottom: 4 },
  hostBody: { ...Type.caption, fontSize: 13, lineHeight: 18, color: Palette.textMuted },
  codeLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    marginBottom: 4,
  },
  codeLinkText: { ...Type.small, fontFamily: Font.semibold, color: Palette.textMuted },
  // Feed
  feedHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 12 },
  feedSeeAll: { ...Type.small, fontFamily: Font.semibold, color: Palette.accent },
  feedCard: {
    ...SpaceStyles.glassCard,
    padding: 14,
    marginBottom: 10,
  },
  feedHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  feedLead: { ...Type.body, color: Palette.textMuted },
  feedName: { fontFamily: Font.bold, color: Palette.text },
  feedWhenLine: { ...Type.caption, color: Palette.textMuted, marginTop: 3 },
  feedChip: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
  },
  feedChipText: { ...Type.caption, fontFamily: Font.bold, color: Palette.accent, textTransform: "uppercase", fontSize: 11, lineHeight: 14 },
  feedBody: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  feedPeople: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  feedMeta: { ...Type.caption, color: Palette.textFaint, flexShrink: 1 },
  imIn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accent,
    minWidth: 84,
    justifyContent: "center",
  },
  imInText: { ...Type.small, fontFamily: Font.bold, color: Palette.base },
  sectionTitle: {
    ...Display.section,
    color: Palette.textMuted,
    textTransform: "uppercase" as const,
    marginTop: 16,
    marginBottom: 12,
  },
  // alignSelf, not alignItems: ActivityIndicator has no children to align —
  // the view stretched full-width and the spinner drew centred while the
  // empty state and carousel it replaces are both left-aligned.
  sectionLoading: { marginBottom: 16, alignSelf: "flex-start" },
  emptySection: { marginBottom: 20 },
  emptySectionText: { ...Type.small, color: Palette.textMuted, marginBottom: 8 },
  emptySectionLink: { ...Type.small, fontFamily: Font.bold, color: Palette.accent },
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
  clubChip: {
    ...SpaceStyles.glassCard,
    width: 160,
    padding: 14,
  },
  clubChipTitle: { ...Type.small, fontFamily: Font.semibold, color: Palette.text, marginBottom: 4 },
  clubChipSubtitle: { ...Type.caption, color: Palette.textMuted },
});
