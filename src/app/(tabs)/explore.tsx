import { useCallback, useEffect, useState } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from "react-native";
import { Text, TextInput } from "@/frontend/components/scaled-text";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { authFetch } from "@/frontend/services/api";
import { SpaceTheme, SpaceStyles, Palette, Type, Radius, Display } from "@/frontend/constants/theme";
import { AvatarStack } from "@/frontend/components/avatar";
import { useProfiles } from "@/frontend/hooks/use-profiles";
import { formatEventDate } from "@/frontend/utils/event-date";
import { POST_ACTIVITIES } from "@/frontend/constants/activities";
import { THEATER_CHAINS, cinemaChain } from "@/frontend/constants/theater-memberships";
import { getDeviceLocation, Coordinates } from "@/frontend/services/nearby-theaters";
import { distanceMiles } from "@/frontend/utils/distance";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { EVENT_CATEGORIES, eventCategoryOf, type EventCategory } from "@/frontend/constants/event-categories";
import { reportContent } from "@/frontend/services/moderation";
import { useToast } from "@/frontend/components/toast";

// Matches the Group shape returned by GET /api/group/open
interface OpenSpace {
  id: string;
  hostName: string;
  filmName: string;
  cinemaName: string;
  theaterLatitude: number | null;
  theaterLongitude: number | null;
  showTime: string;
  showDate: string;
  screeningTime: string | null;
  status: string;
  spaceType: string;
  totalCostCents: number | null;
  maxCapacity: number;
  postActivities: string | null;
  posterPath: string | null;
  eventCategory: string | null;
  // userId drives the attendee avatars — already returned by the API.
  members: { id: string; name: string; confirmed: boolean; userId: string }[];
}

// The body of an Explore card: when, what, where, who.
//
// Split out as its own component purely so it can call useProfiles — the
// avatars need a hook, and the card is rendered inside a FlatList
// renderItem, which isn't a component and can't hold hooks of its own.
function ExploreCardMeta({ item, distanceMi }: { item: OpenSpace; distanceMi: number | null }) {
  const profiles = useProfiles((item.members ?? []).map((m) => m.userId));
  // Relative labels ("Tonight", "In 3 days") read the real current time.
  const eventDate = formatEventDate(item.screeningTime, item.showDate, item.showTime);
  const isFree = item.totalCostCents == null || item.totalCostCents === 0;

  return (
    <>
      <View style={styles.cardDateRow}>
        <Text style={styles.cardDate}>{eventDate.date}</Text>
        <Text style={styles.cardTime}>{eventDate.time}</Text>
        {!!eventDate.relative && <Text style={styles.cardRelative}>{eventDate.relative}</Text>}
      </View>

      <Text style={styles.spaceFilmName} numberOfLines={1}>
        {item.filmName}
      </Text>

      <Text style={styles.spaceDetails} numberOfLines={1}>
        {item.cinemaName}
        {distanceMi != null ? ` · ${distanceMi.toFixed(1)} mi` : ""}
      </Text>

      <View style={styles.cardFooter}>
        <AvatarStack
          people={(item.members ?? []).map((m) => ({
            userId: m.userId,
            name: m.name,
            avatarUrl: profiles.get(m.userId)?.avatarUrl,
          }))}
          size={24}
        />
        <Text style={styles.spaceMembers} numberOfLines={1}>
          {(item.members ?? []).length}/{item.maxCapacity} · {item.hostName}
        </Text>
        {!isFree && (
          <Text style={styles.spacePrice}>${(item.totalCostCents! / 100).toFixed(0)}</Text>
        )}
      </View>
    </>
  );
}

type TypeFilter = "all" | "public_gathering" | "private_rental";
type PriceFilter = "any" | "under50" | "50to150" | "150plus";
type DistanceFilter = "any" | "5" | "10" | "25";
type EventCategoryFilter = "all" | EventCategory;

const EVENT_CATEGORY_OPTIONS: {
  key: EventCategoryFilter;
  icon: keyof typeof Ionicons.glyphMap | null;
  label: string;
}[] = [
  { key: "all", icon: null, label: "All" },
  ...(Object.entries(EVENT_CATEGORIES) as [EventCategory, { icon: keyof typeof Ionicons.glyphMap; label: string }][]).map(
    ([key, { icon, label }]) => ({ key, icon, label }),
  ),
];

export default function ExploreScreen() {
  const { showToast } = useToast();
  const [openSpaces, setOpenSpaces] = useState<OpenSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [deviceLocation, setDeviceLocation] = useState<Coordinates | null>(null);

  const [movieNameFilter, setMovieNameFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [eventCategoryFilter, setEventCategoryFilter] = useState<EventCategoryFilter>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("any");
  const [distanceFilter, setDistanceFilter] = useState<DistanceFilter>("any");
  const [openOnly, setOpenOnly] = useState(false);
  const [activityFilter, setActivityFilter] = useState<string | null>(null);
  const [chainFilter, setChainFilter] = useState<string | null>(null);
  // Filters live behind a collapsed "Filters" toggle rather than always
  // taking up the top of the screen — most visits just want the list.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  const fetchOpenSpaces = async () => {
    try {
      // authFetch: the API blanks member userIds (→ avatars fall back to
      // initials) for unauthenticated callers; it still works with no session.
      const res = await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/open`);
      if (res.ok) {
        const data = await res.json();
        setOpenSpaces(data || []);
      }
    } catch (err) {
      console.warn("Failed to load open spaces:", err);
    } finally {
      setLoading(false);
    }
  };

  // Refetch on every tab focus, like Home and My Spaces — a mount-only fetch
  // meant creating a Space and coming back here showed a stale feed for the
  // rest of the session. `loading` starts true and only ever flips false, so
  // revisits refresh silently without swapping the list for a spinner.
  useFocusEffect(
    useCallback(() => {
      fetchOpenSpaces();
    }, []),
  );

  useEffect(() => {
    getDeviceLocation().then(setDeviceLocation);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOpenSpaces();
    setRefreshing(false);
  };

  const handleReportSpace = (spaceId: string) => {
    Alert.alert("Report this Space?", "Let us know if this listing looks wrong or inappropriate.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Report",
        style: "destructive",
        onPress: async () => {
          // The confirm above stays a blocking Alert (it's a real decision);
          // the outcome is just information, so it's a toast like the
          // identical flow in group-chat.
          const result = await reportContent("space", spaceId);
          showToast(
            result.success
              ? "Thanks — our team will review this Space."
              : result.error || "Couldn't report. Please try again.",
            result.success ? "success" : "error",
          );
        },
      },
    ]);
  };

  // Distance is computed straight from each space's stored theater lat/lng
  // (captured via Google Places at creation time) against the device's live
  // location — no separate lookup call needed. Spaces without stored
  // coordinates (e.g. a manually-typed theater name) have unknown distance
  // and are never hidden by the distance filter.
  const spaceDistance = (space: OpenSpace): number | null => {
    if (!deviceLocation || space.theaterLatitude == null || space.theaterLongitude == null) {
      return null;
    }
    return distanceMiles(
      deviceLocation.latitude,
      deviceLocation.longitude,
      space.theaterLatitude,
      space.theaterLongitude,
    );
  };

  const passesPriceFilter = (space: OpenSpace) => {
    if (priceFilter === "any") return true;
    if (space.totalCostCents == null) return true; // no price data (public gathering) — don't hide it
    const dollars = space.totalCostCents / 100;
    if (priceFilter === "under50") return dollars < 50;
    if (priceFilter === "50to150") return dollars >= 50 && dollars <= 150;
    return dollars > 150;
  };

  const passesDistanceFilter = (space: OpenSpace) => {
    if (distanceFilter === "any") return true;
    const distance = spaceDistance(space);
    if (distance == null) return true; // unknown — don't hide it
    return distance <= parseInt(distanceFilter, 10);
  };

  const filteredSpaces = openSpaces.filter((space) => {
    if (
      movieNameFilter.trim() &&
      !space.filmName.toLowerCase().includes(movieNameFilter.trim().toLowerCase())
    ) {
      return false;
    }
    if (typeFilter !== "all" && space.spaceType !== typeFilter) return false;
    if (
      eventCategoryFilter !== "all" &&
      eventCategoryOf(space.spaceType, space.eventCategory) !== eventCategoryFilter
    )
      return false;
    if (openOnly && (space.members ?? []).length >= space.maxCapacity) return false;
    if (activityFilter && !space.postActivities?.split(",").includes(activityFilter)) return false;
    if (chainFilter && cinemaChain(space.cinemaName) !== chainFilter) return false;
    if (!passesPriceFilter(space)) return false;
    if (!passesDistanceFilter(space)) return false;
    return true;
  });

  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) +
    (eventCategoryFilter !== "all" ? 1 : 0) +
    (priceFilter !== "any" ? 1 : 0) +
    (distanceFilter !== "any" ? 1 : 0) +
    (chainFilter !== null ? 1 : 0) +
    (activityFilter !== null ? 1 : 0) +
    (openOnly ? 1 : 0);

  // Informational only — "Any" distance already shows every space regardless
  // of how far away it is, so there's nothing to actually re-filter here.
  // This just tells the user when what they're seeing skews far away, rather
  // than silently showing a mix of nearby and distant results with no context.
  const knownDistances = deviceLocation
    ? filteredSpaces.map(spaceDistance).filter((d): d is number => d != null)
    : [];
  const showWideRadiusNotice =
    distanceFilter === "any" &&
    knownDistances.length > 0 &&
    !knownDistances.some((d) => d <= 10) &&
    knownDistances.some((d) => d <= 30);

  // isFillingUpFast / isHappeningTonight used to drive "🔥 Filling Up Fast"
  // and "⚡ Happening Tonight" badges on every card. Both are gone: the card
  // now shows the real attendee count against capacity and a relative date
  // ("Tonight", "In 3 days"), which says the same thing without another two
  // coloured pills competing for attention.

  if (loading) {
    return (
      <Starfield>
        <ActivityIndicator size="large" color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
      </Starfield>
    );
  }

  return (
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.title, SpaceStyles.glowText, SpaceStyles.wordmark]}>Explore Spaces</Text>
        <Text style={styles.subtitle}>Open Spaces near you, filtered your way</Text>

        <View style={styles.linkRow}>
          {/* A code still matters for a private Space (IsPrivate) — those are
              excluded from this feed the same way private rentals used to be,
              just on a different flag now. This is exactly the screen someone
              lands on expecting to find one by browsing instead. */}
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.codeEntryLink}
            onPress={() => router.push("/join-by-code")}
          >
            <Ionicons name="key-outline" size={15} color={SpaceTheme.mutedOrbit} />
            <Text style={styles.codeEntryLinkText}>Have a Space code?</Text>
          </TouchableOpacity>

          {/* Community Spaces (evergreen genre clubs) are deliberately
              excluded from GetOpenSpaces now — mixing a permanent club with
              no real ScreeningTime into "nearby gatherings" was drowning out
              actual local screenings. space-discovery.tsx is otherwise
              onboarding-only, so this is the general entry point for anyone
              past that (or who skipped it) to still find one. No genres
              param means "show every public club."

              Styled as a real chip, not the same muted text link as the code
              entry beside it: this opens an entire second catalog that the
              feed below deliberately hides, so making it look like a
              footnote undersold how much content sits behind it. */}
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.clubsChip}
            onPress={() => router.push("/space-discovery")}
          >
            <Ionicons name="people-outline" size={15} color={SpaceTheme.accentGold} />
            <Text style={styles.clubsChipText}>Browse Community Clubs</Text>
            <Ionicons name="chevron-forward" size={14} color={SpaceTheme.accentGold} />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.clubsChip}
            onPress={() => router.push("/create-club")}
          >
            <Ionicons name="add-circle-outline" size={15} color={SpaceTheme.accentGold} />
            <Text style={styles.clubsChipText}>Create a Club</Text>
            <Ionicons name="chevron-forward" size={14} color={SpaceTheme.accentGold} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={filteredSpaces}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Palette.accent} />
          }
          ListHeaderComponent={
            <View style={styles.filters}>
              <View style={styles.searchBox}>
                <Ionicons name="search-outline" size={18} color={SpaceTheme.mutedOrbit} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search by title..."
                  placeholderTextColor={SpaceTheme.mutedOrbit}
                  value={movieNameFilter}
                  onChangeText={setMovieNameFilter}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                />
              </View>
              <View style={styles.filterBarRow}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={[
                    styles.filterToggle,
                    (filtersOpen || activeFilterCount > 0) && styles.filterToggleActive,
                  ]}
                  onPress={() => setFiltersOpen((v) => !v)}
                >
                  <Ionicons
                    name="options-outline"
                    size={16}
                    color={
                      filtersOpen || activeFilterCount > 0
                        ? SpaceTheme.backgroundVoid
                        : SpaceTheme.mutedOrbit
                    }
                  />
                  <Text
                    style={[
                      styles.filterToggleText,
                      (filtersOpen || activeFilterCount > 0) && styles.filterToggleTextActive,
                    ]}
                  >
                    Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                  </Text>
                  <Ionicons
                    name={filtersOpen ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={
                      filtersOpen || activeFilterCount > 0
                        ? SpaceTheme.backgroundVoid
                        : SpaceTheme.mutedOrbit
                    }
                  />
                </TouchableOpacity>
                <Text style={styles.resultsCount}>
                  {filteredSpaces.length} open space{filteredSpaces.length === 1 ? "" : "s"}
                </Text>
              </View>

              {filtersOpen && (
                <View style={styles.filterDropdown}>
                  <Text style={styles.filterLabel}>Type</Text>
                  <View style={styles.chipRow}>
                    {(
                      [
                        { key: "all", label: "All" },
                        { key: "public_gathering", label: "MovieSpaces" },
                        { key: "private_rental", label: "Watch Parties" },
                      ] as { key: TypeFilter; label: string }[]
                    ).map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        activeOpacity={0.8}
                        style={[styles.chip, typeFilter === key && styles.chipActive]}
                        hitSlop={{ top: 8, bottom: 8 }}
                        onPress={() => setTypeFilter(key)}
                      >
                        <Text style={[styles.chipText, typeFilter === key && styles.chipTextActive]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.filterLabel}>Event Type</Text>
                  <View style={styles.chipRow}>
                    {EVENT_CATEGORY_OPTIONS.map(({ key, icon, label }) => (
                      <TouchableOpacity
                        key={key}
                        activeOpacity={0.8}
                        style={[styles.chip, eventCategoryFilter === key && styles.chipActive]}
                        hitSlop={{ top: 8, bottom: 8 }}
                        onPress={() => setEventCategoryFilter(key)}
                      >
                        {!!icon && (
                          <Ionicons
                            name={icon}
                            size={13}
                            color={
                              eventCategoryFilter === key ? Palette.base : Palette.textMuted
                            }
                          />
                        )}
                        <Text
                          style={[styles.chipText, eventCategoryFilter === key && styles.chipTextActive]}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.filterLabel}>Price</Text>
                  <View style={styles.chipRow}>
                    {(
                      [
                        { key: "any", label: "Any" },
                        { key: "under50", label: "Under $50" },
                        { key: "50to150", label: "$50–150" },
                        { key: "150plus", label: "$150+" },
                      ] as { key: PriceFilter; label: string }[]
                    ).map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        activeOpacity={0.8}
                        style={[styles.chip, priceFilter === key && styles.chipActive]}
                        hitSlop={{ top: 8, bottom: 8 }}
                        onPress={() => setPriceFilter(key)}
                      >
                        <Text style={[styles.chipText, priceFilter === key && styles.chipTextActive]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.filterLabel}>Distance</Text>
                  <View style={styles.chipRow}>
                    {(
                      [
                        { key: "any", label: "Any" },
                        { key: "5", label: "< 5 mi" },
                        { key: "10", label: "< 10 mi" },
                        { key: "25", label: "< 25 mi" },
                      ] as { key: DistanceFilter; label: string }[]
                    ).map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        activeOpacity={0.8}
                        style={[styles.chip, distanceFilter === key && styles.chipActive]}
                        hitSlop={{ top: 8, bottom: 8 }}
                        onPress={() => setDistanceFilter(key)}
                      >
                        <Text
                          style={[styles.chipText, distanceFilter === key && styles.chipTextActive]}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.filterLabel}>Theater Chain</Text>
                  <View style={styles.chipRow}>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      style={[styles.chip, chainFilter === null && styles.chipActive]}
                      onPress={() => setChainFilter(null)}
                    >
                      <Text style={[styles.chipText, chainFilter === null && styles.chipTextActive]}>
                        Any
                      </Text>
                    </TouchableOpacity>
                    {THEATER_CHAINS.map((chain) => (
                      <TouchableOpacity
                        key={chain}
                        activeOpacity={0.8}
                        style={[styles.chip, chainFilter === chain && styles.chipActive]}
                        hitSlop={{ top: 8, bottom: 8 }}
                        onPress={() => setChainFilter(chain)}
                      >
                        <Text style={[styles.chipText, chainFilter === chain && styles.chipTextActive]}>
                          {chain}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.filterLabel}>After the Movie</Text>
                  <View style={styles.chipRow}>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      style={[styles.chip, activityFilter === null && styles.chipActive]}
                      onPress={() => setActivityFilter(null)}
                    >
                      <Text style={[styles.chipText, activityFilter === null && styles.chipTextActive]}>
                        Any
                      </Text>
                    </TouchableOpacity>
                    {POST_ACTIVITIES.map((a) => (
                      <TouchableOpacity
                        key={a.key}
                        activeOpacity={0.8}
                        style={[styles.chip, activityFilter === a.key && styles.chipActive]}
                        hitSlop={{ top: 8, bottom: 8 }}
                        onPress={() => setActivityFilter(a.key)}
                      >
                        <Text
                          style={[styles.chipText, activityFilter === a.key && styles.chipTextActive]}
                        >
                          {a.emoji} {a.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={[styles.chip, styles.toggleChip, openOnly && styles.chipActive]}
                    onPress={() => setOpenOnly((v) => !v)}
                  >
                    <Ionicons
                      name={openOnly ? "checkbox" : "square-outline"}
                      size={16}
                      color={openOnly ? SpaceTheme.backgroundVoid : SpaceTheme.mutedOrbit}
                    />
                    <Text style={[styles.chipText, openOnly && styles.chipTextActive]}>
                      Only show spaces with room left
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {showWideRadiusNotice && (
                <Text style={styles.wideRadiusNotice}>
                  No events found within 10 miles — showing active Watch Parties nearby:
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.spaceCard}
              onPress={() => router.push({ pathname: "/group", params: { groupId: item.id } })}
            >
              <MoviePoster
                uri={item.posterPath}
                width={72}
                style={styles.spaceCardPoster}
                fallbackIcon={EVENT_CATEGORIES[eventCategoryOf(item.spaceType, item.eventCategory)].icon}
              />
              <View style={styles.spaceCardBody}>
                {/* Date first, then title, then place. The card previously
                    opened with the title and stacked up to six coloured
                    badges — "Happening Tonight", "Filling Up Fast",
                    "Cost-Split", "+ Hangout After", "Manually scheduled",
                    a type pill — before ever saying when or where it was.
                    At most one badge earns a place here now; the rest is
                    detail that belongs on the Space itself. */}
                <ExploreCardMeta item={item} distanceMi={spaceDistance(item)} />

                <TouchableOpacity
                  activeOpacity={0.7}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Report this Space"
                  style={styles.reportSpaceButton}
                  onPress={(e) => {
                    e.stopPropagation();
                    handleReportSpace(item.id);
                  }}
                >
                  <Ionicons name="flag-outline" size={13} color={Palette.textFaint} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No open spaces match these filters yet.</Text>
          }
          ListFooterComponent={
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.ctaCard}
              onPress={() =>
                router.push({ pathname: "/create-space", params: { spaceType: "public_gathering" } })
              }
            >
              <Text style={styles.ctaCardTitle}>Don&apos;t see what you&apos;re looking for?</Text>
              <Text style={styles.ctaCardSubtitle}>
                Host a movie night, fight night, or watch party in 60 seconds.
              </Text>
              <View style={styles.ctaCardButton}>
                <Text style={styles.ctaCardButtonText}>+ Create a Space</Text>
              </View>
            </TouchableOpacity>
          }
        />
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
  title: { ...Display.heading, color: Palette.text },
  subtitle: { ...Type.small, color: SpaceTheme.mutedOrbit, marginBottom: 16 },
  linkRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  codeEntryLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 4,
  },
  codeEntryLinkText: { color: SpaceTheme.mutedOrbit, ...Type.small, fontWeight: "600" },
  clubsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    backgroundColor: Palette.accentDim,
  },
  clubsChipText: { color: SpaceTheme.accentGold, ...Type.small, fontWeight: "700" },
  filters: { marginBottom: 8 },
  searchBox: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    ...Type.body,
    color: SpaceTheme.starWhite,
    padding: 0,
  },
  filterBarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  filterToggle: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  filterToggleActive: {
    backgroundColor: SpaceTheme.glowCyan,
    borderColor: SpaceTheme.glowCyan,
  },
  filterToggleText: { ...Type.small, fontWeight: "600", color: SpaceTheme.mutedOrbit },
  filterToggleTextActive: { color: SpaceTheme.backgroundVoid },
  filterDropdown: {
    ...SpaceStyles.glassCard,
    padding: 12,
    marginTop: 8,
  },
  filterLabel: {
    ...Type.small,
    fontWeight: "700",
    color: SpaceTheme.mutedOrbit,
    marginTop: 12,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipActive: {
    backgroundColor: SpaceTheme.glowCyan,
    borderColor: SpaceTheme.glowCyan,
  },
  chipText: { ...Type.small, fontWeight: "600", color: SpaceTheme.mutedOrbit },
  chipTextActive: { color: SpaceTheme.backgroundVoid },
  toggleChip: { marginTop: 12, alignSelf: "flex-start" },
  resultsCount: {
    ...Type.small,
    color: SpaceTheme.mutedOrbit,
  },
  spaceCard: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    gap: 12,
    padding: 12,
    marginBottom: 12,
    alignItems: "flex-start",
  },
  spaceCardPoster: { marginTop: 2 },
  spaceCardBody: { flex: 1 },
  spaceFilmName: {
    ...Type.body,
    fontWeight: "600",
    color: Palette.text,
    marginBottom: 2,
  },
  // Date-led card header.
  cardDateRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 2 },
  cardDate: { ...Display.dateCard, color: Palette.text },
  cardTime: { ...Type.small, color: Palette.textMuted },
  cardRelative: { ...Type.caption, color: Palette.accent, fontWeight: "700" },
  cardFooter: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  // Icon-only, tucked top-right — reporting is a rare action and shouldn't
  // sit inline with the attendee count competing for the same attention.
  reportSpaceButton: { position: "absolute", top: 0, right: 0, padding: 4 },
  spaceDetails: { ...Type.small, color: Palette.textMuted },
  spacePrice: { ...Type.caption, color: Palette.accent, fontWeight: "700" },
  spaceMembers: { ...Type.caption, color: Palette.textMuted, flex: 1 },
  empty: { textAlign: "center", color: SpaceTheme.mutedOrbit, marginTop: 40, ...Type.body },
  wideRadiusNotice: {
    ...Type.caption,
    color: SpaceTheme.supernovaPink,
    marginTop: 4,
    marginBottom: 4,
    fontStyle: "italic",
  },
  ctaCard: {
    ...SpaceStyles.glassCard,
    alignItems: "center",
    padding: 20,
    marginTop: 8,
    marginBottom: 20,
    borderColor: Palette.accentBorder,
  },
  ctaCardTitle: {
    ...Type.body,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginBottom: 4,
    textAlign: "center",
  },
  ctaCardSubtitle: {
    ...Type.small,
    color: SpaceTheme.mutedOrbit,
    textAlign: "center",
    marginBottom: 14,
  },
  ctaCardButton: {
    backgroundColor: SpaceTheme.glowCyan,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  ctaCardButtonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", ...Type.small },
});
