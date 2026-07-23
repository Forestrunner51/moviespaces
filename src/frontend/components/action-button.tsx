import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface ActionButtonProps {
  label: string;
  onPress: () => void;
  // A single icon system across the app — replaces the emoji that used to
  // stand in for icons on buttons (📤/💬/🎟/etc.), which rendered
  // inconsistently and couldn't be themed.
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconSize?: number;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

// Shared button: an Ionicon + label laid out in a centered row. The caller
// still owns the visual style (background, padding, text color) via `style` /
// `textStyle`; this just standardizes the icon+text layout and the loading
// spinner so every action button behaves the same.
export function ActionButton({
  label,
  onPress,
  icon,
  iconColor,
  iconSize = 18,
  disabled,
  loading,
  style,
  textStyle,
}: ActionButtonProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[styles.base, style]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator color={iconColor} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={iconSize} color={iconColor} /> : null}
          <Text style={textStyle}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
});
