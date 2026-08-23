import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  ScrollView,
  Platform,
} from "react-native";
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
import { searchMovies, Movie } from "@/frontend/services/movies";
import { formatEventDate } from "@/frontend/utils/event-date";

// Keep in sync with GroupController.MatchCrewSize.
const MATCH_CREW_SIZE = 6;

// Movie Crew: the Timeleft pattern applied to movies — pick how you want to
// watch, which film, and a concrete showing, and get seated in a crew of up
// to six who picked the same. Flow:
//
//   kind  →  film  →  crews already forming (join one)
//                      or start your own: theater crews pick a real showing
//                      from the showtimes data; venue crews name a place and
//                      a time.
//
// A crew is born with a plan, so nobody lands in an empty group with a
// blank date — the thing that made the first version feel broken.
type CrewKind = "theater" | "venue";
type Stage = "kind" | "film" | "crews" | "showing";

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
    body: "Meet a crew at a real showing near you. Tickets are on you, company is on us.",
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

const formatDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const formatTime = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });

export default function MatchScreen() {
  const { showToast } = useToast();
  const [stage, setStage] = useState<Stage>("kind");
  const [kind, setKind] = useState<CrewKind>("theater");
  const [movie, setMovie] = useState<Movie | null>(null);

  // --- film search ---
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [searching, setSearching] = useState(false);
  // Debounce + stale-response guard: one request per pause in typing, and a
  // slow earlier response can never overwrite a newer one.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);

  const handleSearch = (text: string) => {
    setQuery(text);
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
      } catch {
        /* transient — leave prior results */
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 350);
  };

  // --- crews already forming ---
  const [crews, setCrews] = useState<OpenCrew[] | null>(null);
  useEffect(() => {
    if (stage !== "crews" || !movie) return;
    let cancelled = false;
    const params = new URLSearchParams({ kind, imdbId: movie.imdbId, title: movie.title });
    authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/match/open?${params}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: OpenCrew[]) => {
        if (cancelled) return;
        setCrews(data);
        // Nothing forming yet → straight to picking a showing. No point
        // showing an empty list with a single "start your own" button.
        if (data.length === 0) setStage("showing");
      })
      .catch(() => !cancelled && setCrews([]));
    return () => {
      cancelled = true;
    };
  }, [stage, movie, kind]);

  // --- showing (start your own) ---
  const [showtime, setShowtime] = useState<ShowtimeSelection | null>(null);
  const [venueName, setVenueName] = useState("");
  const [dateValue, setDateValue] = useState<Date | null>(null);
  const [timeValue, setTimeValue] = useState<Date | null>(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [hasTicket, setHasTicket] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const pickKind = (k: CrewKind) => {
    setKind(k);
    setStage("film");
  };

  const pickMovie = (m: Movie) => {
    setMovie(m);
    setShowtime(null);
    // Reset here (an event), not in the fetch effect, so the list shows its
    // spinner for the new film instead of the previous film's crews.
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
          ImdbId: movie.imdbId,
          PosterPath: movie.posterPath,
          HostName: hostName,
          Kind: kind,
          HasTicket: hasTicket,
          ...body,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(data?.error || "Couldn't seat you right now. Please try again.");
        return;
      }
      // The group page does the reveal ("you're first in" vs "you're in").
      const matched = data.created ? "created" : data.joined ? "joined" : "already";
      router.replace({ pathname: "/group", params: { groupId: data.groupId, matched } });
    } catch {
      showToast("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const joinCrew = (c: OpenCrew) => submit({ JoinGroupId: c.id });

  const startCrew = () => {
    if (kind === "theater") {
      if (!showtime) {
        showToast("Pick a showing first.");
        return;
      }
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
    }
    if (!venueName.trim()) {
      showToast("Name the place — your address, a bar, a rented room.");
      return;
    }
    if (!dateValue || !timeValue) {
      showToast("Pick a date and a time.");
      return;
    }
    const combined = new Date(dateValue);
    combined.setHours(timeValue.getHours(), timeValue.getMinutes(), 0, 0);
    return submit({
      CinemaName: venueName.trim(),
      ScreeningTime: combined.toISOString(),
      ShowDate: formatDate(combined),
      ShowTime: formatTime(combined),
    });
  };

  const goBack = () => {
    if (stage === "kind") {
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/explore");
    } else if (stage === "film") setStage("kind");
    else if (stage === "crews") setStage("film");
    else if (stage === "showing") setStage(crews && crews.length > 0 ? "crews" : "film");
  };

  const kindMeta = KINDS.find((k) => k.kind === kind)!;

  // Breadcrumb of what's chosen so far — kind · film — with a Change link.
  const crumbs = (
    <View style={styles.crumbs}>
      <Ionicons name={kindMeta.icon} size={14} color={Palette.accent} />
      <Text style={styles.crumbText}>{kindMeta.title}</Text>
      {movie && stage !== "film" && (
        <>
          <Text style={styles.crumbDot}>·</Text>
          <Text style={styles.crumbText} numberOfLines={1}>
            {movie.title}
          </Text>
        </>
      )}
      <TouchableOpacity onPress={() => setStage("kind")} hitSlop={8} accessibilityRole="button">
        <Text style={styles.crumbChange}>Change</Text>
      </TouchableOpacity>
    </View>
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

        {/* ── 2. film ───────────────────────────────────────────── */}
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
            <FlatList
              data={results}
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

        {/* ── 3. crews already forming ──────────────────────────── */}
        {stage === "crews" && movie && (
          <>
            {crumbs}
            <Text style={styles.title}>Crews already forming</Text>
            {crews === null ? (
              <ActivityIndicator color={Palette.accent} style={{ marginTop: 20 }} />
            ) : (
              <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
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
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.startOwn}
                  onPress={() => setStage("showing")}
                  accessibilityRole="button"
                >
                  <Ionicons name="add-circle-outline" size={18} color={Palette.accent} />
                  <Text style={styles.startOwnText}>
                    None of these work — start your own{kind === "theater" ? " showing" : ""}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </>
        )}

        {/* ── 4. showing (start your own) ───────────────────────── */}
        {stage === "showing" && movie && (
          <>
            {crumbs}
            <Text style={styles.title}>{kind === "theater" ? "Pick a showing" : "Where and when?"}</Text>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 60 }}>
              {kind === "theater" ? (
                <ShowtimePicker selection={showtime} onSelect={setShowtime} filterTitle={movie.title} />
              ) : (
                <>
                  <Text style={styles.stepLabel}>PLACE</Text>
                  <TextInput
                    style={styles.field}
                    placeholder="Your address, a bar, a rented room…"
                    placeholderTextColor={Palette.textFaint}
                    value={venueName}
                    onChangeText={setVenueName}
                    maxLength={250}
                  />
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
                </>
              )}

              {kind === "theater" && (
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
              )}

              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.primary, submitting && { opacity: 0.6 }]}
                onPress={startCrew}
                disabled={submitting}
                accessibilityRole="button"
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
                Anyone who picks this film and the same showing gets seated with you, up to{" "}
                {MATCH_CREW_SIZE}.
              </Text>
            </ScrollView>
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
  title: { ...Display.heading, color: Palette.text, marginBottom: 16 },
  crumbs: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  crumbText: { ...Type.small, fontFamily: Font.semibold, color: Palette.accent, flexShrink: 1 },
  crumbDot: { ...Type.small, color: Palette.textFaint },
  crumbChange: { ...Type.small, color: Palette.textMuted, textDecorationLine: "underline", marginLeft: 6 },
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
  // showing
  stepLabel: { ...Display.section, color: Palette.textMuted, marginTop: 12, marginBottom: 6 },
  field: { ...SpaceStyles.field, ...Type.body, color: Palette.text, padding: 12 },
  pickerField: {
    ...SpaceStyles.field,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  pickerFieldText: { ...Type.body, color: Palette.text },
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
