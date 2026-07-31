import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { authFetch } from "@/frontend/services/api";

// A code-based entry point alongside link sharing — mainly for private
// rentals, which (unlike public gatherings) don't show up in Explore, so a
// spoken or texted code is the only way in without the original invite link.
export default function JoinByCodeScreen() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleResolve = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      const res = await authFetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/resolve/${encodeURIComponent(trimmed)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "No Space found with that code.");
      }
      const { groupId } = await res.json();
      router.push({ pathname: "/group", params: { groupId } });
    } catch (err: any) {
      Alert.alert("Couldn't find that Space", err?.message || "Please check the code and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Starfield>
      <View style={styles.container}>
        <Ionicons name="key-outline" size={36} color={SpaceTheme.accentGold} />
        <Text style={styles.title}>Enter a Space Code</Text>
        <Text style={styles.subtitle}>Ask the host for their 6-character code</Text>

        <TextInput
          style={styles.input}
          value={code}
          // Codes are generated uppercase; forcing it here means a lowercase
          // paste or autocapitalize-off keyboard still matches.
          onChangeText={(text) => setCode(text.toUpperCase())}
          placeholder="K7XPQ2"
          placeholderTextColor={SpaceTheme.mutedOrbit}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={10}
          returnKeyType="go"
          onSubmitEditing={handleResolve}
        />

        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.button, (!code.trim() || loading) && styles.buttonDisabled]}
          onPress={handleResolve}
          disabled={!code.trim() || loading}
        >
          {loading ? (
            <ActivityIndicator color={SpaceTheme.backgroundVoid} />
          ) : (
            <Text style={styles.buttonText}>Find Space</Text>
          )}
        </TouchableOpacity>
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", padding: 24, paddingTop: 80, gap: 6 },
  title: { fontSize: 22, fontWeight: "700", color: SpaceTheme.starWhite, marginTop: 12 },
  subtitle: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginBottom: 28, textAlign: "center" },
  input: {
    ...SpaceStyles.glassCard,
    width: "100%",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 4,
    textAlign: "center",
    color: SpaceTheme.starWhite,
    paddingVertical: 16,
    marginBottom: 20,
  },
  button: {
    width: "100%",
    backgroundColor: SpaceTheme.accentGold,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: SpaceTheme.backgroundVoid, fontSize: 16, fontWeight: "700" },
});
