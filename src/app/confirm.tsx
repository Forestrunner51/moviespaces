import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";

export default function ConfirmScreen() {
  const { groupId, memberId, name } = useLocalSearchParams<{
    groupId: string;
    memberId: string;
    name: string;
  }>();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    await fetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/confirm/${memberId}`,
      {
        method: "POST",
      },
    );
    setLoading(false);
    setConfirmed(true);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hey {name}! 👋</Text>
      {confirmed ? (
        <>
          <Text style={styles.subtitle}>You're confirmed! ✓</Text>
          <Text style={styles.info}>
            The host will book once everyone confirms.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() =>
              router.push({
                pathname: "/group",
                params: { groupId, hostName: "" },
              })
            }
          >
            <Text style={styles.buttonText}>View Group</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.subtitle}>
            Confirm you're coming to the movie?
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={handleConfirm}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>✓ I'm In!</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 16,
    paddingTop: 100,
    alignItems: "center",
  },
  title: { fontSize: 28, fontWeight: "bold", color: "#333", marginBottom: 8 },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 32,
    textAlign: "center",
  },
  info: { fontSize: 14, color: "#999", marginBottom: 24, textAlign: "center" },
  button: {
    backgroundColor: "#34C759",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    width: "100%",
  },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
