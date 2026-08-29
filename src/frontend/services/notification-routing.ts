import * as Notifications from "expo-notifications";
import { router } from "expo-router";

// Foreground display: without a handler, a push that lands while the app is
// open is silently swallowed on iOS — the user sees nothing, then finds the
// message later by accident. Called once from the root layout.
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// The backend sends these shapes on its pushes; anything else (or a payload
// with the fields missing) just opens the app wherever it already is.
type NotificationData =
  | { type: "group_message"; groupId?: string; title?: string }
  | { type: "dm"; userId?: string; name?: string };

function routeFor(data: unknown): Parameters<typeof router.push>[0] | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Partial<NotificationData> & Record<string, unknown>;
  if (d.type === "group_message" && typeof d.groupId === "string" && d.groupId) {
    return {
      pathname: "/group-chat/[id]",
      params: { id: d.groupId, type: "group", ...(typeof d.title === "string" ? { title: d.title } : {}) },
    };
  }
  if (d.type === "dm" && typeof d.userId === "string" && d.userId) {
    return {
      pathname: "/chat/[userId]",
      params: { userId: d.userId, ...(typeof d.name === "string" ? { name: d.name } : {}) },
    };
  }
  return null;
}

function handleResponse(response: Notifications.NotificationResponse | null | undefined) {
  const target = routeFor(response?.notification?.request?.content?.data);
  if (!target) return;
  try {
    router.push(target);
  } catch (err) {
    console.warn("Couldn't route notification tap:", err);
  }
}

// Identifier of the response already routed, so the cold-start lookup and
// the live listener can't both act on the same tap.
let handledIdentifier: string | null = null;

// Call once the navigator is mounted and the user is signed in. Returns an
// unsubscribe. Handles the tap that cold-started the app, then every tap
// while running.
export function startNotificationRouting(): () => void {
  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handledIdentifier === id) return;
      handledIdentifier = id;
      handleResponse(response);
    })
    .catch(() => {});

  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const id = response.notification.request.identifier;
    if (handledIdentifier === id) return;
    handledIdentifier = id;
    handleResponse(response);
  });
  return () => sub.remove();
}
