import { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authFetch } from "@/frontend/services/api";
import { supabase } from "@/frontend/config/supabase";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

// No name-entry screen anymore — resolves the user's real identity (same
// sources as before: profile display_name, then auth metadata, then the
// locally-cached name) and joins immediately, with nothing to tap. A blank
// name still isn't fatal: the backend's profanity filter falls back to "A
// Movie Fan" for an empty/invalid name, so there's no dead end even for a
// brand-new user with no profile row yet.
export default function JoinScreen() {
  const { groupId, code } = useLocalSearchParams<{ groupId: string; code?: string }>();
  const [errorText, setErrorText] = useState<string | null>(null);
  // Guards against the join firing twice — e.g. a fast re-render while the
  // name-resolution effect is still in flight.
  const joining = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const resolveName = async (): Promise<string> => {
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
        if (displayName) return displayName;
      }
      return (await AsyncStorage.getItem("userName")) || "";
    };

    (async () => {
      if (joining.current) return;
      joining.current = true;
      try {
        const name = await resolveName();
        if (cancelled) return;
        if (name) await AsyncStorage.setItem("userName", name);

        const res = await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/join`, {
          method: "POST",
          body: JSON.stringify({ name, spaceCode: code ?? null }),
        });
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Couldn't join this Space. Please try again.");
        }
        router.replace({ pathname: "/group", params: { groupId, hostName: "" } });
      } catch (err: any) {
        if (!cancelled) setErrorText(err.message || "Please try again.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [groupId, code]);

  useEffect(() => {
    if (errorText) Alert.alert("Couldn't join", errorText);
  }, [errorText]);

  return (
    <Starfield>
      <View style={styles.container}>
        {errorText ? (
          <>
            <Text style={[styles.title, SpaceStyles.glowText, SpaceStyles.wordmark]}>
              Couldn&apos;t join
            </Text>
            <Text style={styles.subtitle}>{errorText}</Text>
            <TouchableOpacity activeOpacity={0.8} style={styles.button} onPress={() => router.back()}>
              <Text style={styles.buttonText}>Go Back</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={SpaceTheme.glowCyan} />
            <Text style={styles.subtitle}>Joining...</Text>
          </>
        )}
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: { fontSize: 24, fontWeight: "bold", color: SpaceTheme.starWhite, textAlign: "center" },
  subtitle: { fontSize: 15, color: SpaceTheme.mutedOrbit, textAlign: "center" },
  button: {
    backgroundColor: SpaceTheme.glowCyan,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
    marginTop: 8,
  },
  buttonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", fontSize: 16 },
});
