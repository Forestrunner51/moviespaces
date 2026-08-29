import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/frontend/components/scaled-text";
import { SpaceTheme, Palette, Type, Radius } from "@/frontend/constants/theme";

// A failed fetch used to render as the empty state ("No spaces yet") — which
// on a bad connection told the user they had nothing, when the truth was
// that nothing loaded. This is the distinct shape for that case: it names
// the connection and offers a retry. Keep the empty copy for a real empty 200.
export function LoadError({
  message = "Couldn't load — check your connection.",
  onRetry,
  compact = false,
}: {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {!compact && <Ionicons name="cloud-offline-outline" size={40} color={SpaceTheme.mutedOrbit} />}
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <TouchableOpacity activeOpacity={0.8} style={styles.button} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 24, gap: 12 },
  wrapCompact: { alignItems: "flex-start", paddingVertical: 8, paddingHorizontal: 0, gap: 8 },
  message: { ...Type.small, color: Palette.textMuted, textAlign: "center" },
  button: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  buttonText: { ...Type.small, color: Palette.text, fontWeight: "600" },
});
