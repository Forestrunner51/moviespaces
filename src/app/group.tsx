import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/frontend/services/api";
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as WebBrowser from "expo-web-browser";
import * as Calendar from "expo-calendar";
import { supabase } from "@/frontend/config/supabase";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { ActionButton } from "@/frontend/components/action-button";
import { QuickAction } from "@/frontend/components/quick-action";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { SpaceTheme, SpaceStyles, Palette, Type, Radius, Display } from "@/frontend/constants/theme";
import { buildTicketUrl } from "@/frontend/services/ticket-links";
import { activityLabel, activityEmoji } from "@/frontend/constants/activities";
import { useFriends } from "@/frontend/hooks/use-friends";
import { CineMindLeaderboard } from "@/frontend/components/cinemind-leaderboard";
import { EVENT_CATEGORIES, eventCategoryOf } from "@/frontend/constants/event-categories";
import { reportContent } from "@/frontend/services/moderation";
import { Avatar } from "@/frontend/components/avatar";
import { useProfiles } from "@/frontend/hooks/use-profiles";
import { useForegroundPoll } from "@/frontend/hooks/use-foreground-poll";
import { formatEventDate } from "@/frontend/utils/event-date";
import { useToast } from "@/frontend/components/toast";

// Display strings written alongside screeningTime on edit, so the free-text
// columns never drift out of sync with the real timestamp. Matches the
// format create-space.tsx writes at creation.
const formatEditDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const formatEditTime = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });

interface Member {
  id: string;
  name: string;
  confirmed: boolean;
  userId: string;
}
interface Group {
  id: string;
  slug: string | null;
  spaceCode: string | null;
  isPublic: boolean;
  isPrivate: boolean;
  // True when this is a private Space and the viewer is neither host nor
  // member and didn't arrive with the invite code — `members` comes back
  // empty in that case, which is not the same as "nobody is going."
  membersHidden: boolean;
  genreCategory: string | null;
  // Non-null for a Movie Crew (match mode): a small group of strangers
  // seated together because they picked the same film. See match.tsx.
  matchMovieKey: string | null;
  userId: string;
  hostName: string;
  cinemaId: number | null;
  cinemaName: string;
  filmId: number | null;
  filmName: string;
  showTime: string;
  showDate: string;
  screeningTime: string | null;
  bookingUrl: string;
  status: string;
  spaceType: "public_gathering" | "private_rental";
  totalCostCents: number | null;
  maxCapacity: number;
  postActivities: string | null;
  hangoutNotes: string | null;
  showtimeReportCount: number;
  seasonEpisodeInfo: string | null;
  posterPath: string | null;
  eventCategory: string | null;
  createdAt: string;
  members: Member[];
}

export default function GroupScreen() {
  const { showToast } = useToast();
  const { groupId, code, matched } = useLocalSearchParams<{
    groupId: string;
    // Set by match.tsx on arrival so the crew card can do the reveal
    // ("you're first in" vs "you're in") instead of a toast lost to the
    // navigation. Absent on every later visit.
    matched?: "created" | "joined" | "already";
    // Present when arriving via join-by-code.tsx or a shared link that
    // embedded it — forwarded to /join so a private Space's join call can
    // present it. Absent for someone who found the group id some other way,
    // which is exactly the case a private Space's join check should reject.
    code?: string;
  }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Friend requests straight from the member list — see who you're watching
  // with and add them without leaving the Space.
  const { friends, sendFriendRequest } = useFriends();
  // Member rows come from the .NET backend, which has no access to Supabase
  // avatars — joined here so the guest list shows faces instead of a column
  // of plain text names.
  const memberProfiles = useProfiles((group?.members ?? []).map((m) => m.userId));
  const [requestedFriendIds, setRequestedFriendIds] = useState<Set<string>>(new Set());
  const friendIds = new Set(friends.map((f) => f.id));

  const handleAddFriend = async (userId: string) => {
    const result = await sendFriendRequest(userId);
    if (result.success || result.error?.includes("already exists")) {
      setRequestedFriendIds((prev) => new Set(prev).add(userId));
    } else {
      showToast(result.error || "Couldn't send that friend request. Please try again.");
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id ?? null);
    });
  }, []);

  const fetchGroup = useCallback(async () => {
    try {
      // Carries the invite code so a private Space returns its attendee list
      // to someone who was actually invited (see GetGroup's MembersHidden
      // gate) rather than an empty one.
      const res = await authFetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/${encodeURIComponent(groupId)}${
          code ? `?code=${encodeURIComponent(code)}` : ""
        }`,
      );
      // On a non-OK response (deleted Space, transient 500 during the 5s
      // poll, etc.) leave the current state alone rather than clobbering
      // `group` with the error body — otherwise an error object is truthy,
      // slips past the "Group not found" guard, and the screen renders with
      // undefined fields. An initial failure leaves group null → not-found.
      if (!res.ok) return;
      const data = await res.json();
      setGroup(data);
    } catch (err: any) {
      // Expected, not a bug: fires when the 5s poll has a request in flight
      // right as you navigate away — the OS cancels it mid-request. Logging
      // this as an error was pure noise (it doesn't affect the app; the
      // screen is already gone), so only real failures get logged.
      if (!/cancel/i.test(err?.message ?? "")) {
        console.error("Failed to fetch group data:", err);
      }
    } finally {
      setLoading(false);
    }
  }, [groupId, code]);

  // Every 5s while foregrounded only — a Space screen left open in the
  // background used to keep refetching the whole group indefinitely. Refetches
  // immediately on resume, so coming back to the app shows current RSVPs
  // rather than a stale snapshot.
  useForegroundPoll(fetchGroup, 5000, true, `${groupId}:${code}`);

  // Runs a mutating group action, surfaces the server's error message on
  // failure, and returns whether it succeeded — so callers can gate
  // navigation / success UI on a real result. Previously every one of these
  // handlers fired authFetch and ignored the response, so a failed action
  // (403, network drop, etc.) silently "succeeded" in the UI: e.g. Mark
  // Booked showing a confirmation alert, or Delete/Leave navigating away,
  // even when the request never went through.
  const runGroupAction = useCallback(
    async (path: string, options: RequestInit = {}): Promise<boolean> => {
      try {
        const res = await authFetch(
          `${process.env.EXPO_PUBLIC_API_URL}/api/group/${encodeURIComponent(groupId)}${path}`,
          { method: "POST", ...options },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Something went wrong. Please try again.");
        }
        return true;
      } catch (err: any) {
        showToast(err.message || "Couldn't complete that action. Please try again.");
        return false;
      }
    },
    // showToast is stable (useCallback([]) in ToastProvider) so this can't
    // churn the callback — listed to satisfy exhaustive-deps rather than
    // silencing it.
    [groupId, showToast],
  );

  // Fixed: Guarded share handler inside the component scope
  const shareLink = async () => {
    if (!groupId) {
      console.warn("Cannot share yet: groupId is undefined.");
      return;
    }

    const shareId = group?.slug || groupId;
    // Legacy Spaces predate SpaceCode — the link alone still works for them.
    const codeLine = group?.spaceCode ? `\nOr enter code: ${group.spaceCode}` : "";
    // Embedded as a query param too (not just spelled out in the message) —
    // for a private Space, this is what lets the link itself carry proof of
    // invitation through the space/[id] → group → join redirect chain,
    // instead of requiring the recipient to separately type the code.
    const codeParam = group?.spaceCode ? `?code=${encodeURIComponent(group.spaceCode)}` : "";

    // Leads with what/where/when rather than a bare URL — this message is the
    // whole pitch for someone who's never heard of the app, and "Join my movie
    // group!" was both pre-pivot wording (group, not Space) and told them
    // nothing about the actual event.
    const what = group?.filmName ? `"${group.filmName}"` : "a watch party";
    const whereWhen = [group?.cinemaName, group?.showDate, group?.showTime]
      .filter(Boolean)
      .join(" • ");
    const details = whereWhen ? `\n${whereWhen}` : "";

    await Share.share({
      message:
        `Join my MovieSpaces watch party for ${what}!${details}\n\n` +
        `${process.env.EXPO_PUBLIC_API_URL}/space/${shareId}${codeParam}${codeLine}`,
    });
  };

  // Every outbound link a host typed goes through this: only http(s) URLs
  // open (bookingUrl is host-supplied free text — a non-web scheme would make
  // openBrowserAsync reject, and until now that rejection was unhandled), and
  // a failure surfaces as a toast instead of a silent dead tap.
  const openExternalUrl = async (url: string) => {
    const trimmed = (url ?? "").trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      showToast("This link isn't a valid web address.", "error");
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(trimmed);
    } catch {
      showToast("Couldn't open that link.", "error");
    }
  };

  const handleGetTickets = async () => {
    if (!group) return;
    await openExternalUrl(buildTicketUrl(group.filmName, group.bookingUrl, group.cinemaName));
  };

  // cinemaName is often free-typed (a Home/Hosted address, "Sarah's
  // Apartment, Unit 4B") rather than a verified place, so there's no
  // Google Place ID to deep-link to reliably — a plain text query against
  // each platform's native maps app/URL scheme is the only thing that works
  // for both a real theater name and a hand-typed address.
  const handleOpenMaps = () => {
    if (!group) return;
    const query = encodeURIComponent(group.cinemaName);
    const url =
      Platform.OS === "ios" ? `maps:0,0?q=${query}` : `geo:0,0?q=${query}`;
    Linking.openURL(url).catch(() => {
      // The web fallback can also fail (no browser handler) — swallow it
      // rather than leave an unhandled rejection for Sentry to report.
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch(() => {
        showToast("Couldn't open Maps on this device.", "error");
      });
    });
  };

  const handleReportSpace = () => {
    if (!groupId) return;
    Alert.alert(
      "Report this Space?",
      "Let us know if the title, cover photo, or anything else about this Space looks wrong or inappropriate.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          style: "destructive",
          onPress: async () => {
            const result = await reportContent("space", groupId);
            Alert.alert(
              result.success ? "Reported" : "Couldn't report",
              result.success
                ? "Thanks — our team will review this Space."
                : result.error || "Please try again.",
            );
          },
        },
      ],
    );
  };

  const [addingToCalendar, setAddingToCalendar] = useState(false);

  const handleAddToCalendar = async () => {
    if (!group) return;

    // ScreeningTime is the only field with a real Date — ShowDate/ShowTime
    // are host-typed free text and can't be reliably parsed.
    if (!group.screeningTime) {
      showToast("This Space doesn't have an exact date/time set, so it can't be added automatically.");
      return;
    }

    setAddingToCalendar(true);
    try {
      const { status } = await Calendar.requestCalendarPermissions();
      if (status !== "granted") {
        showToast("Allow calendar access to add this watch party.");
        return;
      }

      const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
      const writableCalendar =
        calendars.find((c) => c.allowsModifications && c.isPrimary) ??
        calendars.find((c) => c.allowsModifications);

      if (!writableCalendar) {
        showToast("Couldn't find a calendar to add this event to.");
        return;
      }

      const startDate = new Date(group.screeningTime);
      const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);

      await writableCalendar.createEvent({
        title: group.filmName,
        startDate,
        endDate,
        location: group.cinemaName,
        notes: `MovieSpaces watch party hosted by ${group.hostName}`,
      });

      showToast("This watch party is now on your calendar.", "success");
    } catch (err) {
      console.error("Failed to add to calendar:", err);
      showToast("Couldn't add this to your calendar. Please try again.");
    } finally {
      setAddingToCalendar(false);
    }
  };

  const [joining, setJoining] = useState(false);

  // Joins in place rather than navigating to the /join screen and back.
  // That round trip pushed a whole screen (spinner, two transitions) for
  // what is really one button press, and because it finished with
  // router.replace("/group") the stack ended up [group, group] — pressing
  // back after joining re-showed the same Space instead of leaving it. A
  // failure here also used to strand the user on a dead-end error screen;
  // now it's an alert and they stay put.
  const handleJoin = async () => {
    if (!group) return;
    setJoining(true);
    try {
      // Same resolution order the /join screen used: profile display_name,
      // then auth metadata, then the locally cached name. An empty name is
      // still fine — the backend's profanity filter falls back to "A Movie
      // Fan" rather than rejecting it.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      let name = "";
      if (user) {
        const { data: row } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle();
        name = row?.display_name || user.user_metadata?.full_name || "";
      }
      if (!name) name = (await AsyncStorage.getItem("userName")) || "";
      if (name) await AsyncStorage.setItem("userName", name);

      const res = await authFetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/${group.id}/join`,
        { method: "POST", body: JSON.stringify({ name, spaceCode: code ?? null }) },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Couldn't join this Space. Please try again.");
      }
      await fetchGroup();
    } catch (err: any) {
      showToast(err.message || "Couldn't join this Space. Please try again.");
    } finally {
      setJoining(false);
    }
  };

  const [confirming, setConfirming] = useState(false);

  const handleConfirmAttendance = async (memberId: string) => {
    setConfirming(true);
    if (await runGroupAction(`/confirm/${memberId}`)) await fetchGroup();
    setConfirming(false);
  };

  const handleCancelAttendance = async (memberId: string) => {
    setConfirming(true);
    if (await runGroupAction(`/unconfirm/${memberId}`)) await fetchGroup();
    setConfirming(false);
  };

  const [reporting, setReporting] = useState(false);

  const handleReportShowtime = () => {
    Alert.alert(
      "Report this showtime?",
      "Let other members know this showtime looks outdated or wrong.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          style: "destructive",
          onPress: async () => {
            setReporting(true);
            if (await runGroupAction("/report-showtime")) await fetchGroup();
            setReporting(false);
          },
        },
      ],
    );
  };

  const [bookingUrlModalVisible, setBookingUrlModalVisible] = useState(false);
  const [bookingUrlInput, setBookingUrlInput] = useState("");
  const [savingBookingUrl, setSavingBookingUrl] = useState(false);

  const openBookingUrlModal = () => {
    setBookingUrlInput(group?.bookingUrl ?? "");
    setBookingUrlModalVisible(true);
  };

  const handleSaveBookingUrl = async () => {
    setSavingBookingUrl(true);
    const ok = await runGroupAction("/booking-url", {
      body: JSON.stringify({ bookingUrl: bookingUrlInput.trim() }),
    });
    if (ok) {
      await fetchGroup();
      setBookingUrlModalVisible(false);
    }
    setSavingBookingUrl(false);
  };

  // Edit modal — covers the fields a host is actually likely to need to fix
  // after creation: title, venue, date/time, capacity, cost. This is what
  // makes ShowtimeReportCount ("Flagged by N members") actionable — before
  // this, a host had no way to correct a wrong showtime short of deleting
  // the whole Space and losing every RSVP and the chat history with it.
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editFilmName, setEditFilmName] = useState("");
  const [editCinemaName, setEditCinemaName] = useState("");
  const [editMaxCapacity, setEditMaxCapacity] = useState("");
  const [editTotalCost, setEditTotalCost] = useState("");
  const [saving, setSaving] = useState(false);

  // Real Date objects, not the display strings. ScreeningTime is what every
  // consumer actually reads — formatEventDate prefers it over showDate/
  // showTime, hasPassed compares against it, and the reminder service
  // schedules off it. Editing only the strings (the first version of this
  // modal) therefore changed nothing anyone could see and left the Space
  // still "happening" at its original time.
  const [editDateValue, setEditDateValue] = useState<Date | null>(null);
  const [editTimeValue, setEditTimeValue] = useState<Date | null>(null);
  const [editDatePickerVisible, setEditDatePickerVisible] = useState(false);
  const [editTimePickerVisible, setEditTimePickerVisible] = useState(false);

  const openEditModal = () => {
    if (!group) return;
    setEditFilmName(group.filmName);
    setEditCinemaName(group.cinemaName);
    setEditMaxCapacity(String(group.maxCapacity));
    setEditTotalCost(group.totalCostCents != null ? String(group.totalCostCents / 100) : "");
    // Legacy Spaces predate screeningTime and have only the free-text
    // strings, which can't be parsed back into a Date — those start blank and
    // the host picks a real date/time, which upgrades the row.
    const existing = group.screeningTime ? new Date(group.screeningTime) : null;
    const valid = existing && !Number.isNaN(existing.getTime()) ? existing : null;
    setEditDateValue(valid);
    setEditTimeValue(valid);
    setEditDatePickerVisible(false);
    setEditTimePickerVisible(false);
    setEditModalVisible(true);
  };

  const handleSaveEdit = async () => {
    if ((!isCrew && !editFilmName.trim()) || !editCinemaName.trim()) {
      showToast(isCrew ? "Venue can't be blank." : "Title and venue can't be blank.");
      return;
    }
    if (!editDateValue || !editTimeValue) {
      showToast("Pick a date and a time.");
      return;
    }
    const capacity = isCrew ? (group?.maxCapacity ?? 6) : parseInt(editMaxCapacity, 10);
    if (!Number.isFinite(capacity) || capacity < 1) {
      showToast("Enter a capacity of at least 1.");
      return;
    }
    let totalCostCents: number | null = null;
    if (editTotalCost.trim()) {
      const dollars = parseFloat(editTotalCost);
      if (!Number.isFinite(dollars) || dollars < 0) {
        showToast("Enter a valid cost, or leave it blank.");
        return;
      }
      totalCostCents = Math.round(dollars * 100);
    }

    // Same combine-and-serialize as create-space: the date picker supplies
    // the day and the time picker the clock time, merged into one instant.
    const combined = new Date(editDateValue);
    combined.setHours(editTimeValue.getHours(), editTimeValue.getMinutes(), 0, 0);

    setSaving(true);
    const ok = await runGroupAction("/edit", {
      body: JSON.stringify({
        filmName: editFilmName.trim(),
        cinemaName: editCinemaName.trim(),
        // The display strings are kept in sync with the real timestamp rather
        // than edited independently, so they can never disagree.
        showDate: formatEditDate(combined),
        showTime: formatEditTime(combined),
        screeningTime: combined.toISOString(),
        maxCapacity: capacity,
        totalCostCents,
      }),
    });
    if (ok) {
      await fetchGroup();
      setEditModalVisible(false);
    }
    setSaving(false);
  };

  const handleRemoveMember = (member: Member) => {
    Alert.alert(
      "Remove from this Space?",
      `${member.name} will be removed and lose their spot.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (await runGroupAction(`/remove-member/${member.id}`)) await fetchGroup();
          },
        },
      ],
    );
  };

  const [transferModalVisible, setTransferModalVisible] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancellingSpace, setCancellingSpace] = useState(false);

  const handleDeleteGroup = () => {
    Alert.alert(
      "Delete this Space?",
      "This permanently deletes it for everyone and can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            const ok = await runGroupAction("", { method: "DELETE" });
            setDeleting(false);
            if (ok) router.replace("/(tabs)/spaces");
          },
        },
      ],
    );
  };

  const handleMarkCancelled = async () => {
    setCancellingSpace(true);
    const ok = await runGroupAction("/cancel");
    setCancellingSpace(false);
    if (ok) await fetchGroup();
  };

  // One button, one menu — Hand Off / Mark Cancelled / Delete used to each
  // have their own full-width button, which was a lot of stacked options for
  // something a host only reaches for occasionally. Consolidated back under
  // the single red "Cancel this Space" button, with a real "Cancel" entry so
  // it's easy to back out without doing anything.
  const handleCancelSpace = () => {
    const otherMembers = (group?.members ?? []).filter((m) => m.userId !== group?.userId);
    Alert.alert(
      "Cancel this Space?",
      "Mark it cancelled to notify everyone while keeping it around, hand it off to another member, or delete it entirely.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Mark Cancelled & Notify", style: "destructive", onPress: handleMarkCancelled },
        {
          text: "Hand Off Ownership",
          onPress: () => {
            if (otherMembers.length === 0) {
              Alert.alert("No one to hand it to", "There are no other members in this Space yet.");
              return;
            }
            setTransferModalVisible(true);
          },
        },
        { text: "Delete Permanently", style: "destructive", onPress: handleDeleteGroup },
      ],
    );
  };

  const [leaving, setLeaving] = useState(false);

  const handleLeaveSpace = () => {
    Alert.alert(
      "Leave this Space?",
      "You'll be removed from the member list and the cost split.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            setLeaving(true);
            const ok = await runGroupAction("/leave");
            setLeaving(false);
            if (ok) router.replace("/(tabs)/spaces");
          },
        },
      ],
    );
  };

  const handleTransferOwnership = async (member: Member) => {
    setTransferring(true);
    const ok = await runGroupAction("/transfer-ownership", {
      body: JSON.stringify({ newHostUserId: member.userId }),
    });
    if (ok) {
      await fetchGroup();
      setTransferModalVisible(false);
    }
    setTransferring(false);
  };

  const handleBook = async () => {
    if (!group) return;
    if (!(await runGroupAction("/book"))) return;

    await fetchGroup();

    Alert.alert(
      "Space confirmed",
      `Your group is booked for ${group.filmName} at ${group.showTime} on ${group.showDate}.\n\nHead to ${group.cinemaName} to purchase tickets! Everyone in the group has been notified.`,
      [{ text: "OK" }],
    );
  };

  const [unbooking, setUnbooking] = useState(false);

  const handleUnbook = () => {
    Alert.alert(
      "Unbook this Space?",
      "This reverts it back to pending — useful if it was marked booked by mistake.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unbook",
          onPress: async () => {
            setUnbooking(true);
            if (await runGroupAction("/unbook")) await fetchGroup();
            setUnbooking(false);
          },
        },
      ],
    );
  };

  // 1. Initial Loading State Guard
  if (loading) {
    return (
      <Starfield>
        <ActivityIndicator size="large" color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
      </Starfield>
    );
  }

  // 2. Missing Group Guard
  if (!group) {
    return (
      <Starfield>
        <View style={styles.center}>
          <Text style={styles.notFoundText}>Group not found</Text>
        </View>
      </Starfield>
    );
  }

  // 3. Safe Calculations
  const groupMembers = group.members ?? [];
  const allConfirmed =
    groupMembers.length > 0 && groupMembers.every((m) => m.confirmed);
  // Host status is decided ONLY by the server-authoritative user id, never by
  // the hostName navigation param — that param is attacker-controllable via a
  // crafted deep link (/group?groupId=X&hostName=<real host's name>), which
  // would surface host-only controls (Edit, Cancel, Delete, Remove Member) to
  // a non-owner. The backend rejects every host action for a non-owner anyway,
  // so this was only ever cosmetic, but showing those buttons at all reads as
  // broken. The real host still matches here: they created the Space, so
  // group.userId is their id.
  const isHost = !!currentUserId && currentUserId === group.userId;
  const confirmedCount = groupMembers.filter((m) => m.confirmed).length;
  const isMember =
    !!currentUserId && groupMembers.some((m) => m.userId === currentUserId);
  const myMember = groupMembers.find((m) => m.userId === currentUserId);
  // A crew has no real host — whoever tapped first — so any seated member
  // can set the where/when (the backend's EditGroup allows the same).
  const isCrew = !!group.matchMovieKey;
  const canEdit = isHost || (isCrew && isMember);
  const crewHasPlan = !!group.screeningTime || !!group.cinemaName;
  // Legacy Spaces predate the screeningTime column and have no exact event
  // time — falling back to createdAt (same pattern as profile.tsx's spaces
  // list) means they're still treated as past rather than staying "active"
  // forever just because we can't pin down their real showtime.
  // Deliberately impure: needs the actual current time on every render so
  // this screen correctly locks down while it stays mounted past the event.
  // Public Community Spaces (e.g. "Horror Night Den") are evergreen by
  // design — they have no ScreeningTime because there's no single event to
  // pin down, not because the data is missing. Without this exemption the
  // createdAt fallback above would mark one "past" the instant it's created,
  // hiding the Join button and every other action on a club that's supposed
  // to stay open forever.
  // eslint-disable-next-line react-hooks/purity -- see comment above
  const nowMs = Date.now();
  // A crew is IsPublic (evergreen) but does end once the showtime it set has
  // gone by; with no showtime set it's still forming, never "passed".
  const hasPassed = group.matchMovieKey
    ? !!group.screeningTime && new Date(group.screeningTime).getTime() < nowMs
    : !group.isPublic && new Date(group.screeningTime ?? group.createdAt).getTime() < nowMs;

  // eslint-disable-next-line react-hooks/purity -- relative labels ("Tonight",
  // "In 3 days") are read off the real current time, same as hasPassed above.
  const eventDate = formatEventDate(group.screeningTime, group.showDate, group.showTime);

  return (
    <Starfield>
      <ScrollView style={styles.container} contentContainerStyle={styles.containerContent}>
        {group.status === "cancelled" ? (
          <View style={styles.cancelledBanner}>
            <Ionicons name="close-circle" size={15} color={Palette.danger} />
            <Text style={styles.cancelledBannerText}>This Space has been cancelled</Text>
          </View>
        ) : (
          hasPassed && (
            <View style={styles.cancelledBanner}>
              <Ionicons name="time-outline" size={15} color={Palette.textMuted} />
              <Text style={styles.cancelledBannerText}>This event has passed</Text>
            </View>
          )
        )}
        {group.seasonEpisodeInfo && (
          <View style={styles.tvBadge}>
            <Ionicons name="tv-outline" size={14} color={SpaceTheme.glowCyan} />
            <Text style={styles.tvBadgeText}>
              Live TV Watch Party • {group.seasonEpisodeInfo}
            </Text>
          </View>
        )}
        <View style={styles.hero}>
          <MoviePoster
            uri={group.posterPath}
            width={92}
            fallbackIcon={EVENT_CATEGORIES[eventCategoryOf(group.spaceType, group.eventCategory)].icon}
          />
          <View style={styles.heroInfo}>
            <Text style={styles.title}>
              {group.filmName}
            </Text>
            <View style={styles.badgeRow}>
              {group.spaceType === "private_rental" && (
                <View style={styles.categoryBadge}>
                  <Ionicons
                    name={EVENT_CATEGORIES[eventCategoryOf(group.spaceType, group.eventCategory)].icon}
                    size={11}
                    color={Palette.textMuted}
                  />
                  <Text style={styles.categoryBadgeText}>
                    {EVENT_CATEGORIES[eventCategoryOf(group.spaceType, group.eventCategory)].label}
                  </Text>
                </View>
              )}
              {/* Visible confirmation that the privacy toggle from creation
                  actually took — hidden from Explore/Home and join requires
                  the SpaceCode (see JoinGroup's IsPrivate check), but nothing
                  on this screen said so until now. */}
              {group.isPrivate && (
                <View style={styles.privateBadge}>
                  <Ionicons name="lock-closed" size={11} color={SpaceTheme.accentGold} />
                  <Text style={styles.privateBadgeText}>Private — invite code only</Text>
                </View>
              )}
            </View>
            <Text style={styles.subtitle}>
              {isCrew
                ? `Movie Crew · ${groupMembers.length} of ${group.maxCapacity} seats`
                : `Hosted by ${group.hostName}`}
            </Text>
          </View>
          {canEdit && !hasPassed && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={openEditModal}
              accessibilityRole="button"
              accessibilityLabel="Edit this Space"
              hitSlop={8}
              style={styles.editButton}
            >
              <Ionicons name="pencil-outline" size={17} color={Palette.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Movie Crew reveal — the Timeleft "your table" moment. Seats fill
            with faces as people pick this film; open seats stay dashed so a
            crew of one reads as "forming", not "empty". */}
        {isCrew && (
          <View style={styles.crewCard}>
            <View style={styles.crewSeats}>
              {Array.from({ length: group.maxCapacity }).map((_, i) => {
                const m = groupMembers[i];
                return m ? (
                  <View key={m.id} style={styles.crewSeatFilled}>
                    <Avatar uri={memberProfiles.get(m.userId)?.avatarUrl} name={m.name} size={36} />
                  </View>
                ) : (
                  <View key={`open-${i}`} style={styles.crewSeatOpen}>
                    <Ionicons name="person-outline" size={14} color={Palette.textFaint} />
                  </View>
                );
              })}
            </View>
            <Text style={styles.crewTitle}>
              {isMember && groupMembers.length === 1
                ? "You're first in."
                : matched && isMember
                  ? "You're in."
                  : isMember
                    ? `${groupMembers.length} of ${group.maxCapacity} seats filled.`
                    : `${groupMembers.length} of ${group.maxCapacity} seats filled`}
            </Text>
            <Text style={styles.crewBody}>
              {isMember && groupMembers.length === 1
                ? `We'll seat the next people who pick ${group.filmName}. Invite a friend to get it moving.`
                : isMember
                  ? crewHasPlan
                    ? "Plans are set — see you there."
                    : "Say hi in chat and agree on a theater and showtime together."
                  : `A small crew of up to ${group.maxCapacity} who want to see ${group.filmName}.`}
            </Text>
            {isMember && !crewHasPlan && (
              <View style={styles.crewActions}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.crewPrimary}
                  onPress={openEditModal}
                  accessibilityRole="button"
                  accessibilityLabel="Set the theater and showtime"
                >
                  <Ionicons name="calendar-outline" size={15} color={Palette.base} />
                  <Text style={styles.crewPrimaryText}>Set the showtime</Text>
                </TouchableOpacity>
                {groupMembers.length === 1 && (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={styles.crewSecondary}
                    onPress={shareLink}
                    accessibilityRole="button"
                    accessibilityLabel="Invite a friend to this crew"
                  >
                    <Ionicons name="share-social-outline" size={15} color={Palette.accent} />
                    <Text style={styles.crewSecondaryText}>Invite</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {/* A crew with nothing planned yet has no when/where to show — the
            crew card above carries that state instead of a blank date line
            and an empty location row. */}
        {/* When/where, given the weight it deserves. This is an events app —
            the date used to render at 13px underneath the venue, smaller than
            the venue name itself. */}
        {!(isCrew && !crewHasPlan) && (
          <View style={styles.whenWhere}>
            {/* Date, time and the relative label share one baseline so they read
                as a single fact. Previously they were three stacked lines at
                three different sizes, fonts and colours inside a top-and-bottom
                bordered box, which bracketed the whole thing off as a slab
                dropped into the page rather than part of it. */}
            <View style={styles.whenRow}>
              <Text style={styles.whenDate}>{eventDate.date}</Text>
              <Text style={styles.whenTime}>{eventDate.time}</Text>
              {!!eventDate.relative && !hasPassed && (
                <Text style={styles.whenRelative}>{eventDate.relative}</Text>
              )}
            </View>
            <View style={styles.whereRow}>
              <Ionicons name="location-outline" size={14} color={Palette.textFaint} />
              <Text style={styles.whereText} numberOfLines={2}>
                {group.cinemaName}
              </Text>
            </View>
          </View>
        )}

        {!(isCrew && !crewHasPlan) && (
        <View style={styles.manualRow}>
          <Text style={styles.manualBadge}>
            {isCrew ? "Showtime set by the crew" : "Showtime set by the host"}
          </Text>
          {!hasPassed && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleReportShowtime}
              disabled={reporting}
              hitSlop={8}
              style={styles.reportRow}
            >
              <Ionicons name="flag-outline" size={13} color={SpaceTheme.mutedOrbit} />
              <Text style={styles.reportLink}>Report</Text>
            </TouchableOpacity>
          )}
        </View>
        )}
        {group.showtimeReportCount > 0 && (
          <Text style={styles.reportCountText}>
            Flagged by {group.showtimeReportCount} member
            {group.showtimeReportCount === 1 ? "" : "s"} as possibly outdated
          </Text>
        )}

        {/* No per-Space ticket link for a theater screening: "Get Tickets"
            opens a Fandango search for the film, and the host's own "Find
            Showtimes Near Me" is what actually resolves a real showtime.
            Asking a host to paste an exact URL was a step nobody completed.
            BookingUrl itself lives on — it's the private_rental card's
            "Event / Venue Link" below, where it means something concrete. */}

        {group.postActivities && (
          <View style={styles.hangoutCapsule}>
            <View style={styles.hangoutCapsuleHeader}>
              <Ionicons name="chatbubbles-outline" size={15} color={Palette.accent} />
              <Text style={styles.hangoutCapsuleTitle}>Hangout After</Text>
            </View>
            <View style={styles.afterRow}>
              {group.postActivities.split(",").map((key) => (
                <View key={key} style={styles.afterBadge}>
                  <Text style={styles.afterBadgeText}>
                    {activityEmoji(key)} {activityLabel(key)}
                  </Text>
                </View>
              ))}
            </View>
            {group.hangoutNotes && (
              <Text style={styles.hangoutNotesText}>{group.hangoutNotes}</Text>
            )}
          </View>
        )}

        {group.spaceType === "private_rental" && (
          <View style={styles.rentalCard}>
            <View style={styles.rentalCardHeader}>
              <Text style={styles.rentalBadge}>WATCH PARTY / CUSTOM VENUE</Text>
            </View>
            {group.totalCostCents != null && group.totalCostCents > 0 ? (
              <>
                <Text style={styles.rentalCostText}>
                  ${(group.totalCostCents / 100).toFixed(2)} total
                </Text>
                {/* The per-person split is derived from the confirmed count,
                    which is zero whenever the guest list is hidden — showing it
                    then would quote the entire venue cost as one person's
                    share. Same reason the spots-filled line is suppressed. */}
                {!group.membersHidden && (
                  <Text style={styles.rentalPerPersonText}>
                    ${(group.totalCostCents / 100 / Math.max(confirmedCount, 1)).toFixed(2)} per
                    person ({confirmedCount} confirmed)
                  </Text>
                )}
              </>
            ) : (
              <View style={styles.freeBadge}>
                <Ionicons name="pricetag-outline" size={14} color={Palette.positive} />
                <Text style={styles.freeBadgeText}>Free to attend</Text>
              </View>
            )}
            <Text style={styles.rentalCapacityText}>
              {group.membersHidden
                ? `Up to ${group.maxCapacity} spots`
                : `${groupMembers.length} / ${group.maxCapacity} spots filled`}
            </Text>

            {group.bookingUrl ? (
              <>
                {!hasPassed && (
                  <ActionButton
                    icon="link-outline"
                    label="View Event / Venue Link"
                    onPress={() => openExternalUrl(group.bookingUrl)}
                    style={styles.rentalReservationButton}
                    textStyle={styles.rentalReservationButtonText}
                    iconColor={SpaceTheme.backgroundVoid}
                  />
                )}
                <Text style={styles.linkDisclaimer}>
                  Added by the host — verify it&apos;s legit before entering any personal or
                  payment info.
                </Text>
                <View style={styles.rentalSecuredBadge}>
                  <Text style={styles.rentalSecuredBadgeText}>Venue confirmed</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.tentativeBanner}>
                  <Text style={styles.tentativeBannerText}>
                    Not locked in yet — the host will confirm the venue once enough people RSVP.
                  </Text>
                </View>
                {isHost && !hasPassed && (
                  <ActionButton
                    icon="create-outline"
                    label="Add Venue / Event Link"
                    onPress={openBookingUrlModal}
                    style={styles.addBookingLinkButton}
                    textStyle={styles.addBookingLinkButtonText}
                    iconColor={SpaceTheme.glowCyan}
                  />
                )}
              </>
            )}
          </View>
        )}

        {/* Renders nothing unless this Space's members have CineMind results
            today — see the component for why. */}
        {!!groupId && <CineMindLeaderboard spaceId={groupId} />}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {group.membersHidden ? "Who's Going" : `Group Members (${groupMembers.length})`}
          </Text>
          {group.membersHidden && (
            <Text style={styles.membersHiddenText}>
              This Space is private — the guest list is only visible to people who&apos;ve
              joined.
            </Text>
          )}
          <FlatList
            data={groupMembers}
            scrollEnabled={false}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              // Only app members (non-empty Supabase userId) can be friended —
              // web/name-only joiners have no account to send a request to.
              // Never show it for yourself.
              const canAddFriend =
                !hasPassed &&
                !!item.userId &&
                item.userId !== currentUserId &&
                !friendIds.has(item.userId);
              // No Supabase userId means they RSVP'd from the web invite page
              // without an account. Worth labelling: they're auto-confirmed
              // (they have no way to come back and RSVP later), they can't be
              // messaged or friended, and they still take a capacity slot — so
              // a host counting heads needs to tell them apart from a real
              // in-app confirmation.
              const isWebGuest = !item.userId;
              const profile = item.userId ? memberProfiles.get(item.userId) : undefined;
              // Host can remove anyone but themselves — Cancel/Delete/Hand
              // Off Ownership already cover a host leaving their own Space.
              const canRemove = isHost && !hasPassed && item.userId !== group.userId;
              return (
                <View style={styles.memberRow}>
                  <Avatar uri={profile?.avatarUrl} name={item.name} size={36} />
                  <View style={styles.memberNameBlock}>
                    <Text style={styles.memberName}>{item.name}</Text>
                    {isWebGuest && <Text style={styles.guestTag}>Joined from the web</Text>}
                  </View>
                  <View style={styles.memberRowRight}>
                    {canAddFriend &&
                      (requestedFriendIds.has(item.userId) ? (
                        <Text style={styles.friendRequested}>Requested</Text>
                      ) : (
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onPress={() => handleAddFriend(item.userId)}
                          hitSlop={8}
                        >
                          <Text style={styles.addFriendText}>+ Add Friend</Text>
                        </TouchableOpacity>
                      ))}
                    <Text style={item.confirmed ? styles.confirmed : styles.pending}>
                      {item.confirmed ? "Going" : "Pending"}
                    </Text>
                    {canRemove && (
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => handleRemoveMember(item)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.name} from this Space`}
                        hitSlop={8}
                      >
                        <Ionicons name="close-circle-outline" size={18} color={Palette.textFaint} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            }}
          />
        </View>

        {!isHost && !isMember && !hasPassed && (
          <ActionButton
            icon="person-add-outline"
            label="Join This Space"
            onPress={handleJoin}
            loading={joining}
            style={styles.joinButton}
            textStyle={styles.buttonText}
            iconColor={SpaceTheme.backgroundVoid}
          />
        )}

        {isMember && !isHost && myMember && !hasPassed && (
          myMember.confirmed ? (
            <ActionButton
              icon="checkmark-done-outline"
              label="You're Confirmed — Tap to Cancel"
              onPress={() => handleCancelAttendance(myMember.id)}
              loading={confirming}
              style={styles.confirmedButton}
              textStyle={styles.confirmedButtonText}
              iconColor={SpaceTheme.mutedOrbit}
            />
          ) : (
            <ActionButton
              icon="checkmark-circle-outline"
              label="Confirm You're Going"
              onPress={() => handleConfirmAttendance(myMember.id)}
              loading={confirming}
              style={styles.confirmButton}
              textStyle={styles.buttonText}
              iconColor={SpaceTheme.backgroundVoid}
            />
          )
        )}

        {isMember && !isHost && !hasPassed && (
          <ActionButton
            icon="exit-outline"
            label="Leave Space"
            onPress={handleLeaveSpace}
            loading={leaving}
            style={styles.leaveSpaceButton}
            textStyle={styles.leaveSpaceButtonText}
            iconColor={SpaceTheme.mutedOrbit}
          />
        )}

        {!!group?.spaceCode && !hasPassed && (
          <TouchableOpacity activeOpacity={0.85} style={styles.spaceCodeRow} onPress={shareLink}>
            <Ionicons name="key-outline" size={16} color={SpaceTheme.accentGold} />
            <Text style={styles.spaceCodeLabel}>Space code</Text>
            <Text style={styles.spaceCodeValue}>{group.spaceCode}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.quickActionsRow}>
          {!hasPassed && (
            <QuickAction icon="share-social-outline" label="Invite" onPress={shareLink} />
          )}

          {!hasPassed && !!group.cinemaName && (
            <QuickAction icon="navigate-outline" label="Directions" onPress={handleOpenMaps} />
          )}

          {(isHost || isMember) && (
            <QuickAction
              icon="chatbubbles-outline"
              label="Chat"
              onPress={() =>
                router.push({
                  pathname: "/group-chat/[id]",
                  params: {
                    id: group.id,
                    type: "group",
                    title: group.filmName,
                    showTime: group.showTime,
                    showDate: group.showDate,
                    seasonEpisodeInfo: group.seasonEpisodeInfo ?? "",
                  },
                })
              }
            />
          )}

          {(isHost || isMember) && group.spaceType === "public_gathering" && !hasPassed && (
            <QuickAction icon="ticket-outline" label="Tickets" onPress={handleGetTickets} />
          )}

          {(isHost || isMember) && !hasPassed && (
            <QuickAction
              icon="calendar-outline"
              label="Calendar"
              onPress={handleAddToCalendar}
              loading={addingToCalendar}
            />
          )}

          {!isHost && (
            <QuickAction icon="flag-outline" label="Report" onPress={handleReportSpace} />
          )}
        </View>

        {isHost && group.status !== "booked" && !hasPassed && (
          <ActionButton
            icon={allConfirmed ? "checkmark-circle-outline" : "hourglass-outline"}
            label={
              allConfirmed
                ? "Mark Group Booked"
                : `Waiting for ${groupMembers.filter((m) => !m.confirmed).length} confirmation(s)`
            }
            onPress={handleBook}
            style={styles.bookButton}
            textStyle={styles.buttonText}
            iconColor={SpaceTheme.backgroundVoid}
          />
        )}

        {isHost && group.status === "booked" && !hasPassed && (
          <ActionButton
            icon="arrow-undo-outline"
            label="Unbook (Revert to Pending)"
            onPress={handleUnbook}
            loading={unbooking}
            style={styles.unbookButton}
            textStyle={styles.unbookButtonText}
            iconColor={SpaceTheme.starWhite}
          />
        )}

        {isHost && !hasPassed && (
          <ActionButton
            icon="warning-outline"
            label="Cancel this Space"
            onPress={handleCancelSpace}
            loading={cancellingSpace || deleting}
            style={styles.cancelSpaceButton}
            textStyle={styles.cancelSpaceButtonText}
            iconColor={SpaceTheme.danger}
          />
        )}
      </ScrollView>

      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView style={styles.modal} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>{isCrew ? "Set the showtime" : "Edit Space"}</Text>
            <Text style={styles.modalSubtitle}>
              {isCrew
                ? "Anyone in the crew can set or fix the theater and time — agree in chat first."
                : "Fixing the date or time clears any \u201cflagged as outdated\u201d reports on this Space."}
            </Text>
            {/* A crew's film and size are fixed — see EditGroup, which also
                ignores both for crews server-side. */}
            {!isCrew && (
              <TextInput
                style={styles.modalInput}
                placeholder="Title"
                placeholderTextColor={SpaceTheme.mutedOrbit}
                value={editFilmName}
                onChangeText={setEditFilmName}
                maxLength={200}
              />
            )}
            <TextInput
              style={styles.modalInput}
              placeholder="Venue"
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={editCinemaName}
              onChangeText={setEditCinemaName}
              maxLength={250}
            />
            {/* Pickers, not free-text. These set a real timestamp, which is
                what formatEventDate / hasPassed / the reminder service all
                read — hand-typed strings could never move any of those. */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.modalPickerField}
              onPress={() => setEditDatePickerVisible((v) => !v)}
            >
              <Ionicons name="calendar-outline" size={17} color={Palette.textMuted} />
              <Text
                style={[styles.modalPickerText, !editDateValue && styles.modalPickerPlaceholder]}
              >
                {editDateValue ? formatEditDate(editDateValue) : "Select date"}
              </Text>
            </TouchableOpacity>
            {editDatePickerVisible && (
              <DateTimePicker
                value={editDateValue ?? new Date()}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                themeVariant="dark"
                onValueChange={(_event: any, selected: Date) => {
                  if (Platform.OS === "android") setEditDatePickerVisible(false);
                  setEditDateValue(selected);
                }}
                onDismiss={() => setEditDatePickerVisible(false)}
              />
            )}

            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.modalPickerField}
              onPress={() => setEditTimePickerVisible((v) => !v)}
            >
              <Ionicons name="time-outline" size={17} color={Palette.textMuted} />
              <Text
                style={[styles.modalPickerText, !editTimeValue && styles.modalPickerPlaceholder]}
              >
                {editTimeValue ? formatEditTime(editTimeValue) : "Select time"}
              </Text>
            </TouchableOpacity>
            {editTimePickerVisible && (
              <DateTimePicker
                value={editTimeValue ?? new Date()}
                mode="time"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                themeVariant="dark"
                onValueChange={(_event: any, selected: Date) => {
                  if (Platform.OS === "android") setEditTimePickerVisible(false);
                  setEditTimeValue(selected);
                }}
                onDismiss={() => setEditTimePickerVisible(false)}
              />
            )}
            {!isCrew && (
              <TextInput
                style={styles.modalInput}
                placeholder="Max capacity"
                placeholderTextColor={SpaceTheme.mutedOrbit}
                value={editMaxCapacity}
                onChangeText={setEditMaxCapacity}
                keyboardType="number-pad"
              />
            )}
            {group.spaceType === "private_rental" && (
              <TextInput
                style={styles.modalInput}
                placeholder="Total cost (optional)"
                placeholderTextColor={SpaceTheme.mutedOrbit}
                value={editTotalCost}
                onChangeText={setEditTotalCost}
                keyboardType="decimal-pad"
              />
            )}
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.confirmButton}
              onPress={handleSaveEdit}
              disabled={saving}
            >
              <Text style={styles.buttonText}>{saving ? "Saving..." : "Save Changes"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.modalCancelButton}
              onPress={() => setEditModalVisible(false)}
              disabled={saving}
            >
              <Text style={styles.modalCancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={transferModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTransferModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Hand Ownership To...</Text>
            <Text style={styles.modalSubtitle}>
              They&apos;ll become the new host — you&apos;ll stay on as a regular member.
            </Text>
            <FlatList
              data={groupMembers.filter((m) => m.userId !== group.userId)}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.memberRow}
                  onPress={() => handleTransferOwnership(item)}
                  disabled={transferring}
                >
                  <Text style={styles.memberName}>{item.name}</Text>
                  <Text style={styles.reportLink}>{transferring ? "..." : "Make host"}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.modalCancelButton}
              onPress={() => setTransferModalVisible(false)}
              disabled={transferring}
            >
              <Text style={styles.modalCancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={bookingUrlModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setBookingUrlModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modal}>
            {/* Only the private_rental card opens this now — a theater
                screening has no per-Space link to set. */}
            <Text style={styles.modalTitle}>Add Venue / Event Link</Text>
            <Text style={styles.modalSubtitle}>
              Paste the reservation, invite, or chip-in link once the venue&apos;s locked in — this
              lets everyone know it&apos;s confirmed.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="https://..."
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={bookingUrlInput}
              onChangeText={setBookingUrlInput}
              maxLength={2048}
              autoCapitalize="none"
              keyboardType="url"
            />
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.confirmButton}
              onPress={handleSaveBookingUrl}
              disabled={savingBookingUrl}
            >
              <Text style={styles.buttonText}>{savingBookingUrl ? "Saving..." : "Save"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.modalCancelButton}
              onPress={() => setBookingUrlModalVisible(false)}
              disabled={savingBookingUrl}
            >
              <Text style={styles.modalCancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  containerContent: {
    padding: 16,
    // Not 60 — this screen keeps its native header (see _layout.tsx), which
    // already clears the notch; the extra 60 was dead space under it.
    paddingTop: 16,
    paddingBottom: 40,
  },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  notFoundText: { color: SpaceTheme.mutedOrbit, ...Type.body },
  hero: { flexDirection: "row", gap: 14, marginBottom: 20, alignItems: "flex-start" },
  editButton: { padding: 4 },
  heroInfo: { flex: 1, justifyContent: "center" },
  title: { ...Display.heading, color: Palette.text },
  subtitle: { ...Type.small, color: Palette.textMuted, marginTop: 6 },
  // One hairline underneath, not a border on both sides. Bracketing it top and
  // bottom turned it into a detached slab; a single rule just separates it
  // from what follows, which is what it's actually for.
  whenWhere: {
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
    paddingBottom: 16,
    marginBottom: 20,
  },
  // baseline, not center — the three sizes on this row need to sit on a
  // shared baseline or the smaller ones float mid-way up the big date.
  crewCard: {
    ...SpaceStyles.glassCard,
    borderColor: Palette.accentBorder,
    padding: 16,
    marginBottom: 20,
    gap: 6,
  },
  crewSeats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  crewSeatFilled: {
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: Palette.accentBorder,
  },
  crewSeatOpen: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: Palette.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  crewTitle: { ...Type.body, fontWeight: "700", color: Palette.text },
  crewBody: { ...Type.small, color: Palette.textMuted },
  crewActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  crewPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accent,
  },
  crewPrimaryText: { ...Type.small, fontWeight: "700", color: Palette.base },
  crewSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    backgroundColor: Palette.accentDim,
  },
  crewSecondaryText: { ...Type.small, fontWeight: "700", color: Palette.accent },
  whenRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 10 },
  whenDate: { ...Display.date, color: Palette.text },
  // Muted, not amber. Amber is the accent — having the time *and* the
  // relative label both in it meant two competing highlights inside one row.
  whenTime: { ...Display.stat, color: Palette.textMuted },
  whenRelative: {
    ...Type.caption,
    color: Palette.accent,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  whereRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  whereText: { ...Type.small, color: Palette.textMuted, flex: 1 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  categoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
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
  tvBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    borderRadius: Radius.small,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  tvBadgeText: { color: SpaceTheme.glowCyan, fontWeight: "700", ...Type.caption },
  manualRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  manualBadge: { ...Type.caption, color: SpaceTheme.mutedOrbit, fontWeight: "600" },
  reportRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  reportLink: { ...Type.caption, color: SpaceTheme.mutedOrbit, fontWeight: "700" },
  reportCountText: { ...Type.caption, color: Palette.danger, marginBottom: 12 },
  hangoutCapsule: {
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.accentDim,
    borderRadius: Radius.medium,
    padding: 14,
    marginBottom: 16,
  },
  hangoutCapsuleHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  hangoutCapsuleTitle: { ...Type.small, fontWeight: "700", color: Palette.accent },
  hangoutNotesText: {
    ...Type.small,
    color: SpaceTheme.starWhite,
    lineHeight: 19,
    marginTop: 8,
  },
  afterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  afterBadge: {
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    borderRadius: Radius.small,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  afterBadgeText: { ...Type.caption, fontWeight: "600", color: SpaceTheme.supernovaPink },
  rentalCard: {
    ...SpaceStyles.glassCard,
    borderColor: Palette.accentBorder,
    padding: 16,
    marginBottom: 16,
  },
  rentalCardHeader: { marginBottom: 8 },
  rentalBadge: {
    color: SpaceTheme.supernovaPink,
    ...Type.caption,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  rentalCostText: { color: SpaceTheme.accentGold, ...Type.title, fontWeight: "700" },
  rentalPerPersonText: { color: SpaceTheme.mutedOrbit, ...Type.small, marginTop: 2 },
  freeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(91, 191, 123, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(91, 191, 123, 0.35)",
    borderRadius: Radius.small,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  freeBadgeText: { ...Type.small, color: Palette.positive, fontWeight: "700" },
  rentalCapacityText: { color: SpaceTheme.glowCyan, ...Type.small, fontWeight: "600", marginTop: 8 },
  section: {
    ...SpaceStyles.glassCard,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    ...Display.section,
    color: Palette.textMuted,
    textTransform: "uppercase" as const,
    marginBottom: 12,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  membersHiddenText: { ...Type.small, color: Palette.textMuted },
  memberNameBlock: { flex: 1 },
  memberName: { ...Type.body, color: Palette.text },
  guestTag: { ...Type.caption, color: Palette.textFaint, marginTop: 1 },
  memberRowRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  addFriendText: { color: SpaceTheme.glowCyan, fontWeight: "700", ...Type.small },
  friendRequested: { color: SpaceTheme.mutedOrbit, ...Type.small },
  confirmed: { color: Palette.positive, fontWeight: "600" },
  pending: { color: Palette.textMuted, fontWeight: "600" },
  joinButton: {
    backgroundColor: SpaceTheme.supernovaPink,
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: SpaceTheme.supernovaPink,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  confirmButton: {
    backgroundColor: Palette.positive,
    padding: 14,
    borderRadius: Radius.medium,
    alignItems: "center",
    marginBottom: 12,
  },
  confirmedButton: {
    backgroundColor: Palette.fill,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 14,
    borderRadius: Radius.medium,
    alignItems: "center",
    marginBottom: 12,
  },
  confirmedButtonText: { color: SpaceTheme.mutedOrbit, fontWeight: "600", ...Type.small },
  spaceCodeRow: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 14,
    borderColor: Palette.accentBorder,
  },
  spaceCodeLabel: { color: SpaceTheme.mutedOrbit, ...Type.caption, fontWeight: "600" },
  spaceCodeValue: {
    color: SpaceTheme.accentGold,
    ...Type.body,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  quickActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginBottom: 20,
  },
  bookButton: {
    backgroundColor: Palette.positive,
    padding: 14,
    borderRadius: Radius.medium,
    alignItems: "center",
  },
  unbookButton: {
    backgroundColor: Palette.fill,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    padding: 14,
    borderRadius: Radius.medium,
    alignItems: "center",
  },
  // White, not the dark `buttonText` — this button sits on a dark glass
  // background, so the previous void-colored label was near-invisible.
  unbookButtonText: { color: SpaceTheme.starWhite, fontWeight: "700", ...Type.body },
  cancelSpaceButton: {
    alignItems: "center",
    padding: 14,
    marginTop: 12,
  },
  cancelSpaceButtonText: { color: SpaceTheme.danger, fontWeight: "600", ...Type.small },
  cancelledBanner: {
    flexDirection: "row",
    justifyContent: "center",
    backgroundColor: Palette.dangerDim,
    borderWidth: 1,
    borderColor: Palette.dangerBorder,
    borderRadius: Radius.medium,
    padding: 12,
    marginBottom: 12,
    alignItems: "center",
    gap: 6,
  },
  cancelledBannerText: { ...Type.small, color: Palette.danger, fontWeight: "700" },
  leaveSpaceButton: {
    backgroundColor: Palette.fill,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    padding: 14,
    borderRadius: Radius.medium,
    alignItems: "center",
    marginBottom: 12,
  },
  leaveSpaceButtonText: { color: SpaceTheme.mutedOrbit, fontWeight: "600", ...Type.small },
  buttonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", ...Type.body },
  rentalReservationButton: {
    backgroundColor: SpaceTheme.glowCyan,
    padding: 14,
    borderRadius: Radius.medium,
    alignItems: "center",
    marginTop: 12,
  },
  rentalReservationButtonText: {
    color: SpaceTheme.backgroundVoid,
    fontWeight: "700",
    ...Type.body,
  },
  linkDisclaimer: {
    color: SpaceTheme.mutedOrbit,
    ...Type.caption,
    lineHeight: 15,
    textAlign: "center",
    marginTop: 8,
  },
  rentalSecuredBadge: {
    alignSelf: "center",
    marginTop: 10,
  },
  rentalSecuredBadgeText: { color: Palette.positive, fontWeight: "700", ...Type.small },
  tentativeBanner: {
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  tentativeBannerText: {
    color: SpaceTheme.supernovaPink,
    ...Type.small,
    lineHeight: 18,
    fontWeight: "600",
  },
  addBookingLinkButton: {
    marginTop: 10,
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  addBookingLinkButtonText: { color: SpaceTheme.glowCyan, fontWeight: "700", ...Type.small },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 8, 6, 0.85)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: SpaceTheme.deepSpace,
    padding: 24,
    // Bounded so the edit modal's six fields can't push the sheet off the
    // top of the screen on a smaller device — it scrolls internally instead.
    maxHeight: "85%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  modalTitle: { ...Type.title, fontWeight: "bold", color: SpaceTheme.starWhite, marginBottom: 4 },
  modalSubtitle: { ...Type.small, color: SpaceTheme.mutedOrbit, marginBottom: 20, lineHeight: 18 },
  modalInput: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.small,
    padding: 12,
    ...Type.body,
    backgroundColor: Palette.fill,
    marginBottom: 16,
    color: SpaceTheme.starWhite,
  },
  modalPickerField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.small,
    padding: 12,
    backgroundColor: Palette.raised,
    marginBottom: 12,
  },
  modalPickerText: { ...Type.body, color: Palette.text, flex: 1 },
  modalPickerPlaceholder: { color: Palette.textMuted },
  modalCancelButton: { alignItems: "center", padding: 12 },
  modalCancelButtonText: { color: SpaceTheme.mutedOrbit, ...Type.body },
});
