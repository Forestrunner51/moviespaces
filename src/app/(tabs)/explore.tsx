import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { POST_ACTIVITIES, activityEmoji, activityLabel } from "@/frontend/constants/activities";
import { THEATER_CHAINS, cinemaChain } from "@/frontend/constants/theater-memberships";
import { getDeviceLocation, Coordinates } from "@/frontend/services/nearby-theaters";
import { distanceMiles } from "@/frontend/utils/distance";
import { reportContent } from "@/frontend/services/moderation";

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
  members: { id: string; name: string; confirmed: boolean }[];
}

type TypeFilter = "all" | "public_gathering" | "private_rental";
type PriceFilter = "any" | "under50" | "50to150" | "150plus";
type DistanceFilter = "any" | "5" | "10" | "25";

export default function ExploreScreen() {
  const [openSpaces, setOpenSpaces] = useState<OpenSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [deviceLocation, setDeviceLocation] = useState<Coordinates | null>(null);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("any");
  const [distanceFilter, setDistanceFilter] = useState<DistanceFilter>("any");
  const [openOnly, setOpenOnly] = useState(false);
  const [activityFilter, setActivityFilter] = useState<string | null>(null);
  const [chainFilter, setChainFilter] = useState<string | null>(null);

  const fetchOpenSpaces = async () => {
    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/open`);
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

  useEffect(() => {
    fetchOpenSpaces();
    getDeviceLocation().then(setDeviceLocation);
  }, []);

  const handleReportSpace = (spaceId: string) => {
    Alert.alert("Report this Space?", "Let us know if this listing looks wrong or inappropriate.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Report",
        style: "destructive",
        onPress: async () => {
          const result = await reportContent("space", spaceId);
          Alert.alert(
            result.success ? "Reported" : "Couldn't report",
            result.success ? "Thanks — our team will review this Space." : result.error || "Please try again.",
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
    if (typeFilter !== "all" && space.spaceType !== typeFilter) return false;
    if (openOnly && space.members.length >= space.maxCapacity) return false;
    if (activityFilter && !space.postActivities?.split(",").includes(activityFilter)) return false;
    if (chainFilter && cinemaChain(space.cinemaName) !== chainFilter) return false;
    if (!passesPriceFilter(space)) return false;
    if (!passesDistanceFilter(space)) return false;
    return true;
  });

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

  const confirmedCount = (space: OpenSpace) => space.members.filter((m) => m.confirmed).length;

  const isFillingUpFast = (space: OpenSpace) =>
    space.maxCapacity > 0 && confirmedCount(space) >= space.maxCapacity * 0.75;

  const isHappeningTonight = (space: OpenSpace) => {
    if (!space.screeningTime) return false;
    const eventDate = new Date(space.screeningTime);
    const now = new Date();
    return (
      eventDate.getFullYear() === now.getFullYear() &&
      eventDate.getMonth() === now.getMonth() &&
      eventDate.getDate() === now.getDate()
    );
  };

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
        <Text style={[styles.title, SpaceStyles.glowText]}>Explore Spaces</Text>
        <Text style={styles.subtitle}>Open Spaces near you, filtered your way</Text>

        <FlatList
          data={filteredSpaces}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View style={styles.filters}>
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
                    onPress={() => setTypeFilter(key)}
                  >
                    <Text style={[styles.chipText, typeFilter === key && styles.chipTextActive]}>
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

              <Text style={styles.resultsCount}>
                {filteredSpaces.length} open space{filteredSpaces.length === 1 ? "" : "s"}
              </Text>
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
              <View style={styles.spaceCardHeader}>
                <Text style={styles.spaceFilmName} numberOfLines={1}>
                  {item.filmName}
                </Text>
                <View
                  style={[
                    styles.typeBadge,
                    item.spaceType === "private_rental" && styles.typeBadgePink,
                  ]}
                >
                  <Text style={styles.typeBadgeText}>
                    {item.spaceType === "private_rental" ? "Watch Party" : "MovieSpace"}
                  </Text>
                </View>
              </View>
              <View style={styles.statusRow}>
                {isHappeningTonight(item) && (
                  <View style={[styles.statusBadge, styles.statusBadgeHot]}>
                    <Text style={styles.statusBadgeText}>⚡ Happening Tonight</Text>
                  </View>
                )}
                {isFillingUpFast(item) && (
                  <View style={[styles.statusBadge, styles.statusBadgeHot]}>
                    <Text style={styles.statusBadgeText}>🔥 Filling Up Fast</Text>
                  </View>
                )}
                {item.totalCostCents != null && item.totalCostCents > 0 ? (
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusBadgeText}>🎟️ Cost-Split</Text>
                  </View>
                ) : (
                  <View style={[styles.statusBadge, styles.statusBadgeFree]}>
                    <Text style={styles.statusBadgeFreeText}>🎉 Free Event</Text>
                  </View>
                )}
              </View>
              {item.postActivities && (
                <View style={styles.hangoutBadge}>
                  <Text style={styles.hangoutBadgeText}>💬 + Hangout After</Text>
                </View>
              )}
              <Text style={styles.spaceDetails} numberOfLines={1}>
                {item.cinemaName}
                {spaceDistance(item) != null ? ` • ${spaceDistance(item)!.toFixed(1)} mi` : ""}
              </Text>
              <Text style={styles.spaceDetails}>
                {item.showDate} • {item.showTime}
              </Text>
              <Text style={styles.manualBadge}>👤 Manually scheduled by host</Text>
              {item.totalCostCents != null && (
                <Text style={styles.spacePrice}>
                  ${(item.totalCostCents / 100).toFixed(0)} total
                </Text>
              )}
              {item.postActivities && (
                <View style={styles.afterRow}>
                  {item.postActivities.split(",").map((key) => (
                    <View key={key} style={styles.afterBadge}>
                      <Text style={styles.afterBadgeText}>
                        {activityEmoji(key)} {activityLabel(key)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.spaceFooter}>
                <Text style={styles.spaceMembers}>
                  👥 {item.members.length}/{item.maxCapacity} going
                </Text>
                <Text style={styles.spaceHost} numberOfLines={1}>
                  by {item.hostName}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  hitSlop={8}
                  onPress={(e) => {
                    e.stopPropagation();
                    handleReportSpace(item.id);
                  }}
                >
                  <Text style={styles.reportSpaceLink}>🚩 Report</Text>
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
  title: { fontSize: 28, fontWeight: "bold", color: SpaceTheme.starWhite },
  subtitle: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginBottom: 16 },
  filters: { marginBottom: 8 },
  filterLabel: {
    fontSize: 13,
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
  chipText: { fontSize: 13, fontWeight: "600", color: SpaceTheme.mutedOrbit },
  chipTextActive: { color: SpaceTheme.backgroundVoid },
  toggleChip: { marginTop: 12, alignSelf: "flex-start" },
  resultsCount: {
    fontSize: 13,
    color: SpaceTheme.mutedOrbit,
    marginTop: 16,
    marginBottom: 4,
  },
  spaceCard: {
    ...SpaceStyles.glassCard,
    padding: 16,
    marginBottom: 12,
  },
  spaceCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  spaceFilmName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginRight: 8,
  },
  typeBadge: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.4)",
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  typeBadgePink: {
    backgroundColor: "rgba(244, 114, 182, 0.15)",
    borderColor: "rgba(244, 114, 182, 0.4)",
  },
  typeBadgeText: { fontSize: 11, fontWeight: "700", color: SpaceTheme.starWhite },
  spaceDetails: { fontSize: 13, color: SpaceTheme.mutedOrbit, marginBottom: 2 },
  manualBadge: { fontSize: 11, color: SpaceTheme.mutedOrbit, fontStyle: "italic", marginTop: 2 },
  spacePrice: { fontSize: 13, color: SpaceTheme.supernovaPink, fontWeight: "700", marginTop: 4 },
  hangoutBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(244, 114, 182, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(244, 114, 182, 0.4)",
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginTop: 6,
    shadowColor: SpaceTheme.supernovaPink,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 2,
  },
  hangoutBadgeText: { fontSize: 11, fontWeight: "700", color: SpaceTheme.supernovaPink },
  afterRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  afterBadge: {
    backgroundColor: "rgba(244, 114, 182, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(244, 114, 182, 0.4)",
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  afterBadgeText: { fontSize: 11, fontWeight: "600", color: SpaceTheme.supernovaPink },
  spaceFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  spaceMembers: { fontSize: 12, color: SpaceTheme.glowCyan, fontWeight: "600" },
  spaceHost: { fontSize: 11, color: SpaceTheme.mutedOrbit, maxWidth: 120 },
  reportSpaceLink: { fontSize: 11, color: SpaceTheme.mutedOrbit },
  empty: { textAlign: "center", color: SpaceTheme.mutedOrbit, marginTop: 40, fontSize: 16 },
  wideRadiusNotice: {
    fontSize: 12,
    color: SpaceTheme.supernovaPink,
    marginTop: 4,
    marginBottom: 4,
    fontStyle: "italic",
  },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  statusBadge: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.4)",
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  statusBadgeHot: {
    backgroundColor: "rgba(244, 114, 182, 0.15)",
    borderColor: "rgba(244, 114, 182, 0.4)",
  },
  statusBadgeText: { fontSize: 11, fontWeight: "700", color: SpaceTheme.starWhite },
  statusBadgeFree: {
    backgroundColor: "rgba(74, 222, 128, 0.15)",
    borderColor: "rgba(74, 222, 128, 0.4)",
  },
  statusBadgeFreeText: { fontSize: 11, fontWeight: "700", color: "#4ADE80" },
  ctaCard: {
    ...SpaceStyles.glassCard,
    alignItems: "center",
    padding: 20,
    marginTop: 8,
    marginBottom: 20,
    borderColor: "rgba(56, 189, 248, 0.3)",
  },
  ctaCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginBottom: 4,
    textAlign: "center",
  },
  ctaCardSubtitle: {
    fontSize: 13,
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
  ctaCardButtonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", fontSize: 14 },
});
