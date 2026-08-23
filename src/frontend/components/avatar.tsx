import { View, Image, StyleSheet } from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import { Palette, Radius } from "@/frontend/constants/theme";

interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
}

// Deterministic tint per person so the fallback initial isn't a wall of
// identical grey circles in a member list. Warm hues only, to sit with the
// palette rather than reintroducing the old rainbow of accent colours.
const FALLBACK_TINTS = ["#7C5E3B", "#6B4F4F", "#4F5B45", "#5A4A63", "#3F5661", "#6B5535"];

function tintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return FALLBACK_TINTS[hash % FALLBACK_TINTS.length];
}

// A person. Falls back to their initial on a stable tinted ground when there's
// no photo — never an anonymous grey blob, so a list still reads as a list of
// distinct people.
export function Avatar({ uri, name, size = 36 }: AvatarProps) {
  const dims = { width: size, height: size, borderRadius: Radius.pill };
  const initial = (name ?? "").trim()[0]?.toUpperCase() ?? "?";

  if (uri) {
    return <Image source={{ uri }} style={[styles.base, dims]} />;
  }
  return (
    <View style={[styles.base, styles.fallback, dims, { backgroundColor: tintFor(name ?? "?") }]}>
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}>{initial}</Text>
    </View>
  );
}

interface AvatarStackProps {
  people: { userId?: string | null; name: string; avatarUrl?: string | null }[];
  size?: number;
  max?: number;
}

// Overlapping row of faces + "+N". This is the single strongest signal that a
// Space is a real gathering rather than a database row, which is why it goes
// on the cards rather than a plain "5 members" count.
export function AvatarStack({ people, size = 28, max = 4 }: AvatarStackProps) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <View style={styles.stack}>
      {shown.map((p, i) => (
        <View
          key={p.userId || `${p.name}-${i}`}
          // Negative margin overlaps each face onto the previous one; the ring
          // is what keeps them readable where they overlap.
          style={[
            i > 0 && { marginLeft: -size * 0.3 },
            styles.stackItem,
            { borderRadius: Radius.pill },
          ]}
        >
          <Avatar uri={p.avatarUrl} name={p.name} size={size} />
        </View>
      ))}
      {overflow > 0 && (
        <View
          style={[
            styles.stackItem,
            styles.overflow,
            {
              marginLeft: -size * 0.3,
              width: size,
              height: size,
              borderRadius: Radius.pill,
            },
          ]}
        >
          <Text style={[styles.overflowText, { fontSize: Math.round(size * 0.36) }]}>
            +{overflow}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: Palette.raised },
  fallback: { alignItems: "center", justifyContent: "center" },
  initial: { color: Palette.text, fontWeight: "600" },
  stack: { flexDirection: "row", alignItems: "center" },
  stackItem: { borderWidth: 2, borderColor: Palette.base },
  overflow: {
    backgroundColor: Palette.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  overflowText: { color: Palette.textMuted, fontWeight: "700" },
});
