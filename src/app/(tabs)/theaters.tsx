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
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text>Finding nearby theaters...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  // 3. Render the raw list array down into visible screen elements
  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Theaters Showing Nearby</Text>
      <FlatList
        data={cinemas}
        keyExtractor={(item) => item.cinema_id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
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
            <Text style={styles.cinemaName}>{item.cinema_name}</Text>
            <Text style={styles.cinemaDetails}>
              {item.address}, {item.city}
            </Text>
          </TouchableOpacity>
        )}
      />
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
  headerTitle: { fontSize: 22, fontWeight: "bold", marginBottom: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    backgroundColor: "#ffffff",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cinemaName: { fontSize: 18, fontWeight: "bold", color: "#333" },
  cinemaDetails: { fontSize: 14, color: "#666", marginTop: 4 },
  errorText: { color: "red", fontSize: 16 },
});
