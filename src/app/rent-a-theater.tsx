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
import {
  getDeviceLocation,
  fetchNearbyTheaters,
  NearbyTheater,
} from "@/frontend/services/nearby-theaters";

export default function RentATheaterScreen() {
  const [theaters, setTheaters] = useState<NearbyTheater[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationDenied, setLocationDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDeviceLocation()
      .then((coords) => {
        if (!coords) {
          setLocationDenied(true);
          return [];
        }
        return fetchNearbyTheaters(coords);
      })
      .then(setTheaters)
      .catch((err) => {
        console.error("Failed to load nearby theaters:", err);
        setTheaters([]);
        setError(err.message || "Couldn't load nearby theaters.");
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
            data={theaters}
            keyExtractor={(item) => item.placeId}
            renderItem={({ item }) => (
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.card}
                onPress={() =>
                  router.push({
                    pathname: "/create-space",
                    params: {
                      theaterName: item.name,
                      theaterPlaceId: item.placeId,
                      theaterLat: item.latitude?.toString() ?? "",
                      theaterLng: item.longitude?.toString() ?? "",
                      spaceType: "private_rental",
                    },
                  })
                }
              >
                <View style={styles.rentCardRow}>
                  <Ionicons name="storefront-outline" size={20} color={SpaceTheme.supernovaPink} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.filmName}>{item.name}</Text>
                    <Text style={styles.details}>{item.address}</Text>
                    <Text style={styles.cta}>Start a Space here →</Text>
                  </View>
                  <TouchableOpacity
                    hitSlop={10}
                    onPress={(e) => {
                      e.stopPropagation();
                      WebBrowser.openBrowserAsync(buildRentalInquiryUrl(item.name));
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
                <Text style={styles.emptyTitle}>
                  {error ? "Couldn't load theaters" : "No nearby theaters found"}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {error
                    ? error
                    : locationDenied
                      ? "Location access was denied — allow it in Settings to see nearby theaters, or create a Space and type the theater name manually."
                      : "Try again later or search directly with your local theater chain."}
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
