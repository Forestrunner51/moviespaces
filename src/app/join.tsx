import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";

export default function JoinScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const res = await fetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/join`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    const data = await res.json();
    setLoading(false);
    router.push({
      pathname: "/confirm",
      params: { groupId, memberId: data.memberId, name },
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join Movie Group</Text>
      <Text style={styles.subtitle}>Enter your name to join</Text>
      <TextInput
        style={styles.input}
        placeholder="Your name"
        value={name}
        onChangeText={setName}
        placeholderTextColor="#888"
      />
      <TouchableOpacity
        style={styles.button}
        onPress={handleJoin}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Joining..." : "Join Group"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 16,
    paddingTop: 100,
  },
  title: { fontSize: 28, fontWeight: "bold", color: "#333", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#666", marginBottom: 32 },
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
});
