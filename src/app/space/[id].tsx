import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Text } from "@/frontend/components/scaled-text";
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
  // code is an optional query param a shared link embeds for a private
  // Space (see group.tsx's shareLink) — forwarded through so the eventual
  // /join call can present it, same as the join-by-code.tsx path.
  const { id, code } = useLocalSearchParams<{ id: string; code?: string }>();
  // "notFound" (a 404 — the link is dead or the Space was deleted) reads
  // differently from a network/server failure, which is worth retrying.
  const [error, setError] = useState<"notFound" | "failed" | null>(null);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    (async () => {
      try {
        // The code travels with the lookup, not just onward to /group — a
        // private Space hides its attendee list from anyone who can't present
        // it (see GetGroup), and an invited user arriving by link should see
        // the full picture rather than an empty member list.
        // id comes straight off a deep link — encoded so a crafted segment
        // ("../account", embedded "?"/"#") can't redirect this authenticated
        // request to a different backend route or inject query params.
        const res = await authFetch(
          `${process.env.EXPO_PUBLIC_API_URL}/api/group/${encodeURIComponent(id)}${
            code ? `?code=${encodeURIComponent(code)}` : ""
          }`,
        );
        if (res.status === 404) {
          if (!cancelled) setError("notFound");
          return;
        }
        if (!res.ok) throw new Error(`Space lookup failed (status ${res.status})`);
        const group = await res.json();
        if (cancelled) return;
        router.replace({ pathname: "/group", params: { groupId: group.id, code } });
      } catch (err) {
        console.error("Failed to resolve shared space link:", err);
        if (!cancelled) setError("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, code]);

  return (
    <Starfield>
      <View style={styles.center}>
        {error ? (
          <>
            <Text style={styles.errorText}>
              {error === "notFound"
                ? "This Space link couldn't be found — it may have been deleted."
                : "Couldn't load this Space — check your connection and try again."}
            </Text>
            {/* A deep link is usually the first screen in the stack, so there
                is nothing to go back to — land on Home instead of a dead tap. */}
            <Text
              style={styles.backLink}
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            >
              {router.canGoBack() ? "Go back" : "Go to Home"}
            </Text>
          </>
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
  backLink: {
    color: SpaceTheme.glowCyan,
    fontSize: 15,
    textAlign: "center",
    marginTop: 16,
    padding: 8,
  },
});
