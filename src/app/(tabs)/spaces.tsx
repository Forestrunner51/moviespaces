import { useState, useCallback } from "react";
import { authFetch } from "@/frontend/services/api";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { router, useFocusEffect } from "expo-router";

interface Space {
  id: string;
  filmName: string;
  cinemaName: string;
  showTime: string;
  showDate: string;
  status: string;
  members: { id: string; name: string; confirmed: boolean }[];
}

export default function MySpacesScreen() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSpaces = async () => {
    try {
      setLoading(true);
      const res = await authFetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/mine`,
      );
      if (res.ok) {
        const data = await res.json();
        setSpaces(data);
      } else {
        console.error(
          "Failed to pull secure user spaces status code:",
          res.status,
        );
      }
    } catch (err) {
      console.error("Network error trying to fetch spaces:", err);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadSpaces();
    }, []),
  );

  if (loading) return <ActivityIndicator size="large" style={{ flex: 1 }} />;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Spaces</Text>
      <Text style={styles.subtitle}>Your movie groups and memberships</Text>
      <FlatList
        data={spaces}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() =>
              router.push({
                pathname: "/group",
                params: { groupId: item.id },
              })
            }
          >
            <Text style={styles.filmName}>{item.filmName}</Text>
            <Text style={styles.details}>
              {item.cinemaName} • {item.showTime}
            </Text>
            <Text style={styles.date}>{item.showDate}</Text>
            <View style={styles.footer}>
              <Text style={styles.members}>
                {item.members.length} member(s)
              </Text>
              <Text
                style={
                  item.status === "booked" ? styles.booked : styles.pending
                }
              >
                {item.status === "booked" ? "✓ Booked" : "Pending"}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🎬</Text>
            <Text style={styles.emptyTitle}>No spaces yet</Text>
            <Text style={styles.emptySubtitle}>
              Find a movie and create your first space with friends
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => router.push("/(tabs)")}
            >
              <Text style={styles.emptyButtonText}>Find a Movie →</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1A1A1A",
    marginBottom: 4,
  },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 16 },
  card: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  filmName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 4,
  },
  details: { fontSize: 14, color: "#666", marginBottom: 2 },
  date: { fontSize: 12, color: "#999", marginBottom: 8 },
  footer: { flexDirection: "row", justifyContent: "space-between" },
  members: { fontSize: 13, color: "#007AFF" },
  booked: { fontSize: 13, color: "#34C759", fontWeight: "600" },
  pending: { fontSize: 13, color: "#FF9500", fontWeight: "600" },
  emptyState: {
    alignItems: "center",
    marginTop: 60,
    paddingHorizontal: 24,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#888",
    textAlign: "center",
    marginBottom: 20,
  },
  emptyButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  emptyButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
