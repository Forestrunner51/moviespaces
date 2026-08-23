import { useCallback, useEffect, useMemo, useState } from "react";
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
import { SpaceStyles, Palette, Type, Display, Font, Radius } from "@/frontend/constants/theme";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { AvatarStack } from "@/frontend/components/avatar";
import { CoachTip } from "@/frontend/components/coach-tip";
import { useProfiles } from "@/frontend/hooks/use-profiles";
import { formatEventDate } from "@/frontend/utils/event-date";
import { EVENT_CATEGORIES, eventCategoryOf } from "@/frontend/constants/event-categories";
import { authFetch } from "@/frontend/services/api";

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
  // Non-null for a Movie Crew: IsPublic like a club, but it's a real
  // gathering the user is attending, so it belongs with their Spaces.
  matchMovieKey: string | null;
  status: string;
  spaceType: string;
  eventCategory: string | null;
  members: SpaceMember[];
}

// One carousel card, shared by "My Upcoming Spaces" and "Nearby Public
// Gatherings" — they previously had two identical inline renderItems, both
// showing poster + title + venue + a 12px date line. Now the date leads in
// the display face and attendees appear as faces, matching the Spaces and
// Explore lists. Its own component because the avatars need a hook, and a
// FlatList renderItem can't hold one.
function CarouselCard({
  id,
  filmName,
  cinemaName,
  posterPath,
  showDate,
  showTime,
  screeningTime,
  spaceType,
  eventCategory,
  members,
  hostName,
}: {
  id: string;
  filmName: string;
  cinemaName: string;
  posterPath: string | null;
  showDate: string;
  showTime: string;
  screeningTime: string | null;
  spaceType: string;
  eventCategory: string | null;
  members: SpaceMember[];
  hostName?: string;
}) {
  const profiles = useProfiles(members.map((m) => m.userId));
  // Relative labels ("Tonight", "In 3 days") read the real current time.
  const eventDate = formatEventDate(screeningTime, showDate, showTime);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={styles.spaceCard}
      onPress={() => router.push({ pathname: "/group", params: { groupId: id } })}
    >
      <MoviePoster
        uri={posterPath}
        width={132}
        style={styles.spaceCardPoster}
        fallbackIcon={EVENT_CATEGORIES[eventCategoryOf(spaceType, eventCategory)].icon}
      />
      <Text style={styles.spaceCardDate} numberOfLines={1}>
        {eventDate.date}
      </Text>
      <View style={styles.spaceCardMetaRow}>
        <Text style={styles.spaceCardTime}>{eventDate.time}</Text>
        {!!eventDate.relative && (
          <Text style={styles.spaceCardRelative} numberOfLines={1}>
            {eventDate.relative}
          </Text>
        )}
      </View>
      <Text style={styles.spaceCardTitle} numberOfLines={1}>
        {filmName}
      </Text>
      <Text style={styles.spaceCardSubtitle} numberOfLines={1}>
        {hostName ? `${cinemaName} · ${hostName}` : cinemaName}
      </Text>
      {members.length > 0 && (
        <View style={styles.spaceCardFooter}>
          <AvatarStack
            people={members.map((m) => ({
              userId: m.userId,
              name: m.name,
              avatarUrl: profiles.get(m.userId)?.avatarUrl,
            }))}
            size={20}
            max={3}
          />
          <Text style={styles.spaceCardGoing}>{members.length} going</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// "Your next thing" — the Timeleft card. One big object about the soonest
// Space/crew you're in: poster, when (with the countdown), where, and the
// faces of who's coming. A social app's home leads with the user's life,
// not the app's menu; this is what that looks like here.
function NextUpCard({ space }: { space: MySpace }) {
  const members = space.members ?? [];
  const profiles = useProfiles(members.map((m) => m.userId));
  const eventDate = formatEventDate(space.screeningTime, space.showDate, space.showTime);
  const isCrew = !!space.matchMovieKey;
  const ticketed = members.filter((m) => m.hasTicket).length;
  const hasPlan = !!space.screeningTime || !!space.cinemaName;

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      style={styles.nextCard}
      onPress={() => router.push({ pathname: "/group", params: { groupId: space.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Your next: ${space.filmName}`}
    >
      <View style={styles.nextTop}>
        <MoviePoster
          uri={space.posterPath}
          width={84}
          fallbackIcon={EVENT_CATEGORIES[eventCategoryOf(space.spaceType, space.eventCategory)].icon}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.nextKicker}>
            {isCrew ? (space.spaceType === "private_rental" ? "Your watch party crew" : "Your theater crew") : "Your next Space"}
          </Text>
          <Text style={styles.nextTitle} numberOfLines={2}>
            {space.filmName}
          </Text>
          {hasPlan ? (
            <>
              <View style={styles.nextWhen}>
                <Text style={styles.nextDate}>{eventDate.date}</Text>
                {!!eventDate.time && <Text style={styles.nextTime}>{eventDate.time}</Text>}
              </View>
              <Text style={styles.nextWhere} numberOfLines={1}>
                {space.cinemaName}
              </Text>
            </>
          ) : (
            <Text style={styles.nextWhere}>No showtime yet — decide in chat</Text>
          )}
        </View>
      </View>
      <View style={styles.nextBottom}>
        {members.length > 0 ? (
          <View style={styles.nextPeople}>
            <AvatarStack
              people={members.map((m) => ({
                userId: m.userId,
                name: m.name,
                avatarUrl: profiles.get(m.userId)?.avatarUrl,
              }))}
              size={26}
              max={5}
            />
            <Text style={styles.nextPeopleText}>
              {members.length} going{isCrew && ticketed > 0 ? ` · ${ticketed} ticketed` : ""}
            </Text>
          </View>
        ) : (
          <View />
        )}
        {!!eventDate.relative && (
          <View style={styles.nextCountdown}>
            <Text style={styles.nextCountdownText}>{eventDate.relative}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// Full-width feed card for nearby gatherings — the same date-led layout as
// the Explore list, so Home scrolls like a feed of real events rather than
// a row of 160px chips.
function FeedCard({ space }: { space: NearbySpace }) {
  const members = space.members ?? [];
  const profiles = useProfiles(members.map((m) => m.userId));
  const eventDate = formatEventDate(space.screeningTime, space.showDate, space.showTime);
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={styles.feedCard}
      onPress={() => router.push({ pathname: "/group", params: { groupId: space.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${space.filmName} at ${space.cinemaName}`}
    >
      <MoviePoster
        uri={space.posterPath}
        width={64}
        fallbackIcon={EVENT_CATEGORIES[eventCategoryOf(space.spaceType, space.eventCategory)].icon}
      />
      <View style={{ flex: 1 }}>
        <View style={styles.feedWhen}>
          <Text style={styles.feedDate} numberOfLines={1}>
            {eventDate.date}
          </Text>
          {!!eventDate.time && <Text style={styles.feedTime}>{eventDate.time}</Text>}
          {!!eventDate.relative && <Text style={styles.feedRelative}>{eventDate.relative}</Text>}
        </View>
        <Text style={styles.feedTitle} numberOfLines={1}>
          {space.filmName}
        </Text>
        <Text style={styles.feedWhere} numberOfLines={1}>
          {space.cinemaName}
        </Text>
        <View style={styles.feedFooter}>
          {members.length > 0 && (
            <AvatarStack
              people={members.map((m) => ({
                userId: m.userId,
                name: m.name,
                avatarUrl: profiles.get(m.userId)?.avatarUrl,
              }))}
              size={20}
              max={3}
            />
          )}
          <Text style={styles.feedMeta} numberOfLines={1}>
            {members.length} going · {space.hostName}
          </Text>
        </View>
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

export default function HomeScreen() {
  // Raw, unfiltered feed — the random-2 pick and the "exclude my own"
  // filter both need the full list to draw from, not just whatever survived
  // an earlier pick.
  const [openSpacesRaw, setOpenSpacesRaw] = useState<NearbySpace[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(true);
  const [mySpaces, setMySpaces] = useState<MySpace[]>([]);
  const [mySpacesLoading, setMySpacesLoading] = useState(true);
  const [myClubs, setMyClubs] = useState<MyClub[]>([]);
  // Every Space the user belongs to at all (host or member, any type/status)
  // — deliberately broader than mySpaces' "upcoming, non-public" filter,
  // since this is purely for excluding self-overlap from the teaser below,
  // not for deciding what counts as "upcoming."
  const [myGroupIds, setMyGroupIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/open`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: NearbySpace[]) => setOpenSpacesRaw(data || []))
      .catch((err) => {
        console.warn("Failed to load open spaces for home screen:", err);
        setOpenSpacesRaw([]);
      })
      .finally(() => setSpacesLoading(false));
  }, []);

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

      authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/mine`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data: MySpace[]) => {
          if (cancelled) return;
          setMyGroupIds(new Set((data || []).map((s) => s.id)));
          const now = Date.now();
          const upcoming = (data || [])
            // Community Spaces have their own row below — this section is
            // for real one-off gatherings/rentals the user is actually
            // attending. Same past/evergreen logic as group.tsx's hasPassed.
            .filter((s) => (!s.isPublic || !!s.matchMovieKey) && s.status !== "cancelled")
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

  const nextUp = mySpaces[0] ?? null;
  const restUpcoming = mySpaces.slice(1);

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
          <Text style={styles.headline}>{nextUp ? "You've got plans." : "Who are you\nwatching with?"}</Text>
        </View>

        <CoachTip id="home-welcome" icon="hand-left-outline">
          Welcome! Start by joining a screening near you, or create your own — your Spaces,
          clubs, and the daily CineMind puzzle all live in the tabs below.
        </CoachTip>

        {/* Lead with the user's life, not the app's menu. If they're in a
            Space or crew, that's the hero; the Movie Crew CTA only takes the
            top slot when there's nothing upcoming. */}
        {mySpacesLoading ? (
          <ActivityIndicator color={Palette.accent} style={styles.sectionLoading} />
        ) : nextUp ? (
          <NextUpCard space={nextUp} />
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.heroCard}
            onPress={() => router.push("/match")}
            accessibilityRole="button"
            accessibilityLabel="Get seated with a movie crew"
          >
            <View style={styles.heroIcon}>
              <Ionicons name="people" size={24} color={Palette.base} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroKicker}>Movie Crew</Text>
              <Text style={styles.heroTitle}>Get seated with strangers</Text>
              <Text style={styles.heroSubtitle}>
                Pick a film and a showing — we put you in a crew of up to 6 who picked the same
              </Text>
            </View>
            <View style={styles.heroArrow}>
              <Ionicons name="arrow-forward" size={18} color={Palette.accent} />
            </View>
          </TouchableOpacity>
        )}

        {/* Quiet action row. Hosting used to be two full cards; it's two taps
            away on the tabs anyway, so here it's a link, and the crew entry
            stays reachable when the hero slot is taken by "next up". */}
        <View style={styles.actionRow}>
          {nextUp && (
            <TouchableOpacity activeOpacity={0.7} style={styles.actionLink} onPress={() => router.push("/match")}>
              <Ionicons name="people-outline" size={15} color={Palette.accent} />
              <Text style={styles.actionLinkText}>Find a crew</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.actionLink}
            onPress={() => router.push({ pathname: "/create-space", params: { spaceType: "public_gathering" } })}
          >
            <Ionicons name="film-outline" size={15} color={Palette.accent} />
            <Text style={styles.actionLinkText}>Host at a theater</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} style={styles.actionLink} onPress={() => router.push("/rent-a-theater")}>
            <Ionicons name="home-outline" size={15} color={Palette.accent} />
            <Text style={styles.actionLinkText}>Host at your place</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} style={styles.actionLink} onPress={() => router.push("/join-by-code")}>
            <Ionicons name="key-outline" size={15} color={Palette.textMuted} />
            <Text style={[styles.actionLinkText, { color: Palette.textMuted }]}>Have a code?</Text>
          </TouchableOpacity>
        </View>

        {/* Everything else you're in, after the one that's next. */}
        {restUpcoming.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Also coming up</Text>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={restUpcoming}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.carouselContent}
              renderItem={({ item }) => (
                <CarouselCard
                  id={item.id}
                  filmName={item.filmName}
                  cinemaName={item.cinemaName}
                  posterPath={item.posterPath}
                  showDate={item.showDate}
                  showTime={item.showTime}
                  screeningTime={item.screeningTime}
                  spaceType={item.spaceType}
                  eventCategory={item.eventCategory}
                  members={item.members ?? []}
                />
              )}
            />
          </>
        )}

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
          <ActivityIndicator color={Palette.accent} style={styles.sectionLoading} />
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
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10, marginBottom: 8 },
  actionLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.fill,
  },
  actionLinkText: { ...Type.small, fontFamily: Font.semibold, color: Palette.accent },
  // Next up
  nextCard: {
    ...SpaceStyles.glassCard,
    borderColor: Palette.accentBorder,
    padding: 16,
    marginBottom: 4,
  },
  nextTop: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  nextKicker: {
    ...Type.caption,
    fontFamily: Font.semibold,
    color: Palette.accent,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  nextTitle: { fontFamily: Font.bold, fontSize: 22, lineHeight: 26, color: Palette.text, marginBottom: 6 },
  nextWhen: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  nextDate: { ...Display.date, color: Palette.text },
  nextTime: { ...Display.stat, color: Palette.textMuted },
  nextWhere: { ...Type.small, color: Palette.textMuted, marginTop: 2 },
  nextBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
  },
  nextPeople: { flexDirection: "row", alignItems: "center", gap: 8 },
  nextPeopleText: { ...Type.caption, color: Palette.textMuted },
  nextCountdown: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accent,
  },
  nextCountdownText: { ...Type.caption, fontFamily: Font.bold, color: Palette.base, textTransform: "uppercase", letterSpacing: 0.5 },
  // Feed
  feedHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 12 },
  feedSeeAll: { ...Type.small, fontFamily: Font.semibold, color: Palette.accent },
  feedCard: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    gap: 12,
    padding: 12,
    marginBottom: 10,
  },
  feedWhen: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  feedDate: { ...Display.dateCard, color: Palette.text },
  feedTime: { ...Type.small, color: Palette.textMuted },
  feedRelative: { ...Type.caption, fontFamily: Font.bold, color: Palette.accent, textTransform: "uppercase" },
  feedTitle: { ...Type.body, fontFamily: Font.semibold, color: Palette.text, marginTop: 2 },
  feedWhere: { ...Type.small, color: Palette.textMuted },
  feedFooter: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  feedMeta: { ...Type.caption, color: Palette.textFaint, flexShrink: 1 },
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
  spaceCard: {
    ...SpaceStyles.glassCard,
    width: 160,
    padding: 14,
  },
  spaceCardPoster: { marginBottom: 10 },
  spaceCardDate: { ...Display.dateCard, color: Palette.text },
  spaceCardMetaRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginBottom: 4,
  },
  spaceCardTime: { ...Type.caption, color: Palette.textMuted },
  spaceCardRelative: {
    ...Type.caption,
    color: Palette.accent,
    fontFamily: Font.bold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  spaceCardTitle: { ...Type.small, fontFamily: Font.semibold, color: Palette.text },
  spaceCardSubtitle: { ...Type.caption, color: Palette.textMuted },
  spaceCardFooter: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  spaceCardGoing: { ...Type.caption, color: Palette.textFaint },
  clubChip: {
    ...SpaceStyles.glassCard,
    width: 160,
    padding: 14,
  },
  clubChipTitle: { ...Type.small, fontFamily: Font.semibold, color: Palette.text, marginBottom: 4 },
  clubChipSubtitle: { ...Type.caption, color: Palette.textMuted },
});
