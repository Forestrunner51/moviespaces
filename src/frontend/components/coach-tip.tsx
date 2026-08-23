import { useEffect, useState, type ReactNode } from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Palette, Type, Radius } from "@/frontend/constants/theme";

// A one-time, dismissible coaching tip — the app's whole first-run "tutorial".
// Deliberately lightweight: an inline hint on a real screen, not a full-screen
// walkthrough or an overlay that blocks the UI. Once the user taps the X, the
// tip's `id` is remembered in AsyncStorage (same store as the onboarding flag)
// so it never returns on that device.
export function CoachTip({
  id,
  icon = "sparkles-outline",
  children,
}: {
  id: string;
  icon?: keyof typeof Ionicons.glyphMap;
  children: ReactNode;
}) {
  const storageKey = `coachtip:${id}`;
  // Starts hidden and only shows after we've confirmed it wasn't dismissed —
  // avoids a flash of the tip on a screen the user has already dismissed it on.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(storageKey)
      .then((v) => {
        if (alive && !v) setVisible(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [storageKey]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    AsyncStorage.setItem(storageKey, "1").catch(() => {});
  };

  return (
    <View style={styles.tip}>
      <Ionicons name={icon} size={16} color={Palette.accent} />
      <Text style={styles.tipText}>{children}</Text>
      <TouchableOpacity onPress={dismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="close" size={16} color={Palette.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  tip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    borderRadius: Radius.medium,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  tipText: { ...Type.small, color: Palette.text, flex: 1 },
});
