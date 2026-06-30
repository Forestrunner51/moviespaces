import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{ title: "Home", headerShown: false }}
      />
      <Tabs.Screen name="theaters" options={{ title: "Theaters" }} />
      <Tabs.Screen name="explore" options={{ title: "Explore" }} />
      <Tabs.Screen name="spaces" options={{ title: "My Spaces" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
      {/* This configuration registers the route but completely hides it from the tab bar */}
    </Tabs>
  );
}
