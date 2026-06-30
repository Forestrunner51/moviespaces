import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/frontend/services/api";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface Space {
  id: string;
  filmName: string;
  cinemaName: string;
  showTime: string;
  showDate: string;
  status: string;
  members: { id: string; name: string; confirmed: boolean }[];
}

export default function MySpacesScreen() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");

  const loadSpaces = async (name: string) => {
    setLoading(true);
    const res = await authFetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/group/mine`,
    );
    const data = await res.json();
    setSpaces(data);
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem("userName").then((name) => {
        if (name) {
          setUserName(name);
          loadSpaces(name);
        } else {
          setLoading(false);
        }
      });
    }, []),
  );

  const handleSaveName = async () => {
    if (!nameInput.trim()) return;
    await AsyncStorage.setItem("userName", nameInput);
    setUserName(nameInput);
    loadSpaces(nameInput);
  };

  if (loading) return <ActivityIndicator size="large" style={{ flex: 1 }} />;

  if (!userName) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>My Spaces</Text>
        <Text style={styles.subtitle}>Enter your name to see your spaces</Text>
        <TextInput
          style={styles.input}
          placeholder="Your name"
          value={nameInput}
          onChangeText={setNameInput}
          placeholderTextColor="#888"
        />
        <TouchableOpacity style={styles.button} onPress={handleSaveName}>
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Spaces</Text>
      <Text style={styles.subtitle}>Hey {userName} 👋</Text>
      <FlatList
        data={spaces}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() =>
              router.push({
                pathname: "/group",
                params: { groupId: item.id, hostName: userName },
              })
            }
          >
            <Text style={styles.filmName}>{item.filmName}</Text>
            <Text style={styles.details}>
              {item.cinemaName} • {item.showTime}
            </Text>
            <Text style={styles.date}>{item.showDate}</Text>
            <View style={styles.footer}>
              <Text style={styles.members}>
                {item.members.length} member(s)
              </Text>
              <Text
                style={
                  item.status === "booked" ? styles.booked : styles.pending
                }
              >
                {item.status === "booked" ? "✓ Booked" : "Pending"}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No spaces yet. Find a movie and create one!
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1A1A1A",
    marginBottom: 4,
  },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: "#E5E5E5",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#fff",
    marginBottom: 16,
    color: "#000",
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  card: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  filmName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 4,
  },
  details: { fontSize: 14, color: "#666", marginBottom: 2 },
  date: { fontSize: 12, color: "#999", marginBottom: 8 },
  footer: { flexDirection: "row", justifyContent: "space-between" },
  members: { fontSize: 13, color: "#007AFF" },
  booked: { fontSize: 13, color: "#34C759", fontWeight: "600" },
  pending: { fontSize: 13, color: "#FF9500", fontWeight: "600" },
  empty: { textAlign: "center", color: "#888", marginTop: 40, fontSize: 16 },
});
