import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/frontend/services/api";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  Alert,
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
      `Your group is booked for ${group.filmName} at ${group.showTime} on ${group.showDate}.\n\nHead to ${group.cinemaName} to purchase tickets!`,
      [{ text: "OK" }],
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
  const isHost = hostName === group.hostName;
  const isMember =
    !!currentUserId && groupMembers.some((m) => m.userId === currentUserId);
  const myMember = groupMembers.find((m) => m.userId === currentUserId);

  return (
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.title, SpaceStyles.glowText]}>{group.filmName}</Text>
        <Text style={styles.subtitle}>
          {group.cinemaName} • {group.showTime}
        </Text>

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
              <Text style={styles.rentalBadge}>PRIVATE RENTAL</Text>
            </View>
            {group.totalCostCents != null && (
              <>
                <Text style={styles.rentalCostText}>
                  ${(group.totalCostCents / 100).toFixed(2)} total
                </Text>
                <Text style={styles.rentalPerPersonText}>
                  ${(group.totalCostCents / 100 / Math.max(groupMembers.length, 1)).toFixed(2)}{" "}
                  per person ({groupMembers.length} going)
                </Text>
              </>
            )}
            <Text style={styles.rentalCapacityText}>
              {groupMembers.length} / {group.maxCapacity} spots filled
            </Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Group Members ({groupMembers.length})
          </Text>
          <FlatList
            data={groupMembers}
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
                params: { id: group.id, type: "group", title: group.filmName },
              })
            }
          >
            <Text style={styles.buttonText}>💬 Group Chat</Text>
          </TouchableOpacity>
        )}

        {(isHost || isMember) && (
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.ticketsButton}
            onPress={handleGetTickets}
          >
            <Text style={styles.ticketsButtonText}>🎟 Get Tickets</Text>
          </TouchableOpacity>
        )}

        {isHost && (
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
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingTop: 60,
  },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  notFoundText: { color: SpaceTheme.mutedOrbit, fontSize: 16 },
  title: { fontSize: 22, fontWeight: "bold", color: SpaceTheme.starWhite },
  subtitle: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginBottom: 12 },
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
  buttonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", fontSize: 16 },
});
