import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { authFetch } from "@/frontend/services/api";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

type SpaceType = "public_gathering" | "private_rental";

export default function CreateSpaceScreen() {
  const [spaceType, setSpaceType] = useState<SpaceType>("public_gathering");
  const [hostName, setHostName] = useState("");
  const [theaterName, setTheaterName] = useState("");
  const [movieName, setMovieName] = useState("");
  const [showDate, setShowDate] = useState("");
  const [showTime, setShowTime] = useState("");

  // Private rental only
  const [totalCost, setTotalCost] = useState("");
  const [maxCapacity, setMaxCapacity] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");

  const [creating, setCreating] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("userName").then((savedName) => {
      if (savedName) setHostName(savedName);
    });
  }, []);

  const handleSubmit = async () => {
    if (!hostName.trim() || !theaterName.trim() || !movieName.trim() || !showDate.trim() || !showTime.trim()) {
      Alert.alert("Missing info", "Please fill in your name, theater, movie, date, and time.");
      return;
    }

    let totalCostCents: number | null = null;
    if (spaceType === "private_rental") {
      const amount = parseFloat(totalCost);
      if (!amount || amount <= 0) {
        Alert.alert("Missing cost", "Please enter the total estimated booking cost.");
        return;
      }
      totalCostCents = Math.round(amount * 100);
    }

    setCreating(true);
    await AsyncStorage.setItem("userName", hostName.trim());

    try {
      const res = await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group`, {
        method: "POST",
        body: JSON.stringify({
          hostName: hostName.trim(),
          cinemaId: null,
          cinemaName: theaterName.trim(),
          filmId: null,
          filmName: movieName.trim(),
          showTime: showTime.trim(),
          showDate: showDate.trim(),
          bookingUrl: spaceType === "private_rental" ? bookingUrl.trim() : "",
          spaceType,
          totalCostCents,
          maxCapacity: spaceType === "private_rental" && maxCapacity ? parseInt(maxCapacity, 10) : null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to create space.");
      }

      const data = await res.json();
      setCreating(false);
      router.replace({
        pathname: "/group",
        params: { groupId: data.groupId, hostName: hostName.trim() },
      });
    } catch (err: any) {
      setCreating(false);
      Alert.alert("Couldn't create space", err.message || "Please try again.");
    }
  };

  return (
    <Starfield>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, SpaceStyles.glowText]}>Create a Space</Text>

          <View style={styles.toggleRow}>
            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.toggleOption,
                spaceType === "public_gathering" && styles.toggleOptionActiveCyan,
              ]}
              onPress={() => setSpaceType("public_gathering")}
            >
              <Ionicons
                name="planet-outline"
                size={20}
                color={spaceType === "public_gathering" ? SpaceTheme.glowCyan : SpaceTheme.mutedOrbit}
              />
              <Text
                style={[
                  styles.toggleLabel,
                  spaceType === "public_gathering" && styles.toggleLabelActiveCyan,
                ]}
              >
                Public Movie Gathering
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.toggleOption,
                spaceType === "private_rental" && styles.toggleOptionActivePink,
              ]}
              onPress={() => setSpaceType("private_rental")}
            >
              <Ionicons
                name="storefront-outline"
                size={20}
                color={spaceType === "private_rental" ? SpaceTheme.supernovaPink : SpaceTheme.mutedOrbit}
              />
              <Text
                style={[
                  styles.toggleLabel,
                  spaceType === "private_rental" && styles.toggleLabelActivePink,
                ]}
              >
                Private Theater Rental
              </Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor={SpaceTheme.mutedOrbit}
            value={hostName}
            onChangeText={setHostName}
          />
          <TextInput
            style={styles.input}
            placeholder="Theater name"
            placeholderTextColor={SpaceTheme.mutedOrbit}
            value={theaterName}
            onChangeText={setTheaterName}
          />
          <TextInput
            style={styles.input}
            placeholder="Movie"
            placeholderTextColor={SpaceTheme.mutedOrbit}
            value={movieName}
            onChangeText={setMovieName}
          />
          <TextInput
            style={styles.input}
            placeholder="Screening date (e.g. 2026-08-01)"
            placeholderTextColor={SpaceTheme.mutedOrbit}
            value={showDate}
            onChangeText={setShowDate}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Screening time (e.g. 7:30 PM)"
            placeholderTextColor={SpaceTheme.mutedOrbit}
            value={showTime}
            onChangeText={setShowTime}
            autoCapitalize="none"
          />

          {spaceType === "private_rental" && (
            <View style={styles.rentalSection}>
              <View style={styles.rentalSectionHeader}>
                <Ionicons name="storefront-outline" size={16} color={SpaceTheme.supernovaPink} />
                <Text style={styles.rentalSectionTitle}>Rental Details</Text>
              </View>
              <Text style={styles.rentalSectionSubtext}>
                You've already booked this rental independently — these fields are just for
                transparency with your guests, splitting cost and showing capacity. The app
                doesn't charge anyone.
              </Text>

              <TextInput
                style={styles.input}
                placeholder="Total estimated booking cost ($)"
                placeholderTextColor={SpaceTheme.mutedOrbit}
                value={totalCost}
                onChangeText={setTotalCost}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={styles.input}
                placeholder="Max room capacity (default 40)"
                placeholderTextColor={SpaceTheme.mutedOrbit}
                value={maxCapacity}
                onChangeText={setMaxCapacity}
                keyboardType="number-pad"
              />
              <TextInput
                style={styles.input}
                placeholder="Direct ticket/rental confirmation link (optional)"
                placeholderTextColor={SpaceTheme.mutedOrbit}
                value={bookingUrl}
                onChangeText={setBookingUrl}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>
          )}

          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.submitButton}
            onPress={handleSubmit}
            disabled={creating}
          >
            {creating ? (
              <ActivityIndicator color={SpaceTheme.backgroundVoid} />
            ) : (
              <Text style={styles.submitButtonText}>Create Space</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: "bold", color: SpaceTheme.starWhite, marginBottom: 20 },
  toggleRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  toggleOption: {
    flex: 1,
    ...SpaceStyles.glassCard,
    padding: 14,
    alignItems: "center",
    gap: 8,
  },
  toggleOptionActiveCyan: {
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderColor: "rgba(56, 189, 248, 0.5)",
    shadowColor: SpaceTheme.glowCyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  toggleOptionActivePink: {
    backgroundColor: "rgba(244, 114, 182, 0.12)",
    borderColor: "rgba(244, 114, 182, 0.5)",
    shadowColor: SpaceTheme.supernovaPink,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  toggleLabel: { fontSize: 13, fontWeight: "600", color: SpaceTheme.mutedOrbit, textAlign: "center" },
  toggleLabelActiveCyan: { color: SpaceTheme.glowCyan },
  toggleLabelActivePink: { color: SpaceTheme.supernovaPink },
  input: {
    ...SpaceStyles.glassCard,
    color: SpaceTheme.starWhite,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  rentalSection: {
    ...SpaceStyles.glassCard,
    borderColor: "rgba(244, 114, 182, 0.25)",
    padding: 16,
    marginBottom: 8,
  },
  rentalSectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  rentalSectionTitle: { fontSize: 15, fontWeight: "700", color: SpaceTheme.starWhite },
  rentalSectionSubtext: {
    fontSize: 12,
    color: SpaceTheme.mutedOrbit,
    lineHeight: 17,
    marginBottom: 14,
  },
  submitButton: {
    backgroundColor: SpaceTheme.supernovaPink,
    padding: 18,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 8,
    shadowColor: SpaceTheme.supernovaPink,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  submitButtonText: { color: SpaceTheme.backgroundVoid, fontWeight: "800", fontSize: 17 },
});
