import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authFetch } from "@/frontend/services/api";

// Settings screen toggle. Defaults to enabled (existing users who never
// touch the toggle keep getting notifications, matching behavior before
// this setting existed).
const NOTIFICATIONS_ENABLED_KEY = "pushNotificationsEnabled";

export async function areNotificationsEnabled(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
  return stored !== "false";
}

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
    // Inside the try on purpose: this AsyncStorage read was the one await
    // outside it, so a storage failure at launch became an unhandled
    // rejection on every session instead of the silent no-op promised above.
    if (!(await areNotificationsEnabled())) return;

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

// Settings screen "Push Notifications" toggle. Turning it off deletes the
// token server-side — every push send path here only looks up tokens for a
// user id, so a removed row is what actually stops notifications from going
// out, not a flag the server has no way to check. Turning it back on
// re-registers (re-prompting for permission only if it was never granted).
export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, enabled ? "true" : "false");

  if (enabled) {
    await registerForPushNotifications();
    return;
  }

  await unregisterPushToken();
}

// Deletes this user's push token rows server-side. Also called on sign-out —
// otherwise the device keeps receiving the previous account's notifications
// after someone else signs in (or after nobody does). Best-effort: never
// throws, so it can run before signOut without blocking it.
export async function unregisterPushToken(): Promise<void> {
  try {
    await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/pushtokens`, { method: "DELETE" });
  } catch (err) {
    console.warn("Failed to unregister push token:", err);
  }
}
