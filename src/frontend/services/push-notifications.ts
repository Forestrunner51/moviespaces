import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { authFetch } from "@/frontend/services/api";

// Registers this device for push notifications and hands the Expo push
// token to the backend, which is what actually sends notifications (e.g. on
// booking confirmation) via Expo's push API. Silently no-ops on failure —
// notification delivery is a nice-to-have, never something that should
// block or error out the rest of the app.
export async function registerForPushNotifications(): Promise<void> {
  // Simulators/emulators can never obtain a real push token (no APNs
  // entitlement is possible without a real device), so don't even try —
  // avoids a guaranteed-to-fail attempt and its console warning every launch.
  if (!Device.isDevice) return;

  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/pushtokens`, {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  } catch (err) {
    console.warn("Failed to register for push notifications:", err);
  }
}
