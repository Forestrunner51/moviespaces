import { TouchableOpacity, Text, View, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

interface QuickActionProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

// A compact icon + label button, meant to sit in a horizontal row of
// frequently-used utility actions (chat, calendar, tickets, invite) — as
// opposed to ActionButton, which is a full-width bar meant for a single
// primary/state-changing action (Join, Cancel, Book, ...).
export function QuickAction({ icon, label, onPress, loading, disabled }: QuickActionProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={styles.action}
      onPress={onPress}
      disabled={disabled || loading}
    >
      <View style={styles.iconCircle}>
        {loading ? (
          <ActivityIndicator size="small" color={SpaceTheme.glowCyan} />
        ) : (
          <Ionicons name={icon} size={20} color={SpaceTheme.glowCyan} />
        )}
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: "center", width: 72 },
  iconCircle: {
    ...SpaceStyles.glassCard,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  label: { fontSize: 11, fontWeight: "600", color: SpaceTheme.mutedOrbit },
});
