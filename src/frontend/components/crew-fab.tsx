import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import { router, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Palette, Type, Font, Radius } from "@/frontend/constants/theme";

// The one action the app wants you to take, in the same place on every
// tab — Strava's Record, Kaya's Log. Hidden on CineMind (it has its own
// full-screen game) and on Home, where the hero already says it louder.
const TAB_BAR_HEIGHT = 49;

export function CrewFab() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  if (pathname === "/" || pathname.startsWith("/cinemind")) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: TAB_BAR_HEIGHT + insets.bottom + 14 }]}>
      <TouchableOpacity
        activeOpacity={0.88}
        style={styles.fab}
        onPress={() => router.push("/match")}
        accessibilityRole="button"
        accessibilityLabel="Find a movie crew"
      >
        <Ionicons name="people" size={18} color={Palette.base} />
        <Text style={styles.label}>Find a crew</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", right: 16, left: 16, alignItems: "flex-end" },
  fab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accent,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  label: { ...Type.small, fontFamily: Font.bold, color: Palette.base },
});
