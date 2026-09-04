import { useEffect, useRef, useState } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  ScrollView,
  Platform,
  InputAccessoryView,
  Keyboard,
} from "react-native";
import { Text, TextInput } from "@/frontend/components/scaled-text";
import { FilmLoader } from "@/frontend/components/film-loader";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Starfield } from "@/frontend/components/starfield";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { ShowtimePicker, ShowtimeSelection } from "@/frontend/components/showtime-picker";
import { SpaceStyles, Palette, Type, Display, Radius, Font } from "@/frontend/constants/theme";
import { useToast } from "@/frontend/components/toast";
import { authFetch } from "@/frontend/services/api";
import { resolveDisplayName } from "@/frontend/services/display-name";
import { searchMovies, Movie, getNowPlaying, resolveMarqueeTitle } from "@/frontend/services/movies";
import { combineDateAndTime, formatEventDate, isPastDateTime } from "@/frontend/utils/event-date";
import { POST_ACTIVITIES } from "@/frontend/constants/activities";
import {
  fetchNearbyTheaters,
  getDeviceLocation,
  type Coordinates,
  type NearbyTheater,
} from "@/frontend/services/nearby-theaters";

// Keep in sync with GroupController.MatchCrewSize.
const MATCH_CREW_SIZE = 6;
// iOS decimal keyboards have no Return key; this accessory bar is the only
// way out of the cost field (same pattern as create-space).
const COST_ACCESSORY_ID = "crewVenueCost";

// Movie Crew: the Timeleft pattern applied to movies — get grouped with up
// to six people going to the same showing. Two flows:
//
//   theater:  kind → pick a real showing (theater → date → film → time, the
//             same picker create-space uses, so the film is by construction
//             one that's actually playing) → confirm: crews already forming
//             for that film (join one) or start your own with this showing.
//   venue:    kind → search any film (a watch party can be anything) → crews
//             forming → or name a place and a date/time.
//
// A crew is always born with a plan, so nobody lands in an empty group with
// a blank date.
type CrewKind = "theater" | "venue";
type Stage = "kind" | "pickShowing" | "confirm" | "film" | "crews" | "venueShowing";

const KINDS: {
  kind: CrewKind;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}[] = [
  {
    kind: "theater",
    icon: "film-outline",
    title: "At a theater",
    body: "Pick a real showing near you. You're grouped with others going to it. Tickets are on you, company is on us.",
  },
  {
    kind: "venue",
    icon: "home-outline",
    title: "At a venue",
    body: "A watch party — someone's place, a bar, a rented room. The crew hosts it together.",
  },
];

interface OpenCrew {
  id: string;
  cinemaName: string;
  showDate: string;
  showTime: string;
  screeningTime: string | null;
  hostName: string;
  memberCount: number;
  ticketCount: number;
  maxCapacity: number;
  alreadyIn: boolean;
}

// What the backend needs to identify the film. For theater crews it's
// derived from the scraped showing title (no id), so imdbId may be empty
// and the key falls back to the normalized title.
interface PickedMovie {
  title: string;
  imdbId: string;
  posterPath: string | null;
}

const formatDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const formatTime = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });

// Same resolution create-space does after a showing is picked: the scraped
// title has no id or art, so look it up — exact title first, newest year
// among those (a film in theaters is a recent release) — for the poster and
// IMDb id. A miss just means no poster and a title-based key.
async function resolveFromShowing(title: string): Promise<PickedMovie> {
  try {
    const pick = await resolveMarqueeTitle(title);
    if (pick) {
      const isExact = pick.title.trim().toLowerCase() === title.trim().toLowerCase();
      return { title, imdbId: isExact ? pick.imdbId : "", posterPath: pick.posterPath ?? null };
    }
  } catch {
    /* offline or OMDb hiccup — proceed with the bare title */
  }
  return { title, imdbId: "", posterPath: null };
}

export default function MatchScreen() {
  const { showToast } = useToast();
  const [stage, setStage] = useState<Stage>("kind");
  const [kind, setKind] = useState<CrewKind>("theater");
  const [movie, setMovie] = useState<PickedMovie | null>(null);
  const [showtime, setShowtime] = useState<ShowtimeSelection | null>(null);
  const [hasTicket, setHasTicket] = useState(false);
  // Optional "up for after" picks — become the starter's per-member votes.
  const [afterPicks, setAfterPicks] = useState<string[]>([]);
  // Single choice — tap to pick, tap again to clear.
  const toggleAfter = (key: string) =>
    setAfterPicks((prev) => (prev.includes(key) ? [] : [key]));
  const [submitting, setSubmitting] = useState(false);

  // --- crews already forming (both kinds) ---
  const [crews, setCrews] = useState<OpenCrew[] | null>(null);
  useEffect(() => {
    if ((stage !== "crews" && stage !== "confirm") || !movie) return;
    let cancelled = false;
    const params = new URLSearchParams({ kind, imdbId: movie.imdbId, title: movie.title });
    authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/match/open?${params}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: OpenCrew[]) => {
        if (cancelled) return;
        setCrews(data);
        // Venue flow: nothing forming yet → straight to naming a place.
        if (stage === "crews" && data.length === 0) setStage("venueShowing");
      })
      .catch(() => !cancelled && setCrews([]));
    return () => {
      cancelled = true;
    };
  }, [stage, movie, kind]);

  // --- venue: film search ---
  const [query, setQuery] = useState("");
  // Tap-to-pick options before anyone types — the rotating now-playing list
  // create-space already uses. Typing is the fallback, not the front door.
  const [nowPlaying, setNowPlaying] = useState<Movie[]>([]);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [results, setResults] = useState<Movie[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  useEffect(() => {
    if (stage !== "film" || nowPlaying.length > 0) return;
    getNowPlaying("movie").then(setNowPlaying).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const handleSearch = (text: string) => {
    setQuery(text);
    setSearchNotice(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = text.trim();
    if (q.length < 2) {
      searchSeq.current += 1;
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    searchTimer.current = setTimeout(async () => {
      try {
        const outcome = await searchMovies(q);
        if (seq !== searchSeq.current) return;
        setResults(outcome.results);
        setSearchNotice(outcome.notice);
      } catch {
        /* transient — leave prior results */
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 350);
  };

  // --- venue: place + time ---
  const [venueName, setVenueName] = useState("");
  // Google Places typeahead for the place (same text-search endpoint the
  // theater modal in create-space uses — it returns any place or address,
  // not just theaters), so nobody has to paste an address by hand. Picking
  // a result also carries coordinates onto the crew for distance/directions.
  const [placePick, setPlacePick] = useState<NearbyTheater | null>(null);
  const [placeResults, setPlaceResults] = useState<NearbyTheater[] | null>(null);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [coords, setCoords] = useState<Coordinates | null>(null);
  useEffect(() => {
    if (stage !== "venueShowing" || coords) return;
    getDeviceLocation().then((c) => c && setCoords(c)).catch(() => {});
  }, [stage, coords]);
  const placeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onVenueText = (text: string) => {
    setVenueName(text);
    setPlacePick(null);
    if (placeTimer.current) clearTimeout(placeTimer.current);
    const q = text.trim();
    if (q.length < 2 || !coords) {
      setPlaceResults(null);
      setPlaceSearching(false);
      return;
    }
    setPlaceSearching(true);
    placeTimer.current = setTimeout(() => {
      fetchNearbyTheaters(coords, 40233.6, q)
        .then((r) => setPlaceResults(r.slice(0, 6)))
        .catch(() => setPlaceResults([]))
        .finally(() => setPlaceSearching(false));
    }, 400);
  };
  const pickPlace = (pl: NearbyTheater) => {
    setPlacePick(pl);
    setVenueName(pl.address && !pl.name.includes(pl.address) ? `${pl.name}, ${pl.address}` : pl.name);
    setPlaceResults(null);
  };
  const [dateValue, setDateValue] = useState<Date | null>(null);
  const [timeValue, setTimeValue] = useState<Date | null>(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [venueCost, setVenueCost] = useState("");
  const venueCostCents = (() => {
    const t = venueCost.trim();
    if (!t) return null;
    const n = parseFloat(t);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
  })();

  const pickKind = (k: CrewKind) => {
    resolveSeq.current += 1;
    repickRef.current = false;
    setResolving(false);
    setKind(k);
    if (k === "venue") setHasTicket(false);
    setMovie(null);
    setShowtime(null);
    setCrews(null);
    setStage(k === "theater" ? "pickShowing" : "film");
  };

  // Theater: a showing was picked → the film is whatever's playing in it.
  const [resolving, setResolving] = useState(false);
  // Same sequence-guard as handleSearch: Back (or picking another showing)
  // during the title lookup bumps the counter, so the stale resolution can't
  // land afterwards and push the user forward to Confirm on its own.
  const resolveSeq = useRef(0);
  const onShowingPicked = async (sel: ShowtimeSelection) => {
    const seq = ++resolveSeq.current;
    setShowtime(sel);
    setResolving(true);
    setCrews(null);
    const m = await resolveFromShowing(sel.movieTitle);
    if (seq !== resolveSeq.current) return;
    setMovie(m);
    setResolving(false);
    setStage("confirm");
  };

  // Set when "Wrong film or poster?" on the confirm screen sends the user to
  // the film search: their showing is already chosen, so the next pick must
  // return to confirm instead of falling into the start-a-crew flow (which,
  // for theater kind, would ask them to name a venue they don't have).
  const repickRef = useRef(false);
  const startRepick = () => {
    repickRef.current = true;
    setStage("film");
  };
  const changeKind = () => {
    repickRef.current = false;
    setStage("kind");
  };
  const pickMovie = (m: Movie) => {
    setMovie({ title: m.title, imdbId: m.imdbId, posterPath: m.posterPath });
    if (repickRef.current) {
      repickRef.current = false;
      // Clear the OLD film's crew list — confirm renders "join a crew
      // already going", and stale film-A crews under film B's summary would
      // let someone join the exact wrong-film crew the repick exists to fix.
      setCrews(null);
      setStage("confirm");
      return;
    }
    setCrews(null);
    setStage("crews");
  };

  const submit = async (body: Record<string, unknown>) => {
    if (!movie || submitting) return;
    setSubmitting(true);
    try {
      const hostName = await resolveDisplayName();
      const res = await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/match`, {
        method: "POST",
        body: JSON.stringify({
          MovieTitle: movie.title,
          ImdbId: movie.imdbId || null,
          PosterPath: movie.posterPath,
          HostName: hostName,
          Kind: kind,
          HasTicket: hasTicket,
          AfterActivities: afterPicks,
          ...body,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(data?.error || "Couldn't seat you right now. Please try again.");
        return;
      }
      const matched = data.created ? "created" : data.joined ? "joined" : "already";
      router.replace({ pathname: "/group", params: { groupId: data.groupId, matched } });
    } catch {
      showToast("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const joinCrew = (c: OpenCrew) => submit({ JoinGroupId: c.id });

  const startTheaterCrew = () => {
    if (!showtime) return;
    const [y, m, d] = showtime.date.split("-").map(Number);
    const when = new Date(y, m - 1, d, Math.floor(showtime.minutes / 60), showtime.minutes % 60, 0, 0);
    return submit({
      CinemaName: showtime.theaterName,
      ScreeningTime: when.toISOString(),
      ShowDate: showtime.date,
      ShowTime: showtime.label,
      TheaterLatitude: showtime.latitude,
      TheaterLongitude: showtime.longitude,
    });
  };

  // The date picker has minimumDate today, but the time picker doesn't know
  // the date — "today at 2pm" at 9pm is a crew for a showing already over.
  const venueInPast = isPastDateTime(dateValue, timeValue);
  const venueReady =
    venueName.trim().length > 0 &&
    !!dateValue &&
    !!timeValue &&
    !venueInPast &&
    !Number.isNaN(venueCostCents);
  const startVenueCrew = () => {
    if (!venueReady || !dateValue || !timeValue || isPastDateTime(dateValue, timeValue)) return;
    const combined = combineDateAndTime(dateValue, timeValue);
    return submit({
      CinemaName: venueName.trim().slice(0, 250),
      ScreeningTime: combined.toISOString(),
      ShowDate: formatDate(combined),
      ShowTime: formatTime(combined),
      TheaterLatitude: placePick?.latitude ?? null,
      TheaterLongitude: placePick?.longitude ?? null,
      TotalCostCents: venueCostCents,
    });
  };

  const goBack = () => {
    // Cancel any showing-title lookup in flight — see resolveSeq.
    resolveSeq.current += 1;
    setResolving(false);
    if (stage === "kind") {
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/explore");
    } else if (stage === "film" && repickRef.current) {
      repickRef.current = false;
      setStage("confirm");
    } else if (stage === "pickShowing" || stage === "film") setStage("kind");
    else if (stage === "confirm") setStage("pickShowing");
    else if (stage === "crews") setStage("film");
    else if (stage === "venueShowing") setStage(crews && crews.length > 0 ? "crews" : "film");
  };

  const kindMeta = KINDS.find((k) => k.kind === kind)!;
  // One line, always: kind · film … Change. The film title ellipsizes rather
  // than wrapping under the icon.
  const crumbs = (
    <View style={styles.crumbs}>
      <Ionicons name={kindMeta.icon} size={14} color={Palette.accent} />
      <Text style={styles.crumbText} numberOfLines={1}>
        {kindMeta.title}
        {movie && stage !== "film" && stage !== "pickShowing" ? `  ·  ${movie.title}` : ""}
      </Text>
      <TouchableOpacity onPress={changeKind} hitSlop={8} accessibilityRole="button">
        <Text style={styles.crumbChange}>Change</Text>
      </TouchableOpacity>
    </View>
  );

  const crewList = (onStartOwn: () => void, startLabel: string) =>
    crews === null ? (
      <FilmLoader line="Checking for crews already forming…" style={{ marginTop: 20 }} />
    ) : (
      <>
        {crews.length > 0 && <Text style={styles.stepLabel}>CREWS ALREADY FORMING</Text>}
        {crews.map((c) => {
          const when = formatEventDate(c.screeningTime, c.showDate, c.showTime);
          const open = c.maxCapacity - c.memberCount;
          return (
            <TouchableOpacity
              key={c.id}
              activeOpacity={0.85}
              style={styles.crewCard}
              onPress={() => joinCrew(c)}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={`Join crew at ${c.cinemaName}`}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.crewWhen}>
                  <Text style={styles.crewDate}>{when.date || "Date TBD"}</Text>
                  {!!when.time && <Text style={styles.crewTime}>{when.time}</Text>}
                  {!!when.relative && <Text style={styles.crewRelative}>{when.relative}</Text>}
                </View>
                <Text style={styles.crewWhere} numberOfLines={1}>
                  {c.cinemaName || (kind === "venue" ? "Venue TBD" : "Theater TBD")}
                </Text>
                <Text style={styles.crewMeta}>
                  {c.memberCount}/{c.maxCapacity} seated
                  {c.ticketCount > 0 ? ` · ${c.ticketCount} ticketed` : ""}
                  {` · started by ${c.hostName}`}
                </Text>
              </View>
              <View style={[styles.seatPill, c.alreadyIn && styles.seatPillMuted]}>
                <Text style={[styles.seatPillText, c.alreadyIn && styles.seatPillTextMuted]}>
                  {c.alreadyIn ? "You're in" : open === 1 ? "Last seat" : "Join"}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity activeOpacity={0.85} style={styles.startOwn} onPress={onStartOwn} accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={18} color={Palette.accent} />
          <Text style={styles.startOwnText}>{startLabel}</Text>
        </TouchableOpacity>
      </>
    );

  return (
    <Starfield>
      <View style={styles.content}>
        <TouchableOpacity activeOpacity={0.8} style={styles.backButton} onPress={goBack}>
          <Ionicons name="chevron-back" size={22} color={Palette.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.kicker}>MOVIE CREW</Text>

        {/* ── 1. kind ───────────────────────────────────────────── */}
        {stage === "kind" && (
          <>
            <Text style={styles.title}>How do you want to watch?</Text>
            <Text style={styles.kindSub}>
              A crew is up to 6 people matched onto one concrete plan — a real showing, or a
              watch party someone hosts. Not a group chat about movies; an actual night out.
            </Text>
            <View style={styles.kinds}>
              {KINDS.map((k) => (
                <TouchableOpacity
                  key={k.kind}
                  activeOpacity={0.85}
                  style={styles.kindCard}
                  onPress={() => pickKind(k.kind)}
                  accessibilityRole="button"
                  accessibilityLabel={k.title}
                >
                  <View style={styles.kindIcon}>
                    <Ionicons name={k.icon} size={22} color={Palette.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kindTitle}>{k.title}</Text>
                    <Text style={styles.kindBody}>{k.body}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Palette.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fineprint}>
              Either way you end up in a crew of up to {MATCH_CREW_SIZE} who picked the same film
              and showing.
            </Text>
          </>
        )}

        {/* ── theater 2. pick a real showing ────────────────────── */}
        {stage === "pickShowing" && (
          <>
            {crumbs}
            <Text style={styles.title}>Pick a showing</Text>
            <Text style={styles.subtitle}>
              Theater, then day, then what&apos;s playing — only films actually in theaters near you.
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 60 }}>
              <ShowtimePicker selection={showtime} onSelect={onShowingPicked} />
              {resolving && <FilmLoader line="Matching the marquee to the movie…" style={{ marginTop: 16 }} />}
            </ScrollView>
          </>
        )}

        {/* ── theater 3. confirm: crews forming or start your own ── */}
        {stage === "confirm" && movie && showtime && (
          <>
            {crumbs}
            <Text style={styles.title}>{crews && crews.length > 0 ? "Join a crew or start one" : "Start your crew"}</Text>
            <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
              <View style={styles.summary}>
                <MoviePoster uri={movie.posterPath} width={56} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryTitle} numberOfLines={2}>
                    {movie.title}
                  </Text>
                  <Text style={styles.summarySub} numberOfLines={2}>
                    {showtime.theaterName} · {formatEventDate(null, showtime.date, showtime.label).date} ·{" "}
                    {showtime.label}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setStage("pickShowing")} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.crumbChange}>Change</Text>
                </TouchableOpacity>
              </View>
              {/* The poster is a best guess from a bare marquee title —
                  same-name films and re-releases can fool it. Let the human
                  fix it instead of shipping a crew with the wrong art. */}
              <TouchableOpacity
                onPress={startRepick}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Wrong film or poster? Pick the film manually"
              >
                <Text style={styles.wrongFilmLink}>Wrong film or poster? Pick it manually</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.ticketToggle, hasTicket && styles.ticketToggleOn]}
                onPress={() => setHasTicket((v) => !v)}
                accessibilityRole="switch"
                accessibilityState={{ checked: hasTicket }}
              >
                <Ionicons
                  name={hasTicket ? "checkmark-circle" : "ticket-outline"}
                  size={16}
                  color={hasTicket ? Palette.positive : Palette.textMuted}
                />
                <Text style={[styles.ticketToggleText, hasTicket && styles.ticketToggleTextOn]}>
                  I already have my ticket for this showing
                </Text>
              </TouchableOpacity>

              <Text style={styles.stepLabel}>UP FOR ANYTHING AFTER?</Text>
              <View style={styles.afterRow}>
                {POST_ACTIVITIES.map((a) => {
                  const on = afterPicks.includes(a.key);
                  return (
                    <TouchableOpacity
                      key={a.key}
                      activeOpacity={0.8}
                      style={[styles.afterChip, on && styles.afterChipOn]}
                      onPress={() => toggleAfter(a.key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.afterChipText, on && styles.afterChipTextOn]}>
                        {a.emoji} {a.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.placeHint}>Optional — pick one; the crew sees who&apos;s up for what.</Text>

              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.primary, submitting && { opacity: 0.6 }]}
                onPress={startTheaterCrew}
                disabled={submitting}
                accessibilityRole="button"
              >
                {submitting ? (
                  <ActivityIndicator color={Palette.base} />
                ) : (
                  <>
                    <Ionicons name="people-outline" size={18} color={Palette.base} />
                    <Text style={styles.primaryText}>Start the crew for this showing</Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={styles.fineprint}>
                Anyone who picks this same showing is seated with you, up to {MATCH_CREW_SIZE}. If a
                crew already has it, you join them.
              </Text>

              {/* Other crews for this film (other showings) — join one instead. */}
              {crews && crews.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.stepLabel}>OR JOIN A CREW ALREADY GOING</Text>
                  {crews.map((c) => {
                    const when = formatEventDate(c.screeningTime, c.showDate, c.showTime);
                    const open = c.maxCapacity - c.memberCount;
                    return (
                      <TouchableOpacity
                        key={c.id}
                        activeOpacity={0.85}
                        style={styles.crewCard}
                        onPress={() => joinCrew(c)}
                        disabled={submitting}
                        accessibilityRole="button"
                        accessibilityLabel={`Join crew at ${c.cinemaName}`}
                      >
                        <View style={{ flex: 1 }}>
                          <View style={styles.crewWhen}>
                            <Text style={styles.crewDate}>{when.date || "Date TBD"}</Text>
                            {!!when.time && <Text style={styles.crewTime}>{when.time}</Text>}
                            {!!when.relative && <Text style={styles.crewRelative}>{when.relative}</Text>}
                          </View>
                          <Text style={styles.crewWhere} numberOfLines={1}>
                            {c.cinemaName}
                          </Text>
                          <Text style={styles.crewMeta}>
                            {c.memberCount}/{c.maxCapacity} seated
                            {c.ticketCount > 0 ? ` · ${c.ticketCount} ticketed` : ""}
                            {` · started by ${c.hostName}`}
                          </Text>
                        </View>
                        <View style={[styles.seatPill, c.alreadyIn && styles.seatPillMuted]}>
                          <Text style={[styles.seatPillText, c.alreadyIn && styles.seatPillTextMuted]}>
                            {c.alreadyIn ? "You're in" : open === 1 ? "Last seat" : "Join"}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </>
        )}

        {/* ── venue 2. film ─────────────────────────────────────── */}
        {stage === "film" && (
          <>
            {crumbs}
            <Text style={styles.title}>Which film?</Text>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={18} color={Palette.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Search a movie…"
                placeholderTextColor={Palette.textMuted}
                value={query}
                onChangeText={handleSearch}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                clearButtonMode="while-editing"
                autoFocus
              />
            </View>
            {searching && <ActivityIndicator color={Palette.accent} style={{ marginTop: 14 }} />}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <Text style={styles.searchEmpty}>
                {searchNotice ??
                  `No movie found for “${query.trim()}” — double-check the spelling.`}
              </Text>
            )}
            {query.trim().length < 2 && nowPlaying.length > 0 && (
              <Text style={styles.stepLabel}>OR PICK ONE THAT&apos;S OUT NOW</Text>
            )}
            <FlatList
              data={query.trim().length >= 2 ? results : nowPlaying}
              keyExtractor={(m) => m.imdbId}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingTop: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.row}
                  onPress={() => pickMovie(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Choose ${item.title}`}
                >
                  <MoviePoster uri={item.posterPath} width={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {item.releaseYear ? <Text style={styles.rowYear}>{item.releaseYear}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Palette.textMuted} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                query.trim().length >= 2 && !searching ? (
                  <Text style={styles.empty}>No matches — check the spelling?</Text>
                ) : null
              }
            />
          </>
        )}

        {/* ── venue 3. crews forming ────────────────────────────── */}
        {stage === "crews" && movie && (
          <>
            {crumbs}
            <Text style={styles.title}>Crews already forming</Text>
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
              {crewList(() => setStage("venueShowing"), "None of these work — start your own")}
            </ScrollView>
          </>
        )}

        {/* ── venue 4. place + time ─────────────────────────────── */}
        {stage === "venueShowing" && movie && (
          <>
            {crumbs}
            <Text style={styles.title}>Where and when?</Text>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 60 }}>
              <Text style={styles.stepLabel}>PLACE</Text>
              <View style={styles.placeBox}>
                <Ionicons name="location-outline" size={18} color={Palette.textMuted} />
                <TextInput
                  style={styles.placeInput}
                  placeholder="Search a bar, a venue, or an address…"
                  placeholderTextColor={Palette.textFaint}
                  value={venueName}
                  onChangeText={onVenueText}
                  maxLength={250}
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
                {placeSearching && <ActivityIndicator color={Palette.accent} size="small" />}
                {placePick && !placeSearching && (
                  <Ionicons name="checkmark-circle" size={18} color={Palette.positive} />
                )}
              </View>
              {!coords && venueName.trim().length >= 2 && (
                <Text style={styles.placeHint}>
                  Turn on location to search places — or type the address as-is.
                </Text>
              )}
              {placeResults && placeResults.length > 0 && (
                <View style={styles.placeList}>
                  {placeResults.map((pl) => (
                    <TouchableOpacity
                      key={pl.placeId}
                      activeOpacity={0.8}
                      style={styles.placeRow}
                      onPress={() => pickPlace(pl)}
                      accessibilityRole="button"
                      accessibilityLabel={`${pl.name}, ${pl.address}`}
                    >
                      <Text style={styles.placeName} numberOfLines={1}>
                        {pl.name}
                      </Text>
                      {!!pl.address && (
                        <Text style={styles.placeAddress} numberOfLines={1}>
                          {pl.address}
                        </Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {placeResults && placeResults.length === 0 && !placeSearching && (
                <Text style={styles.placeHint}>No places found — you can keep the text as typed.</Text>
              )}
              <Text style={styles.stepLabel}>DATE</Text>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.pickerField}
                onPress={() => {
                  setTimePickerVisible(false);
                  setDatePickerVisible((v) => !v);
                }}
              >
                <Ionicons name="calendar-outline" size={18} color={Palette.textMuted} />
                <Text style={[styles.pickerFieldText, !dateValue && styles.pickerPlaceholder]}>
                  {dateValue ? formatDate(dateValue) : "Select a date"}
                </Text>
              </TouchableOpacity>
              {datePickerVisible && (
                <DateTimePicker
                  value={dateValue ?? new Date()}
                  mode="date"
                  minimumDate={new Date()}
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  themeVariant="dark"
                  onValueChange={(_e: unknown, selected: Date) => {
                    if (Platform.OS === "android") setDatePickerVisible(false);
                    setDateValue(selected);
                  }}
                  onDismiss={() => setDatePickerVisible(false)}
                />
              )}
              {Platform.OS === "ios" && datePickerVisible && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.pickerDone}
                  onPress={() => {
                    if (!dateValue) setDateValue(new Date());
                    setDatePickerVisible(false);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.pickerDoneText}>Done</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.stepLabel}>TIME</Text>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.pickerField}
                onPress={() => {
                  setDatePickerVisible(false);
                  setTimePickerVisible((v) => !v);
                }}
              >
                <Ionicons name="time-outline" size={18} color={Palette.textMuted} />
                <Text style={[styles.pickerFieldText, !timeValue && styles.pickerPlaceholder]}>
                  {timeValue ? formatTime(timeValue) : "Select a time"}
                </Text>
              </TouchableOpacity>
              {timePickerVisible && (
                <DateTimePicker
                  value={timeValue ?? new Date()}
                  mode="time"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  themeVariant="dark"
                  onValueChange={(_e: unknown, selected: Date) => {
                    if (Platform.OS === "android") setTimePickerVisible(false);
                    setTimeValue(selected);
                  }}
                  onDismiss={() => setTimePickerVisible(false)}
                />
              )}
              {Platform.OS === "ios" && timePickerVisible && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.pickerDone}
                  onPress={() => {
                    if (!timeValue) setTimeValue(new Date());
                    setTimePickerVisible(false);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.pickerDoneText}>Done</Text>
                </TouchableOpacity>
              )}

              <Text style={styles.stepLabel}>COST</Text>
              <View style={styles.placeBox}>
                <Text style={styles.costPrefix}>$</Text>
                <TextInput
                  style={styles.placeInput}
                  placeholder="Total cost, if any — split per person"
                  placeholderTextColor={Palette.textFaint}
                  value={venueCost}
                  onChangeText={setVenueCost}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={Platform.OS === "ios" ? COST_ACCESSORY_ID : undefined}
                />
              </View>
              <Text style={styles.placeHint}>Leave blank if it&apos;s free. Shown to the crew as a per-person share.</Text>

              <Text style={styles.stepLabel}>UP FOR ANYTHING AFTER?</Text>
              <View style={styles.afterRow}>
                {POST_ACTIVITIES.map((a) => {
                  const on = afterPicks.includes(a.key);
                  return (
                    <TouchableOpacity
                      key={a.key}
                      activeOpacity={0.8}
                      style={[styles.afterChip, on && styles.afterChipOn]}
                      onPress={() => toggleAfter(a.key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.afterChipText, on && styles.afterChipTextOn]}>
                        {a.emoji} {a.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.placeHint}>Optional — pick one; the crew sees who&apos;s up for what.</Text>

              {/* Inline validation instead of a toast — the toast lands on top
                  of this form's title and reads as a glitch. The button stays
                  dim until the fields are in. */}
              {!venueReady && (
                <Text style={styles.formHint}>
                  {!venueName.trim()
                    ? "Add a place to start."
                    : !dateValue
                      ? "Pick a date."
                      : !timeValue
                        ? "Pick a time."
                        : venueInPast
                          ? "That time has already passed — pick a later one."
                          : "Enter a valid cost, or leave it blank."}
                </Text>
              )}
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.primary, (submitting || !venueReady) && { opacity: 0.5 }]}
                onPress={startVenueCrew}
                disabled={submitting || !venueReady}
                accessibilityRole="button"
                accessibilityState={{ disabled: submitting || !venueReady }}
              >
                {submitting ? (
                  <ActivityIndicator color={Palette.base} />
                ) : (
                  <>
                    <Ionicons name="people-outline" size={18} color={Palette.base} />
                    <Text style={styles.primaryText}>Start the crew</Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={styles.fineprint}>
                Anyone who picks this film for a watch party can join you, up to {MATCH_CREW_SIZE}.
              </Text>
            </ScrollView>
            {Platform.OS === "ios" && (
              <InputAccessoryView nativeID={COST_ACCESSORY_ID}>
                <View style={styles.keyboardBar}>
                  <TouchableOpacity activeOpacity={0.8} onPress={() => Keyboard.dismiss()} hitSlop={8}>
                    <Text style={styles.pickerDoneText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </InputAccessoryView>
            )}
          </>
        )}
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 2,
    marginBottom: 8,
    paddingVertical: 4,
    paddingRight: 8,
  },
  backText: { ...Type.body, color: Palette.text },
  kicker: { ...Display.section, color: Palette.accent, marginBottom: 4 },
  title: { ...Display.heading, color: Palette.text, marginBottom: 12 },
  subtitle: { ...Type.small, color: Palette.textMuted, marginBottom: 8 },
  crumbs: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  crumbText: { ...Type.small, fontFamily: Font.semibold, color: Palette.accent, flex: 1 },
  crumbChange: { ...Type.small, color: Palette.textMuted, textDecorationLine: "underline", marginLeft: 6 },
  wrongFilmLink: { ...Type.caption, color: Palette.textFaint, textDecorationLine: "underline", marginTop: -6, marginBottom: 12 },
  kinds: { gap: 12, marginTop: 4 },
  kindCard: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
  },
  kindIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  kindTitle: { ...Type.body, fontFamily: Font.bold, color: Palette.text, marginBottom: 2 },
  kindBody: { ...Type.small, color: Palette.textMuted },
  searchBox: {
    ...SpaceStyles.field,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  input: { flex: 1, ...Type.body, color: Palette.text, padding: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  rowTitle: { ...Type.body, color: Palette.text },
  rowYear: { ...Type.small, color: Palette.textMuted, marginTop: 2 },
  empty: { ...Type.small, color: Palette.textMuted, textAlign: "center", marginTop: 24 },
  fineprint: { ...Type.caption, color: Palette.textFaint, marginTop: 14 },
  // confirm summary
  summary: {
    ...SpaceStyles.glassCard,
    borderColor: Palette.accentBorder,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  summaryTitle: { ...Type.body, fontFamily: Font.bold, color: Palette.text },
  summarySub: { ...Type.small, color: Palette.textMuted, marginTop: 2 },
  // crews list
  crewCard: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    marginBottom: 10,
  },
  crewWhen: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  crewDate: { ...Display.dateCard, color: Palette.text },
  crewTime: { ...Display.stat, color: Palette.textMuted },
  crewRelative: { ...Type.caption, fontFamily: Font.bold, color: Palette.accent, textTransform: "uppercase" },
  crewWhere: { ...Type.small, color: Palette.text, marginTop: 2 },
  crewMeta: { ...Type.caption, color: Palette.textMuted, marginTop: 3 },
  seatPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
  },
  seatPillMuted: { backgroundColor: Palette.fill, borderColor: Palette.border },
  seatPillText: { ...Type.caption, fontFamily: Font.bold, color: Palette.accent },
  seatPillTextMuted: { color: Palette.textMuted },
  startOwn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 4,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Palette.accentBorder,
  },
  startOwnText: { ...Type.small, fontFamily: Font.semibold, color: Palette.accent },
  // forms
  stepLabel: { ...Display.section, color: Palette.textMuted, marginTop: 12, marginBottom: 6 },
  kindSub: { ...Type.small, color: Palette.textMuted, marginTop: 6, marginBottom: 4 },
  searchEmpty: { ...Type.small, color: Palette.textMuted, marginTop: 16, textAlign: "center" },
  field: { ...SpaceStyles.field, ...Type.body, color: Palette.text, padding: 12 },
  placeBox: {
    ...SpaceStyles.field,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  placeInput: { flex: 1, ...Type.body, color: Palette.text, padding: 0 },
  placeHint: { ...Type.caption, color: Palette.textFaint, marginTop: 6 },
  placeList: {
    ...SpaceStyles.glassCard,
    marginTop: 6,
    overflow: "hidden",
  },
  placeRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  placeName: { ...Type.small, fontFamily: Font.semibold, color: Palette.text },
  placeAddress: { ...Type.caption, color: Palette.textMuted, marginTop: 1 },
  pickerField: {
    ...SpaceStyles.field,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  pickerFieldText: { ...Type.body, color: Palette.text },
  pickerDone: { alignSelf: "flex-end", paddingVertical: 8, paddingHorizontal: 16, marginTop: 4 },
  pickerDoneText: { ...Type.small, fontFamily: Font.bold, color: Palette.accent },
  formHint: { ...Type.caption, color: Palette.textMuted, marginTop: 14 },
  afterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  afterChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.raised,
  },
  afterChipOn: { borderColor: Palette.accentBorder, backgroundColor: Palette.accentDim },
  afterChipText: { ...Type.caption, color: Palette.textMuted },
  afterChipTextOn: { color: Palette.accent, fontFamily: Font.semibold },
  costPrefix: { ...Type.body, color: Palette.textMuted },
  keyboardBar: {
    backgroundColor: Palette.raised,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
    alignItems: "flex-end",
    padding: 10,
  },
  pickerPlaceholder: { color: Palette.textFaint },
  ticketToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Radius.small,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.raised,
  },
  ticketToggleOn: { borderColor: Palette.positiveBorder, backgroundColor: Palette.positiveDim },
  ticketToggleText: { ...Type.small, fontFamily: Font.semibold, color: Palette.textMuted, flex: 1 },
  ticketToggleTextOn: { color: Palette.positive },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accent,
  },
  primaryText: { ...Type.body, fontFamily: Font.bold, color: Palette.base },
});
