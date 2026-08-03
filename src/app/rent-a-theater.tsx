import { useEffect, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles, Palette } from "@/frontend/constants/theme";
import {
  getDeviceLocation,
  fetchNearbyTheaters,
  NearbyTheater,
} from "@/frontend/services/nearby-theaters";
import { getCorporateRentalUrl } from "@/frontend/utils/theater-rentals";
import { cinemaChain } from "@/frontend/constants/theater-memberships";

export default function RentATheaterScreen() {
  const [theaters, setTheaters] = useState<NearbyTheater[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationDenied, setLocationDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Straight into the form — no confirmation alert, and no forced detour out
  // to a third-party site first. Previously this opened the venue's rental
  // page in a browser *before* the user had seen the form at all, so
  // dismissing the browser dropped them on a screen they never asked for.
  // Booking is optional and can happen later (the Space supports a blank
  // venue link precisely so a host can gauge interest first), so the rental
  // page is now an opt-in link on the card instead — see below.
  const handleSelectTheater = (theater: NearbyTheater) => {
    router.push({
      pathname: "/create-space",
      params: {
        theaterName: theater.name,
        theaterPlaceId: theater.placeId,
        theaterLat: theater.latitude?.toString() ?? "",
        theaterLng: theater.longitude?.toString() ?? "",
        spaceType: "private_rental",
      },
    });
  };

  // Only offered for venues we can actually map to a real corporate rental
  // program. getCorporateRentalUrl falls back to a Google search for anything
  // unrecognized, which is noise on a neighborhood bar or community hall —
  // those have no rental page to send someone to.
  const handleViewRentalInfo = (theater: NearbyTheater) => {
    WebBrowser.openBrowserAsync(getCorporateRentalUrl(theater.name));
  };

  useEffect(() => {
    getDeviceLocation()
      .then((coords) => {
        if (!coords) {
          setLocationDenied(true);
          return [];
        }
        // ~25 miles — see create-space.tsx's matching call for why this
        // isn't the old 10mi default.
        return fetchNearbyTheaters(coords, 40233.6);
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
        <Text style={[styles.title, SpaceStyles.glowText, SpaceStyles.wordmark]}>Host a Watch Party</Text>
        <Text style={styles.subtitle}>
          Pick a venue — a theater, bar, community space, or your own place — to start a Space
          with friends. MovieSpaces doesn&apos;t handle the booking itself; use the venue&apos;s own
          confirmation link once you&apos;ve locked it in.
        </Text>

        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.customCard}
          onPress={() =>
            router.push({ pathname: "/create-space", params: { spaceType: "private_rental" } })
          }
        >
          <Ionicons name="location-outline" size={20} color={SpaceTheme.glowCyan} />
          <View style={{ flex: 1 }}>
            <Text style={styles.filmName}>Custom / Private Address</Text>
            <Text style={styles.details}>Backyard, someone&apos;s place, or anywhere not listed</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={SpaceTheme.mutedOrbit} />
        </TouchableOpacity>

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
                onPress={() => handleSelectTheater(item)}
              >
                <View style={styles.rentCardRow}>
                  <Ionicons name="storefront-outline" size={20} color={SpaceTheme.supernovaPink} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.filmName}>{item.name}</Text>
                    <Text style={styles.details}>{item.address}</Text>
                    <Text style={styles.cta}>Start a Space here</Text>
                    {!!cinemaChain(item.name) && (
                      <TouchableOpacity
                        activeOpacity={0.7}
                        hitSlop={8}
                        onPress={(e) => {
                          e.stopPropagation();
                          handleViewRentalInfo(item);
                        }}
                      >
                        <Text style={styles.rentalInfoLink}>View their rental info</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={SpaceTheme.mutedOrbit} />
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="storefront-outline" size={40} color={SpaceTheme.mutedOrbit} />
                <Text style={styles.emptyTitle}>
                  {error ? "Couldn't load venues" : "No nearby venues found"}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {error
                    ? error
                    : locationDenied
                      ? "Location access was denied — allow it in Settings to see nearby venues, or use Custom / Private Address above."
                      : "Try again later, or use Custom / Private Address above."}
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
  customCard: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    marginBottom: 16,
    borderColor: Palette.accentBorder,
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
  rentalInfoLink: { fontSize: 12, color: SpaceTheme.mutedOrbit, marginTop: 6 },
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
