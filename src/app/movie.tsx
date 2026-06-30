import { useState, useEffect } from "react";
import { authFetch } from "@/frontend/services/api";
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

interface Space {
  id: string;
  hostName: string;
  cinemaName: string;
  showTime: string;
  showDate: string;
  members: { id: string; name: string; confirmed: boolean }[];
}

interface Cinema {
  cinema_id: number;
  cinema_name: string;
  address: string;
  showings: {
    Standard: {
      times: { start_time: string; end_time: string }[];
    };
  };
}

export default function MovieScreen() {
  const { filmId, filmName } = useLocalSearchParams<{
    filmId: string;
    filmName: string;
  }>();

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [cinemas, setCinemas] = useState<Cinema[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedCinema, setSelectedCinema] = useState<Cinema | null>(null);
  const [selectedTime, setSelectedTime] = useState("");
  const [hostName, setHostName] = useState("");
  const [creating, setCreating] = useState(false);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    const base = process.env.EXPO_PUBLIC_API_URL;
    Promise.all([
      fetch(`${base}/api/group/search?filmId=${filmId}`).then((r) => r.json()),
      fetch(
        `${base}/api/movieglu/filmshowtimes?filmId=${filmId}&date=${today}`,
      ).then((r) => r.json()),
    ])
      .then(([spacesData, showtimesData]) => {
        setSpaces(spacesData);
        setCinemas(showtimesData.cinemas || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const openCreateGroup = (cinema: Cinema, time: string) => {
    setSelectedCinema(cinema);
    setSelectedTime(time);
    setModalVisible(true);
  };

  const handleCreateSpace = async () => {
    if (!hostName.trim() || !selectedCinema) return;
    setCreating(true);

    const res = await authFetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/group`,
      {
        method: "POST",
        body: JSON.stringify({
          hostName,
          cinemaId: selectedCinema.cinema_id,
          cinemaName: selectedCinema.cinema_name,
          filmId: parseInt(filmId),
          filmName,
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{filmName}</Text>

      {spaces.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Open Spaces ({spaces.length})</Text>
          {spaces.map((space) => (
            <TouchableOpacity
              key={space.id}
              style={styles.spaceCard}
              onPress={() =>
                router.push({
                  pathname: "/group",
                  params: { groupId: space.id, hostName: "" },
                })
              }
            >
              <Text style={styles.spaceHost}>Hosted by {space.hostName}</Text>
              <Text style={styles.spaceDetails}>
                {space.cinemaName} • {space.showTime}
              </Text>
              <Text style={styles.spaceMembers}>
                {space.members.length} member(s)
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>Showtimes</Text>
      <FlatList
        data={cinemas}
        keyExtractor={(item) => item.cinema_id.toString()}
        renderItem={({ item }) => (
          <View style={styles.cinemaCard}>
            <Text style={styles.cinemaName}>{item.cinema_name}</Text>
            <Text style={styles.cinemaAddress}>{item.address}</Text>
            <View style={styles.times}>
              {item.showings.Standard.times.slice(0, 6).map((t) => (
                <TouchableOpacity
                  key={t.start_time}
                  style={styles.timeButton}
                  onPress={() => openCreateGroup(item, t.start_time)}
                >
                  <Text style={styles.timeText}>{t.start_time}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      />

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Create a Space</Text>
            <Text style={styles.modalSubtitle}>
              {filmName} • {selectedTime} at {selectedCinema?.cinema_name}
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
              onPress={handleCreateSpace}
              disabled={creating}
            >
              <Text style={styles.buttonText}>
                {creating ? "Creating..." : "Create Space"}
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
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1A1A1A",
    marginBottom: 16,
  },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 12,
  },
  spaceCard: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#007AFF",
  },
  spaceHost: { fontSize: 14, fontWeight: "600", color: "#333" },
  spaceDetails: { fontSize: 13, color: "#666", marginTop: 2 },
  spaceMembers: { fontSize: 12, color: "#007AFF", marginTop: 4 },
  cinemaCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  cinemaName: { fontSize: 16, fontWeight: "700", color: "#333" },
  cinemaAddress: { fontSize: 13, color: "#666", marginBottom: 8 },
  times: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeButton: { backgroundColor: "#007AFF", padding: 8, borderRadius: 6 },
  timeText: { color: "#fff", fontWeight: "600", fontSize: 13 },
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
