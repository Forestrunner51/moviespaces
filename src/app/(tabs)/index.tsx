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
import { SpaceStyles, Palette, Type, Display } from "@/frontend/constants/theme";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { AvatarStack } from "@/frontend/components/avatar";
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
    return pickRandom(notMine, 2);
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

        {/* Joining leads, and it's a full card rather than a muted text link.
            Both hosting options below author an event from scratch — for a
            new user with no friends and no Spaces yet, every prominent action
            used to end in "you've created something nobody is in." */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.chooseCard}
          onPress={() => router.push({ pathname: "/(tabs)/explore" })}
        >
          <Ionicons name="telescope-outline" size={28} color={Palette.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.chooseCardTitle}>Find a Space to Join</Text>
            <Text style={styles.chooseCardSubtitle}>
              Browse public screenings and watch parties happening near you
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Palette.textMuted} />
        </TouchableOpacity>

        {/* Titles say where it happens, not just what you do — "Watch a
            Movie" and "Host a Watch Party" both read as hosting, and you can
            watch a movie at a watch party, so the old split only made sense
            after you'd been through both. */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.chooseCard}
          onPress={() =>
            router.push({ pathname: "/create-space", params: { spaceType: "public_gathering" } })
          }
        >
          <Ionicons name="film-outline" size={28} color={Palette.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.chooseCardTitle}>See a Movie at a Theater</Text>
            <Text style={styles.chooseCardSubtitle}>
              Pick a showtime at a nearby theater and invite friends along
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Palette.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.chooseCard}
          onPress={() => router.push("/rent-a-theater")}
        >
          <Ionicons name="storefront-outline" size={28} color={Palette.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.chooseCardTitle}>Host at Your Own Venue</Text>
            <Text style={styles.chooseCardSubtitle}>
              Your place, a bar, or a rented space — movie night, fight night, or a finale
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Palette.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.codeEntryLink}
          onPress={() => router.push("/join-by-code")}
        >
          <Ionicons name="key-outline" size={15} color={Palette.textMuted} />
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

        <Text style={styles.sectionTitle}>My Upcoming Spaces</Text>
        {mySpacesLoading ? (
          <ActivityIndicator color={Palette.accent} style={styles.sectionLoading} />
        ) : mySpaces.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionText}>
              Nothing on your calendar yet — host one above or join with a code.
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
        )}

        <Text style={styles.sectionTitle}>Nearby Public Gatherings</Text>
        {spacesLoading ? (
          <ActivityIndicator color={Palette.accent} style={styles.sectionLoading} />
        ) : nearbySpaces.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionText}>
              No spaces available — you can check Explore for a larger list of spaces.
            </Text>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => router.push({ pathname: "/(tabs)/explore" })}
            >
              <Text style={styles.emptySectionLink}>Go to Explore</Text>
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
                hostName={item.hostName}
              />
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
  title: { ...Display.heading, color: Palette.text },
  titleSpacing: { marginBottom: 12 },
  chooseSubtitle: { ...Type.small, color: Palette.textMuted, marginBottom: 20 },
  chooseCard: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    marginBottom: 12,
  },
  codeEntryLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    marginBottom: 6,
  },
  codeEntryLinkText: { ...Type.small, color: Palette.textMuted, fontWeight: "600" },
  chooseCardTitle: {
    ...Type.body,
    fontWeight: "600",
    color: Palette.text,
    marginBottom: 2,
  },
  chooseCardSubtitle: { ...Type.small, color: Palette.textMuted },
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
  emptySectionLink: { ...Type.small, color: Palette.accent, fontWeight: "700" },
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
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  spaceCardTitle: { ...Type.small, fontWeight: "600", color: Palette.text },
  spaceCardSubtitle: { ...Type.caption, color: Palette.textMuted },
  spaceCardFooter: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  spaceCardGoing: { ...Type.caption, color: Palette.textFaint },
  clubChip: {
    ...SpaceStyles.glassCard,
    width: 160,
    padding: 14,
  },
  clubChipTitle: { ...Type.small, fontWeight: "600", color: Palette.text, marginBottom: 4 },
  clubChipSubtitle: { ...Type.caption, color: Palette.textMuted },
});
