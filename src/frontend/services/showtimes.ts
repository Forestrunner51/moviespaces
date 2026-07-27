// Real showtimes from our own database, populated nightly by the Apify
// CinemaClock scrape (see backend ApifyWebhookController). Replaces the old
// "open a Google search and read the time off it" redirect when we actually
// have data for the chosen film + theater; the redirect stays as the fallback
// when we don't.

export interface ShowtimeSlot {
  id: string;
  theaterName: string;
  city: string | null;
  // LOCAL wall-clock at the theater, e.g. "2026-07-28T14:00:00".
  // Deliberately has NO trailing "Z" — the scraper gives no timezone, so this
  // must not be reinterpreted as UTC. Parse it as-is.
  startsAt: string;
  date: string; // "2026-07-28"
  time: string; // "2:00 PM"
  format: string | null;
  bookingLink: string | null;
}

export interface ShowtimeLookup {
  // The theater name as it appears in OUR data, which may differ from the
  // Google Places name the user picked ("AMC Empire 25 DINE-IN" vs
  // "AMC Empire 25"). Null when nothing matched closely enough.
  matchedTheaterName: string | null;
  slots: ShowtimeSlot[];
}

const EMPTY: ShowtimeLookup = { matchedTheaterName: null, slots: [] };

export async function fetchShowtimes(
  movieTitle: string,
  theaterName?: string,
): Promise<ShowtimeLookup> {
  if (!movieTitle.trim()) return EMPTY;

  const params = new URLSearchParams({ movieTitle: movieTitle.trim() });
  if (theaterName?.trim()) params.set("theaterName", theaterName.trim());

  try {
    const res = await fetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/showtimes?${params.toString()}`,
    );
    if (!res.ok) return EMPTY;

    const data = await res.json();
    return {
      matchedTheaterName: data.matchedTheaterName ?? null,
      slots: (data.showtimes || []) as ShowtimeSlot[],
    };
  } catch (err) {
    // Never surface as an error — a failed lookup just means the host falls
    // back to the Google redirect and sets the time manually.
    console.warn("fetchShowtimes failed:", err);
    return EMPTY;
  }
}

// Groups slots by their local date, preserving the server's chronological
// order, so the picker can render one row of time chips per day.
export function groupSlotsByDate(slots: ShowtimeSlot[]): { date: string; slots: ShowtimeSlot[] }[] {
  const byDate = new Map<string, ShowtimeSlot[]>();
  for (const slot of slots) {
    const existing = byDate.get(slot.date);
    if (existing) existing.push(slot);
    else byDate.set(slot.date, [slot]);
  }
  return [...byDate.entries()].map(([date, grouped]) => ({ date, slots: grouped }));
}

// "2026-07-28" -> "Tue, Jul 28". Built from the parts rather than
// `new Date(str)` because that would parse as UTC midnight and can render as
// the previous day west of Greenwich.
export function formatSlotDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  const local = new Date(year, month - 1, day);
  return local.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
