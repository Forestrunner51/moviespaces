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
import { searchMovies, searchTvShows, getNowPlaying, TmdbMovie } from "@/frontend/services/tmdb";
import {
  getDeviceLocation,
  fetchNearbyTheaters,
  NearbyTheater,
} from "@/frontend/services/nearby-theaters";

type SpaceType = "public_gathering" | "private_rental";

const formatDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const formatTime = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });

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
    tmdbMovieId: prefillTmdbMovieId,
    posterPath: prefillPosterPath,
  } = useLocalSearchParams<{
    theaterName?: string;
    theaterPlaceId?: string;
    theaterLat?: string;
    theaterLng?: string;
    spaceType?: SpaceType;
    movieName?: string;
    tmdbMovieId?: string;
    posterPath?: string;
  }>();
  const [spaceType, setSpaceType] = useState<SpaceType>(
    prefillSpaceType === "private_rental" ? "private_rental" : "public_gathering",
  );
  // Locked when arriving from rent-a-theater.tsx's guided flow with a
  // specific theater already picked — not a blanket lock on every private
  // rental, since someone starting a rental from scratch still needs to
  // choose one.
  const theaterLocked = !!prefillPlaceId;
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
  const [tmdbMovieId, setTmdbMovieId] = useState<number | null>(
    prefillTmdbMovieId ? parseInt(prefillTmdbMovieId, 10) : null,
  );
  // The picked movie's poster URL — stored on the Space at creation so cards
  // can show poster art without a per-card TMDb lookup.
  const [posterPath, setPosterPath] = useState<string | null>(prefillPosterPath ?? null);
  const [showDate, setShowDate] = useState("");
  const [showTime, setShowTime] = useState("");

  // Private rental only — a rental doesn't have to be a movie screening at
  // all: "tv" swaps the movie search for a TMDb TV-show search (plus
  // optional season/episode info), "other" swaps it for a plain freeform
  // description instead of forcing a title choice at all.
  const [rentalActivityType, setRentalActivityType] = useState<"movie" | "tv" | "other">("movie");
  const [seasonEpisodeInfo, setSeasonEpisodeInfo] = useState("");
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

  const [movieModalVisible, setMovieModalVisible] = useState(false);
  const [movieSearch, setMovieSearch] = useState("");
  const [movieResults, setMovieResults] = useState<TmdbMovie[]>([]);
  const [movieSearching, setMovieSearching] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<TmdbMovie[]>([]);

  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [dateValue, setDateValue] = useState<Date | null>(null);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [timeValue, setTimeValue] = useState<Date | null>(null);

  useEffect(() => {
    AsyncStorage.getItem("userName").then((savedName) => {
      if (savedName) setHostName(savedName);
    });
  }, []);

  useEffect(() => {
    getDeviceLocation()
      .then((coords) => (coords ? fetchNearbyTheaters(coords) : []))
      .then(setTheaters)
      .catch((err) => {
        console.error("Failed to load nearby theaters:", err);
        setTheaters([]);
        setTheatersError(err.message || "Couldn't load nearby theaters.");
      })
      .finally(() => setTheatersLoading(false));
  }, []);

  // Pre-populate with box-office-active titles so the picker isn't empty
  // before the host types anything.
  useEffect(() => {
    getNowPlaying().then(setNowPlaying);
  }, []);

  const searchingTv = spaceType === "private_rental" && rentalActivityType === "tv";

  // Debounced TMDb search — fires 400ms after the user stops typing. An
  // empty query falls back to the now-playing list instead of a blank modal
  // (TV mode has no equivalent "airing now" list, so it just stays empty).
  //
  // Full catalog search is available for both space types (not just private
  // rentals) — different theaters carry different things (indie/arthouse
  // screens, re-releases, festivals), so restricting MovieSpaces to
  // only TMDb's generic "now playing" list was too narrow for what a given
  // theater might actually be showing. Manual entry covers whatever TMDb
  // itself doesn't have.
  useEffect(() => {
    if (!movieSearch.trim()) {
      setMovieResults(searchingTv ? [] : nowPlaying);
      return;
    }

    setMovieSearching(true);
    const handle = setTimeout(() => {
      (searchingTv ? searchTvShows(movieSearch) : searchMovies(movieSearch))
        .then(setMovieResults)
        .finally(() => setMovieSearching(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [movieSearch, nowPlaying, searchingTv]);

  const filteredTheaters = theaters.filter((t) =>
    t.name.toLowerCase().includes(theaterSearch.toLowerCase()),
  );

  const onDateChange = (_event: any, selected: Date) => {
    if (Platform.OS === "android") setDatePickerVisible(false);
    setDateValue(selected);
    setShowDate(formatDate(selected));
  };

  const onTimeChange = (_event: any, selected: Date) => {
    if (Platform.OS === "android") setTimePickerVisible(false);
    setTimeValue(selected);
    setShowTime(formatTime(selected));
  };

  const handleSubmit = async () => {
    const isOtherActivity = spaceType === "private_rental" && rentalActivityType === "other";
    const mediaLabel = isOtherActivity ? "activity" : searchingTv ? "show" : "movie";
    if (!hostName.trim() || !theaterName.trim() || !movieName.trim() || !showDate.trim() || !showTime.trim()) {
      Alert.alert(
        "Missing info",
        `Please fill in your name, theater, ${mediaLabel}, date, and time.`,
      );
      return;
    }

    if (timeValue && isOutsideBusinessHours(timeValue)) {
      Alert.alert(
        "Check your showtime",
        "Theaters don't typically run showings between 2:00 AM and 10:30 AM — double-check the time you picked.",
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
          hostName: hostName.trim(),
          cinemaName: theaterName.trim(),
          googlePlaceId: theaterPlaceId,
          theaterLatitude: theaterLat,
          theaterLongitude: theaterLng,
          filmName: movieName.trim(),
          tmdbMovieId,
          posterPath,
          showTime: showTime.trim(),
          showDate: showDate.trim(),
          screeningTime,
          bookingUrl: spaceType === "private_rental" ? bookingUrl.trim() : "",
          spaceType,
          totalCostCents,
          maxCapacity: spaceType === "private_rental" && maxCapacity ? parseInt(maxCapacity, 10) : null,
          postActivities,
          hangoutNotes: hangoutNotes.trim() || null,
          seasonEpisodeInfo: searchingTv && seasonEpisodeInfo.trim() ? seasonEpisodeInfo.trim() : null,
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
              onPress={() => setSpaceType("public_gathering")}
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

          <TextInput
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor={SpaceTheme.mutedOrbit}
            value={hostName}
            onChangeText={setHostName}
          />
          <TouchableOpacity
            activeOpacity={theaterLocked ? 1 : 0.8}
            style={styles.pickerField}
            onPress={() => !theaterLocked && setTheaterModalVisible(true)}
            disabled={theaterLocked}
          >
            <Ionicons name="storefront-outline" size={18} color={SpaceTheme.mutedOrbit} />
            <Text style={[styles.pickerFieldText, !theaterName && styles.pickerFieldPlaceholder]}>
              {theaterName || "Select a nearby theater"}
            </Text>
            <Ionicons
              name={theaterLocked ? "lock-closed" : "chevron-down"}
              size={18}
              color={SpaceTheme.mutedOrbit}
            />
          </TouchableOpacity>

          {spaceType === "private_rental" && (
            <View style={styles.chipRow}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.afterChip, rentalActivityType === "movie" && styles.afterChipActive]}
                onPress={() => {
                  setRentalActivityType("movie");
                  setMovieName("");
                  setTmdbMovieId(null);
                  setPosterPath(null);
                }}
              >
                <Text style={styles.afterChipEmoji}>🎬</Text>
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
                  setTmdbMovieId(null);
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
                style={[styles.afterChip, rentalActivityType === "other" && styles.afterChipActive]}
                onPress={() => {
                  setRentalActivityType("other");
                  setMovieName("");
                  setTmdbMovieId(null);
                  setPosterPath(null);
                }}
              >
                <Text style={styles.afterChipEmoji}>🏆</Text>
                <Text
                  style={[
                    styles.afterChipText,
                    rentalActivityType === "other" && styles.afterChipTextActive,
                  ]}
                >
                  Sports / Gaming / Other
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {spaceType === "private_rental" && rentalActivityType === "other" ? (
            <TextInput
              style={styles.input}
              placeholder="What's the event? (e.g. Fight Night, Game Tournament, Anime Night)"
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
                {movieName || (searchingTv ? "Search for a TV show" : "Search for a movie")}
              </Text>
              <Ionicons name="chevron-down" size={18} color={SpaceTheme.mutedOrbit} />
            </TouchableOpacity>
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
              // user never touches the spinner.
              if (!timeValue) {
                const initial = new Date();
                setTimeValue(initial);
                setShowTime(formatTime(initial));
              }
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
                placeholder="Total Venue / Event Cost (Optional)"
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
                placeholder="Max capacity (default 40)"
                placeholderTextColor={SpaceTheme.mutedOrbit}
                value={maxCapacity}
                onChangeText={setMaxCapacity}
                keyboardType="number-pad"
              />
              <TextInput
                style={styles.input}
                placeholder="Event / Venue Link (Optional)"
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
              <Text style={styles.modalTitle}>Select a Theater</Text>
              <TouchableOpacity onPress={() => setTheaterModalVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={SpaceTheme.mutedOrbit} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Search theaters..."
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={theaterSearch}
              onChangeText={setTheaterSearch}
            />
            {theatersLoading ? (
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
                      ? `Couldn't load theaters: ${theatersError}`
                      : "No nearby theaters found — allow location access, or type the name in manually below."}
                  </Text>
                }
              />
            )}
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              placeholder="Can't find it? Type the theater name"
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
                {searchingTv ? "Search for a TV Show" : "Search for a Movie"}
              </Text>
              <TouchableOpacity onPress={() => setMovieModalVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={SpaceTheme.mutedOrbit} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder={searchingTv ? "Search TV shows..." : "Search movies..."}
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={movieSearch}
              onChangeText={setMovieSearch}
              autoFocus
            />
            {movieSearching ? (
              <ActivityIndicator color={SpaceTheme.glowCyan} style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={movieResults}
                keyExtractor={(item) => item.id.toString()}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.modalRow}
                    onPress={() => {
                      setMovieName(item.title);
                      setTmdbMovieId(item.id);
                      setPosterPath(item.posterPath);
                      setMovieModalVisible(false);
                      setMovieSearch("");
                    }}
                  >
                    <Text style={styles.modalRowTitle}>{item.title}</Text>
                    {item.releaseDate ? (
                      <Text style={styles.modalRowSubtitle}>{item.releaseDate.slice(0, 4)}</Text>
                    ) : null}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  movieSearch.trim() ? (
                    <Text style={styles.modalEmptyText}>
                      No {searchingTv ? "TV shows" : "movies"} found for &quot;{movieSearch}&quot;.
                    </Text>
                  ) : null
                }
              />
            )}
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              placeholder={searchingTv ? "Can't find it? Type the show title" : "Can't find it? Type the movie title"}
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={movieName}
              onChangeText={(text) => {
                setMovieName(text);
                setTmdbMovieId(null);
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
