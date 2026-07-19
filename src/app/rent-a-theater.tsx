import { useEffect, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { buildRentalInquiryUrl } from "@/frontend/services/ticket-links";

interface Cinema {
  cinema_id: number;
  cinema_name: string;
  address: string;
  city: string;
}

export default function RentATheaterScreen() {
  const [cinemas, setCinemas] = useState<Cinema[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/movieglu/cinemas?lat=-22.0&lng=14.0`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server responded with status: ${res.status}`);
        const data = await res.json();
        setCinemas(data.cinemas || []);
      })
      .catch((err) => {
        console.error("Failed to load nearby theaters:", err);
        setCinemas([]);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.title, SpaceStyles.glowText]}>Rent a Theater</Text>
        <Text style={styles.subtitle}>
          Pick a theater to start a private rental Space with friends. MovieSpaces doesn't
          handle the booking itself — tap the link icon to check a theater's rental info
          directly, or use their site's confirmation link once you've booked.
        </Text>
        {loading ? (
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
                  router.push({
                    pathname: "/create-space",
                    params: { theaterName: item.cinema_name, spaceType: "private_rental" },
                  })
                }
              >
                <View style={styles.rentCardRow}>
                  <Ionicons name="storefront-outline" size={20} color={SpaceTheme.supernovaPink} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.filmName}>{item.cinema_name}</Text>
                    <Text style={styles.details}>
                      {item.address}, {item.city}
                    </Text>
                    <Text style={styles.cta}>Start a Space here →</Text>
                  </View>
                  <TouchableOpacity
                    hitSlop={10}
                    onPress={(e) => {
                      e.stopPropagation();
                      WebBrowser.openBrowserAsync(buildRentalInquiryUrl(item.cinema_name));
                    }}
                  >
                    <Ionicons name="open-outline" size={20} color={SpaceTheme.mutedOrbit} />
                  </TouchableOpacity>
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
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 20,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: SpaceTheme.starWhite,
    marginBottom: 4,
  },
  subtitle: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginBottom: 16 },
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
  cta: { fontSize: 13, color: SpaceTheme.supernovaPink, fontWeight: "600", marginTop: 6 },
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
});
