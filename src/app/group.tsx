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
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Calendar from "expo-calendar";
import { supabase } from "@/frontend/config/supabase";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { ActionButton } from "@/frontend/components/action-button";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { buildTicketUrl } from "@/frontend/services/ticket-links";
import { activityLabel, activityEmoji } from "@/frontend/constants/activities";
import { useFriends } from "@/frontend/hooks/use-friends";

interface Member {
  id: string;
  name: string;
  confirmed: boolean;
  userId: string;
}
interface Group {
  id: string;
  slug: string | null;
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
  createdAt: string;
  members: Member[];
}

export default function GroupScreen() {
  const { groupId, hostName } = useLocalSearchParams<{
    groupId: string;
    hostName: string;
  }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Friend requests straight from the member list — see who you're watching
  // with and add them without leaving the Space.
  const { friends, sendFriendRequest } = useFriends();
  const [requestedFriendIds, setRequestedFriendIds] = useState<Set<string>>(new Set());
  const friendIds = new Set(friends.map((f) => f.id));

  const handleAddFriend = async (userId: string) => {
    const result = await sendFriendRequest(userId);
    if (result.success || result.error?.includes("already exists")) {
      setRequestedFriendIds((prev) => new Set(prev).add(userId));
    } else {
      Alert.alert("Couldn't send request", result.error || "Please try again.");
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id ?? null);
    });
  }, []);

  const fetchGroup = useCallback(async () => {
    try {
      const res = await authFetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}`,
      );
      // On a non-OK response (deleted Space, transient 500 during the 5s
      // poll, etc.) leave the current state alone rather than clobbering
      // `group` with the error body — otherwise an error object is truthy,
      // slips past the "Group not found" guard, and the screen renders with
      // undefined fields. An initial failure leaves group null → not-found.
      if (!res.ok) return;
      const data = await res.json();
      setGroup(data);
    } catch (err) {
      console.error("Failed to fetch group data:", err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchGroup();
    const interval = setInterval(fetchGroup, 5000); // poll every 5 seconds
    return () => clearInterval(interval);
  }, [fetchGroup]);

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
          `${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}${path}`,
          { method: "POST", ...options },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Something went wrong. Please try again.");
        }
        return true;
      } catch (err: any) {
        Alert.alert("Couldn't complete that action", err.message || "Please try again.");
        return false;
      }
    },
    [groupId],
  );

  // Fixed: Guarded share handler inside the component scope
  const shareLink = async () => {
    if (!groupId) {
      console.warn("Cannot share yet: groupId is undefined.");
      return;
    }

    const shareId = group?.slug || groupId;

    await Share.share({
      message: `Join my movie group! Open this link: ${process.env.EXPO_PUBLIC_API_URL}/space/${shareId}`,
    });
  };

  const handleGetTickets = async () => {
    if (!group) return;
    await WebBrowser.openBrowserAsync(buildTicketUrl(group.filmName, group.bookingUrl));
  };

  const [addingToCalendar, setAddingToCalendar] = useState(false);

  const handleAddToCalendar = async () => {
    if (!group) return;

    // ScreeningTime is the only field with a real Date — ShowDate/ShowTime
    // are host-typed free text and can't be reliably parsed.
    if (!group.screeningTime) {
      Alert.alert(
        "Can't add to calendar",
        "This Space doesn't have an exact date/time set, so it can't be added automatically.",
      );
      return;
    }

    setAddingToCalendar(true);
    try {
      const { status } = await Calendar.requestCalendarPermissions();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Allow calendar access to add this watch party.");
        return;
      }

      const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
      const writableCalendar =
        calendars.find((c) => c.allowsModifications && c.isPrimary) ??
        calendars.find((c) => c.allowsModifications);

      if (!writableCalendar) {
        Alert.alert("No calendar available", "Couldn't find a calendar to add this event to.");
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

      Alert.alert("Added!", "This watch party is now on your calendar.");
    } catch (err) {
      console.error("Failed to add to calendar:", err);
      Alert.alert("Couldn't add to calendar", "Please try again.");
    } finally {
      setAddingToCalendar(false);
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

  const [transferModalVisible, setTransferModalVisible] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    if (await runGroupAction("/cancel")) await fetchGroup();
  };

  const handleCancelSpace = () => {
    const otherMembers = (group?.members ?? []).filter((m) => m.userId !== group?.userId);
    Alert.alert(
      "Cancel this Space?",
      "Mark it cancelled to notify everyone while keeping it around, hand it off to another member, or delete it entirely.",
      [
        { text: "Nevermind", style: "cancel" },
        { text: "Mark Cancelled & Notify", onPress: handleMarkCancelled },
        {
          text: "Hand Ownership",
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
      "🎉 Group Confirmed!",
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
  const isHost =
    (!!hostName && hostName === group.hostName) ||
    (!!currentUserId && currentUserId === group.userId);
  const confirmedCount = groupMembers.filter((m) => m.confirmed).length;
  const isMember =
    !!currentUserId && groupMembers.some((m) => m.userId === currentUserId);
  const myMember = groupMembers.find((m) => m.userId === currentUserId);
  // Legacy Spaces predate the screeningTime column and have no exact event
  // time — falling back to createdAt (same pattern as profile.tsx's spaces
  // list) means they're still treated as past rather than staying "active"
  // forever just because we can't pin down their real showtime.
  // Deliberately impure: needs the actual current time on every render so
  // this screen correctly locks down while it stays mounted past the event.
  // eslint-disable-next-line react-hooks/purity -- see comment above
  const hasPassed = new Date(group.screeningTime ?? group.createdAt).getTime() < Date.now();

  return (
    <Starfield>
      <ScrollView style={styles.container} contentContainerStyle={styles.containerContent}>
        {group.status === "cancelled" ? (
          <View style={styles.cancelledBanner}>
            <Ionicons name="close-circle" size={15} color={SpaceTheme.supernovaPink} />
            <Text style={styles.cancelledBannerText}>This Space has been cancelled</Text>
          </View>
        ) : (
          hasPassed && (
            <View style={styles.cancelledBanner}>
              <Ionicons name="time-outline" size={15} color={SpaceTheme.supernovaPink} />
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
          <MoviePoster uri={group.posterPath} width={92} />
          <View style={styles.heroInfo}>
            <Text style={[styles.title, SpaceStyles.glowText, SpaceStyles.wordmark]}>
              {group.filmName}
            </Text>
            <Text style={styles.subtitle}>
              {group.cinemaName} • {group.showTime}
            </Text>
            <Text style={styles.heroDate}>{group.showDate}</Text>
          </View>
        </View>

        <View style={styles.manualRow}>
          <Text style={styles.manualBadge}>👤 Showtime scheduled manually by host</Text>
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
        {group.showtimeReportCount > 0 && (
          <Text style={styles.reportCountText}>
            Flagged by {group.showtimeReportCount} member
            {group.showtimeReportCount === 1 ? "" : "s"} as possibly outdated
          </Text>
        )}

        {group.postActivities && (
          <View style={styles.hangoutCapsule}>
            <View style={styles.hangoutCapsuleHeader}>
              <Text style={styles.hangoutCapsuleTitle}>💬 Hangout After</Text>
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
                <Text style={styles.rentalPerPersonText}>
                  ${(group.totalCostCents / 100 / Math.max(confirmedCount, 1)).toFixed(2)} per
                  person ({confirmedCount} confirmed)
                </Text>
              </>
            ) : (
              <View style={styles.freeBadge}>
                <Text style={styles.freeBadgeText}>🎉 Free to Attend</Text>
              </View>
            )}
            <Text style={styles.rentalCapacityText}>
              {groupMembers.length} / {group.maxCapacity} spots filled
            </Text>

            {group.bookingUrl ? (
              <>
                {!hasPassed && (
                  <ActionButton
                    icon="link-outline"
                    label="View Event / Venue Link"
                    onPress={() => WebBrowser.openBrowserAsync(group.bookingUrl)}
                    style={styles.rentalReservationButton}
                    textStyle={styles.rentalReservationButtonText}
                    iconColor={SpaceTheme.backgroundVoid}
                  />
                )}
                <View style={styles.rentalSecuredBadge}>
                  <Text style={styles.rentalSecuredBadgeText}>🔒 Venue Secured & Confirmed</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.tentativeBanner}>
                  <Text style={styles.tentativeBannerText}>
                    ⏳ Tentative Mode — Host will lock in the venue once enough members RSVP!
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Group Members ({groupMembers.length})
          </Text>
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
              return (
                <View style={styles.memberRow}>
                  <Text style={styles.memberName}>{item.name}</Text>
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
                      {item.confirmed ? "✓ In" : "Pending"}
                    </Text>
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
            onPress={() => router.push({ pathname: "/join", params: { groupId: group.id } })}
            style={styles.joinButton}
            textStyle={styles.buttonText}
            iconColor={SpaceTheme.backgroundVoid}
          />
        )}

        {isMember && myMember && !hasPassed && (
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

        {!hasPassed && (
          <ActionButton
            icon="share-social-outline"
            label="Invite Friends"
            onPress={shareLink}
            style={styles.shareButton}
            textStyle={styles.buttonText}
            iconColor={SpaceTheme.backgroundVoid}
          />
        )}

        {(isHost || isMember) && (
          <ActionButton
            icon="chatbubbles-outline"
            label="Group Chat"
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
            style={styles.chatButton}
            textStyle={styles.buttonText}
            iconColor={SpaceTheme.backgroundVoid}
          />
        )}

        {(isHost || isMember) && group.spaceType === "public_gathering" && !hasPassed && (
          <ActionButton
            icon="ticket-outline"
            iconSize={20}
            label="Get Tickets"
            onPress={handleGetTickets}
            style={styles.ticketsButton}
            textStyle={styles.ticketsButtonText}
            iconColor={SpaceTheme.backgroundVoid}
          />
        )}

        {(isHost || isMember) && !hasPassed && (
          <ActionButton
            icon="calendar-outline"
            label="Add to Calendar"
            onPress={handleAddToCalendar}
            loading={addingToCalendar}
            style={styles.calendarButton}
            textStyle={styles.calendarButtonText}
            iconColor={SpaceTheme.starWhite}
          />
        )}

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
            loading={deleting}
            style={styles.cancelSpaceButton}
            textStyle={styles.cancelSpaceButtonText}
            iconColor={SpaceTheme.danger}
          />
        )}
      </ScrollView>

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
                  <Text style={styles.reportLink}>{transferring ? "..." : "Make Host →"}</Text>
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
    paddingTop: 60,
    paddingBottom: 40,
  },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  notFoundText: { color: SpaceTheme.mutedOrbit, fontSize: 16 },
  hero: { flexDirection: "row", gap: 14, marginBottom: 12, alignItems: "flex-start" },
  heroInfo: { flex: 1, justifyContent: "center" },
  title: { fontSize: 26, color: SpaceTheme.starWhite },
  subtitle: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginTop: 4 },
  heroDate: { fontSize: 13, color: SpaceTheme.glowCyan, fontWeight: "600", marginTop: 4 },
  tvBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.4)",
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  tvBadgeText: { color: SpaceTheme.glowCyan, fontWeight: "700", fontSize: 12 },
  manualRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  manualBadge: { fontSize: 12, color: SpaceTheme.mutedOrbit, fontWeight: "600" },
  reportRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  reportLink: { fontSize: 12, color: SpaceTheme.mutedOrbit, fontWeight: "700" },
  reportCountText: {
    fontSize: 12,
    color: SpaceTheme.supernovaPink,
    marginBottom: 12,
  },
  hangoutCapsule: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(244, 114, 182, 0.06)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  hangoutCapsuleHeader: { marginBottom: 8 },
  hangoutCapsuleTitle: { fontSize: 14, fontWeight: "700", color: SpaceTheme.supernovaPink },
  hangoutNotesText: {
    fontSize: 13,
    color: SpaceTheme.starWhite,
    lineHeight: 19,
    marginTop: 8,
  },
  afterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  afterBadge: {
    backgroundColor: "rgba(244, 114, 182, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(244, 114, 182, 0.35)",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  afterBadgeText: { fontSize: 12, fontWeight: "600", color: SpaceTheme.supernovaPink },
  rentalCard: {
    ...SpaceStyles.glassCard,
    borderColor: "rgba(244, 114, 182, 0.3)",
    padding: 16,
    marginBottom: 16,
  },
  rentalCardHeader: { marginBottom: 8 },
  rentalBadge: {
    color: SpaceTheme.supernovaPink,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  rentalCostText: { color: SpaceTheme.accentGold, fontSize: 20, fontWeight: "700" },
  rentalPerPersonText: { color: SpaceTheme.mutedOrbit, fontSize: 13, marginTop: 2 },
  freeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(74, 222, 128, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(74, 222, 128, 0.4)",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  freeBadgeText: { color: "#4ADE80", fontWeight: "800", fontSize: 15 },
  rentalCapacityText: { color: SpaceTheme.glowCyan, fontSize: 13, fontWeight: "600", marginTop: 8 },
  section: {
    ...SpaceStyles.glassCard,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: SpaceTheme.starWhite, marginBottom: 12 },
  memberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  memberName: { fontSize: 16, color: SpaceTheme.starWhite },
  memberRowRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  addFriendText: { color: SpaceTheme.glowCyan, fontWeight: "700", fontSize: 13 },
  friendRequested: { color: SpaceTheme.mutedOrbit, fontSize: 13 },
  confirmed: { color: "#4ADE80", fontWeight: "600" },
  pending: { color: SpaceTheme.supernovaPink, fontWeight: "600" },
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
    backgroundColor: "#4ADE80",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  confirmedButton: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  confirmedButtonText: { color: SpaceTheme.mutedOrbit, fontWeight: "600", fontSize: 14 },
  shareButton: {
    backgroundColor: SpaceTheme.glowCyan,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  chatButton: {
    backgroundColor: "#8B5CF6",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  ticketsButton: {
    backgroundColor: SpaceTheme.glowCyan,
    padding: 18,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: SpaceTheme.glowCyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  ticketsButtonText: { color: SpaceTheme.backgroundVoid, fontWeight: "800", fontSize: 18 },
  calendarButton: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  calendarButtonText: { color: SpaceTheme.starWhite, fontWeight: "600", fontSize: 14 },
  bookButton: {
    backgroundColor: "#4ADE80",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  unbookButton: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  // White, not the dark `buttonText` — this button sits on a dark glass
  // background, so the previous void-colored label was near-invisible.
  unbookButtonText: { color: SpaceTheme.starWhite, fontWeight: "700", fontSize: 15 },
  cancelSpaceButton: {
    alignItems: "center",
    padding: 14,
    marginTop: 12,
  },
  cancelSpaceButtonText: { color: SpaceTheme.danger, fontWeight: "600", fontSize: 14 },
  cancelledBanner: {
    flexDirection: "row",
    justifyContent: "center",
    backgroundColor: "rgba(255, 59, 92, 0.12)",
    borderWidth: 1,
    borderColor: SpaceTheme.supernovaPink,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    alignItems: "center",
    gap: 6,
  },
  cancelledBannerText: { color: SpaceTheme.supernovaPink, fontWeight: "700", fontSize: 14 },
  leaveSpaceButton: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  leaveSpaceButtonText: { color: SpaceTheme.mutedOrbit, fontWeight: "600", fontSize: 14 },
  buttonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", fontSize: 16 },
  rentalReservationButton: {
    backgroundColor: SpaceTheme.glowCyan,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 12,
  },
  rentalReservationButtonText: {
    color: SpaceTheme.backgroundVoid,
    fontWeight: "700",
    fontSize: 15,
  },
  rentalSecuredBadge: {
    alignSelf: "center",
    marginTop: 10,
  },
  rentalSecuredBadgeText: { color: "#4ADE80", fontWeight: "700", fontSize: 13 },
  tentativeBanner: {
    backgroundColor: "rgba(244, 114, 182, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(244, 114, 182, 0.3)",
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  tentativeBannerText: {
    color: SpaceTheme.supernovaPink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  addBookingLinkButton: {
    marginTop: 10,
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  addBookingLinkButtonText: { color: SpaceTheme.glowCyan, fontWeight: "700", fontSize: 14 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.85)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: SpaceTheme.deepSpace,
    padding: 24,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: SpaceTheme.starWhite, marginBottom: 4 },
  modalSubtitle: { fontSize: 13, color: SpaceTheme.mutedOrbit, marginBottom: 20, lineHeight: 18 },
  modalInput: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    marginBottom: 16,
    color: SpaceTheme.starWhite,
  },
  modalCancelButton: { alignItems: "center", padding: 12 },
  modalCancelButtonText: { color: SpaceTheme.mutedOrbit, fontSize: 15 },
});
