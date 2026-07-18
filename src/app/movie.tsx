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
  Alert,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import {
  createSpace,
  getOpenSpaces,
  CrowdfundSpace,
} from "@/frontend/hooks/use-crowdfund-spaces";

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
  const [crowdfunds, setCrowdfunds] = useState<CrowdfundSpace[]>([]);
  const [cinemas, setCinemas] = useState<Cinema[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<"free" | "crowdfund">("free");
  const [slotModalVisible, setSlotModalVisible] = useState(false);
  const [selectedCinema, setSelectedCinema] = useState<Cinema | null>(null);
  const [selectedTime, setSelectedTime] = useState("");
  const [hostName, setHostName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [maxParticipants, setMaxParticipants] = useState("");
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
      getOpenSpaces({ movieId: filmId }),
    ])
      .then(([spacesData, showtimesData, crowdfundData]) => {
        setSpaces(Array.isArray(spacesData) ? spacesData : []);
        setCinemas(Array.isArray(showtimesData?.cinemas) ? showtimesData.cinemas : []);
        setCrowdfunds(Array.isArray(crowdfundData) ? crowdfundData : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const computeShowtimeIso = (time: string) =>
    new Date(`${today}T${time}:00`).toISOString();

  const showtimeIso = () => computeShowtimeIso(selectedTime);

  const freeSpacesForSlot = (cinema: Cinema, time: string) =>
    spaces.filter((s) => s.cinemaId === cinema.cinema_id && s.showTime === time);

  const crowdfundsForSlot = (cinema: Cinema, time: string) => {
    const iso = computeShowtimeIso(time);
    return crowdfunds.filter(
      (cf) => cf.theaterId === cinema.cinema_id.toString() && cf.showtime === iso,
    );
  };

  const openSlot = (cinema: Cinema, time: string) => {
    setSelectedCinema(cinema);
    setSelectedTime(time);
    setSlotModalVisible(true);
  };

  const openCreateModal = (type: "free" | "crowdfund") => {
    setSlotModalVisible(false);
    setModalType(type);
    setModalVisible(true);
  };

  // Free-text date entry is fragile — this rejects anything Date can't parse
  // instead of letting toISOString() throw an uncaught RangeError later.
  const parseDateOrNull = (value: string): Date | null => {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  const handleCreateFreeSpace = async () => {
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

  const handleCreateCrowdfund = async () => {
    if (!selectedCinema || !targetAmount || !deadline) return;

    const parsedDeadline = parseDateOrNull(deadline);
    if (!parsedDeadline) {
      Alert.alert(
        "Invalid deadline",
        "Please enter the deadline as e.g. 2026-07-30T20:00:00.",
      );
      return;
    }
    const amount = parseFloat(targetAmount);
    if (!amount || amount <= 0) {
      Alert.alert("Invalid target amount", "Target amount must be a number greater than zero.");
      return;
    }

    setCreating(true);
    try {
      const spaceId = await createSpace({
        movieId: filmId,
        movieTitle: filmName,
        moviePosterUrl: null,
        theaterId: selectedCinema.cinema_id.toString(),
        theaterName: selectedCinema.cinema_name,
        showtime: showtimeIso(),
        targetAmount: amount,
        deadline: parsedDeadline.toISOString(),
        maxParticipants: maxParticipants ? parseInt(maxParticipants, 10) : null,
      });
      setCreating(false);
      setModalVisible(false);
      router.push({ pathname: "/crowdfund/[id]", params: { id: spaceId } });
    } catch (err: any) {
      setCreating(false);
      Alert.alert("Couldn't start crowdfund", err.message || "Please try again.");
    }
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

      {crowdfunds.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Open Crowdfunds ({crowdfunds.length})</Text>
          {crowdfunds.map((cf) => (
            <TouchableOpacity
              key={cf.id}
              style={styles.crowdfundCard}
              onPress={() =>
                router.push({ pathname: "/crowdfund/[id]", params: { id: cf.id } })
              }
            >
              <Text style={styles.spaceDetails}>
                {cf.theaterName} • {new Date(cf.showtime).toLocaleString()}
              </Text>
              <Text style={styles.crowdfundProgress}>
                ${cf.currentAmount.toFixed(0)} / ${cf.targetAmount.toFixed(0)} pledged
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
              {item.showings.Standard.times.slice(0, 6).map((t) => {
                const count =
                  freeSpacesForSlot(item, t.start_time).length +
                  crowdfundsForSlot(item, t.start_time).length;
                return (
                  <TouchableOpacity
                    key={t.start_time}
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

              {selectedCinema &&
                crowdfundsForSlot(selectedCinema, selectedTime).map((cf) => (
                  <TouchableOpacity
                    key={cf.id}
                    style={styles.crowdfundCard}
                    onPress={() => {
                      setSlotModalVisible(false);
                      router.push({ pathname: "/crowdfund/[id]", params: { id: cf.id } });
                    }}
                  >
                    <Text style={styles.crowdfundProgress}>
                      ${cf.currentAmount.toFixed(0)} / ${cf.targetAmount.toFixed(0)} pledged
                    </Text>
                  </TouchableOpacity>
                ))}

              {selectedCinema &&
                freeSpacesForSlot(selectedCinema, selectedTime).length === 0 &&
                crowdfundsForSlot(selectedCinema, selectedTime).length === 0 && (
                  <Text style={styles.emptySlotText}>
                    No spaces yet for this showtime — be the first to start one.
                  </Text>
                )}

              <TouchableOpacity
                style={styles.createButton}
                onPress={() => openCreateModal("free")}
              >
                <Text style={styles.buttonText}>Create a free Space</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.crowdfundCreateButton}
                onPress={() => openCreateModal("crowdfund")}
              >
                <Text style={styles.buttonText}>Start a Crowdfund</Text>
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
              <Text style={styles.modalTitle}>
                {modalType === "free" ? "Create a Space" : "Start a Crowdfund"}
              </Text>
              <TouchableOpacity
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
            {modalType === "free" ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Your name"
                  value={hostName}
                  onChangeText={setHostName}
                  placeholderTextColor="#888"
                />
                <TouchableOpacity
                  style={styles.createButton}
                  onPress={handleCreateFreeSpace}
                  disabled={creating}
                >
                  <Text style={styles.buttonText}>
                    {creating ? "Creating..." : "Create Space"}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Target amount ($)"
                  value={targetAmount}
                  onChangeText={setTargetAmount}
                  keyboardType="decimal-pad"
                  placeholderTextColor="#888"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Pledge deadline (e.g. 2026-07-30T20:00:00)"
                  value={deadline}
                  onChangeText={setDeadline}
                  autoCapitalize="none"
                  placeholderTextColor="#888"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Max participants (optional)"
                  value={maxParticipants}
                  onChangeText={setMaxParticipants}
                  keyboardType="number-pad"
                  placeholderTextColor="#888"
                />
                <TouchableOpacity
                  style={styles.createButton}
                  onPress={handleCreateCrowdfund}
                  disabled={creating}
                >
                  <Text style={styles.buttonText}>
                    {creating ? "Creating..." : "Start Crowdfund"}
                  </Text>
                </TouchableOpacity>
              </>
            )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
  crowdfundCard: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#E50914",
  },
  crowdfundProgress: { fontSize: 12, color: "#E50914", marginTop: 4, fontWeight: "600" },
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
  timeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#007AFF",
    padding: 8,
    borderRadius: 6,
  },
  timeText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  timeCountBadge: {
    backgroundColor: "#fff",
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  timeCountBadgeText: { color: "#007AFF", fontSize: 11, fontWeight: "700" },
  emptySlotText: {
    color: "#999",
    fontSize: 14,
    textAlign: "center",
    marginVertical: 16,
  },
  crowdfundCreateButton: {
    backgroundColor: "#E50914",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
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
    backgroundColor: "#f0f0f0",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonText: { fontSize: 16, color: "#666", fontWeight: "600" },
  modalTitle: { fontSize: 22, fontWeight: "bold" },
  modalSubtitle: { fontSize: 14, color: "#666", marginBottom: 24, marginTop: 4 },
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
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
