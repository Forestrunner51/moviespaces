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
import { supabase } from "@/frontend/config/supabase";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { buildTicketUrl } from "@/frontend/services/ticket-links";
import { activityLabel, activityEmoji } from "@/frontend/constants/activities";

interface Member {
  id: string;
  name: string;
  confirmed: boolean;
  userId: string;
}
interface Group {
  id: string;
  userId: string;
  hostName: string;
  cinemaId: number | null;
  cinemaName: string;
  filmId: number | null;
  filmName: string;
  showTime: string;
  showDate: string;
  bookingUrl: string;
  status: string;
  spaceType: "public_gathering" | "private_rental";
  totalCostCents: number | null;
  maxCapacity: number;
  postActivities: string | null;
  hangoutNotes: string | null;
  showtimeReportCount: number;
  seasonEpisodeInfo: string | null;
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

  // Fixed: Guarded share handler inside the component scope
  const shareLink = async () => {
    if (!groupId) {
      console.warn("Cannot share yet: groupId is undefined.");
      return;
    }

    await Share.share({
      // 👇 CHANGE "/join/" TO "/space/" IN THIS TEMPLATE STRING
      message: `Join my movie group! Open this link: ${process.env.EXPO_PUBLIC_API_URL}/space/${groupId}`,
    });
  };

  const handleGetTickets = async () => {
    if (!group) return;
    await WebBrowser.openBrowserAsync(buildTicketUrl(group.filmName, group.bookingUrl));
  };

  const [confirming, setConfirming] = useState(false);

  const handleConfirmAttendance = async (memberId: string) => {
    setConfirming(true);
    await authFetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/confirm/${memberId}`,
      { method: "POST" },
    );
    await fetchGroup();
    setConfirming(false);
  };

  const handleCancelAttendance = async (memberId: string) => {
    setConfirming(true);
    await authFetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/unconfirm/${memberId}`,
      { method: "POST" },
    );
    await fetchGroup();
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
            await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/report-showtime`, {
              method: "POST",
            });
            await fetchGroup();
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
    await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/booking-url`, {
      method: "POST",
      body: JSON.stringify({ bookingUrl: bookingUrlInput.trim() }),
    });
    await fetchGroup();
    setSavingBookingUrl(false);
    setBookingUrlModalVisible(false);
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
            await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}`, {
              method: "DELETE",
            });
            router.replace("/(tabs)/spaces");
          },
        },
      ],
    );
  };

  const handleCancelSpace = () => {
    const otherMembers = (group?.members ?? []).filter((m) => m.userId !== group?.userId);
    Alert.alert(
      "Cancel this Space?",
      "You can hand ownership to another member instead, or delete the Space entirely.",
      [
        { text: "Nevermind", style: "cancel" },
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

  const handleTransferOwnership = async (member: Member) => {
    setTransferring(true);
    await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/transfer-ownership`, {
      method: "POST",
      body: JSON.stringify({ newHostUserId: member.userId }),
    });
    await fetchGroup();
    setTransferring(false);
    setTransferModalVisible(false);
  };

  const handleBook = async () => {
    if (!group) return;

    // Mark group as booked
    await authFetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/book`,
      {
        method: "POST",
      },
    );

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
            await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/unbook`, {
              method: "POST",
            });
            await fetchGroup();
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

  return (
    <Starfield>
      <ScrollView style={styles.container} contentContainerStyle={styles.containerContent}>
        {group.seasonEpisodeInfo && (
          <View style={styles.tvBadge}>
            <Text style={styles.tvBadgeText}>
              📺 Live TV Watch Party • {group.seasonEpisodeInfo}
            </Text>
          </View>
        )}
        <Text style={[styles.title, SpaceStyles.glowText]}>{group.filmName}</Text>
        <Text style={styles.subtitle}>
          {group.cinemaName} • {group.showTime}
        </Text>

        <View style={styles.manualRow}>
          <Text style={styles.manualBadge}>👤 Showtime scheduled manually by host</Text>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleReportShowtime}
            disabled={reporting}
            hitSlop={8}
          >
            <Text style={styles.reportLink}>🚩 Report</Text>
          </TouchableOpacity>
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
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.rentalReservationButton}
                  onPress={() => WebBrowser.openBrowserAsync(group.bookingUrl)}
                >
                  <Text style={styles.rentalReservationButtonText}>
                    🔗 View Event / Venue Link
                  </Text>
                </TouchableOpacity>
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
                {isHost && (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.addBookingLinkButton}
                    onPress={openBookingUrlModal}
                  >
                    <Text style={styles.addBookingLinkButtonText}>
                      ✏️ Add Venue / Event Link
                    </Text>
                  </TouchableOpacity>
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
            renderItem={({ item }) => (
              <View style={styles.memberRow}>
                <Text style={styles.memberName}>{item.name}</Text>
                <Text style={item.confirmed ? styles.confirmed : styles.pending}>
                  {item.confirmed ? "✓ In" : "Pending"}
                </Text>
              </View>
            )}
          />
        </View>

        {!isHost && !isMember && (
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.joinButton}
            onPress={() => router.push({ pathname: "/join", params: { groupId: group.id } })}
          >
            <Text style={styles.buttonText}>🙋 Join This Space</Text>
          </TouchableOpacity>
        )}

        {isMember && myMember && (
          myMember.confirmed ? (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.confirmedButton}
              onPress={() => handleCancelAttendance(myMember.id)}
              disabled={confirming}
            >
              <Text style={styles.confirmedButtonText}>
                {confirming ? "..." : "✓ You're Confirmed — Tap to Cancel"}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.confirmButton}
              onPress={() => handleConfirmAttendance(myMember.id)}
              disabled={confirming}
            >
              <Text style={styles.buttonText}>
                {confirming ? "..." : "✓ Confirm You're Going"}
              </Text>
            </TouchableOpacity>
          )
        )}

        <TouchableOpacity activeOpacity={0.8} style={styles.shareButton} onPress={shareLink}>
          <Text style={styles.buttonText}>📤 Invite Friends</Text>
        </TouchableOpacity>

        {(isHost || isMember) && (
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.chatButton}
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
          >
            <Text style={styles.buttonText}>💬 Group Chat</Text>
          </TouchableOpacity>
        )}

        {(isHost || isMember) && group.spaceType === "public_gathering" && (
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.ticketsButton}
            onPress={handleGetTickets}
          >
            <Text style={styles.ticketsButtonText}>🎟 Get Tickets</Text>
          </TouchableOpacity>
        )}

        {isHost && group.status !== "booked" && (
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.bookButton}
            onPress={handleBook}
          >
            <Text style={styles.buttonText}>
              {allConfirmed
                ? "✓ Mark Group Booked"
                : `Waiting for ${groupMembers.filter((m) => !m.confirmed).length} confirmation(s)`}
            </Text>
          </TouchableOpacity>
        )}

        {isHost && group.status === "booked" && (
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.unbookButton}
            onPress={handleUnbook}
            disabled={unbooking}
          >
            <Text style={styles.buttonText}>
              {unbooking ? "..." : "↩️ Unbook (Revert to Pending)"}
            </Text>
          </TouchableOpacity>
        )}

        {isHost && (
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.cancelSpaceButton}
            onPress={handleCancelSpace}
            disabled={deleting}
          >
            <Text style={styles.cancelSpaceButtonText}>
              {deleting ? "Deleting..." : "⚠️ Cancel this Space"}
            </Text>
          </TouchableOpacity>
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
              They'll become the new host — you'll stay on as a regular member.
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
              Paste the reservation, invite, or chip-in link once the venue's locked in — this
              lets everyone know it's confirmed.
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
  title: { fontSize: 22, fontWeight: "bold", color: SpaceTheme.starWhite },
  subtitle: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginBottom: 12 },
  tvBadge: {
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
  reportLink: { fontSize: 12, color: SpaceTheme.supernovaPink, fontWeight: "700" },
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
  rentalCostText: { color: SpaceTheme.starWhite, fontSize: 20, fontWeight: "700" },
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
  cancelSpaceButton: {
    alignItems: "center",
    padding: 14,
    marginTop: 12,
  },
  cancelSpaceButtonText: { color: SpaceTheme.supernovaPink, fontWeight: "600", fontSize: 14 },
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
