import { useState, useCallback } from "react";
import { authFetch } from "@/frontend/services/api";
import * as WebBrowser from "expo-web-browser";
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
import { Ionicons } from "@expo/vector-icons";
import { FriendsPanel } from "@/frontend/components/friends-panel";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { buildRentalInquiryUrl } from "@/frontend/services/ticket-links";

interface Space {
  id: string;
  filmName: string;
  cinemaName: string;
  showTime: string;
  showDate: string;
  status: string;
  members: { id: string; name: string; confirmed: boolean }[];
}

interface Cinema {
  cinema_id: number;
  cinema_name: string;
  address: string;
  city: string;
}

type Tab = "spaces" | "rent" | "friends";

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "spaces", label: "Spaces", icon: "planet-outline" },
  { key: "rent", label: "Rent a Theater", icon: "storefront-outline" },
  { key: "friends", label: "Friends", icon: "people-outline" },
];

export default function MySpacesScreen() {
  const [tab, setTab] = useState<Tab>("spaces");
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);

  const [cinemas, setCinemas] = useState<Cinema[]>([]);
  const [cinemasLoading, setCinemasLoading] = useState(true);

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

  const loadCinemas = async () => {
    setCinemasLoading(true);
    try {
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/movieglu/cinemas?lat=-22.0&lng=14.0`,
      );
      if (res.ok) {
        const data = await res.json();
        setCinemas(data.cinemas || []);
      }
    } catch (err) {
      console.error("Failed to load nearby theaters:", err);
    } finally {
      setCinemasLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadSpaces();
      loadCinemas();
    }, []),
  );

  return (
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.title, SpaceStyles.glowText]}>My Spaces</Text>

        <View style={styles.tabBar}>
          {TABS.map(({ key, label, icon }) => {
            const active = tab === key;
            return (
              <TouchableOpacity
                key={key}
                activeOpacity={0.8}
                style={[styles.tabBarItem, active && styles.tabBarItemActive]}
                onPress={() => setTab(key)}
              >
                <Ionicons
                  name={icon}
                  size={16}
                  color={active ? SpaceTheme.glowCyan : SpaceTheme.mutedOrbit}
                />
                <Text style={[styles.tabBarLabel, active && styles.tabBarLabelActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {tab === "friends" ? (
          <ScrollView keyboardShouldPersistTaps="handled">
            <FriendsPanel />
          </ScrollView>
        ) : tab === "rent" ? (
          <>
            <Text style={styles.subtitle}>
              MovieSpaces doesn't handle the booking — pick a theater and we'll connect you
              directly so you can arrange your own private rental for whatever movie or
              activity you want.
            </Text>
            {cinemasLoading ? (
              <ActivityIndicator size="large" color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
            ) : (
              <FlatList
                data={cinemas}
                keyExtractor={(item) => item.cinema_id.toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.card}
                    onPress={() =>
                      WebBrowser.openBrowserAsync(buildRentalInquiryUrl(item.cinema_name))
                    }
                  >
                    <View style={styles.rentCardRow}>
                      <Ionicons name="storefront-outline" size={20} color={SpaceTheme.supernovaPink} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.filmName}>{item.cinema_name}</Text>
                        <Text style={styles.details}>
                          {item.address}, {item.city}
                        </Text>
                      </View>
                      <Ionicons name="open-outline" size={18} color={SpaceTheme.mutedOrbit} />
                    </View>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Ionicons name="storefront-outline" size={40} color={SpaceTheme.mutedOrbit} />
                    <Text style={styles.emptyTitle}>No nearby theaters found</Text>
                    <Text style={styles.emptySubtitle}>
                      Try again later or search directly with your local theater chain.
                    </Text>
                  </View>
                }
              />
            )}
          </>
        ) : loading ? (
          <ActivityIndicator size="large" color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
        ) : (
          <>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.newSpaceButton}
              onPress={() => router.push("/create-space")}
            >
              <Ionicons name="add-circle-outline" size={18} color={SpaceTheme.backgroundVoid} />
              <Text style={styles.newSpaceButtonText}>New Space</Text>
            </TouchableOpacity>
            <Text style={styles.subtitle}>Your movie groups and memberships</Text>
            <FlatList
              data={spaces}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  activeOpacity={0.8}
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
                    <Text style={styles.amount}>
                      {item.members.length} member(s)
                    </Text>
                    <Text
                      style={
                        item.status === "booked" ? styles.statusGood : styles.statusPending
                      }
                    >
                      {item.status === "booked" ? "✓ Booked" : "Pending"}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="planet-outline" size={40} color={SpaceTheme.mutedOrbit} />
                  <Text style={styles.emptyTitle}>No spaces yet</Text>
                  <Text style={styles.emptySubtitle}>
                    Find a movie and create your first space with friends
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.8}
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
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: SpaceTheme.starWhite,
    marginBottom: 4,
  },
  subtitle: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginBottom: 16 },
  tabBar: {
    flexDirection: "row",
    ...SpaceStyles.glassCard,
    padding: 4,
    marginTop: 12,
    marginBottom: 16,
  },
  tabBarItem: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBarItemActive: {
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.4)",
  },
  tabBarLabel: { fontSize: 13, fontWeight: "600", color: SpaceTheme.mutedOrbit },
  tabBarLabelActive: { color: SpaceTheme.glowCyan },
  newSpaceButton: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: SpaceTheme.supernovaPink,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  newSpaceButtonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", fontSize: 15 },
  card: {
    ...SpaceStyles.glassCard,
    padding: 16,
    marginBottom: 12,
  },
  rentCardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  filmName: {
    fontSize: 18,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginBottom: 4,
  },
  details: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginBottom: 2 },
  date: { fontSize: 12, color: SpaceTheme.mutedOrbit, marginBottom: 8 },
  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  amount: { fontSize: 13, color: SpaceTheme.glowCyan, fontWeight: "600" },
  statusGood: { fontSize: 13, color: "#4ADE80", fontWeight: "600" },
  statusPending: { fontSize: 13, color: SpaceTheme.supernovaPink, fontWeight: "600" },
  emptyState: {
    alignItems: "center",
    marginTop: 60,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginTop: 12,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: SpaceTheme.mutedOrbit,
    textAlign: "center",
    marginBottom: 20,
  },
  emptyButton: {
    backgroundColor: SpaceTheme.glowCyan,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  emptyButtonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", fontSize: 15 },
});
