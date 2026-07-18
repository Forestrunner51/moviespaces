import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

// Structure matching the inner properties returned by MovieGlu
interface Cinema {
  cinema_id: number;
  cinema_name: string;
  address: string;
  city: string;
}

export default function TheaterListScreen() {
  const [cinemas, setCinemas] = useState<Cinema[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 1. Point to your local .NET proxy backend, using coordinates (e.g., Frisco area)
    const backendUrl = `${process.env.EXPO_PUBLIC_API_URL}/api/movieglu/cinemas?lat=-22.0&lng=14.0`;
    console.log("API URL:", process.env.EXPO_PUBLIC_API_URL);

    fetch(backendUrl)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Server status returned error: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        // 2. MovieGlu wraps nearby theaters inside a root "cinemas" key block
        if (data && data.cinemas) {
          setCinemas(data.cinemas);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed loading local screens:", err);
        setError("Could not pull local theater lists.");
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <Starfield>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={SpaceTheme.glowCyan} />
          <Text style={styles.loadingText}>Finding nearby theaters...</Text>
        </View>
      </Starfield>
    );
  }

  if (error) {
    return (
      <Starfield>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </Starfield>
    );
  }

  // 3. Render the raw list array down into visible screen elements
  return (
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.headerTitle, SpaceStyles.glowText]}>Theaters Showing Nearby</Text>
        <FlatList
          data={cinemas}
          keyExtractor={(item) => item.cinema_id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.card}
              onPress={() =>
                router.push({
                  pathname: "/showtimes",
                  params: {
                    cinemaId: item.cinema_id,
                    cinemaName: item.cinema_name,
                  },
                })
              }
            >
              <Ionicons name="film-outline" size={20} color={SpaceTheme.glowCyan} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cinemaName}>{item.cinema_name}</Text>
                <Text style={styles.cinemaDetails}>
                  {item.address}, {item.city}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
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
  headerTitle: { fontSize: 22, fontWeight: "bold", color: SpaceTheme.starWhite, marginBottom: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { color: SpaceTheme.mutedOrbit, marginTop: 12 },
  card: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    marginBottom: 12,
  },
  cinemaName: { fontSize: 18, fontWeight: "bold", color: SpaceTheme.starWhite },
  cinemaDetails: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginTop: 4 },
  errorText: { color: SpaceTheme.supernovaPink, fontSize: 16 },
});
