import type { Ionicons } from "@expo/vector-icons";

// Shared across every screen that shows a category badge/fallback (Explore,
// My Spaces, group detail — Home's carousels don't use this yet) so the
// icon/label/fallback logic can't drift between them — see create-space.tsx's
// activity-type chips for where these values originate and
// GroupController.CreateGroup for the server-side allow-list.
export type EventCategory = "movie" | "tv" | "sports" | "gaming" | "awards" | "other";

// Icons, not emoji: emoji render differently per platform and OS version,
// can't inherit a colour from the theme, and don't align to the text
// baseline — which is most of why a UI reads as machine-assembled.
export const EVENT_CATEGORIES: Record<
  EventCategory,
  { icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  movie: { icon: "film-outline", label: "Movie" },
  tv: { icon: "tv-outline", label: "TV" },
  sports: { icon: "football-outline", label: "Sports" },
  gaming: { icon: "game-controller-outline", label: "Gaming" },
  awards: { icon: "trophy-outline", label: "Awards" },
  other: { icon: "sparkles-outline", label: "Custom" },
};

// Legacy rows predate the event_category column — infer a reasonable value
// rather than treating them as a 7th "unknown" bucket that always disappears
// once any category filter/badge logic runs.
export function eventCategoryOf(spaceType: string, eventCategory: string | null): EventCategory {
  if (eventCategory && eventCategory in EVENT_CATEGORIES) return eventCategory as EventCategory;
  return spaceType === "public_gathering" ? "movie" : "other";
}
