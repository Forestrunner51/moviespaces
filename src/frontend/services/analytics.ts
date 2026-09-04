import { authFetch } from "@/frontend/services/api";

// Fire-and-forget behavioral events — the minimal counting that turns
// post-launch decisions ("is the crew steer ever overridden?", "are sessions
// CineMind-only?") into data. Never awaited by callers, never throws, never
// blocks UI; a lost event is fine, a janky tap is not. Names must exist in
// EventsController.AllowedEvents.
export type AppEventName =
  | "onboarding_complete"
  | "tour_skipped"
  | "crew_created"
  | "crew_joined"
  | "space_created"
  | "club_created"
  | "club_joined"
  | "steer_shown"
  | "steer_find_crew"
  | "steer_invite_only"
  | "steer_override"
  | "puzzle_submitted"
  | "cinemind_bridge_tap"
  | "chat_opened"
  | "profile_sheet_opened";

export function track(name: AppEventName): void {
  authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/events`, {
    method: "POST",
    body: JSON.stringify({ name }),
  }).catch(() => {});
}
