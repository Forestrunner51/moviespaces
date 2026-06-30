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

interface Member {
  id: string;
  name: string;
  confirmed: boolean;
}
interface Group {
  id: string;
  hostName: string;
  cinemaId: number;
  cinemaName: string;
  filmId: number;
  filmName: string;
  showTime: string;
  showDate: string;
  bookingUrl: string;
  status: string;
  members: Member[];
}

export default function GroupScreen() {
  const { groupId, hostName } = useLocalSearchParams<{
    groupId: string;
    hostName: string;
  }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);

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
      message: `Join my movie group! Open this link: ${process.env.EXPO_PUBLIC_API_URL}/join/${groupId}`,
    });
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
  if (loading) return <ActivityIndicator size="large" style={{ flex: 1 }} />;

  // 2. Missing Group Guard
  if (!group) {
    return (
      <View style={styles.center}>
        <Text>Group not found</Text>
      </View>
    );
  }

  // 3. Safe Calculations
  const groupMembers = group.members ?? [];
  const allConfirmed =
    groupMembers.length > 0 && groupMembers.every((m) => m.confirmed);
  const isHost = hostName === group.hostName;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{group.filmName}</Text>
      <Text style={styles.subtitle}>
        {group.cinemaName} • {group.showTime}
      </Text>

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

      <TouchableOpacity style={styles.shareButton} onPress={shareLink}>
        <Text style={styles.buttonText}>📤 Invite Friends</Text>
      </TouchableOpacity>

      {isHost && (
        <TouchableOpacity
          style={styles.bookButton} // Always styled brightly now
          onPress={handleBook} // Always clickable
        >
          <Text style={styles.buttonText}>
            {allConfirmed
              ? "🎟 Book Now"
              : `Waiting for ${groupMembers.filter((m) => !m.confirmed).length} confirmation(s)`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 16,
    paddingTop: 60,
  },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 22, fontWeight: "bold", color: "#333" },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 24 },
  section: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  memberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  memberName: { fontSize: 16, color: "#333" },
  confirmed: { color: "#34C759", fontWeight: "600" },
  pending: { color: "#FF9500", fontWeight: "600" },
  shareButton: {
    backgroundColor: "#007AFF",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  bookButton: {
    backgroundColor: "#34C759",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  disabled: { backgroundColor: "#ccc" },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
