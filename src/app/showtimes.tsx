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
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

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

  if (loading) {
    return (
      <Starfield>
        <ActivityIndicator size="large" color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
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

  return (
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.title, SpaceStyles.glowText]}>{cinemaName}</Text>
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
                    activeOpacity={0.8}
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

        <Modal
          visible={modalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setModalVisible(false)}
        >
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View style={styles.modal}>
              <Text style={styles.modalTitle}>Create a Group</Text>
              <Text style={styles.modalSubtitle}>
                {selectedFilm?.film_name} • {selectedTime}
              </Text>
              <ScrollView keyboardShouldPersistTaps="handled">
                <TextInput
                  style={styles.input}
                  placeholder="Your name"
                  value={hostName}
                  onChangeText={setHostName}
                  placeholderTextColor={SpaceTheme.mutedOrbit}
                />
                <TouchableOpacity
                  activeOpacity={0.8}
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
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
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
  title: { fontSize: 22, fontWeight: "bold", color: SpaceTheme.starWhite, marginBottom: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  errorText: { color: SpaceTheme.supernovaPink, fontSize: 16 },
  card: {
    ...SpaceStyles.glassCard,
    padding: 16,
    marginBottom: 12,
  },
  filmName: { fontSize: 18, fontWeight: "bold", color: SpaceTheme.starWhite },
  duration: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginTop: 4, marginBottom: 8 },
  times: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeButton: {
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.4)",
    padding: 8,
    borderRadius: 8,
  },
  timeText: { color: SpaceTheme.glowCyan, fontWeight: "600" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.85)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: SpaceTheme.deepSpace,
    padding: 24,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    maxHeight: "85%",
  },
  modalTitle: { fontSize: 22, fontWeight: "bold", color: SpaceTheme.starWhite, marginBottom: 4 },
  modalSubtitle: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    marginBottom: 16,
    color: SpaceTheme.starWhite,
  },
  createButton: {
    backgroundColor: SpaceTheme.glowCyan,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  cancelButton: { alignItems: "center", padding: 8 },
  buttonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", fontSize: 16 },
  cancelText: { color: SpaceTheme.mutedOrbit, fontSize: 16 },
});
