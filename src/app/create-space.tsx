import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  FlatList,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { authFetch } from "@/frontend/services/api";
import { supabase } from "@/frontend/config/supabase";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { POST_ACTIVITIES } from "@/frontend/constants/activities";
import { useFriends } from "@/frontend/hooks/use-friends";
import { searchMovies, searchTvShows, getNowPlaying, Movie } from "@/frontend/services/movies";
import * as WebBrowser from "expo-web-browser";
import { buildGoogleShowtimesUrl } from "@/frontend/services/ticket-links";
import {
  getDeviceLocation,
  fetchNearbyTheaters,
  NearbyTheater,
  Coordinates,
} from "@/frontend/services/nearby-theaters";

type SpaceType = "public_gathering" | "private_rental";

const formatDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// includeZone is for Virtual events specifically — a same-day global stream
// (an anime simulcast, an overseas fight card) is genuinely ambiguous as
// "8:00 PM" with no zone attached once host and joiner aren't in the same
// timezone, unlike an in-person venue where "8:00 PM" always means the
// venue's own local time no matter who's asking.
const formatTime = (d: Date, includeZone = false) =>
  d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(includeZone ? { timeZoneName: "short" } : {}),
  });

// Theaters don't run showings between roughly 2am and 10:30am — catches an
// obvious fat-finger on the time picker (e.g. AM/PM mixup) before it's saved.
const isOutsideBusinessHours = (d: Date) => {
  const minutes = d.getHours() * 60 + d.getMinutes();
  return minutes >= 2 * 60 && minutes < 10 * 60 + 30;
};

const maxBookingDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

export default function CreateSpaceScreen() {
  const {
    theaterName: prefillTheaterName,
    theaterPlaceId: prefillPlaceId,
    theaterLat: prefillLat,
    theaterLng: prefillLng,
    spaceType: prefillSpaceType,
    movieName: prefillMovieName,
    posterPath: prefillPosterPath,
  } = useLocalSearchParams<{
    theaterName?: string;
    theaterPlaceId?: string;
    theaterLat?: string;
    theaterLng?: string;
    spaceType?: SpaceType;
    movieName?: string;
    posterPath?: string;
  }>();
  const [spaceType, setSpaceType] = useState<SpaceType>(
    prefillSpaceType === "private_rental" ? "private_rental" : "public_gathering",
  );
  // Independent of spaceType — either a real theater screening or a custom
  // venue/watch party can be made invite-only. When true: excluded from
  // Explore/Home's browse feed, and joining requires the SpaceCode (enforced
  // server-side in JoinGroup/JoinGroupWeb, not just hidden from browsing).
  const [isPrivate, setIsPrivate] = useState(false);
  // Locked when arriving from rent-a-theater.tsx's guided flow with a
  // specific theater already picked — not a blanket lock on every private
  // rental, since someone starting a rental from scratch still needs to
  // choose one. State, not a plain const: once the Home/Virtual venue chips
  // exist, a locked user can switch away from "theater" entirely (clearing
  // the pre-picked place) and then back — the lock has to actually release
  // at that point, or the picker would stay permanently disabled with
  // nothing left in it to unlock.
  const [theaterLocked, setTheaterLocked] = useState(!!prefillPlaceId);
  const [hostName, setHostName] = useState("");
  const [theaterName, setTheaterName] = useState(prefillTheaterName ?? "");
  const [theaterPlaceId, setTheaterPlaceId] = useState<string | null>(prefillPlaceId ?? null);
  const [theaterLat, setTheaterLat] = useState<number | null>(
    prefillLat ? parseFloat(prefillLat) : null,
  );
  const [theaterLng, setTheaterLng] = useState<number | null>(
    prefillLng ? parseFloat(prefillLng) : null,
  );
  const [movieName, setMovieName] = useState(prefillMovieName ?? "");
  // The picked movie's poster URL — stored on the Space at creation so cards
  // can show poster art without a per-card metadata lookup.
  const [posterPath, setPosterPath] = useState<string | null>(prefillPosterPath ?? null);
  const [showDate, setShowDate] = useState("");

  // Private rental only — a rental doesn't have to be a movie screening at
  // all: "tv" swaps the movie search for an OMDb TV-show search (plus
  // optional season/episode info); sports/gaming/awards/other all swap it for
  // a plain freeform title instead of forcing a catalog match — there's no
  // database of UFC cards or Twitch streams to search, so these just differ
  // in their placeholder copy to nudge the right kind of title.
  type RentalActivityType = "movie" | "tv" | "sports" | "gaming" | "awards" | "other";
  const [rentalActivityType, setRentalActivityType] = useState<RentalActivityType>("movie");
  const [seasonEpisodeInfo, setSeasonEpisodeInfo] = useState("");
  // Private rental only — where the party actually happens. Reuses the same
  // theaterName/bookingUrl fields a real theater venue already has (no schema
  // change): "home" just means theaterName holds an address/description
  // instead of a Google Places result, "virtual" means it holds a platform
  // name and bookingUrl holds the stream/watch link.
  type VenueMode = "theater" | "home" | "virtual";
  const [venueMode, setVenueMode] = useState<VenueMode>("theater");
  const [totalCost, setTotalCost] = useState("");
  const [maxCapacity, setMaxCapacity] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");
  const [postActivities, setPostActivities] = useState<string[]>([]);
  const [customActivities, setCustomActivities] = useState<string[]>([]);
  const [customActivityInput, setCustomActivityInput] = useState("");
  const [hangoutNotes, setHangoutNotes] = useState("");

  const toggleActivity = (key: string) => {
    setPostActivities((prev) =>
      prev.includes(key) ? prev.filter((a) => a !== key) : [...prev, key],
    );
  };

  const addCustomActivity = () => {
    // Stored comma-joined, so strip commas out of freeform tags.
    const label = customActivityInput.trim().replace(/,/g, "");
    if (!label || customActivities.includes(label)) {
      setCustomActivityInput("");
      return;
    }
    setCustomActivities((prev) => [...prev, label]);
    setPostActivities((prev) => [...prev, label]);
    setCustomActivityInput("");
  };

  const removeCustomActivity = (label: string) => {
    setCustomActivities((prev) => prev.filter((a) => a !== label));
    setPostActivities((prev) => prev.filter((a) => a !== label));
  };

  const [creating, setCreating] = useState(false);

  // Invite friends already on the app — after the Space is created we DM each
  // selected friend the invite link (reuses the friends-only messages table).
  // Picked via a modal (not inline chips) so this doesn't turn into an
  // unbounded, unfilterable wall of chips for hosts with a lot of friends.
  const { currentUserId, friends } = useFriends();
  const [invitedFriendIds, setInvitedFriendIds] = useState<Set<string>>(new Set());
  const [friendsModalVisible, setFriendsModalVisible] = useState(false);
  const [friendSearch, setFriendSearch] = useState("");

  const filteredFriends = friends.filter((f) => {
    const query = friendSearch.trim().toLowerCase();
    if (!query) return true;
    return (
      f.display_name.toLowerCase().includes(query) ||
      (f.username ?? "").toLowerCase().includes(query)
    );
  });

  const toggleInviteFriend = (id: string) => {
    setInvitedFriendIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Best-effort: DM the invite link to each friend the host picked. A failure
  // here should never block the Space from being created / navigated to.
  const sendFriendInvites = async (groupId: string) => {
    if (!currentUserId || invitedFriendIds.size === 0) return;
    const link = `${process.env.EXPO_PUBLIC_API_URL}/space/${groupId}`;
    const rows = Array.from(invitedFriendIds).map((receiverId) => ({
      sender_id: currentUserId,
      receiver_id: receiverId,
      content: `🎬 ${hostName.trim() || "A friend"} invited you to a watch party for ${movieName.trim()}! Join here: ${link}`,
    }));
    try {
      await supabase.from("messages").insert(rows);
    } catch (err) {
      console.warn("Failed to send friend invites:", err);
    }
  };

  const [theaters, setTheaters] = useState<NearbyTheater[]>([]);
  const [theatersLoading, setTheatersLoading] = useState(true);
  const [theatersError, setTheatersError] = useState<string | null>(null);
  const [theaterModalVisible, setTheaterModalVisible] = useState(false);
  const [theaterSearch, setTheaterSearch] = useState("");
  // Cached from the initial mount-time lookup so typing in the search box
  // doesn't re-request GPS/permission on every keystroke — just reused as
  // the location bias for each text search.
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);
  // Non-null once a text search has actually run — lets the render logic
  // below tell "searched, found nothing" apart from "haven't searched yet,
  // showing the generic nearby list."
  const [textSearchResults, setTextSearchResults] = useState<NearbyTheater[] | null>(null);
  const [textSearching, setTextSearching] = useState(false);

  const [movieModalVisible, setMovieModalVisible] = useState(false);
  const [movieSearch, setMovieSearch] = useState("");
  const [movieResults, setMovieResults] = useState<Movie[]>([]);
  const [movieSearching, setMovieSearching] = useState(false);
  const [movieSearchError, setMovieSearchError] = useState<string | null>(null);
  const [movieSearchNotice, setMovieSearchNotice] = useState<string | null>(null);
  const [showtimeConfirmed, setShowtimeConfirmed] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<Movie[]>([]);

  // Nudge, not a hard block — see the search-by-title endpoint's own
  // comment for why this only informs rather than prevents creation.
  interface SimilarSpace {
    id: string;
    filmName: string;
    hostName: string;
    showDate: string;
    showTime: string;
    memberCount: number;
  }
  const [similarSpaces, setSimilarSpaces] = useState<SimilarSpace[]>([]);
  // Tracks which title the banner was dismissed for, rather than a plain
  // boolean — so it naturally "un-dismisses" the moment the title changes
  // again instead of needing an effect to explicitly reset a separate flag.
  const [similarSpacesDismissedFor, setSimilarSpacesDismissedFor] = useState<string | null>(null);

  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [dateValue, setDateValue] = useState<Date | null>(null);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [timeValue, setTimeValue] = useState<Date | null>(null);
  // Derived, not stored — a plain computed value naturally stays in sync
  // with venueMode (Virtual gets a timezone suffix) with no effect/cascading
  // render needed, unlike re-deriving it via setState whenever either
  // timeValue or venueMode changes.
  const showTime = timeValue ? formatTime(timeValue, venueMode === "virtual") : "";

  // Host name is the creator's own profile name — there's no name input on
  // this screen anymore (you don't rename yourself while creating a Space), so
  // resolve it automatically: saved name first, then the profile's
  // display_name, then the auth metadata full_name.
  useEffect(() => {
    (async () => {
      const savedName = await AsyncStorage.getItem("userName");
      if (savedName) {
        setHostName(savedName);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();
      const name = profile?.display_name || (user.user_metadata?.full_name as string) || "";
      if (name) setHostName(name);
    })();
  }, []);

  useEffect(() => {
    // ~25 miles — was a hardcoded 10mi on the backend, which felt
    // restrictive especially for Watch Party/Custom Venue (a private event
    // isn't tied to "my local theater" the way a real screening is). Not
    // scoped by spaceType: this effect only runs once at mount, before a
    // later toggle between MovieSpace/Watch Party would ever be reflected,
    // and a wider radius for a real theater search isn't a downside anyway —
    // just more choice.
    getDeviceLocation()
      .then((coords) => {
        setDeviceCoords(coords);
        return coords ? fetchNearbyTheaters(coords, 40233.6) : [];
      })
      .then(setTheaters)
      .catch((err) => {
        console.error("Failed to load nearby theaters:", err);
        setTheaters([]);
        setTheatersError(err.message || "Couldn't load nearby theaters.");
      })
      .finally(() => setTheatersLoading(false));
  }, []);

  // Debounced Text Search (New) — fires 400ms after typing stops, same
  // pattern as the movie search below. Only while the modal is actually open
  // and a real location is known, so closing it (without clearing the text)
  // doesn't keep firing calls in the background.
  useEffect(() => {
    if (!theaterModalVisible || !deviceCoords || theaterSearch.trim().length < 2) {
      setTextSearchResults(null);
      return;
    }
    setTextSearching(true);
    const handle = setTimeout(() => {
      fetchNearbyTheaters(deviceCoords, 40233.6, theaterSearch)
        .then(setTextSearchResults)
        .catch((err) => {
          console.warn("Location text search failed:", err);
          setTextSearchResults([]);
        })
        .finally(() => setTextSearching(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [theaterSearch, theaterModalVisible, deviceCoords]);

  // Pre-populate with a rotating pick of well-known titles (a fixed curated
  // list, not real theatrical data — OMDb has no now-playing/popularity
  // endpoint to draw from) so the picker isn't empty before the host types
  // anything.
  useEffect(() => {
    getNowPlaying().then(setNowPlaying);
  }, []);

  const searchingTv = spaceType === "private_rental" && rentalActivityType === "tv";

  // A rented custom venue isn't a public theater screening — "showing" reads
  // more naturally there (could be a re-watch, a screener, a private premiere)
  // than "movie" does. Public gatherings at a real theater keep "movie"
  // since that's literally what the TMDb search underneath is finding.
  const isCustomVenueShowing = spaceType === "private_rental" && rentalActivityType === "movie";

  // Placeholder copy per non-catalog preset — the only thing that actually
  // differs between them, since they all just set a freeform title.
  const FREEFORM_TITLE_PLACEHOLDER: Record<"sports" | "gaming" | "awards" | "other", string> = {
    sports: "What's the event? (e.g. UFC 305, Fight Night, Super Bowl LX)",
    gaming: "What's the event? (e.g. Valorant Champions, The Game Awards)",
    awards: "What's the event? (e.g. Oscars 2026, Grammys)",
    other: "What's the event?",
  };

  // A generic noun per activity preset — used anywhere copy needs to say
  // "this kind of thing" without hardcoding "movie" (e.g. the cost-splitting
  // field, which used to always say "Movie Night" regardless of what was
  // actually being hosted).
  const EVENT_NOUN: Record<RentalActivityType, string> = {
    movie: "Movie Night",
    tv: "TV Event",
    sports: "Fight Night",
    gaming: "Gaming Event",
    awards: "Watch Event",
    other: "Event",
  };

  // Debounced OMDb search — fires 400ms after the user stops typing. An
  // empty query falls back to the now-playing list instead of a blank modal
  // (TV mode has no equivalent "airing now" list, so it just stays empty).
  //
  // Full catalog search is available for both space types (not just private
  // rentals) — different theaters carry different things (indie/arthouse
  // screens, re-releases, festivals), so restricting MovieSpaces to
  // only OMDb's generic "now playing" list was too narrow for what a given
  // theater might actually be showing. Manual entry covers whatever OMDb
  // itself doesn't have.
  useEffect(() => {
    if (!movieSearch.trim()) {
      setMovieResults(searchingTv ? [] : nowPlaying);
      setMovieSearchError(null);
      setMovieSearchNotice(null);
      return;
    }

    setMovieSearching(true);
    setMovieSearchError(null);
    setMovieSearchNotice(null);
    const handle = setTimeout(() => {
      (searchingTv ? searchTvShows(movieSearch) : searchMovies(movieSearch))
        .then(({ results, notice }) => {
          setMovieResults(results);
          setMovieSearchError(null);
          setMovieSearchNotice(notice);
        })
        .catch((err) => {
          console.warn("Movie search failed:", err);
          setMovieResults([]);
          setMovieSearchNotice(null);
          setMovieSearchError(err?.message || "Search failed. Check your connection and try again.");
        })
        .finally(() => setMovieSearching(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [movieSearch, nowPlaying, searchingTv]);

  // Only for Virtual private rentals — a real theater's Google Place ID
  // already gives public gatherings natural dedup, and Home/in-person
  // rentals are inherently distinct locations anyway. Virtual is the one
  // case where two hosts can trivially create the identical event ("UFC
  // 305") with nothing to tell them apart.
  useEffect(() => {
    if (venueMode !== "virtual" || movieName.trim().length < 3) {
      setSimilarSpaces([]);
      return;
    }
    const handle = setTimeout(() => {
      fetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/search-by-title?title=${encodeURIComponent(movieName.trim())}`,
      )
        .then((res) => (res.ok ? res.json() : { spaces: [] }))
        .then((data: { spaces: SimilarSpace[] }) => setSimilarSpaces(data.spaces || []))
        .catch((err) => console.warn("Similar-space lookup failed:", err));
    }, 500);
    return () => clearTimeout(handle);
  }, [movieName, venueMode]);

  // Text Search's results are already query-relevant (Google did the
  // matching server-side) — a client-side substring re-filter on top would
  // just drop legitimate fuzzy matches (e.g. Google returning "AMC
  // Levittown 6" for a search of "levittown"). The generic nearby list still
  // needs it, since that one was never filtered by anything.
  const baseTheaters = textSearchResults ?? theaters;

  // MovieSpaces (public_gathering) are screenings at an actual theater — bars
  // and community centers only belong in the broader Watch Party venue list.
  // A place with no returned types (rare) is kept rather than hidden, since
  // that's more likely a data gap than a genuine non-theater. Applies to
  // text-search results too — a search shouldn't let a public_gathering end
  // up pointed at a random bar just because it matched the typed name.
  const venueScopedTheaters =
    spaceType === "public_gathering"
      ? baseTheaters.filter((t) => t.types.length === 0 || t.types.includes("movie_theater"))
      : baseTheaters;

  const filteredTheaters =
    textSearchResults != null
      ? venueScopedTheaters
      : venueScopedTheaters.filter((t) => t.name.toLowerCase().includes(theaterSearch.toLowerCase()));

  const onDateChange = (_event: any, selected: Date) => {
    if (Platform.OS === "android") setDatePickerVisible(false);
    setDateValue(selected);
    setShowDate(formatDate(selected));
  };

  const onTimeChange = (_event: any, selected: Date) => {
    if (Platform.OS === "android") setTimePickerVisible(false);
    setTimeValue(selected);
  };

  // Opens Google's showtimes results for the picked film near the chosen
  // theater in an in-app browser. Google localizes and shows real theaters,
  // times, and ticket links — the host reads off the real showtime, then sets
  // the time in the picker below. (No paid showtimes API.)
  const handleFindShowtimes = () => {
    WebBrowser.openBrowserAsync(buildGoogleShowtimesUrl(movieName, theaterName));
  };

  const handleSubmit = async () => {
    const isFreeformActivity =
      spaceType === "private_rental" && rentalActivityType !== "movie" && rentalActivityType !== "tv";
    const mediaLabel = isFreeformActivity ? "event" : searchingTv ? "show" : "movie";
    const venueLabel = venueMode === "home" ? "address" : venueMode === "virtual" ? "platform" : "theater";
    if (!theaterName.trim() || !movieName.trim() || !showDate.trim() || !showTime.trim()) {
      Alert.alert("Missing info", `Please fill in your ${venueLabel}, ${mediaLabel}, date, and time.`);
      return;
    }

    // Theater hours only make sense for an actual theater — a Home or
    // Virtual watch party legitimately might start at 3am (an overseas UFC
    // card, a same-day anime simulcast), so this check would otherwise block
    // a perfectly real submission for those venue modes.
    if (venueMode === "theater" && timeValue && isOutsideBusinessHours(timeValue)) {
      Alert.alert(
        "Check your showtime",
        "Theaters don't typically run showings between 2:00 AM and 10:30 AM — double-check the time you picked.",
      );
      return;
    }

    // We don't have a real showtimes API (see "Find Showtimes Near Me") —
    // there's no way to verify server-side that this movie is actually
    // playing at this theater at this time, so we require the host to
    // attest to it instead of silently allowing bogus/expired listings.
    if (spaceType === "public_gathering" && !showtimeConfirmed) {
      Alert.alert(
        "Confirm the showtime",
        "Please check the box confirming this movie is actually playing at this theater at the date/time you picked.",
      );
      return;
    }

    let totalCostCents: number | null = null;
    if (spaceType === "private_rental" && totalCost.trim()) {
      const amount = parseFloat(totalCost);
      if (isNaN(amount) || amount < 0) {
        Alert.alert("Invalid cost", "Please enter a valid cost, or leave it blank for a free event.");
        return;
      }
      totalCostCents = amount > 0 ? Math.round(amount * 100) : null;
    }

    setCreating(true);
    await AsyncStorage.setItem("userName", hostName.trim());

    let screeningTime: string | null = null;
    if (dateValue && timeValue) {
      const combined = new Date(dateValue);
      combined.setHours(timeValue.getHours(), timeValue.getMinutes(), 0, 0);
      screeningTime = combined.toISOString();
    }

    try {
      const res = await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group`, {
        method: "POST",
        body: JSON.stringify({
          hostName: hostName.trim() || "Host",
          cinemaName: theaterName.trim(),
          googlePlaceId: theaterPlaceId,
          theaterLatitude: theaterLat,
          theaterLongitude: theaterLng,
          filmName: movieName.trim(),
          posterPath,
          showTime: showTime.trim(),
          showDate: showDate.trim(),
          screeningTime,
          bookingUrl: spaceType === "private_rental" ? bookingUrl.trim() : "",
          spaceType,
          totalCostCents,
          maxCapacity: maxCapacity ? parseInt(maxCapacity, 10) : null,
          postActivities,
          hangoutNotes: hangoutNotes.trim() || null,
          seasonEpisodeInfo: searchingTv && seasonEpisodeInfo.trim() ? seasonEpisodeInfo.trim() : null,
          eventCategory: spaceType === "private_rental" ? rentalActivityType : "movie",
          isPrivate,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to create space.");
      }

      const data = await res.json();
      await sendFriendInvites(data.groupId);
      setCreating(false);
      router.replace({
        pathname: "/group",
        params: { groupId: data.groupId, hostName: hostName.trim() },
      });
    } catch (err: any) {
      setCreating(false);
      Alert.alert("Couldn't create space", err.message || "Please try again.");
    }
  };

  return (
    <Starfield>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, SpaceStyles.glowText, SpaceStyles.wordmark]}>Create a Space</Text>

          <View style={styles.toggleRow}>
            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.toggleOption,
                spaceType === "public_gathering" && styles.toggleOptionActiveCyan,
              ]}
              onPress={() => {
                setSpaceType("public_gathering");
                // A public gathering must always be a real Google
                // Places theater (Explore's distance/theater-chain filters
                // and "Find Showtimes Near Me" depend on real coordinates) —
                // venueMode is private-rental-only UI, but its state
                // otherwise survives switching spaceType, so force it back
                // and drop whatever freeform Home/Virtual text was typed.
                if (venueMode !== "theater") {
                  setVenueMode("theater");
                  setTheaterName("");
                  setTheaterPlaceId(null);
                  setTheaterLat(null);
                  setTheaterLng(null);
                }
              }}
            >
              <Ionicons
                name="planet-outline"
                size={20}
                color={spaceType === "public_gathering" ? SpaceTheme.glowCyan : SpaceTheme.mutedOrbit}
              />
              <Text
                style={[
                  styles.toggleLabel,
                  spaceType === "public_gathering" && styles.toggleLabelActiveCyan,
                ]}
              >
                MovieSpace
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.toggleOption,
                spaceType === "private_rental" && styles.toggleOptionActivePink,
              ]}
              onPress={() => setSpaceType("private_rental")}
            >
              <Ionicons
                name="storefront-outline"
                size={20}
                color={spaceType === "private_rental" ? SpaceTheme.supernovaPink : SpaceTheme.mutedOrbit}
              />
              <Text
                style={[
                  styles.toggleLabel,
                  spaceType === "private_rental" && styles.toggleLabelActivePink,
                ]}
              >
                Watch Party / Custom Venue
              </Text>
            </TouchableOpacity>
          </View>

          {/* Independent of spaceType — a real theater screening and a
              custom watch party can both be made invite-only. */}
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.confirmRow}
            onPress={() => setIsPrivate((prev) => !prev)}
          >
            <Ionicons
              name={isPrivate ? "checkbox" : "square-outline"}
              size={20}
              color={isPrivate ? SpaceTheme.glowCyan : SpaceTheme.mutedOrbit}
            />
            <Text style={styles.confirmRowText}>
              🔒 Make this Space private — only joinable with the invite code, hidden from Explore
              and Home.
            </Text>
          </TouchableOpacity>

          {spaceType === "private_rental" && (
            <View style={styles.chipRow}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.afterChip, venueMode === "theater" && styles.afterChipActive]}
                onPress={() => setVenueMode("theater")}
              >
                <Text style={styles.afterChipEmoji}>📍</Text>
                <Text style={[styles.afterChipText, venueMode === "theater" && styles.afterChipTextActive]}>
                  In-Person / Venue
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.afterChip, venueMode === "home" && styles.afterChipActive]}
                onPress={() => {
                  setVenueMode("home");
                  setTheaterLocked(false);
                  setTheaterName("");
                  setTheaterPlaceId(null);
                  setTheaterLat(null);
                  setTheaterLng(null);
                }}
              >
                <Text style={styles.afterChipEmoji}>🏠</Text>
                <Text style={[styles.afterChipText, venueMode === "home" && styles.afterChipTextActive]}>
                  Home / Hosted
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.afterChip, venueMode === "virtual" && styles.afterChipActive]}
                onPress={() => {
                  setVenueMode("virtual");
                  setTheaterLocked(false);
                  setTheaterName("");
                  setTheaterPlaceId(null);
                  setTheaterLat(null);
                  setTheaterLng(null);
                }}
              >
                <Text style={styles.afterChipEmoji}>🌐</Text>
                <Text style={[styles.afterChipText, venueMode === "virtual" && styles.afterChipTextActive]}>
                  Virtual / Online
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {venueMode === "theater" ? (
            <TouchableOpacity
              activeOpacity={theaterLocked ? 1 : 0.8}
              style={styles.pickerField}
              onPress={() => !theaterLocked && setTheaterModalVisible(true)}
              disabled={theaterLocked}
            >
              <Ionicons name="storefront-outline" size={18} color={SpaceTheme.mutedOrbit} />
              <Text style={[styles.pickerFieldText, !theaterName && styles.pickerFieldPlaceholder]}>
                {theaterName ||
                  (spaceType === "private_rental" ? "Select a location" : "Select a nearby theater")}
              </Text>
              <Ionicons
                name={theaterLocked ? "lock-closed" : "chevron-down"}
                size={18}
                color={SpaceTheme.mutedOrbit}
              />
            </TouchableOpacity>
          ) : venueMode === "home" ? (
            <TextInput
              style={styles.input}
              placeholder="Address, room, or host's place (e.g. Sarah's Apartment, Unit 4B)"
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={theaterName}
              onChangeText={setTheaterName}
            />
          ) : (
            <TextInput
              style={styles.input}
              placeholder="Platform (e.g. Netflix Party, Twitch, Discord)"
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={theaterName}
              onChangeText={setTheaterName}
            />
          )}

          {spaceType === "private_rental" && (
            <View style={styles.chipRow}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.afterChip, rentalActivityType === "movie" && styles.afterChipActive]}
                onPress={() => {
                  setRentalActivityType("movie");
                  setMovieName("");
                  setPosterPath(null);
                }}
              >
                <Text style={styles.afterChipEmoji}>🍿</Text>
                <Text
                  style={[
                    styles.afterChipText,
                    rentalActivityType === "movie" && styles.afterChipTextActive,
                  ]}
                >
                  Movie
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.afterChip, rentalActivityType === "tv" && styles.afterChipActive]}
                onPress={() => {
                  setRentalActivityType("tv");
                  setMovieName("");
                  setPosterPath(null);
                }}
              >
                <Text style={styles.afterChipEmoji}>📺</Text>
                <Text
                  style={[
                    styles.afterChipText,
                    rentalActivityType === "tv" && styles.afterChipTextActive,
                  ]}
                >
                  TV Series / Premiere
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.afterChip, rentalActivityType === "sports" && styles.afterChipActive]}
                onPress={() => {
                  setRentalActivityType("sports");
                  setMovieName("");
                  setPosterPath(null);
                }}
              >
                <Text style={styles.afterChipEmoji}>🥊</Text>
                <Text
                  style={[
                    styles.afterChipText,
                    rentalActivityType === "sports" && styles.afterChipTextActive,
                  ]}
                >
                  Combat Sports / Fights
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.afterChip, rentalActivityType === "gaming" && styles.afterChipActive]}
                onPress={() => {
                  setRentalActivityType("gaming");
                  setMovieName("");
                  setPosterPath(null);
                }}
              >
                <Text style={styles.afterChipEmoji}>🎮</Text>
                <Text
                  style={[
                    styles.afterChipText,
                    rentalActivityType === "gaming" && styles.afterChipTextActive,
                  ]}
                >
                  Gaming / Esports
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.afterChip, rentalActivityType === "awards" && styles.afterChipActive]}
                onPress={() => {
                  setRentalActivityType("awards");
                  setMovieName("");
                  setPosterPath(null);
                }}
              >
                <Text style={styles.afterChipEmoji}>🏆</Text>
                <Text
                  style={[
                    styles.afterChipText,
                    rentalActivityType === "awards" && styles.afterChipTextActive,
                  ]}
                >
                  Awards / Live TV
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.afterChip, rentalActivityType === "other" && styles.afterChipActive]}
                onPress={() => {
                  setRentalActivityType("other");
                  setMovieName("");
                  setPosterPath(null);
                }}
              >
                <Text style={styles.afterChipEmoji}>✨</Text>
                <Text
                  style={[
                    styles.afterChipText,
                    rentalActivityType === "other" && styles.afterChipTextActive,
                  ]}
                >
                  Custom / Other
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {spaceType === "private_rental" &&
          rentalActivityType !== "movie" &&
          rentalActivityType !== "tv" ? (
            <TextInput
              style={styles.input}
              placeholder={FREEFORM_TITLE_PLACEHOLDER[rentalActivityType]}
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={movieName}
              onChangeText={setMovieName}
            />
          ) : (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.pickerField}
              onPress={() => setMovieModalVisible(true)}
            >
              <Ionicons name={searchingTv ? "tv-outline" : "film-outline"} size={18} color={SpaceTheme.mutedOrbit} />
              <Text style={[styles.pickerFieldText, !movieName && styles.pickerFieldPlaceholder]}>
                {movieName ||
                  (searchingTv
                    ? "Search for a TV show"
                    : isCustomVenueShowing
                      ? "Search for a showing"
                      : "Search for a movie")}
              </Text>
              <Ionicons name="chevron-down" size={18} color={SpaceTheme.mutedOrbit} />
            </TouchableOpacity>
          )}

          {similarSpacesDismissedFor !== movieName.trim() && similarSpaces.length > 0 && (
            <View style={styles.similarBanner}>
              <View style={styles.similarBannerHeader}>
                <Ionicons name="information-circle-outline" size={16} color={SpaceTheme.accentGold} />
                <Text style={styles.similarBannerTitle}>
                  {similarSpaces.length === 1
                    ? "A watch party for this already exists"
                    : `${similarSpaces.length} watch parties for this already exist`}
                </Text>
                <TouchableOpacity onPress={() => setSimilarSpacesDismissedFor(movieName.trim())} hitSlop={8}>
                  <Ionicons name="close" size={16} color={SpaceTheme.mutedOrbit} />
                </TouchableOpacity>
              </View>
              {similarSpaces.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  activeOpacity={0.8}
                  style={styles.similarRow}
                  onPress={() => router.push({ pathname: "/group", params: { groupId: s.id } })}
                >
                  <Text style={styles.similarRowTitle} numberOfLines={1}>
                    {s.filmName}
                  </Text>
                  <Text style={styles.similarRowSubtitle} numberOfLines={1}>
                    Hosted by {s.hostName} • {s.showDate} • {s.showTime} • {s.memberCount} joined
                  </Text>
                </TouchableOpacity>
              ))}
              <Text style={styles.similarBannerFootnote}>
                Tap one to join instead, or keep filling this out to create your own.
              </Text>
            </View>
          )}

          {searchingTv && (
            <TextInput
              style={styles.input}
              placeholder="Season & Episode Info (Optional) — e.g. Season 2 Premiere"
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={seasonEpisodeInfo}
              onChangeText={setSeasonEpisodeInfo}
            />
          )}

          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.pickerField}
            onPress={() => {
              // Seed a real value immediately (not just whatever the
              // spinner happens to be showing) — otherwise tapping "Done"
              // without ever touching the wheel leaves showDate/dateValue
              // unset, since onValueChange only fires on user interaction.
              if (!dateValue) {
                const initial = new Date();
                setDateValue(initial);
                setShowDate(formatDate(initial));
              }
              setDatePickerVisible(true);
            }}
          >
            <Ionicons name="calendar-outline" size={18} color={SpaceTheme.mutedOrbit} />
            <Text style={[styles.pickerFieldText, !showDate && styles.pickerFieldPlaceholder]}>
              {showDate || "Select screening date"}
            </Text>
          </TouchableOpacity>
          {datePickerVisible && (
            <DateTimePicker
              style={styles.pickerNativeTime}
              value={dateValue ?? new Date()}
              mode="date"
              minimumDate={new Date()}
              maximumDate={maxBookingDate}
              display={Platform.OS === "ios" ? "spinner" : "default"}
              themeVariant="dark"
              onValueChange={onDateChange}
              onDismiss={() => setDatePickerVisible(false)}
            />
          )}
          {Platform.OS === "ios" && datePickerVisible && (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.pickerDoneButton}
              onPress={() => setDatePickerVisible(false)}
            >
              <Text style={styles.pickerDoneButtonText}>Done</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.pickerField}
            onPress={() => {
              // Same fix as the date field above — seed a real value up
              // front so "Done" always has something to commit even if the
              // user never touches the spinner. showTime itself derives from
              // timeValue via the effect above, not set directly here.
              if (!timeValue) setTimeValue(new Date());
              setTimePickerVisible(true);
            }}
          >
            <Ionicons name="time-outline" size={18} color={SpaceTheme.mutedOrbit} />
            <Text style={[styles.pickerFieldText, !showTime && styles.pickerFieldPlaceholder]}>
              {showTime || "Select screening time"}
            </Text>
          </TouchableOpacity>
          {timePickerVisible && (
            <DateTimePicker
              style={styles.pickerNativeTime}
              value={timeValue ?? new Date()}
              mode="time"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              themeVariant="dark"
              onValueChange={onTimeChange}
              onDismiss={() => setTimePickerVisible(false)}
            />
          )}
          {Platform.OS === "ios" && timePickerVisible && (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.pickerDoneButton}
              onPress={() => setTimePickerVisible(false)}
            >
              <Text style={styles.pickerDoneButtonText}>Done</Text>
            </TouchableOpacity>
          )}

          {/* Look up real showtimes on Google (opens in-app browser) for the
              chosen film + theater — the host reads the time and sets it in the
              picker above. Movie screenings only. */}
          {spaceType === "public_gathering" && !!movieName.trim() && (
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.showtimeButton}
              onPress={handleFindShowtimes}
            >
              <Ionicons name="search-outline" size={18} color={SpaceTheme.backgroundVoid} />
              <Text style={styles.showtimeButtonText}>Find Showtimes Near Me</Text>
            </TouchableOpacity>
          )}

          {/* No showtimes API backs this, so the host attests that the film is
              really playing there. Required at submit. */}
          {spaceType === "public_gathering" && (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.confirmRow}
              onPress={() => setShowtimeConfirmed((prev) => !prev)}
            >
              <Ionicons
                name={showtimeConfirmed ? "checkbox" : "square-outline"}
                size={20}
                color={showtimeConfirmed ? SpaceTheme.glowCyan : SpaceTheme.mutedOrbit}
              />
              <Text style={styles.confirmRowText}>
                I&apos;ve confirmed this movie is actually playing at this theater at this date/time.
              </Text>
            </TouchableOpacity>
          )}

          {spaceType === "private_rental" && (
            <View style={styles.rentalSection}>
              <View style={styles.rentalSectionHeader}>
                <Ionicons name="storefront-outline" size={16} color={SpaceTheme.supernovaPink} />
                <Text style={styles.rentalSectionTitle}>Venue & Event Details</Text>
              </View>
              <Text style={styles.rentalSectionSubtext}>
                Whether you&apos;ve already booked this venue or you&apos;re still gauging interest before
                spending money, these fields keep guests informed — cost-splitting and capacity
                only. The app never charges anyone.
              </Text>

              <TextInput
                style={styles.input}
                placeholder={`Total Venue / ${EVENT_NOUN[rentalActivityType]} Cost (Optional)`}
                placeholderTextColor={SpaceTheme.mutedOrbit}
                value={totalCost}
                onChangeText={setTotalCost}
                keyboardType="decimal-pad"
              />
              <Text style={styles.rentalHintText}>
                💡 Leave at $0 if this event is free for attendees.
              </Text>
              <TextInput
                style={styles.input}
                placeholder={
                  venueMode === "virtual"
                    ? "Streaming/watch link (e.g. https://netflix.com/watch/...)"
                    : "Event / Venue Link (Optional)"
                }
                placeholderTextColor={SpaceTheme.mutedOrbit}
                value={bookingUrl}
                onChangeText={setBookingUrl}
                autoCapitalize="none"
                keyboardType="url"
              />
              <Text style={styles.rentalHintText}>
                💡 Paste a reservation link, invite URL, or chip-in link — or leave it blank to
                gauge interest before spending money out of pocket!
              </Text>
            </View>
          )}

          {/* Universal — not gated to private_rental. Used to only exist in
              the rental section, which meant a public_gathering (a real
              theater screening, potentially a large one — a studio premiere,
              a corporate rental of a whole auditorium) had no way to raise
              this past the backend's default of 40 at all. */}
          <TextInput
            style={styles.input}
            placeholder={
              venueMode === "home"
                ? "How many people fit at your place? (default 40)"
                : venueMode === "virtual"
                  ? "Max attendees (optional headcount — no real limit online)"
                  : "Max capacity (default 40)"
            }
            placeholderTextColor={SpaceTheme.mutedOrbit}
            value={maxCapacity}
            onChangeText={setMaxCapacity}
            keyboardType="number-pad"
          />

          <Text style={styles.afterSectionTitle}>Up for anything after? (optional)</Text>
          <View style={styles.chipRow}>
            {POST_ACTIVITIES.map((a) => (
              <TouchableOpacity
                key={a.key}
                activeOpacity={0.8}
                style={[styles.afterChip, postActivities.includes(a.key) && styles.afterChipActive]}
                onPress={() => toggleActivity(a.key)}
              >
                <Text style={styles.afterChipEmoji}>{a.emoji}</Text>
                <Text
                  style={[
                    styles.afterChipText,
                    postActivities.includes(a.key) && styles.afterChipTextActive,
                  ]}
                >
                  {a.label}
                </Text>
              </TouchableOpacity>
            ))}
            {customActivities.map((label) => (
              <TouchableOpacity
                key={label}
                activeOpacity={0.8}
                style={[styles.afterChip, styles.afterChipActive]}
                onPress={() => removeCustomActivity(label)}
              >
                <Text style={[styles.afterChipText, styles.afterChipTextActive]}>{label}</Text>
                <Ionicons name="close" size={14} color={SpaceTheme.glowCyan} />
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.customActivityRow}>
            <TextInput
              style={[styles.input, styles.customActivityInput]}
              placeholder="Add your own (e.g. Board games)"
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={customActivityInput}
              onChangeText={setCustomActivityInput}
              onSubmitEditing={addCustomActivity}
              returnKeyType="done"
            />
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.customActivityAddButton}
              onPress={addCustomActivity}
            >
              <Ionicons name="add" size={20} color={SpaceTheme.backgroundVoid} />
            </TouchableOpacity>
          </View>

          {postActivities.length > 0 && (
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder="e.g., Grabbing drinks at the bar across the street..."
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={hangoutNotes}
              onChangeText={setHangoutNotes}
              multiline
            />
          )}

          {friends.length > 0 && (
            <>
              <Text style={styles.afterSectionTitle}>Invite friends (optional)</Text>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.pickerField}
                onPress={() => setFriendsModalVisible(true)}
              >
                <Ionicons name="person-add-outline" size={18} color={SpaceTheme.mutedOrbit} />
                <Text style={styles.pickerFieldText}>
                  {invitedFriendIds.size === 0
                    ? `Select from ${friends.length} friend${friends.length === 1 ? "" : "s"}`
                    : `${invitedFriendIds.size} friend${invitedFriendIds.size === 1 ? "" : "s"} selected`}
                </Text>
                <Ionicons name="chevron-down" size={18} color={SpaceTheme.mutedOrbit} />
              </TouchableOpacity>
              {invitedFriendIds.size > 0 && (
                <View style={styles.chipRow}>
                  {friends
                    .filter((f) => invitedFriendIds.has(f.id))
                    .map((friend) => (
                      <TouchableOpacity
                        key={friend.id}
                        activeOpacity={0.8}
                        style={[styles.afterChip, styles.afterChipActive]}
                        onPress={() => toggleInviteFriend(friend.id)}
                      >
                        <Text style={[styles.afterChipText, styles.afterChipTextActive]}>
                          {friend.display_name}
                        </Text>
                        <Ionicons name="close" size={14} color={SpaceTheme.glowCyan} />
                      </TouchableOpacity>
                    ))}
                </View>
              )}
              <Text style={styles.rentalHintText}>
                💡 Selected friends get the invite link sent to them in the app.
              </Text>
            </>
          )}

          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.submitButton}
            onPress={handleSubmit}
            disabled={creating}
          >
            {creating ? (
              <ActivityIndicator color={SpaceTheme.backgroundVoid} />
            ) : (
              <Text style={styles.submitButtonText}>Create Space</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={theaterModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setTheaterModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {spaceType === "private_rental" ? "Select a Location" : "Select a Theater"}
              </Text>
              <TouchableOpacity onPress={() => setTheaterModalVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={SpaceTheme.mutedOrbit} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder={spaceType === "private_rental" ? "Search locations..." : "Search theaters..."}
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={theaterSearch}
              onChangeText={setTheaterSearch}
            />
            {theatersLoading || textSearching ? (
              <ActivityIndicator color={SpaceTheme.glowCyan} style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={filteredTheaters}
                keyExtractor={(item) => item.placeId}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.modalRow}
                    onPress={() => {
                      setTheaterName(item.name);
                      setTheaterPlaceId(item.placeId);
                      setTheaterLat(item.latitude);
                      setTheaterLng(item.longitude);
                      setTheaterModalVisible(false);
                      setTheaterSearch("");
                    }}
                  >
                    <Text style={styles.modalRowTitle}>{item.name}</Text>
                    <Text style={styles.modalRowSubtitle}>{item.address}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.modalEmptyText}>
                    {theatersError
                      ? `Couldn't load locations: ${theatersError}`
                      : textSearchResults != null
                        ? `No matches for "${theaterSearch.trim()}" — try a different name, or type it in manually below.`
                        : spaceType === "private_rental"
                          ? "No nearby locations found — allow location access, or type the name in manually below."
                          : "No nearby theaters found — allow location access, or type the name in manually below."}
                  </Text>
                }
              />
            )}
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              placeholder={
                spaceType === "private_rental"
                  ? "Can't find it? Type the location name"
                  : "Can't find it? Type the theater name"
              }
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={theaterName}
              onChangeText={(text) => {
                setTheaterName(text);
                setTheaterPlaceId(null);
                setTheaterLat(null);
                setTheaterLng(null);
              }}
            />
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.pickerDoneButton}
              onPress={() => {
                setTheaterModalVisible(false);
                setTheaterSearch("");
              }}
            >
              <Text style={styles.pickerDoneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={movieModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setMovieModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {searchingTv
                  ? "Search for a TV Show"
                  : isCustomVenueShowing
                    ? "Search for a Showing"
                    : "Search for a Movie"}
              </Text>
              <TouchableOpacity onPress={() => setMovieModalVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={SpaceTheme.mutedOrbit} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder={
                searchingTv ? "Search TV shows..." : isCustomVenueShowing ? "Search showings..." : "Search movies..."
              }
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={movieSearch}
              onChangeText={setMovieSearch}
              autoFocus
            />
            {/* One-tap custom title — for anything that isn't in the catalog
                at all (a Twitch stream, "UFC 305", "Oscars 2026"), so typing
                a query is enough on its own without also having to scroll
                past empty search results to the fallback field below. */}
            {movieSearch.trim().length > 0 && (
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.customTitleRow}
                onPress={() => {
                  setMovieName(movieSearch.trim());
                  setPosterPath(null);
                  setMovieModalVisible(false);
                  setMovieSearch("");
                }}
              >
                <Ionicons name="add-circle" size={20} color={SpaceTheme.glowCyan} />
                <Text style={styles.customTitleRowText} numberOfLines={1}>
                  Use &quot;{movieSearch.trim()}&quot; as the title
                </Text>
              </TouchableOpacity>
            )}
            {movieSearchError ? (
              <Text style={[styles.modalEmptyText, { color: SpaceTheme.danger }]}>
                {movieSearchError}
              </Text>
            ) : movieSearchNotice ? (
              <Text style={[styles.modalEmptyText, { color: SpaceTheme.mutedOrbit }]}>
                {movieSearchNotice}
              </Text>
            ) : null}
            {movieSearching ? (
              <ActivityIndicator color={SpaceTheme.glowCyan} style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={movieResults}
                keyExtractor={(item) => item.imdbId}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.modalRow}
                    onPress={() => {
                      setMovieName(item.title);
                      setPosterPath(item.posterPath);
                      setMovieModalVisible(false);
                      setMovieSearch("");
                    }}
                  >
                    <Text style={styles.modalRowTitle}>{item.title}</Text>
                    {item.releaseYear ? (
                      <Text style={styles.modalRowSubtitle}>{item.releaseYear}</Text>
                    ) : null}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  movieSearch.trim() ? (
                    <Text style={styles.modalEmptyText}>
                      No {searchingTv ? "TV shows" : isCustomVenueShowing ? "showings" : "movies"} found for &quot;
                      {movieSearch}&quot;.
                    </Text>
                  ) : null
                }
              />
            )}
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              placeholder={
                searchingTv
                  ? "Can't find it? Type the show title"
                  : isCustomVenueShowing
                    ? "Type the event/showing name"
                    : "Can't find it? Type the movie title"
              }
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={movieName}
              onChangeText={(text) => {
                setMovieName(text);
                setPosterPath(null);
              }}
            />
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.pickerDoneButton}
              onPress={() => {
                setMovieModalVisible(false);
                setMovieSearch("");
              }}
            >
              <Text style={styles.pickerDoneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={friendsModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setFriendsModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Friends</Text>
              <TouchableOpacity onPress={() => setFriendsModalVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={SpaceTheme.mutedOrbit} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Search friends by name or @username..."
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={friendSearch}
              onChangeText={setFriendSearch}
              autoCapitalize="none"
            />
            <FlatList
              data={filteredFriends}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = invitedFriendIds.has(item.id);
                return (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.modalRow}
                    onPress={() => toggleInviteFriend(item.id)}
                  >
                    <View style={styles.friendModalRowContent}>
                      <View>
                        <Text style={styles.modalRowTitle}>{item.display_name}</Text>
                        {item.username && (
                          <Text style={styles.modalRowSubtitle}>@{item.username}</Text>
                        )}
                      </View>
                      <Ionicons
                        name={selected ? "checkmark-circle" : "ellipse-outline"}
                        size={22}
                        color={selected ? SpaceTheme.glowCyan : SpaceTheme.mutedOrbit}
                      />
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.modalEmptyText}>
                  No friends found for &quot;{friendSearch}&quot;.
                </Text>
              }
            />
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.pickerDoneButton}
              onPress={() => {
                setFriendsModalVisible(false);
                setFriendSearch("");
              }}
            >
              <Text style={styles.pickerDoneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: "bold", color: SpaceTheme.starWhite, marginBottom: 20 },
  toggleRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  toggleOption: {
    flex: 1,
    ...SpaceStyles.glassCard,
    padding: 14,
    alignItems: "center",
    gap: 8,
  },
  toggleOptionActiveCyan: {
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderColor: "rgba(56, 189, 248, 0.5)",
    shadowColor: SpaceTheme.glowCyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  toggleOptionActivePink: {
    backgroundColor: "rgba(244, 114, 182, 0.12)",
    borderColor: "rgba(244, 114, 182, 0.5)",
    shadowColor: SpaceTheme.supernovaPink,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  toggleLabel: { fontSize: 13, fontWeight: "600", color: SpaceTheme.mutedOrbit, textAlign: "center" },
  toggleLabelActiveCyan: { color: SpaceTheme.glowCyan },
  toggleLabelActivePink: { color: SpaceTheme.supernovaPink },
  input: {
    ...SpaceStyles.glassCard,
    color: SpaceTheme.starWhite,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  rentalSection: {
    ...SpaceStyles.glassCard,
    borderColor: "rgba(244, 114, 182, 0.25)",
    padding: 16,
    marginBottom: 8,
  },
  rentalSectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  rentalSectionTitle: { fontSize: 15, fontWeight: "700", color: SpaceTheme.starWhite },
  rentalSectionSubtext: {
    fontSize: 12,
    color: SpaceTheme.mutedOrbit,
    lineHeight: 17,
    marginBottom: 14,
  },
  rentalHintText: {
    fontSize: 12,
    color: SpaceTheme.supernovaPink,
    lineHeight: 17,
    marginTop: -4,
  },
  similarBanner: {
    ...SpaceStyles.glassCard,
    padding: 12,
    marginBottom: 16,
    borderColor: "rgba(245, 197, 24, 0.35)",
  },
  similarBannerHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  similarBannerTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
  },
  similarRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  similarRowTitle: { fontSize: 14, fontWeight: "600", color: SpaceTheme.glowCyan, marginBottom: 2 },
  similarRowSubtitle: { fontSize: 12, color: SpaceTheme.mutedOrbit },
  similarBannerFootnote: {
    fontSize: 11,
    color: SpaceTheme.mutedOrbit,
    marginTop: 6,
    fontStyle: "italic",
  },
  submitButton: {
    backgroundColor: SpaceTheme.supernovaPink,
    padding: 18,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 8,
    shadowColor: SpaceTheme.supernovaPink,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  submitButtonText: { color: SpaceTheme.backgroundVoid, fontWeight: "800", fontSize: 17 },
  showtimeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: SpaceTheme.accentGold,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 4,
  },
  showtimeButtonText: { color: SpaceTheme.backgroundVoid, fontSize: 15, fontWeight: "700" },
  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    marginBottom: 4,
  },
  confirmRowText: {
    flex: 1,
    color: SpaceTheme.mutedOrbit,
    fontSize: 13,
    lineHeight: 18,
  },
  pickerField: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    marginBottom: 12,
  },
  pickerFieldText: { flex: 1, color: SpaceTheme.starWhite, fontSize: 16 },
  pickerFieldPlaceholder: { color: SpaceTheme.mutedOrbit },
  pickerNativeTime: { width: "100%", height: 200, marginBottom: 4 },
  afterSectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginTop: 4,
    marginBottom: 10,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  afterChip: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  afterChipActive: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderColor: SpaceTheme.glowCyan,
  },
  afterChipEmoji: { fontSize: 14 },
  afterChipText: { fontSize: 13, fontWeight: "600", color: SpaceTheme.mutedOrbit },
  afterChipTextActive: { color: SpaceTheme.glowCyan },
  notesInput: { minHeight: 60, textAlignVertical: "top" },
  customActivityRow: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 12 },
  customActivityInput: { flex: 1, marginBottom: 0 },
  customActivityAddButton: {
    backgroundColor: SpaceTheme.glowCyan,
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerDoneButton: {
    alignSelf: "flex-end",
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  pickerDoneButtonText: { color: SpaceTheme.glowCyan, fontWeight: "700", fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  modalSheet: {
    backgroundColor: SpaceTheme.deepSpace,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: SpaceTheme.starWhite },
  modalRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  modalRowTitle: { fontSize: 15, fontWeight: "600", color: SpaceTheme.starWhite, marginBottom: 2 },
  modalRowSubtitle: { fontSize: 13, color: SpaceTheme.mutedOrbit },
  customTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    marginTop: 8,
  },
  customTitleRowText: { flex: 1, fontSize: 14, fontWeight: "600", color: SpaceTheme.glowCyan },
  friendModalRowContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalEmptyText: {
    color: SpaceTheme.mutedOrbit,
    fontSize: 14,
    textAlign: "center",
    marginTop: 20,
    paddingHorizontal: 12,
  },
});
