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
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { FriendsPanel } from "@/frontend/components/friends-panel";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

interface Space {
  id: string;
  filmName: string;
  cinemaName: string;
  showTime: string;
  showDate: string;
  status: string;
  spaceType: string;
  members: { id: string; name: string; confirmed: boolean }[];
}

type Tab = "spaces" | "rent" | "friends";

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "spaces", label: "Spaces", icon: "planet-outline" },
  { key: "rent", label: "Rent a Theater", icon: "storefront-outline" },
  { key: "friends", label: "Friends", icon: "people-outline" },
];

export default function MySpacesScreen() {
  const { tab: initialTab } = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(
    initialTab === "rent" || initialTab === "friends" ? initialTab : "spaces",
  );
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

  const rentalSpaces = spaces.filter((s) => s.spaceType === "private_rental");

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
          loading ? (
            <ActivityIndicator size="large" color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
          ) : (
            <>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.newSpaceButton}
                onPress={() => router.push("/rent-a-theater")}
              >
                <Ionicons name="storefront-outline" size={18} color={SpaceTheme.backgroundVoid} />
                <Text style={styles.newSpaceButtonText}>Find a Theater to Rent</Text>
              </TouchableOpacity>
              <Text style={styles.subtitle}>Private theater rentals you're part of</Text>
              <FlatList
                data={rentalSpaces}
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
                    <Ionicons name="storefront-outline" size={40} color={SpaceTheme.mutedOrbit} />
                    <Text style={styles.emptyTitle}>No theater rentals yet</Text>
                    <Text style={styles.emptySubtitle}>
                      Find a theater and set up a private rental to see it here
                    </Text>
                  </View>
                }
              />
            </>
          )
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
                    onPress={() =>
                      router.push({
                        pathname: "/create-space",
                        params: { spaceType: "public_gathering" },
                      })
                    }
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
