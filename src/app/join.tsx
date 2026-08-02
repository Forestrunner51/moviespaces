import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authFetch } from "@/frontend/services/api";
import { supabase } from "@/frontend/config/supabase";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

export default function JoinScreen() {
  // code is only present when arriving via join-by-code.tsx or a shared link
  // that embedded it (see group.tsx's shareLink) — required by the backend
  // when the Space is private (see JoinGroup's IsPrivate check); harmless to
  // send along unconditionally for a public Space, which ignores it.
  const { groupId, code } = useLocalSearchParams<{ groupId: string; code?: string }>();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  // Auto-fill from the user's real identity rather than making them retype
  // it every time they join a Space. Profile's display_name is the primary
  // source (same lookup as profile.tsx) since it's what everyone else in the
  // Space will see them as; the locally-cached name is only a fallback for
  // the rare case a profile row doesn't exist yet. Either way this just
  // seeds the field — it stays editable, so a one-off alias still works.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: row } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle();
        const displayName = row?.display_name || user.user_metadata?.full_name;
        if (displayName && !cancelled) {
          setName(displayName);
          return;
        }
      }
      const savedName = await AsyncStorage.getItem("userName");
      if (savedName && !cancelled) setName(savedName);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleJoin = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await AsyncStorage.setItem("userName", name.trim());
      const res = await authFetch(
        `${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/join`,
        {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), spaceCode: code ?? null }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Couldn't join this Space. Please try again.");
      }
      router.replace({
        pathname: "/group",
        params: { groupId, hostName: "" },
      });
    } catch (err: any) {
      Alert.alert("Couldn't join", err.message || "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.title, SpaceStyles.glowText, SpaceStyles.wordmark]}>Join Movie Group</Text>
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
