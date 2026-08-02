// Shared across every screen that shows a category badge/fallback (Explore,
// My Spaces, group detail — Home's carousels don't use this yet) so the vibe
// emoji/label/fallback logic can't drift between them — see
// create-space.tsx's activity-type chips for where these values originate
// and GroupController.CreateGroup for the server-side allow-list.
export type EventCategory = "movie" | "tv" | "sports" | "gaming" | "awards" | "other";

export const EVENT_CATEGORIES: Record<EventCategory, { emoji: string; label: string }> = {
  movie: { emoji: "🍿", label: "Movie" },
  tv: { emoji: "📺", label: "TV" },
  sports: { emoji: "🥊", label: "Combat Sports" },
  gaming: { emoji: "🎮", label: "Gaming" },
  awards: { emoji: "🏆", label: "Awards" },
  other: { emoji: "✨", label: "Custom" },
};

// Legacy rows predate the event_category column — infer a reasonable value
// rather than treating them as a 7th "unknown" bucket that always disappears
// once any category filter/badge logic runs.
export function eventCategoryOf(spaceType: string, eventCategory: string | null): EventCategory {
  if (eventCategory && eventCategory in EVENT_CATEGORIES) return eventCategory as EventCategory;
  return spaceType === "public_gathering" ? "movie" : "other";
}
