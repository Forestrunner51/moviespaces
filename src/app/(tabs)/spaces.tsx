import { useState, useCallback, useRef } from "react";
import { authFetch } from "@/frontend/services/api";
import {
  View,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import { FilmLoader } from "@/frontend/components/film-loader";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { FriendsPanel } from "@/frontend/components/friends-panel";
import { Starfield } from "@/frontend/components/starfield";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { SpaceTheme, SpaceStyles, Palette, Type, Radius, Display, Font } from "@/frontend/constants/theme";
import { useFriends } from "@/frontend/hooks/use-friends";
import { LoadError } from "@/frontend/components/load-error";
import { CoachTip } from "@/frontend/components/coach-tip";
import { useProfiles } from "@/frontend/hooks/use-profiles";
import { AvatarStack } from "@/frontend/components/avatar";
import { formatEventDate } from "@/frontend/utils/event-date";
import { NextUpCard } from "@/frontend/components/next-up-card";
import {
  EVENT_CATEGORIES,
  eventCategoryOf,
  type EventCategory,
} from "@/frontend/constants/event-categories";

interface Space {
  id: string;
  filmName: string;
  cinemaName: string;
  showTime: string;
  showDate: string;
  screeningTime: string | null;
  createdAt: string;
  isPublic: boolean;
  isPrivate: boolean;
  matchMovieKey?: string | null;
  status: string;
  spaceType: string;
  posterPath: string | null;
  eventCategory: string | null;
  // userId is needed to look up each attendee's avatar (see useProfiles) —
  // the backend already returns it, this type just wasn't asking for it.
  members: { id: string; name: string; confirmed: boolean; userId: string; hasTicket?: boolean }[];
}

type Tab = "spaces" | "rent" | "friends";

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "spaces", label: "Spaces", icon: "planet-outline" },
  { key: "rent", label: "Watch Parties", icon: "storefront-outline" },
  { key: "friends", label: "Friends", icon: "people-outline" },
];

// One card, shared by the Spaces and Watch Parties lists (they were
// previously two identical inline renderItems). Poster anchors the left,
// details on the right.
function SpaceCard({
  item,
  unreadCount,
  past,
}: {
  item: Space;
  unreadCount: number;
  past: boolean;
}) {
  const profiles = useProfiles((item.members ?? []).map((m) => m.userId));
  // Community Club: evergreen room, not a dated plan — the card leads with
  // what it IS instead of a blank date/venue that reads like a broken event.
  const isClub = item.isPublic && !item.matchMovieKey;
  // Relative labels ("Tonight", "In 3 days") read the real current time.
  const eventDate = formatEventDate(item.screeningTime, item.showDate, item.showTime);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={styles.card}
      onPress={() => router.push({ pathname: "/group", params: { groupId: item.id } })}
    >
      <MoviePoster
        uri={item.posterPath}
        width={60}
        fallbackIcon={EVENT_CATEGORIES[eventCategoryOf(item.spaceType, item.eventCategory)].icon}
      />
      <View style={styles.cardBody}>
        {/* Date leads. On an events list, when it happens is the thing being
            scanned for — it used to sit third, at 12px, under the venue. */}
        <View style={styles.dateRow}>
          {isClub ? (
            <Text style={styles.clubLead}>COMMUNITY CLUB</Text>
          ) : (
            <>
              <Text style={styles.dateText}>{eventDate.date}</Text>
              <Text style={styles.timeText}>{eventDate.time}</Text>
              {!!eventDate.relative && !past && (
                <Text style={styles.relativeText}>{eventDate.relative}</Text>
              )}
            </>
          )}
        </View>

        <View style={styles.cardHeader}>
          <Text style={styles.filmName} numberOfLines={1}>
            {item.filmName}
          </Text>
          {!!unreadCount && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
            </View>
          )}
        </View>

        <Text style={styles.details} numberOfLines={1}>
          {isClub ? `${(item.members ?? []).length} members · always open` : item.cinemaName}
        </Text>

        <View style={styles.badgeRow}>
          {item.spaceType === "private_rental" && (
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>
                {EVENT_CATEGORIES[eventCategoryOf(item.spaceType, item.eventCategory)].label}
              </Text>
            </View>
          )}
          {item.isPrivate && (
            <View style={styles.privateBadge}>
              <Ionicons name="lock-closed" size={11} color={Palette.accent} />
              <Text style={styles.privateBadgeText}>Private</Text>
            </View>
          )}
          {past && (
            <View style={styles.pastBadge}>
              <Text style={styles.pastBadgeText}>Passed</Text>
            </View>
          )}
        </View>

        {/* Faces, not a count. "5 member(s)" is a database row; a row of
            people is a gathering — which is the whole product. */}
        <View style={styles.footer}>
          <AvatarStack
            people={(item.members ?? []).map((m) => ({
              userId: m.userId,
              name: m.name,
              avatarUrl: profiles.get(m.userId)?.avatarUrl,
            }))}
            size={24}
          />
          <Text style={styles.goingText}>
            {(item.members ?? []).length} going
            {item.status === "booked" ? " · Booked" : ""}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function MySpacesScreen() {
  const insets = useSafeAreaInsets();
  // Powers the pending-request count on the Friends tab so an incoming request
  // is visible from anywhere in My Spaces, not only after opening Friends.
  // Foreground-polled (see useFriends), so it pauses when backgrounded.
  const { pendingRequests, unreadCounts } = useFriends();
  const { tab: initialTab } = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(
    initialTab === "rent" || initialTab === "friends" ? initialTab : "spaces",
  );
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  // Set when the fetch failed and there's nothing loaded to show — the
  // empty states below must not claim "no spaces" for a network error.
  const [loadError, setLoadError] = useState(false);
  const [rentCategoryFilter, setRentCategoryFilter] = useState<EventCategory | "all">("all");

  // A ref, not `spaces.length`, because the focus effect below captures the
  // first render's loadSpaces (deps []) — a state read here would always see
  // the initial empty array.
  const hasLoadedOnceRef = useRef(false);

  const loadSpaces = async () => {
    try {
      // Full-screen spinner only on the very first load. This runs on every
      // tab focus, and unconditionally flipping `loading` swapped the whole
      // list out for a spinner — losing scroll position — when a silent
      // background refresh is all a revisit needs.
      if (!hasLoadedOnceRef.current) setLoading(true);
      const res = await authFetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/mine`,
      );
      if (res.ok) {
        const data = await res.json();
        setSpaces(data);
        setLoadError(false);
      } else {
        console.error(
          "Failed to pull secure user spaces status code:",
          res.status,
        );
        setLoadError(true);
      }
    } catch (err) {
      console.error("Network error trying to fetch spaces:", err);
      setLoadError(true);
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadSpaces();
    }, []),
  );

  const rentalSpaces = spaces
    .filter((s) => s.spaceType === "private_rental")
    .filter(
      (s) => rentCategoryFilter === "all" || eventCategoryOf(s.spaceType, s.eventCategory) === rentCategoryFilter,
    );
  const gatheringSpaces = spaces.filter((s) => s.spaceType !== "private_rental");

  // Legacy Spaces predate the screeningTime column — fall back to createdAt
  // (same pattern as profile.tsx and group.tsx) so they still register as
  // past rather than staying "active" forever with no real showtime to check.
  // Deliberately impure: needs to read the actual current time on every call
  // so a card correctly flips to "passed" while this screen stays mounted.
  const isPast = (space: Space) =>
    // Public Community Spaces are evergreen — see the matching exemption in
    // group.tsx's hasPassed for why a null ScreeningTime doesn't mean "past" here.
    // A crew (IsPublic but a real plan) passes once its own showtime does.
    (space.matchMovieKey ? !!space.screeningTime : !space.isPublic) &&
    // eslint-disable-next-line react-hooks/purity -- see comment above
    new Date(space.screeningTime ?? space.createdAt).getTime() < Date.now();

  // "You've got plans." — the soonest upcoming thing you're in, any type,
  // pinned above the list (Timeleft's one-big-card). Clubs aren't plans.
  const nextUp = (() => {
    const eligible = spaces.filter(
      (s) => s.status !== "cancelled" && (!s.isPublic || !!s.matchMovieKey) && !isPast(s),
    );
    const t = (s: Space) =>
      s.screeningTime ? new Date(s.screeningTime).getTime() : Number.POSITIVE_INFINITY;
    return [...eligible].sort((a, b) => t(a) - t(b))[0] ?? null;
  })();

  return (
    <Starfield>
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, SpaceStyles.glowText, SpaceStyles.wordmark]}>My Spaces</Text>
          {tab !== "friends" && (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.headerCreateButton}
              onPress={() => router.push(tab === "rent" ? "/rent-a-theater" : "/create-space")}
            >
              <Ionicons
                name={tab === "rent" ? "storefront-outline" : "add-circle-outline"}
                size={16}
                color={SpaceTheme.backgroundVoid}
              />
              <Text style={styles.headerCreateButtonText}>{tab === "rent" ? "Find Venue" : "New Space"}</Text>
            </TouchableOpacity>
          )}
        </View>

        <CoachTip id="spaces-intro" icon="add-circle-outline">
          Tap <Text style={{ fontWeight: "700" }}>New Space</Text> up top to plan a movie night, or the{" "}
          <Text style={{ fontWeight: "700" }}>Friends</Text> tab to add people.
        </CoachTip>

        <View style={styles.tabBar}>
          {TABS.map(({ key, label, icon }) => {
            const active = tab === key;
            return (
              <TouchableOpacity
                key={key}
                activeOpacity={0.8}
                style={[styles.tabBarItem, active && styles.tabBarItemActive]}
                onPress={() => setTab(key)}
              >
                <Ionicons
                  name={icon}
                  size={16}
                  color={active ? SpaceTheme.glowCyan : SpaceTheme.mutedOrbit}
                />
                <Text style={[styles.tabBarLabel, active && styles.tabBarLabelActive]} numberOfLines={1}>
                  {label}
                </Text>
                {key === "friends" && pendingRequests.length > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{pendingRequests.length}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {tab === "friends" ? (
          <ScrollView keyboardShouldPersistTaps="handled">
            <FriendsPanel />
          </ScrollView>
        ) : tab === "rent" ? (
          loading ? (
            <FilmLoader full />
          ) : (
            <>
              <Text style={styles.subtitle}>Watch parties you&apos;re part of</Text>
              <View style={styles.categoryFilterRow}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={[styles.categoryChip, rentCategoryFilter === "all" && styles.categoryChipActive]}
                  hitSlop={{ top: 8, bottom: 8 }}
                  onPress={() => setRentCategoryFilter("all")}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      rentCategoryFilter === "all" && styles.categoryChipTextActive,
                    ]}
                  >
                    All
                  </Text>
                </TouchableOpacity>
                {(Object.entries(EVENT_CATEGORIES) as [EventCategory, { icon: keyof typeof Ionicons.glyphMap; label: string }][]).map(
                  ([key, { icon, label }]) => (
                    <TouchableOpacity
                      key={key}
                      activeOpacity={0.8}
                      style={[styles.categoryChip, rentCategoryFilter === key && styles.categoryChipActive]}
                      hitSlop={{ top: 8, bottom: 8 }}
                      onPress={() => setRentCategoryFilter(key)}
                    >
                      <Ionicons
                        name={icon}
                        size={13}
                        // Accent, matching categoryChipTextActive — Palette.base
                        // (near-black) was invisible on the accentDim fill.
                        color={rentCategoryFilter === key ? Palette.accent : Palette.textMuted}
                      />
                      <Text
                        style={[
                          styles.categoryChipText,
                          rentCategoryFilter === key && styles.categoryChipTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ),
                )}
              </View>
              <FlatList
                data={rentalSpaces}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <SpaceCard
                    item={item}
                    unreadCount={unreadCounts[item.id] ?? 0}
                    past={isPast(item)}
                  />
                )}
                ListEmptyComponent={
                  loadError && spaces.length === 0 ? (
                    <LoadError onRetry={loadSpaces} />
                  ) : (
                  <View style={styles.emptyState}>
                    <Ionicons name="storefront-outline" size={40} color={SpaceTheme.mutedOrbit} />
                    <Text style={styles.emptyTitle}>No watch parties yet</Text>
                    <Text style={styles.emptySubtitle}>
                      Find a venue and set one up to see it here
                    </Text>
                  </View>
                  )
                }
              />
            </>
          )
        ) : loading ? (
          <ActivityIndicator size="large" color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
        ) : (
          <>
            <FlatList
              data={gatheringSpaces.filter((s) => s.id !== nextUp?.id)}
              keyExtractor={(item) => item.id}
              ListHeaderComponent={
                <>
                  {nextUp && (
                    <>
                      <Text style={styles.plansHeadline}>You&apos;ve got plans.</Text>
                      <NextUpCard space={nextUp} />
                    </>
                  )}
                  <Text style={[styles.subtitle, nextUp && { marginTop: 18 }]}>
                    {nextUp ? "Everything else you're in" : "Your movie groups and memberships"}
                  </Text>
                </>
              }
              renderItem={({ item }) => (
                <SpaceCard
                  item={item}
                  unreadCount={unreadCounts[item.id] ?? 0}
                  past={isPast(item)}
                />
              )}
              ListEmptyComponent={
                loadError && spaces.length === 0 ? (
                  <LoadError onRetry={loadSpaces} />
                ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="planet-outline" size={40} color={SpaceTheme.mutedOrbit} />
                  <Text style={styles.emptyTitle}>No spaces yet</Text>
                  <Text style={styles.emptySubtitle}>
                    Find a movie and create your first space with friends
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.emptyButton}
                    onPress={() =>
                      router.push({
                        pathname: "/create-space",
                        params: { spaceType: "public_gathering" },
                      })
                    }
                  >
                    <Text style={styles.emptyButtonText}>Find a Movie</Text>
                  </TouchableOpacity>
                </View>
                )
              }
            />
          </>
        )}
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // paddingTop is applied inline from safe-area insets so the header sits a
    // consistent distance below the status bar / Dynamic Island on every
    // device, instead of a fixed 60px that drifted across screen sizes.
    paddingHorizontal: 16,
  },
  // Display.heading, like every sibling tab's title — this was the one
  // screen heading at 28/system-bold, and Bebas needs the paired lineHeight
  // to keep its ascenders from clipping.
  plansHeadline: {
    fontFamily: Font.bold,
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: -0.3,
    color: Palette.text,
    marginBottom: 12,
  },
  title: {
    ...Display.heading,
    color: SpaceTheme.starWhite,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  headerCreateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: SpaceTheme.supernovaPink,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Radius.medium,
  },
  headerCreateButtonText: { ...Type.small, color: SpaceTheme.backgroundVoid, fontWeight: "700" },
  subtitle: { ...Type.small, color: SpaceTheme.mutedOrbit, marginBottom: 16 },
  tabBar: {
    flexDirection: "row",
    ...SpaceStyles.glassCard,
    padding: 4,
    marginTop: 12,
    marginBottom: 16,
  },
  tabBarItem: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    paddingVertical: 10,
    borderRadius: Radius.medium,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBarItemActive: {
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
  },
  tabBarLabel: { ...Type.small, fontWeight: "600", color: SpaceTheme.mutedOrbit },
  tabBarLabelActive: { color: SpaceTheme.glowCyan },
  tabBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: SpaceTheme.supernovaPink,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeText: { ...Type.caption, color: SpaceTheme.starWhite, fontWeight: "700" },
  card: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    gap: 12,
    padding: 12,
    marginBottom: 12,
    alignItems: "flex-start",
  },
  cardBody: { flex: 1, justifyContent: "center" },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
    gap: 8,
  },
  filmName: {
    flex: 1,
    ...Type.body,
    fontWeight: "600",
    color: Palette.text,
  },
  // Date block, the card's lead line.
  dateRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 2 },
  dateText: { ...Display.dateCard, color: Palette.text },
  timeText: { ...Type.small, color: Palette.textMuted },
  relativeText: { ...Type.caption, color: Palette.accent, fontWeight: "700" },
  // A count badge, not a chat bubble emoji + the word "new".
  unreadBadge: {
    backgroundColor: Palette.accent,
    borderRadius: Radius.pill,
    minWidth: 20,
    alignItems: "center",
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  unreadBadgeText: { color: Palette.base, ...Type.caption, fontWeight: "800" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 },
  clubLead: {
    ...Type.caption,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: Palette.accent,
  },
  categoryBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: Palette.fill,
  },
  categoryBadgeText: { ...Type.caption, fontWeight: "600", color: SpaceTheme.mutedOrbit },
  privateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
  },
  privateBadgeText: { ...Type.caption, fontWeight: "700", color: SpaceTheme.accentGold },
  categoryFilterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  categoryChip: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  categoryChipActive: { borderColor: SpaceTheme.glowCyan, backgroundColor: Palette.accentDim },
  categoryChipText: { ...Type.caption, fontWeight: "600", color: SpaceTheme.mutedOrbit },
  categoryChipTextActive: { color: SpaceTheme.glowCyan },
  pastBadge: {
    alignSelf: "flex-start",
    backgroundColor: Palette.fill,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  pastBadgeText: { color: Palette.textMuted, ...Type.caption, fontWeight: "700" },
  details: { ...Type.small, color: Palette.textMuted, marginBottom: 6 },
  footer: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  goingText: { ...Type.caption, color: Palette.textMuted },
  emptyState: {
    alignItems: "center",
    marginTop: 60,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    ...Type.title,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginTop: 12,
    marginBottom: 6,
  },
  emptySubtitle: {
    ...Type.small,
    color: SpaceTheme.mutedOrbit,
    textAlign: "center",
    marginBottom: 20,
  },
  emptyButton: {
    backgroundColor: SpaceTheme.glowCyan,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  emptyButtonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", ...Type.body },
});
