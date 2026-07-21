import { useEffect, useState } from "react";
import { View, ActivityIndicator, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { authFetch } from "@/frontend/services/api";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme } from "@/frontend/constants/theme";

// Landing target for shared space links — both the universal link
// (https://moviespaces.onrender.com/space/{id}) and the custom scheme
// (moviespaces://space/{id}) point here. {id} is either the raw Guid
// (legacy links) or the friendlier Slug, so it has to be resolved to the
// real group id before handing off to the actual group screen.
export default function SpaceRedirectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(
          `${process.env.EXPO_PUBLIC_API_URL}/api/group/${id}`,
        );
        if (!res.ok) throw new Error("Space not found");
        const group = await res.json();
        if (cancelled) return;
        router.replace({ pathname: "/group", params: { groupId: group.id } });
      } catch (err) {
        console.error("Failed to resolve shared space link:", err);
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <Starfield>
      <View style={styles.center}>
        {error ? (
          <Text style={styles.errorText}>This Space link couldn't be found.</Text>
        ) : (
          <ActivityIndicator size="large" color={SpaceTheme.glowCyan} />
        )}
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { color: SpaceTheme.mutedOrbit, fontSize: 15, textAlign: "center" },
});
