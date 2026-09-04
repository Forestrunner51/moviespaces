import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Text, TextInput } from "@/frontend/components/scaled-text";
import { FilmLoader } from "@/frontend/components/film-loader";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { SpaceStyles, Palette, Type, Display, Radius } from "@/frontend/constants/theme";
import { useToast } from "@/frontend/components/toast";
import { authFetch } from "@/frontend/services/api";
import { completeOnboarding } from "@/frontend/services/onboarding";
import { formatEventDate } from "@/frontend/utils/event-date";
import { getDeviceLocation, type Coordinates } from "@/frontend/services/nearby-theaters";
import { distanceMiles, formatMilesAway } from "@/frontend/utils/distance";

interface DiscoverSpace {
  id: string;
  displayName: string;
  spaceCode: string | null;
  genreCategory: string | null;
  posterPath: string | null;
  memberCount: number;
  playedTodayCount: number;
  todayAvgScore: number | null;
  isJoined: boolean;
  isMine: boolean;
  latitude: number | null;
  longitude: number | null;
}

// One haversine per row, computed once then sorted — not per comparison.
function milesFrom(
  coords: Coordinates,
  lat: number | null,
  lng: number | null,
): number | null {
  return lat != null && lng != null
    ? distanceMiles(coords.latitude, coords.longitude, lat, lng)
    : null;
}
function sortByDistance<T>(list: T[], miles: (item: T) => number | null): T[] {
  return list
    .map((item) => ({ item, d: miles(item) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.item);
}

// Browse filters. "Near me" needs a device fix; clubs without a pin sort
// after the pinned ones rather than disappearing (a global club is still
// joinable from anywhere — location is a boost, not a gate).
type ClubFilter = "all" | "crews" | "near" | "joined" | "mine";
const FILTERS: { key: ClubFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "crews", label: "Crews" },
  { key: "near", label: "Near me" },
  { key: "joined", label: "Joined" },
  { key: "mine", label: "Mine" },
];

// Shape returned by GET /api/group/crews/open — a live Movie Crew still
// taking members. Listed here so clubs and crews share one searchable pool
// instead of crews being reachable only through the match flow.
interface OpenCrew {
  id: string;
  filmName: string;
  posterPath: string | null;
  spaceType: string;
  cinemaName: string | null;
  showDate: string | null;
  showTime: string | null;
  screeningTime: string | null;
  theaterLatitude: number | null;
  theaterLongitude: number | null;
  memberCount: number;
  maxCapacity: number;
  alreadyIn: boolean;
}

// Icons rather than emoji — see event-categories.ts for the reasoning.
const ICON_BY_GENRE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Blockbusters: "film-outline",
  "Sci-Fi": "planet-outline",
  Horror: "skull-outline",
  Indie: "color-palette-outline",
  Action: "flash-outline",
  General: "videocam-outline",
  Comedy: "happy-outline",
  Thriller: "eye-outline",
  Anime: "sparkles-outline",
  Romance: "heart-outline",
  Classics: "time-outline",
  Documentary: "earth-outline",
  Family: "balloon-outline",
};

// Preview-before-joining: reached from onboarding's genre picker (with
// selected genres as a param) or, in principle, anywhere else that wants to
// let someone browse Community Spaces — the genres param is optional, and an
// empty one just shows every public club.
export default function SpaceDiscoveryScreen() {
  const { showToast } = useToast();
  const { genres, onboarding } = useLocalSearchParams<{ genres?: string; onboarding?: string }>();
  // Reached two ways: as the last step of onboarding (where "Continue"
  // finalizes onboarding) or as a plain browse screen from Explore (where
  // there's a real screen to go back to). Only the onboarding entry passes
  // this flag, so everywhere else gets a back button instead of "Continue".
  const isOnboarding = onboarding === "1";
  const [spaces, setSpaces] = useState<DiscoverSpace[]>([]);
  const [crews, setCrews] = useState<OpenCrew[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ClubFilter>("all");
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationFailed, setLocationFailed] = useState(false);

  // Guards the async location fetch: bouncing off and back onto "Near me"
  // while a slow fix is pending must not let the first request's failure
  // stomp the second one's status.
  const locateSeq = useRef(0);
  const pickFilter = useCallback(async (next: ClubFilter) => {
    setFilter(next);
    if (next !== "near" || coords) return;
    const seq = ++locateSeq.current;
    setLocating(true);
    setLocationFailed(false);
    const loc = await getDeviceLocation();
    if (seq !== locateSeq.current) return;
    setCoords(loc);
    setLocationFailed(!loc);
    setLocating(false);
  }, [coords]);

  const visibleSpaces = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = spaces;
    if (q) {
      list = list.filter(
        (s) =>
          s.displayName.toLowerCase().includes(q) ||
          (s.genreCategory ?? "").toLowerCase().includes(q),
      );
    }
    if (filter === "crews") return []; // crews-only view — the crews section carries it
    if (filter === "joined") list = list.filter((s) => s.isJoined);
    if (filter === "mine") list = list.filter((s) => s.isMine);
    if (filter === "near" && coords) {
      list = sortByDistance(list, (s) => milesFrom(coords, s.latitude, s.longitude));
    }
    return list;
  }, [spaces, search, filter, coords]);

  const visibleCrews = useMemo(() => {
    if (filter === "mine") return []; // creator isn't tracked on the row
    const q = search.trim().toLowerCase();
    let list = crews;
    if (q) {
      list = list.filter(
        (c) =>
          c.filmName.toLowerCase().includes(q) ||
          (c.cinemaName ?? "").toLowerCase().includes(q),
      );
    }
    if (filter === "joined") list = list.filter((c) => c.alreadyIn);
    if (filter === "near" && coords) {
      list = sortByDistance(list, (c) => milesFrom(coords, c.theaterLatitude, c.theaterLongitude));
    }
    return list;
  }, [crews, search, filter, coords]);

  const crewMilesAway = useCallback(
    (c: OpenCrew): string | null =>
      coords ? formatMilesAway(milesFrom(coords, c.theaterLatitude, c.theaterLongitude)) : null,
    [coords],
  );

  const milesAway = useCallback(
    (space: DiscoverSpace): string | null => {
      if (!coords) return null;
      const label = formatMilesAway(milesFrom(coords, space.latitude, space.longitude));
      return label ? `${label} away` : null;
    },
    [coords],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const query = genres ? `?genres=${encodeURIComponent(genres)}` : "";
      const res = await authFetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/community-spaces/discover${query}`,
      );
      if (!res.ok) throw new Error(`Couldn't load Spaces (${res.status}).`);
      const data = await res.json();
      setSpaces(data.spaces ?? []);
      // Crews are additive to this screen — if the endpoint fails the club
      // browse still works, so it never throws the whole page into an error.
      try {
        const crewRes = await authFetch(
          `${process.env.EXPO_PUBLIC_API_URL}/api/group/crews/open`,
        );
        setCrews(crewRes.ok ? await crewRes.json() : []);
      } catch {
        setCrews([]);
      }
    } catch (err: any) {
      setErrorText(err?.message || "Couldn't load Community Spaces.");
    } finally {
      setLoading(false);
    }
  }, [genres]);

  useEffect(() => {
    load();
  }, [load]);

  const handleJoin = async (space: DiscoverSpace) => {
    setJoiningId(space.id);
    try {
      const res = await authFetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/${space.id}/join`,
        { method: "POST", body: JSON.stringify({ name: "" }) },
      );
      if (res.ok) {
        setSpaces((prev) => prev.map((s) => (s.id === space.id ? { ...s, isJoined: true } : s)));
      } else {
        // Was silent — a first-run user tapping Join on flaky signal saw
        // nothing happen and couldn't tell if it worked. Tell them.
        const body = await res.json().catch(() => null);
        showToast(body?.error || "Couldn't join that club. Please try again.");
      }
    } catch {
      showToast("Network error — please try again.");
    } finally {
      setJoiningId(null);
    }
  };

  const handleContinue = async () => {
    // Last onboarding stop (the tour ran BEFORE this screen). The flag was
    // already written at the taste step; completeOnboarding re-writes it
    // harmlessly and routes into the app.
    setFinishing(true);
    try {
      await completeOnboarding();
    } finally {
      setFinishing(false);
    }
  };

  return (
    <Starfield>
      <ScrollView contentContainerStyle={styles.content}>
        {!isOnboarding && (
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.backButton}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/explore"))}
          >
            <Ionicons name="chevron-back" size={22} color={Palette.text} />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>Clubs &amp; Crews</Text>
        <Text style={styles.subtitle}>
          {isOnboarding
            ? "Matched to your picks. Clubs are open rooms of movie people — join any. Crews are real plans you can hop into later."
            : "Clubs are where you find your people. Crews are real plans — pick one and go."}
        </Text>

        <TextInput
          style={styles.searchInput}
          placeholder="Search clubs by name or genre"
          placeholderTextColor={Palette.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search clubs"
        />
        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              activeOpacity={0.85}
              style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
              onPress={() => pickFilter(f.key)}
            >
              <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {filter === "near" && locating && (
          <Text style={styles.locationNote}>Finding clubs near you…</Text>
        )}
        {filter === "near" && locationFailed && (
          <Text style={styles.locationNote}>
            Couldn&apos;t get your location — showing every club instead.
          </Text>
        )}

        {loading && <FilmLoader style={styles.loading} />}

        {errorText && !loading && (
          <View style={styles.card}>
            <Text style={styles.errorText}>{errorText}</Text>
            <TouchableOpacity activeOpacity={0.85} style={styles.retryButton} onPress={load}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !errorText && visibleSpaces.length === 0 && visibleCrews.length === 0 && (
          <View style={styles.card}>
            <Text style={styles.emptyText}>
              {spaces.length === 0
                ? "No Community Spaces matched — try different genres."
                : filter === "joined"
                  ? "You haven't joined a club yet."
                  : filter === "mine"
                    ? "You haven't created a club yet."
                    : filter === "crews"
                      ? "No crews forming right now."
                      : "No clubs match that search."}
            </Text>
            {filter === "crews" && (
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.emptyCrewButton}
                onPress={() => router.push("/match")}
                accessibilityRole="button"
              >
                <Text style={styles.emptyCrewButtonText}>Start one — find a crew</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {!loading && visibleCrews.length > 0 && filter !== "mine" && (
          <>
            <View style={styles.groupHeaderRow}>
              <Text style={styles.groupHeader}>CREWS FORMING</Text>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => router.push("/match")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Find a crew"
              >
                <Text style={styles.findCrewLink}>+ Find a crew</Text>
              </TouchableOpacity>
            </View>
            {visibleCrews.map((crew) => {
              const when = formatEventDate(crew.screeningTime, crew.showDate ?? "", crew.showTime ?? "");
              const dist = crewMilesAway(crew);
              return (
                <TouchableOpacity
                  key={crew.id}
                  activeOpacity={0.85}
                  style={styles.card}
                  onPress={() => router.push({ pathname: "/group", params: { groupId: crew.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`View crew for ${crew.filmName}`}
                >
                  <View style={styles.cardHeader}>
                    <MoviePoster uri={crew.posterPath} width={44} fallbackIcon="film-outline" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{crew.filmName}</Text>
                      <Text style={styles.crewMeta} numberOfLines={1}>
                        {crew.spaceType === "private_rental" ? "Watch party" : crew.cinemaName || "Theater TBD"}
                        {when.date ? ` · ${when.date}` : ""}
                        {when.time ? ` ${when.time}` : ""}
                        {dist ? ` · ${dist}` : ""}
                      </Text>
                    </View>
                    <View style={styles.crewSeatsPill}>
                      <Text style={styles.crewSeatsPillText}>
                        {crew.alreadyIn ? "You're in" : `${crew.memberCount} of ${crew.maxCapacity}`}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
            {visibleSpaces.length > 0 && <Text style={styles.groupHeader}>COMMUNITY CLUBS</Text>}
          </>
        )}

        {!loading &&
          visibleSpaces.map((space) => (
            <View key={space.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <MoviePoster
                  uri={space.posterPath}
                  width={44}
                  fallbackIcon={ICON_BY_GENRE[space.genreCategory ?? ""] ?? "videocam-outline"}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{space.displayName}</Text>
                  {!!space.genreCategory && <Text style={styles.genreBadge}>{space.genreCategory}</Text>}
                  {!!milesAway(space) && <Text style={styles.distanceText}>{milesAway(space)}</Text>}
                </View>
              </View>

              <View style={styles.statsRow}>
                <Text style={styles.statText}>{space.memberCount} members</Text>
                <Text style={styles.statText}>
                  {space.playedTodayCount === 0
                    ? "No plays yet today"
                    : space.todayAvgScore != null
                      ? `${space.playedTodayCount} played today · avg ${space.todayAvgScore}`
                      : `${space.playedTodayCount} played today`}
                </Text>
              </View>

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.previewButton}
                  onPress={() => router.push({ pathname: "/group", params: { groupId: space.id } })}
                  accessibilityLabel={`Preview ${space.displayName} before joining`}
                >
                  <Ionicons name="eye-outline" size={15} color={Palette.accent} />
                  <Text style={styles.previewButtonText}>Preview</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.joinButton, space.isJoined && styles.joinButtonJoined]}
                  onPress={() => handleJoin(space)}
                  disabled={space.isJoined || joiningId === space.id}
                >
                  {joiningId === space.id ? (
                    <ActivityIndicator size="small" color={Palette.base} />
                  ) : (
                    <Text style={[styles.joinButtonText, space.isJoined && styles.joinButtonTextJoined]}>
                      {space.isJoined ? "Joined" : "Join Space"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ))}

      </ScrollView>
      {/* Pinned, not the last item in the scroll: testers didn't know to
          scroll past every club to find the way forward. */}
      {isOnboarding && (
        <View style={styles.continueBar}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.continueButton, finishing && styles.continueButtonDisabled]}
            onPress={handleContinue}
            disabled={finishing}
          >
            {finishing ? (
              <ActivityIndicator color={Palette.base} />
            ) : (
              <Text style={styles.continueButtonText}>Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </Starfield>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 40 },
  backButton: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 2, marginBottom: 8, paddingVertical: 4, paddingRight: 8 },
  backButtonText: { ...Type.body, color: Palette.text },
  title: { ...Display.heading, color: Palette.text, textAlign: "center" },
  subtitle: {
    ...Type.small,
    color: Palette.textMuted,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 24,
  },
  loading: { marginVertical: 24 },
  searchInput: { ...SpaceStyles.field, ...Type.body, color: Palette.text, padding: 14, marginBottom: 12 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  filterChip: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  filterChipActive: { backgroundColor: Palette.accentDim, borderColor: Palette.accentBorder },
  filterChipText: { ...Type.small, color: Palette.textMuted },
  filterChipTextActive: { color: Palette.accent, fontWeight: "600" },
  locationNote: { ...Type.caption, color: Palette.textMuted, marginBottom: 12 },
  distanceText: { ...Type.caption, color: Palette.textMuted, marginTop: 2 },
  groupHeaderRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  findCrewLink: { ...Type.caption, color: Palette.accent, fontWeight: "700" },
  emptyCrewButton: {
    alignSelf: "center",
    marginTop: 12,
    backgroundColor: Palette.accent,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  emptyCrewButtonText: { ...Type.small, color: Palette.base, fontWeight: "700" },
  groupHeader: {
    ...Type.caption,
    fontWeight: "700",
    letterSpacing: 1,
    color: Palette.textFaint,
    marginBottom: 10,
    marginTop: 4,
  },
  crewMeta: { ...Type.caption, color: Palette.textMuted, marginTop: 2 },
  crewSeatsPill: {
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    backgroundColor: Palette.accentDim,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  crewSeatsPillText: { ...Type.caption, color: Palette.accent, fontWeight: "700" },
  card: { ...SpaceStyles.glassCard, padding: 16, marginBottom: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  cardTitle: { ...Type.body, fontWeight: "700", color: Palette.text },
  genreBadge: {
    ...Type.caption,
    color: Palette.accent,
    fontWeight: "700",
    textTransform: "uppercase",
    marginTop: 2,
  },
  statsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  statText: { ...Type.caption, color: Palette.textMuted },
  actionsRow: { flexDirection: "row", gap: 10 },
  previewButton: {
    ...SpaceStyles.field,
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingVertical: 11,
    borderColor: Palette.accentBorder,
  },
  previewButtonText: { ...Type.small, color: Palette.accent, fontWeight: "700" },
  joinButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Palette.accent,
    borderRadius: Radius.small,
    paddingVertical: 11,
  },
  joinButtonJoined: { backgroundColor: Palette.surfaceHover },
  joinButtonText: { ...Type.small, color: Palette.base, fontWeight: "700" },
  joinButtonTextJoined: { color: Palette.textMuted },
  errorText: { ...Type.small, color: Palette.text, textAlign: "center", marginBottom: 12 },
  retryButton: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 16 },
  retryButtonText: { ...Type.small, color: Palette.accent, fontWeight: "700" },
  emptyText: { ...Type.small, color: Palette.textMuted, textAlign: "center" },
  continueBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
    backgroundColor: Palette.base,
  },
  continueButton: {
    backgroundColor: Palette.accent,
    borderRadius: Radius.medium,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  continueButtonDisabled: { opacity: 0.6 },
  continueButtonText: { ...Type.body, color: Palette.base, fontWeight: "700" },
});
