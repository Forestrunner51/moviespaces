import { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Text, TextInput } from "@/frontend/components/scaled-text";
import { Ionicons } from "@expo/vector-icons";
import { SpaceStyles, Palette, Type, Radius } from "@/frontend/constants/theme";
import {
  fetchShowtimeTheaters,
  fetchTheaterShowtimes,
  isStale,
  ShowtimeTheater,
  TheaterShowtimesDay,
} from "@/frontend/services/showtimes";
import * as Location from "expo-location";
import { getDeviceLocation } from "@/frontend/services/nearby-theaters";
import { distanceMiles } from "@/frontend/utils/distance";

// The theater-screening picker: real theaters → real dates → real films and
// times, all from the backend's nightly showtimes cache. This replaced the
// old host-entry flow ("Find Showtimes Near Me" deep link + manual date/time
// pickers + an attestation checkbox) — a Space made through this can only
// reference a showing that actually exists, so there's nothing to attest.
//
// When the cache has nothing (region not covered yet, scrape mid-run, or the
// scraper broken upstream) this renders an honest empty state instead of the
// picker — creation of theater Spaces is data-backed or not at all, by
// product decision.

export interface ShowtimeSelection {
  theaterSlug: string;
  theaterName: string;
  latitude: number | null;
  longitude: number | null;
  movieTitle: string;
  date: string; // YYYY-MM-DD
  minutes: number; // minutes after local midnight
  label: string; // "7:15 PM"
}

interface Props {
  selection: ShowtimeSelection | null;
  onSelect: (selection: ShowtimeSelection) => void;
  // When the film is already decided (Movie Crew), only list that film's
  // showings at each theater instead of the whole marquee.
  filterTitle?: string;
}

const normalizeTitle = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function ShowtimePicker({ selection, onSelect, filterTitle }: Props) {
  const [theaters, setTheaters] = useState<ShowtimeTheater[] | null>(null);
  const [stale, setStale] = useState(false);
  // lastUpdatedUtc with an empty list = the feed HAS data history but
  // everything aged out (broken scraper), which is a different story than
  // "we don't cover your area".
  const [hadDataBefore, setHadDataBefore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [theater, setTheater] = useState<ShowtimeTheater | null>(null);
  const [day, setDay] = useState<TheaterShowtimesDay | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  // Collapsed once a time is chosen; re-expandable to change it.
  // Collapsed from the start when editing an existing showing.
  const [open, setOpen] = useState(!selection);
  const [showAllTheaters, setShowAllTheaters] = useState(false);
  const [hasLocation, setHasLocation] = useState(false);
  // Location permission was granted but no fix arrived (timeout/indoors) —
  // distinct from "not granted" so the hint says what actually happened.
  const [locationFailed, setLocationFailed] = useState(false);
  const [theaterQuery, setTheaterQuery] = useState("");

  // Separate from loadError: that one gates the whole picker's empty state,
  // while a single day's fetch failing should only message inside the flow
  // (the theater list is still fine — the user can retap or switch).
  const [dayError, setDayError] = useState(false);

  const pickTheater = async (t: ShowtimeTheater, date?: string) => {
    setTheater(t);
    setDay(null);
    setDayError(false);
    setDayLoading(true);
    try {
      const data = await fetchTheaterShowtimes(t.slug, date);
      setDay(data);
    } catch {
      setDayError(true);
    } finally {
      setDayLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loc = await getDeviceLocation();
        if (!loc && !cancelled) {
          const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
          setLocationFailed(perm?.status === "granted");
        }
        const result = await fetchShowtimeTheaters(loc?.latitude, loc?.longitude);
        // The API returns every covered metro nearest-first — without this
        // cutoff a user outside coverage saw a "nearest" theater hundreds of
        // miles away instead of the honest "not near you yet" state. No
        // location permission → show the list (we can't know they're far).
        // With a location: only theaters within 60 miles — the API returns
        // every covered metro, and "Show all 800 theaters" is useless to
        // someone in Dallas. Without one: keep the list but see canShowAll.
        let list = result.theaters;
        if (loc) {
          list = list.filter(
            (t) =>
              t.latitude != null &&
              t.longitude != null &&
              distanceMiles(loc.latitude, loc.longitude, t.latitude, t.longitude) <= 60,
          );
        }
        if (!cancelled) {
          setHasLocation(!!loc);
          setTheaters(list);
          setStale(isStale(result.lastUpdatedUtc));
          setHadDataBefore(result.lastUpdatedUtc != null);
          // Editing an existing showing: land on its theater and day so the
          // times are one tap away. Match by slug, else by name (a group row
          // stores the theater's name, not its slug). Search the full
          // result, not the 60-mile cut — the Space may be elsewhere.
          if (selection && !theater) {
            const all = result.theaters;
            const wantName = selection.theaterName.trim().toLowerCase();
            const t =
              all.find((x) => x.slug === selection.theaterSlug) ??
              all.find((x) => x.name.trim().toLowerCase() === wantName);
            if (t) pickTheater(t, selection.date);
          }
        }
      } catch {
        if (!cancelled) {
          setTheaters([]);
          setLoadError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);


  // Film filter: exact normalized match first; otherwise accept a scraped
  // title that is the wanted title followed by a qualifier ("weapons 2025",
  // "dune part two imax"). Not a contains match — "alien" must not pick up
  // "aliens" or "alien romulus", which would seat a crew for the wrong film.
  const visibleMovies = (() => {
    if (!day) return [];
    if (!filterTitle) return day.movies;
    const want = normalizeTitle(filterTitle);
    const exact = day.movies.filter((m) => normalizeTitle(m.title) === want);
    if (exact.length > 0) return exact;
    return day.movies.filter((m) => normalizeTitle(m.title).startsWith(want + " "));
  })();

  if (theaters === null) {
    return <ActivityIndicator color={Palette.accent} style={styles.loading} />;
  }

  if (theaters.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Ionicons name="film-outline" size={22} color={Palette.textMuted} />
        <Text style={styles.emptyTitle}>
          {loadError
            ? "Couldn't load showtimes"
            : hadDataBefore
              ? "Showtimes are temporarily unavailable"
              : "No theaters near you yet"}
        </Text>
        <Text style={styles.emptyText}>
          {loadError
            ? "Please check your connection and try again."
            : hadDataBefore
              ? "Our showtime feed is catching up — check back shortly, or host a Watch Party instead."
              : "Theater showtimes are rolling out area by area. Host a Watch Party instead, or check back soon."}
        </Text>
      </View>
    );
  }

  // Collapsed summary once everything's chosen.
  if (selection && !open) {
    return (
      <TouchableOpacity activeOpacity={0.8} style={styles.summaryCard} onPress={() => setOpen(true)}>
        <Ionicons name="ticket-outline" size={18} color={Palette.accent} />
        <View style={styles.summaryText}>
          <Text style={styles.summaryTitle} numberOfLines={1}>
            {selection.movieTitle}
          </Text>
          <Text style={styles.summarySub} numberOfLines={1}>
            {selection.theaterName} · {selection.date} · {selection.label}
          </Text>
        </View>
        <Text style={styles.summaryChange}>Change</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Most-recent data always shows; this banner is the honesty layer
          when the nightly refresh has been failing for 36h+. */}
      {stale && (
        <View style={styles.staleBanner}>
          <Ionicons name="time-outline" size={14} color={Palette.accent} />
          <Text style={styles.staleBannerText}>
            These showtimes haven&apos;t refreshed recently — double-check with the theater before
            heading out.
          </Text>
        </View>
      )}

      {/* Step 1 — theater (nearest first, name-filterable) */}
      <Text style={styles.stepLabel}>THEATER</Text>
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color={Palette.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search theaters..."
          placeholderTextColor={Palette.textFaint}
          value={theaterQuery}
          onChangeText={setTheaterQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      {/* Vertical, nearest-first — the parent screen scrolls, so plain rows.
          Capped at 8 until expanded (searching always shows every match). */}
      {(theaterQuery.trim()
        ? theaters.filter((t) => t.name.toLowerCase().includes(theaterQuery.trim().toLowerCase()))
        : showAllTheaters
          ? theaters
          : theaters.slice(0, 8)
      ).map((t) => (
        <TouchableOpacity
          key={t.slug}
          activeOpacity={0.8}
          style={[styles.theaterRow, theater?.slug === t.slug && styles.chipActive]}
          onPress={() => pickTheater(t)}
        >
          <Text
            style={[styles.chipText, theater?.slug === t.slug && styles.chipTextActive]}
            numberOfLines={1}
          >
            {t.name}
          </Text>
          <Text style={styles.theaterRowCount}>{t.movieCount} films</Text>
        </TouchableOpacity>
      ))}
      {/* Without a location the list is every covered metro, nearest-first
          is meaningless, and "show all" would be hundreds of rows — offer
          search and a nudge instead. */}
      {!theaterQuery.trim() && theaters.length > 8 && hasLocation && (
        <TouchableOpacity activeOpacity={0.8} onPress={() => setShowAllTheaters((p) => !p)}>
          <Text style={styles.showAllText}>
            {showAllTheaters ? "Show fewer" : `Show all ${theaters.length} nearby theaters`}
          </Text>
        </TouchableOpacity>
      )}
      {!theaterQuery.trim() && !hasLocation && (
        <Text style={styles.locationHint}>
          {locationFailed
            ? "Couldn't get your location — search for a theater by name instead."
            : "Turn on location to see theaters near you, or search by name."}
        </Text>
      )}

      {/* Step 2 — date */}
      {theater && day && day.availableDates.length > 0 && (
        <>
          <Text style={styles.stepLabel}>DATE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
            {day.availableDates.map((d) => (
              <TouchableOpacity
                key={d}
                activeOpacity={0.8}
                style={[styles.chip, day.date === d && styles.chipActive]}
                onPress={() => pickTheater(theater, d)}
              >
                <Text style={[styles.chipText, day.date === d && styles.chipTextActive]}>
                  {formatChipDate(d)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      {dayLoading && <ActivityIndicator color={Palette.accent} style={styles.loading} />}

      {theater && dayError && !dayLoading && (
        <TouchableOpacity activeOpacity={0.8} onPress={() => pickTheater(theater)}>
          <Text style={styles.dayErrorText}>
            Couldn&apos;t load this theater&apos;s showtimes — tap to retry.
          </Text>
        </TouchableOpacity>
      )}

      {/* Step 3 — film & time */}
      {theater && day && !dayLoading && (
        <>
          <Text style={styles.stepLabel}>{filterTitle ? "TIME" : "FILM & TIME"}</Text>
          {visibleMovies.length === 0 && (
            <Text style={styles.emptyText}>
              {filterTitle
                ? `No showings of ${filterTitle} listed here this day — try another date or theater.`
                : "No showings listed for this day."}
            </Text>
          )}
          {visibleMovies.map((m) => (
            <View key={m.slug || m.title} style={styles.movieRow}>
              <Text style={styles.movieTitle} numberOfLines={2}>
                {m.title}
              </Text>
              <View style={styles.timeRow}>
                {m.times.map((t) => {
                  const isSelected =
                    selection?.theaterSlug === theater.slug &&
                    selection?.movieTitle === m.title &&
                    selection?.date === day.date &&
                    selection?.minutes === t.minutes;
                  return (
                    <TouchableOpacity
                      key={t.minutes}
                      activeOpacity={0.8}
                      style={[styles.timeChip, isSelected && styles.chipActive]}
                      onPress={() => {
                        onSelect({
                          theaterSlug: theater.slug,
                          theaterName: theater.name,
                          latitude: theater.latitude,
                          longitude: theater.longitude,
                          movieTitle: m.title,
                          date: day.date,
                          minutes: t.minutes,
                          label: t.label,
                        });
                        setOpen(false);
                      }}
                    >
                      <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

// "2026-08-15" → "Sat, Aug 15". Parsed by parts, not new Date(string) — a bare
// ISO date string parses as UTC midnight and renders the previous day in any
// negative-offset timezone.
function formatChipDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  container: { marginBottom: 4 },
  loading: { marginVertical: 16 },
  stepLabel: {
    ...Type.caption,
    fontWeight: "700",
    letterSpacing: 1,
    color: Palette.textMuted,
    marginTop: 12,
    marginBottom: 6,
  },
  chipScroll: { gap: 8, paddingRight: 8 },
  locationHint: { ...Type.caption, color: Palette.textFaint, marginTop: 6 },
  chip: {
    ...SpaceStyles.glassCard,
    paddingVertical: 8,
    paddingHorizontal: 14,
    maxWidth: 220,
  },
  chipActive: { borderColor: Palette.accentBorder, backgroundColor: Palette.accentDim },
  chipText: { ...Type.small, color: Palette.textMuted, fontWeight: "600" },
  chipTextActive: { color: Palette.accent },
  movieRow: { marginBottom: 12 },
  movieTitle: { ...Type.body, fontWeight: "600", color: Palette.text, marginBottom: 6 },
  timeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeChip: {
    backgroundColor: Palette.raised,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.small,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  emptyCard: {
    ...SpaceStyles.glassCard,
    alignItems: "center",
    gap: 6,
    padding: 20,
    marginBottom: 8,
  },
  emptyTitle: { ...Type.body, fontWeight: "700", color: Palette.text },
  emptyText: { ...Type.small, color: Palette.textMuted, textAlign: "center" },
  summaryCard: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    marginBottom: 8,
    borderColor: Palette.accentBorder,
  },
  summaryText: { flex: 1 },
  summaryTitle: { ...Type.body, fontWeight: "700", color: Palette.text },
  summarySub: { ...Type.caption, color: Palette.textMuted, marginTop: 2 },
  summaryChange: { ...Type.small, color: Palette.accent, fontWeight: "700" },
  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    borderRadius: Radius.small,
    padding: 10,
    marginTop: 8,
  },
  staleBannerText: { ...Type.caption, color: Palette.text, flex: 1 },
  dayErrorText: { ...Type.small, color: Palette.danger, marginTop: 10, textAlign: "center" },
  theaterRow: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  theaterRowCount: { ...Type.caption, color: Palette.textFaint },
  searchRow: {
    ...SpaceStyles.field,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  searchInput: { flex: 1, ...Type.small, color: Palette.text, padding: 0 },
  showAllText: { ...Type.small, color: Palette.accent, fontWeight: "700", textAlign: "center", marginTop: 4 },
});
