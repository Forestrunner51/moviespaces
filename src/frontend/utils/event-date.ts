// Formatting for a Space's date/time.
//
// ShowDate/ShowTime on a Group are host-typed free text and can't be reliably
// parsed or reformatted, but ScreeningTime is a real timestamp and is set on
// every Space created through the current form. Where it exists we can render
// a proper, emphasised date; where it doesn't (legacy rows) we fall back to
// the host's raw strings rather than showing nothing.

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface EventDateParts {
  // "Sat, Aug 14" — or the host's raw ShowDate for legacy Spaces.
  date: string;
  // "7:30 PM" — or the host's raw ShowTime.
  time: string;
  // "Tonight" / "Tomorrow" / "In 3 days" / "Last week". Null when unknown.
  relative: string | null;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Whole calendar days between now and the event — not a raw hour division, so
// an event at 9pm tonight reads "Tonight" rather than "In 0 days", and one at
// 1am tomorrow reads "Tomorrow" even though it's only a few hours away.
function relativeLabel(target: Date): string {
  const days = Math.round((startOfDay(target) - startOfDay(new Date())) / 86400_000);
  if (days === 0) return target.getHours() >= 17 ? "Tonight" : "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days <= 6) return `In ${days} days`;
  if (days < -1 && days >= -6) return `${Math.abs(days)} days ago`;
  // Pluralize off the computed week count, not the raw day count — the old
  // `days >= 14` check rendered "In 2 week" for 8–13 days (which round to 2).
  // Math.round, not ceil: 15 days is closer to 2 weeks than 3.
  const weeks = Math.max(1, Math.round(Math.abs(days) / 7));
  const plural = weeks === 1 ? "" : "s";
  return days > 0 ? `In ${weeks} week${plural}` : `${weeks} week${plural} ago`;
}

export function formatEventDate(
  screeningTime: string | null | undefined,
  fallbackDate: string,
  fallbackTime: string,
): EventDateParts {
  if (!screeningTime) {
    return { date: fallbackDate, time: fallbackTime, relative: null };
  }
  const d = new Date(screeningTime);
  if (Number.isNaN(d.getTime())) {
    return { date: fallbackDate, time: fallbackTime, relative: null };
  }

  return {
    date: `${DAY[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`,
    time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    relative: relativeLabel(d),
  };
}
