import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { authFetch } from "@/frontend/services/api";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

export default function JoinScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const res = await authFetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/join`,
      {
        method: "POST",
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
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.title, SpaceStyles.glowText]}>Join Movie Group</Text>
        <Text style={styles.subtitle}>Enter your name to join</Text>
        <TextInput
          style={styles.input}
          placeholder="Your name"
          value={name}
          onChangeText={setName}
          placeholderTextColor={SpaceTheme.mutedOrbit}
        />
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.button}
          onPress={handleJoin}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? "Joining..." : "Join Group"}
          </Text>
        </TouchableOpacity>
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingTop: 100,
  },
  title: { fontSize: 28, fontWeight: "bold", color: SpaceTheme.starWhite, marginBottom: 8 },
  subtitle: { fontSize: 16, color: SpaceTheme.mutedOrbit, marginBottom: 32 },
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
  button: {
    backgroundColor: SpaceTheme.glowCyan,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", fontSize: 16 },
});
