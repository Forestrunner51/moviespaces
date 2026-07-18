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
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

interface Space {
  id: string;
  hostName: string;
  cinemaId: number;
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
  const [slotModalVisible, setSlotModalVisible] = useState(false);
  const [selectedCinema, setSelectedCinema] = useState<Cinema | null>(null);
  const [selectedTime, setSelectedTime] = useState("");
  const [hostName, setHostName] = useState("");
  const [creating, setCreating] = useState(false);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    const base = process.env.EXPO_PUBLIC_API_URL;
    Promise.all([
      fetch(`${base}/api/group/search?filmId=${filmId}`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`${base}/api/movieglu/filmshowtimes?filmId=${filmId}&date=${today}`)
        .then((r) => (r.ok ? r.json() : { cinemas: [] }))
        .catch(() => ({ cinemas: [] })),
    ])
      .then(([spacesData, showtimesData]) => {
        setSpaces(Array.isArray(spacesData) ? spacesData : []);
        setCinemas(Array.isArray(showtimesData?.cinemas) ? showtimesData.cinemas : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Pre-fill hostName from the cached name saved at signup/login, so users
  // don't have to retype it every time they create a space (matches the same
  // prefill already done in showtimes.tsx).
  useEffect(() => {
    AsyncStorage.getItem("userName").then((savedName) => {
      if (savedName) setHostName(savedName);
    });
  }, []);

  const freeSpacesForSlot = (cinema: Cinema, time: string) =>
    spaces.filter((s) => s.cinemaId === cinema.cinema_id && s.showTime === time);

  const openSlot = (cinema: Cinema, time: string) => {
    setSelectedCinema(cinema);
    setSelectedTime(time);
    setSlotModalVisible(true);
  };

  const openCreateModal = () => {
    setSlotModalVisible(false);
    setModalVisible(true);
  };

  const handleCreateFreeSpace = async () => {
    if (!hostName.trim() || !selectedCinema) return;
    setCreating(true);

    // Keep the cache fresh in case the user edited the pre-filled name here.
    await AsyncStorage.setItem("userName", hostName.trim());

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

  if (loading) {
    return (
      <Starfield>
        <ActivityIndicator size="large" color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
      </Starfield>
    );
  }

  return (
    <Starfield>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={[styles.title, SpaceStyles.glowText]}>{filmName}</Text>

        {spaces.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="planet-outline" size={16} color={SpaceTheme.glowCyan} />
              <Text style={styles.sectionTitle}>Open Spaces ({spaces.length})</Text>
            </View>
            {spaces.map((space) => (
              <TouchableOpacity
                key={space.id}
                activeOpacity={0.8}
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

        <View style={styles.sectionHeader}>
          <Ionicons name="film-outline" size={16} color={SpaceTheme.starWhite} />
          <Text style={styles.sectionTitle}>Showtimes</Text>
        </View>
        {cinemas.length === 0 && (
          <View style={styles.notInTheatersCard}>
            <Ionicons name="time-outline" size={22} color={SpaceTheme.mutedOrbit} />
            <Text style={styles.notInTheatersText}>
              Not currently playing in theaters — no showtimes to start a Space around yet.
            </Text>
          </View>
        )}
        <FlatList
          data={cinemas}
          scrollEnabled={false}
          keyExtractor={(item) => item.cinema_id.toString()}
          renderItem={({ item }) => (
            <View style={styles.cinemaCard}>
              <Text style={styles.cinemaName}>{item.cinema_name}</Text>
              <Text style={styles.cinemaAddress}>{item.address}</Text>
              <View style={styles.times}>
                {item.showings.Standard.times.slice(0, 6).map((t) => {
                  const count = freeSpacesForSlot(item, t.start_time).length;
                  return (
                    <TouchableOpacity
                      key={t.start_time}
                      activeOpacity={0.8}
                      style={styles.timeButton}
                      onPress={() => openSlot(item, t.start_time)}
                    >
                      <Text style={styles.timeText}>{t.start_time}</Text>
                      {count > 0 && (
                        <View style={styles.timeCountBadge}>
                          <Text style={styles.timeCountBadgeText}>{count}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        />

        <Modal
          visible={slotModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setSlotModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modal}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{selectedTime}</Text>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.closeButton}
                  onPress={() => setSlotModalVisible(false)}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.modalSubtitle}>
                {filmName} at {selectedCinema?.cinema_name}
              </Text>

              <ScrollView keyboardShouldPersistTaps="handled">
                {selectedCinema &&
                  freeSpacesForSlot(selectedCinema, selectedTime).map((space) => (
                    <TouchableOpacity
                      key={space.id}
                      activeOpacity={0.8}
                      style={styles.spaceCard}
                      onPress={() => {
                        setSlotModalVisible(false);
                        router.push({
                          pathname: "/group",
                          params: { groupId: space.id, hostName: "" },
                        });
                      }}
                    >
                      <Text style={styles.spaceHost}>Hosted by {space.hostName}</Text>
                      <Text style={styles.spaceMembers}>
                        {space.members.length} member(s)
                      </Text>
                    </TouchableOpacity>
                  ))}

                {selectedCinema && freeSpacesForSlot(selectedCinema, selectedTime).length === 0 && (
                  <Text style={styles.emptySlotText}>
                    No spaces yet for this showtime — be the first to start one.
                  </Text>
                )}

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.createButton}
                  onPress={openCreateModal}
                >
                  <Text style={styles.buttonText}>Create a Space</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>

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
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Create a Space</Text>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.closeButton}
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.modalSubtitle}>
                {filmName} • {selectedTime} at {selectedCinema?.cinema_name}
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
                  onPress={handleCreateFreeSpace}
                  disabled={creating}
                >
                  <Text style={styles.buttonText}>
                    {creating ? "Creating..." : "Create Space"}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </ScrollView>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: SpaceTheme.starWhite,
    marginBottom: 16,
  },
  section: { marginBottom: 16 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
  },
  spaceCard: {
    ...SpaceStyles.glassCard,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: SpaceTheme.glowCyan,
  },
  spaceHost: { fontSize: 14, fontWeight: "600", color: SpaceTheme.starWhite },
  spaceDetails: { fontSize: 13, color: SpaceTheme.mutedOrbit, marginTop: 2 },
  spaceMembers: { fontSize: 12, color: SpaceTheme.glowCyan, marginTop: 4 },
  cinemaCard: {
    ...SpaceStyles.glassCard,
    padding: 16,
    marginBottom: 12,
  },
  notInTheatersCard: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    gap: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: "flex-start",
  },
  notInTheatersText: { flex: 1, color: SpaceTheme.mutedOrbit, fontSize: 13, lineHeight: 19 },
  cinemaName: { fontSize: 16, fontWeight: "700", color: SpaceTheme.starWhite },
  cinemaAddress: { fontSize: 13, color: SpaceTheme.mutedOrbit, marginBottom: 8 },
  times: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.4)",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  timeText: { color: SpaceTheme.glowCyan, fontWeight: "600", fontSize: 13 },
  timeCountBadge: {
    backgroundColor: SpaceTheme.supernovaPink,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  timeCountBadgeText: { color: SpaceTheme.backgroundVoid, fontSize: 11, fontWeight: "700" },
  emptySlotText: {
    color: SpaceTheme.mutedOrbit,
    fontSize: 14,
    textAlign: "center",
    marginVertical: 16,
  },
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
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonText: { fontSize: 16, color: SpaceTheme.starWhite, fontWeight: "600" },
  modalTitle: { fontSize: 22, fontWeight: "bold", color: SpaceTheme.starWhite },
  modalSubtitle: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginBottom: 24, marginTop: 4 },
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
  buttonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", fontSize: 16 },
});
