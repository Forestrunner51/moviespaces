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
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { POST_ACTIVITIES } from "@/frontend/constants/activities";

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
  // Keyed by screen/format type as returned by MovieGlu, e.g. "Standard",
  // "IMAX", "3D", "Dolby Cinema", "Laser" — not just "Standard".
  showings: Record<string, { times: { start_time: string; end_time: string }[] }>;
}

const formatDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const formatDateLabel = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

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

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const selectedDateStr = formatDate(selectedDate);

  // Editing controls inside the "Create a Space" review modal
  const [reviewDatePickerVisible, setReviewDatePickerVisible] = useState(false);
  const [theaterEditVisible, setTheaterEditVisible] = useState(false);
  const [timeEditVisible, setTimeEditVisible] = useState(false);
  const [postActivities, setPostActivities] = useState<string[]>([]);
  const [hangoutNotes, setHangoutNotes] = useState("");

  const toggleActivity = (key: string) => {
    setPostActivities((prev) =>
      prev.includes(key) ? prev.filter((a) => a !== key) : [...prev, key],
    );
  };

  useEffect(() => {
    const base = process.env.EXPO_PUBLIC_API_URL;
    setLoading(true);
    Promise.all([
      fetch(`${base}/api/group/search?filmId=${filmId}`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`${base}/api/movieglu/filmshowtimes?filmId=${filmId}&date=${selectedDateStr}`)
        .then((r) => (r.ok ? r.json() : { cinemas: [] }))
        .catch(() => ({ cinemas: [] })),
    ])
      .then(([spacesData, showtimesData]) => {
        setSpaces(Array.isArray(spacesData) ? spacesData : []);
        setCinemas(Array.isArray(showtimesData?.cinemas) ? showtimesData.cinemas : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [selectedDateStr]);

  const onDateChange = (_event: any, selected: Date) => {
    if (Platform.OS === "android") setDatePickerVisible(false);
    setSelectedDate(selected);
  };

  // Changing the date while reviewing invalidates the previously picked
  // cinema/time (showtimes differ per day), so re-fetch for the new date
  // and send the user back to pick a fresh slot instead of silently
  // keeping a showtime that may no longer exist.
  const onReviewDateChange = (_event: any, selected: Date) => {
    if (Platform.OS === "android") setReviewDatePickerVisible(false);
    setSelectedDate(selected);
    setModalVisible(false);
    setSelectedCinema(null);
    setSelectedTime("");
    Alert.alert("Date changed", "Pick a showtime for the new date to continue.");
  };

  const availableSlotsForCinema = (cinemaId: number) => {
    const fresh = cinemas.find((c) => c.cinema_id === cinemaId);
    if (!fresh) return [];
    return Object.entries(fresh.showings || {}).flatMap(([format, showing]) =>
      (showing?.times ?? []).map((t) => ({ format, time: t.start_time })),
    );
  };

  // Pre-fill hostName from the cached name saved at signup/login, so users
  // don't have to retype it every time they create a space (matches the same
  // prefill already done in showtimes.tsx).
  useEffect(() => {
    AsyncStorage.getItem("userName").then((savedName) => {
      if (savedName) setHostName(savedName);
    });
  }, []);

  const freeSpacesForSlot = (cinema: Cinema, time: string) =>
    spaces.filter(
      (s) =>
        s.cinemaId === cinema.cinema_id &&
        s.showTime === time &&
        s.showDate === selectedDateStr,
    );

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
          showDate: selectedDateStr,
          bookingUrl: "",
          postActivities,
          hangoutNotes: hangoutNotes.trim() || null,
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

  const confirmAndCreate = () => {
    if (!hostName.trim() || !selectedCinema) {
      Alert.alert("Missing info", "Please enter your name before creating the space.");
      return;
    }
    Alert.alert(
      "Does this look correct?",
      `${filmName}\n${selectedCinema.cinema_name}\n${formatDateLabel(selectedDate)} • ${selectedTime}\nHost: ${hostName.trim()}` +
        (postActivities.length > 0
          ? `\nAfter: ${postActivities.map((k) => POST_ACTIVITIES.find((a) => a.key === k)?.label).join(", ")}` +
            (hangoutNotes.trim() ? ` (${hangoutNotes.trim()})` : "")
          : ""),
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", onPress: handleCreateFreeSpace },
      ],
    );
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

        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.pickerField}
          onPress={() => setDatePickerVisible(true)}
        >
          <Ionicons name="calendar-outline" size={18} color={SpaceTheme.mutedOrbit} />
          <Text style={styles.pickerFieldText}>{formatDateLabel(selectedDate)}</Text>
          <Ionicons name="chevron-down" size={18} color={SpaceTheme.mutedOrbit} />
        </TouchableOpacity>
        {datePickerVisible && (
          <DateTimePicker
            style={styles.pickerNative}
            value={selectedDate}
            mode="date"
            minimumDate={new Date()}
            display={Platform.OS === "ios" ? "inline" : "default"}
            onValueChange={onDateChange}
            onDismiss={() => setDatePickerVisible(false)}
          />
        )}
        {Platform.OS === "ios" && datePickerVisible && (
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.pickerDoneButton}
            onPress={() => setDatePickerVisible(false)}
          >
            <Text style={styles.pickerDoneButtonText}>Done</Text>
          </TouchableOpacity>
        )}

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
              {Object.entries(item.showings || {})
                .filter(([, showing]) => Array.isArray(showing?.times) && showing.times.length > 0)
                .map(([format, showing]) => (
                <View key={format} style={styles.formatGroup}>
                  <View style={styles.formatBadge}>
                    <Ionicons name="sparkles-outline" size={12} color={SpaceTheme.supernovaPink} />
                    <Text style={styles.formatBadgeText}>{format}</Text>
                  </View>
                  <View style={styles.times}>
                    {(showing?.times ?? []).slice(0, 6).map((t) => {
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
              ))}
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
              <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: 16 }}>
                <View style={styles.reviewField}>
                  <Ionicons name="film-outline" size={18} color={SpaceTheme.mutedOrbit} />
                  <Text style={styles.reviewFieldText}>{filmName}</Text>
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.reviewField}
                  onPress={() => setTheaterEditVisible(true)}
                >
                  <Ionicons name="storefront-outline" size={18} color={SpaceTheme.mutedOrbit} />
                  <Text style={styles.reviewFieldText}>{selectedCinema?.cinema_name}</Text>
                  <Ionicons name="pencil-outline" size={16} color={SpaceTheme.glowCyan} />
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.reviewField}
                  onPress={() => setReviewDatePickerVisible(true)}
                >
                  <Ionicons name="calendar-outline" size={18} color={SpaceTheme.mutedOrbit} />
                  <Text style={styles.reviewFieldText}>{formatDateLabel(selectedDate)}</Text>
                  <Ionicons name="pencil-outline" size={16} color={SpaceTheme.glowCyan} />
                </TouchableOpacity>
                {reviewDatePickerVisible && (
                  <DateTimePicker
                    style={styles.pickerNative}
                    value={selectedDate}
                    mode="date"
                    minimumDate={new Date()}
                    display={Platform.OS === "ios" ? "inline" : "default"}
                    onValueChange={onReviewDateChange}
                    onDismiss={() => setReviewDatePickerVisible(false)}
                  />
                )}
                {Platform.OS === "ios" && reviewDatePickerVisible && (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.pickerDoneButton}
                    onPress={() => setReviewDatePickerVisible(false)}
                  >
                    <Text style={styles.pickerDoneButtonText}>Done</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.reviewField}
                  onPress={() => setTimeEditVisible(true)}
                >
                  <Ionicons name="time-outline" size={18} color={SpaceTheme.mutedOrbit} />
                  <Text style={styles.reviewFieldText}>{selectedTime}</Text>
                  <Ionicons name="pencil-outline" size={16} color={SpaceTheme.glowCyan} />
                </TouchableOpacity>

                <Text style={styles.afterSectionTitle}>Up for anything after? (optional)</Text>
                <View style={styles.chipRow}>
                  {POST_ACTIVITIES.map((a) => (
                    <TouchableOpacity
                      key={a.key}
                      activeOpacity={0.8}
                      style={[
                        styles.afterChip,
                        postActivities.includes(a.key) && styles.afterChipActive,
                      ]}
                      onPress={() => toggleActivity(a.key)}
                    >
                      <Text style={styles.afterChipEmoji}>{a.emoji}</Text>
                      <Text
                        style={[
                          styles.afterChipText,
                          postActivities.includes(a.key) && styles.afterChipTextActive,
                        ]}
                      >
                        {a.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {postActivities.length > 0 && (
                  <TextInput
                    style={[styles.input, styles.notesInput]}
                    placeholder="e.g., Grabbing drinks at the bar across the street..."
                    placeholderTextColor={SpaceTheme.mutedOrbit}
                    value={hangoutNotes}
                    onChangeText={setHangoutNotes}
                    multiline
                  />
                )}

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
                  onPress={confirmAndCreate}
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

        <Modal
          visible={theaterEditVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setTheaterEditVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modal}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select a Theater</Text>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.closeButton}
                  onPress={() => setTheaterEditVisible(false)}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled">
                {cinemas.map((c) => (
                  <TouchableOpacity
                    key={c.cinema_id}
                    activeOpacity={0.8}
                    style={styles.spaceCard}
                    onPress={() => {
                      const slots = availableSlotsForCinema(c.cinema_id);
                      setSelectedCinema(c);
                      setSelectedTime(slots[0]?.time ?? "");
                      setTheaterEditVisible(false);
                    }}
                  >
                    <Text style={styles.spaceHost}>{c.cinema_name}</Text>
                    <Text style={styles.spaceDetails}>{c.address}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={timeEditVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setTimeEditVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modal}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select a Time</Text>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.closeButton}
                  onPress={() => setTimeEditVisible(false)}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled">
                <View style={styles.times}>
                  {selectedCinema &&
                    availableSlotsForCinema(selectedCinema.cinema_id).map((slot) => (
                      <TouchableOpacity
                        key={`${slot.format}-${slot.time}`}
                        activeOpacity={0.8}
                        style={styles.timeButton}
                        onPress={() => {
                          setSelectedTime(slot.time);
                          setTimeEditVisible(false);
                        }}
                      >
                        <Text style={styles.timeText}>
                          {slot.time} · {slot.format}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </View>
              </ScrollView>
            </View>
          </View>
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
  pickerField: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    marginBottom: 12,
  },
  pickerFieldText: { flex: 1, color: SpaceTheme.starWhite, fontSize: 16, fontWeight: "600" },
  pickerNative: { width: "100%", height: 360, marginBottom: 4 },
  pickerDoneButton: {
    alignSelf: "flex-end",
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  pickerDoneButtonText: { color: SpaceTheme.glowCyan, fontWeight: "700", fontSize: 15 },
  formatGroup: { marginBottom: 10 },
  formatBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: "rgba(244, 114, 182, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(244, 114, 182, 0.35)",
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  formatBadgeText: {
    color: SpaceTheme.supernovaPink,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
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
  reviewField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
  reviewFieldText: { flex: 1, color: SpaceTheme.starWhite, fontSize: 15, fontWeight: "600" },
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
  afterSectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginTop: 4,
    marginBottom: 10,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  afterChip: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  afterChipActive: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderColor: SpaceTheme.glowCyan,
  },
  afterChipEmoji: { fontSize: 14 },
  afterChipText: { fontSize: 13, fontWeight: "600", color: SpaceTheme.mutedOrbit },
  afterChipTextActive: { color: SpaceTheme.glowCyan },
  notesInput: { minHeight: 60, textAlignVertical: "top" },
});
