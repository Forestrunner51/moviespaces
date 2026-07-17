import { useState, useCallback } from "react";
import { authFetch } from "@/frontend/services/api";
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { FriendsPanel } from "@/frontend/components/friends-panel";
import {
  getMySpaces,
  getOpenSpaces,
  CrowdfundSpace,
} from "@/frontend/hooks/use-crowdfund-spaces";

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
  const [tab, setTab] = useState<"spaces" | "crowdfund" | "friends">("spaces");
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);

  const [crowdfunds, setCrowdfunds] = useState<CrowdfundSpace[]>([]);
  const [crowdfundsLoading, setCrowdfundsLoading] = useState(true);

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

  const loadCrowdfunds = async () => {
    setCrowdfundsLoading(true);
    try {
      const [mine, open] = await Promise.all([getMySpaces(), getOpenSpaces()]);
      const byId = new Map<string, CrowdfundSpace>();
      [...mine, ...open].forEach((s) => byId.set(s.id, s));
      setCrowdfunds(Array.from(byId.values()));
    } catch (err) {
      console.error("Failed to load crowdfund spaces:", err);
    } finally {
      setCrowdfundsLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadSpaces();
      loadCrowdfunds();
    }, []),
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Spaces</Text>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBarItem, tab === "spaces" && styles.tabBarItemActive]}
          onPress={() => setTab("spaces")}
        >
          <Text
            style={[
              styles.tabBarLabel,
              tab === "spaces" && styles.tabBarLabelActive,
            ]}
          >
            Spaces
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBarItem, tab === "crowdfund" && styles.tabBarItemActive]}
          onPress={() => setTab("crowdfund")}
        >
          <Text
            style={[
              styles.tabBarLabel,
              tab === "crowdfund" && styles.tabBarLabelActive,
            ]}
          >
            Crowdfund
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBarItem, tab === "friends" && styles.tabBarItemActive]}
          onPress={() => setTab("friends")}
        >
          <Text
            style={[
              styles.tabBarLabel,
              tab === "friends" && styles.tabBarLabelActive,
            ]}
          >
            Friends
          </Text>
        </TouchableOpacity>
      </View>

      {tab === "friends" ? (
        <ScrollView keyboardShouldPersistTaps="handled">
          <FriendsPanel />
        </ScrollView>
      ) : tab === "crowdfund" ? (
        <>
          <TouchableOpacity
            style={styles.newCrowdfundButton}
            onPress={() => router.push("/crowdfund/create")}
          >
            <Text style={styles.newCrowdfundButtonText}>+ New Crowdfund</Text>
          </TouchableOpacity>
          {crowdfundsLoading ? (
            <ActivityIndicator size="large" style={{ flex: 1 }} />
          ) : (
            <FlatList
              data={crowdfunds}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.card}
                  onPress={() =>
                    router.push({ pathname: "/crowdfund/[id]", params: { id: item.id } })
                  }
                >
                  <Text style={styles.filmName}>{item.movieTitle}</Text>
                  <Text style={styles.details}>
                    {item.theaterName} • {new Date(item.showtime).toLocaleDateString()}
                  </Text>
                  <View style={styles.footer}>
                    <Text style={styles.members}>
                      ${item.currentAmount.toFixed(0)} / ${item.targetAmount.toFixed(0)}
                    </Text>
                    <Text
                      style={item.status === "successful" ? styles.booked : styles.pending}
                    >
                      {item.status}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyEmoji}>💸</Text>
                  <Text style={styles.emptyTitle}>No crowdfunds yet</Text>
                  <Text style={styles.emptySubtitle}>
                    Start one to pool money toward a private screening
                  </Text>
                </View>
              }
            />
          )}
        </>
      ) : loading ? (
        <ActivityIndicator size="large" style={{ flex: 1 }} />
      ) : (
        <>
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
        </>
      )}
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
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#eee",
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  tabBarItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  tabBarItemActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  tabBarLabel: { fontSize: 14, fontWeight: "600", color: "#888" },
  tabBarLabelActive: { color: "#1A1A1A" },
  newCrowdfundButton: {
    backgroundColor: "#E50914",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 12,
  },
  newCrowdfundButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
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
