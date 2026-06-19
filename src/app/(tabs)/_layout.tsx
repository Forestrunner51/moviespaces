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
      <Tabs.Screen name="group" options={{ title: "Movie Group" }} />
      <Tabs.Screen name="join" options={{ title: "Join Group" }} />
      <Tabs.Screen name="confirm" options={{ title: "Confirm" }} />
    </Tabs>
  );
}
