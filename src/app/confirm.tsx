import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

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
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.title, SpaceStyles.glowText]}>Hey {name}! 👋</Text>
        {confirmed ? (
          <>
            <Text style={styles.subtitle}>You're confirmed! ✓</Text>
            <Text style={styles.info}>
              The host will book once everyone confirms.
            </Text>
            <TouchableOpacity
              activeOpacity={0.8}
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
              activeOpacity={0.8}
              style={styles.button}
              onPress={handleConfirm}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={SpaceTheme.backgroundVoid} />
              ) : (
                <Text style={styles.buttonText}>✓ I'm In!</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingTop: 100,
    alignItems: "center",
  },
  title: { fontSize: 28, fontWeight: "bold", color: SpaceTheme.starWhite, marginBottom: 8 },
  subtitle: {
    fontSize: 16,
    color: SpaceTheme.mutedOrbit,
    marginBottom: 32,
    textAlign: "center",
  },
  info: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginBottom: 24, textAlign: "center" },
  button: {
    backgroundColor: SpaceTheme.glowCyan,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    width: "100%",
  },
  buttonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", fontSize: 16 },
});
