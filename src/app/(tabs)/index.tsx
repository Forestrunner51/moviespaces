import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

export default function HomeScreen() {
  return (
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.title, SpaceStyles.glowText, styles.titleSpacing]}>MovieSpace</Text>
        <Text style={styles.chooseSubtitle}>What do you want to do?</Text>

        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.chooseCard}
          onPress={() =>
            router.push({ pathname: "/create-space", params: { spaceType: "public_gathering" } })
          }
        >
          <Ionicons name="film-outline" size={28} color={SpaceTheme.glowCyan} />
          <View style={{ flex: 1 }}>
            <Text style={styles.chooseCardTitle}>Watch a Movie</Text>
            <Text style={styles.chooseCardSubtitle}>
              Pick a movie and a nearby theater, then start a Space with friends
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={SpaceTheme.mutedOrbit} />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.chooseCard}
          onPress={() => router.push("/rent-a-theater")}
        >
          <Ionicons name="storefront-outline" size={28} color={SpaceTheme.supernovaPink} />
          <View style={{ flex: 1 }}>
            <Text style={styles.chooseCardTitle}>Host a Watch Party</Text>
            <Text style={styles.chooseCardSubtitle}>
              Organize a movie night, fight night, or screening at a theater, local venue, or
              custom space
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={SpaceTheme.mutedOrbit} />
        </TouchableOpacity>
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: SpaceTheme.starWhite,
  },
  titleSpacing: { marginBottom: 16 },
  chooseSubtitle: { fontSize: 15, color: SpaceTheme.mutedOrbit, marginBottom: 20 },
  chooseCard: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    marginBottom: 16,
  },
  chooseCardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginBottom: 4,
  },
  chooseCardSubtitle: { fontSize: 13, color: SpaceTheme.mutedOrbit, lineHeight: 18 },
});
