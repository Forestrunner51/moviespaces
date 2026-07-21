export const POST_ACTIVITIES = [
  { key: "eat_out", label: "Eat Out", emoji: "🍔" },
  { key: "drinks", label: "Grab Drinks", emoji: "🍹" },
  { key: "walk", label: "Go for a Walk", emoji: "🚶" },
  { key: "hangout", label: "Hang Out Longer", emoji: "🎉" },
  { key: "coffee", label: "Coffee & Dessert", emoji: "☕" },
  // Watch-party specific — "eat_out"/"drinks" above already cover the
  // food-after case, these are the at-the-watch-party equivalents.
  { key: "potluck", label: "Potluck / Snacks", emoji: "🍲" },
  { key: "byob", label: "BYOB", emoji: "🍺" },
  { key: "pizza", label: "Ordering Pizza", emoji: "🍕" },
  { key: "spoiler_chat", label: "Post-Show Spoiler Discussion", emoji: "🗣️" },
] as const;

export type PostActivityKey = (typeof POST_ACTIVITIES)[number]["key"];

export const activityLabel = (key: string) =>
  POST_ACTIVITIES.find((a) => a.key === key)?.label ?? key;

export const activityEmoji = (key: string) =>
  POST_ACTIVITIES.find((a) => a.key === key)?.emoji ?? "✨";
