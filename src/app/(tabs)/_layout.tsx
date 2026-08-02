import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SpaceTheme } from "@/frontend/constants/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: SpaceTheme.glowCyan,
        tabBarInactiveTintColor: SpaceTheme.mutedOrbit,
        tabBarStyle: {
          backgroundColor: SpaceTheme.deepSpace,
          borderTopColor: "rgba(255, 255, 255, 0.08)",
        },
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
      <Tabs.Screen
        name="explore"
        options={{
          title: "Explore",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="telescope-outline" size={size} color={color} />
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
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bulb-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="spaces"
        options={{
          title: "My Spaces",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="rocket-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" size={size} color={color} />
          ),
        }}
      />
      {/* This configuration registers the route but completely hides it from the tab bar */}
    </Tabs>
  );
}
