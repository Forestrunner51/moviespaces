import { useState, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";

interface Showtime {
  start_time: string;
  display_start_time: string;
}

interface Film {
  film_id: number;
  film_name: string;
  duration_hrs_mins: string;
  showings: { Standard: { times: Showtime[] } };
}

export default function ShowtimesScreen() {
  const { cinemaId, cinemaName } = useLocalSearchParams();
  const [films, setFilms] = useState<Film[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    const url = `${process.env.EXPO_PUBLIC_API_URL}/api/movieglu/showtimes?cinemaId=${cinemaId}&date=${today}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setFilms(data.films || []);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load showtimes.");
        setLoading(false);
      });
  }, []);

  const handleBook = async (filmId: number, time: string) => {
    const url = `${process.env.EXPO_PUBLIC_API_URL}/api/movieglu/booking?cinemaId=${cinemaId}&filmId=${filmId}&time=${time}&date=${today}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.booking_url) {
      await WebBrowser.openBrowserAsync(data.booking_url);
    }
  };

  if (loading) return <ActivityIndicator size="large" style={{ flex: 1 }} />;
  if (error)
    return (
      <View style={styles.center}>
        <Text>{error}</Text>
      </View>
    );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{cinemaName}</Text>
      <FlatList
        data={films}
        keyExtractor={(item) => item.film_id.toString()}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.filmName}>{item.film_name}</Text>
            <Text style={styles.duration}>{item.duration_hrs_mins}</Text>
            <View style={styles.times}>
              {item.showings.Standard.times.map((t) => (
                <TouchableOpacity
                  key={t.start_time}
                  style={styles.timeButton}
                  onPress={() => handleBook(item.film_id, t.start_time)}
                >
                  <Text style={styles.timeText}>{t.display_start_time}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
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
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  filmName: { fontSize: 18, fontWeight: "bold", color: "#333" },
  duration: { fontSize: 14, color: "#666", marginTop: 4, marginBottom: 8 },
  times: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeButton: { backgroundColor: "#007AFF", padding: 8, borderRadius: 6 },
  timeText: { color: "#fff", fontWeight: "600" },
});
