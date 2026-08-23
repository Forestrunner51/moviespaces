import { Tabs } from "expo-router";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SpaceTheme, Palette } from "@/frontend/constants/theme";
import { CrewFab } from "@/frontend/components/crew-fab";
import { useSpacesTabBadge } from "@/frontend/hooks/use-spaces-tab-badge";
import { useCineMindBadge } from "@/frontend/hooks/use-cinemind-badge";

export default function TabsLayout() {
  // Unread chats + pending friend requests, shown on the Spaces tab so a
  // notification is visible from any tab, not only after opening Spaces.
  const badge = useSpacesTabBadge();
  // Dot on CineMind while today's puzzle is unplayed.
  const puzzleWaiting = useCineMindBadge();
  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: SpaceTheme.glowCyan,
        tabBarInactiveTintColor: SpaceTheme.mutedOrbit,
        tabBarStyle: {
          backgroundColor: SpaceTheme.deepSpace,
          borderTopColor: Palette.border,
        },
        // Explicit even distribution. The default item layout is flex-based
        // and, on some devices/orientations (and iOS's compact "label beside
        // icon" mode), items size to their label width — "My Spaces" and
        // "CineMind" then crowd the others and the gaps go uneven.
        tabBarItemStyle: { flex: 1, paddingHorizontal: 0 },
        tabBarLabelPosition: "below-icon",
        tabBarLabelStyle: { fontSize: 11 },
        tabBarAllowFontScaling: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="planet-outline" size={size} color={color} />
          ),
        }}
      />
      {/* headerShown: false on every tab — each of these screens renders its
          own wordmark heading, so a native header on top of that showed the
          same word twice with 60px of dead space between them (the screens'
          paddingTop is sized to clear the notch on its own). */}
      <Tabs.Screen
        name="explore"
        options={{
          title: "Explore",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="telescope-outline" size={size} color={color} />
          ),
        }}
      />
      {/* My Spaces sits in the center slot (the easiest to reach), not
          CineMind — CineMind is the deliberately secondary daily puzzle,
          while My Spaces is core to the watch-party pitch. */}
      <Tabs.Screen
        name="spaces"
        options={{
          title: "Spaces",
          headerShown: false,
          tabBarBadge: badge > 0 ? (badge > 99 ? "99+" : badge) : undefined,
          tabBarBadgeStyle: {
            backgroundColor: Palette.accent,
            color: Palette.base,
            fontSize: 11,
            fontFamily: "Karla_700Bold",
          },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="rocket-outline" size={size} color={color} />
          ),
        }}
      />
      {/* Demoted from the app's front door (was Home) to a secondary tab —
          still a full daily puzzle, just no longer the first thing anyone
          sees. Watch Parties/Spaces is the primary pitch now. The global
          leaderboard lives inside this same tab now (a view-mode toggle,
          not its own route) rather than a separate tab. */}
      <Tabs.Screen
        name="cinemind"
        options={{
          title: "CineMind",
          headerShown: false,
          // A dot, not a count — "there is a puzzle", not "N things owed".
          tabBarBadge: puzzleWaiting ? "" : undefined,
          tabBarBadgeStyle: {
            backgroundColor: Palette.accent,
            minWidth: 10,
            maxWidth: 10,
            height: 10,
            borderRadius: 5,
            marginTop: 2,
          },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bulb-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" size={size} color={color} />
          ),
        }}
      />
      {/* This configuration registers the route but completely hides it from the tab bar */}
    </Tabs>
    <CrewFab />
    </View>
  );
}
