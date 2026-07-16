import { useState, useEffect } from "react";
import { authFetch } from "@/frontend/services/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Modal,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";

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
  const { cinemaId, cinemaName } = useLocalSearchParams<{
    cinemaId: string;
    cinemaName: string;
  }>();
  const [films, setFilms] = useState<Film[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedFilm, setSelectedFilm] = useState<Film | null>(null);
  const [selectedTime, setSelectedTime] = useState("");
  const [hostName, setHostName] = useState("");
  const [creating, setCreating] = useState(false);

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

  // Pre-fill hostName from the cached name saved at signup/login, so users
  // don't have to retype it every time they create a space.
  useEffect(() => {
    AsyncStorage.getItem("userName").then((savedName) => {
      if (savedName) setHostName(savedName);
    });
  }, []);

  const openCreateGroup = (film: Film, time: string) => {
    setSelectedFilm(film);
    setSelectedTime(time);
    setModalVisible(true);
  };

  const handleCreateGroup = async () => {
    if (!hostName.trim() || !selectedFilm) return;
    setCreating(true);

    // Keep the cache fresh in case the user edited the pre-filled name here
    // (e.g. typo fix, nickname) — future spaces should use the latest value.
    await AsyncStorage.setItem("userName", hostName.trim());

    const res = await authFetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/group`,
      {
        method: "POST",
        body: JSON.stringify({
          hostName,
          cinemaId: parseInt(cinemaId),
          cinemaName,
          filmId: selectedFilm.film_id,
          filmName: selectedFilm.film_name,
          showTime: selectedTime,
          showDate: today,
          bookingUrl: "",
        }),
      },
    );

    const data = await res.json();
    setCreating(false);
    setModalVisible(false);
    router.push({
      pathname: "/group",
      params: { groupId: data.groupId, hostName },
    });
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
                  onPress={() => openCreateGroup(item, t.start_time)}
                >
                  <Text style={styles.timeText}>{t.display_start_time}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      />

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Create a Group</Text>
            <Text style={styles.modalSubtitle}>
              {selectedFilm?.film_name} • {selectedTime}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Your name"
              value={hostName}
              onChangeText={setHostName}
              placeholderTextColor="#888"
            />
            <TouchableOpacity
              style={styles.createButton}
              onPress={handleCreateGroup}
              disabled={creating}
            >
              <Text style={styles.buttonText}>
                {creating ? "Creating..." : "Create Group"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setModalVisible(false)}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#fff",
    padding: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalTitle: { fontSize: 22, fontWeight: "bold", marginBottom: 4 },
  modalSubtitle: { fontSize: 14, color: "#666", marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderColor: "#E5E5E5",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#fafafa",
    marginBottom: 16,
    color: "#000",
  },
  createButton: {
    backgroundColor: "#007AFF",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  cancelButton: { alignItems: "center", padding: 8 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  cancelText: { color: "#666", fontSize: 16 },
});
