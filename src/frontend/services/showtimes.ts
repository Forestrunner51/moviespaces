import { authFetch } from "@/frontend/services/api";

// Client for the backend's scraped-showtimes cache (see the backend's
// ShowtimesScraperService for sourcing). This replaced the old flow where a
// host looked showtimes up on Google via a deep link and typed them in by
// hand — the picker now offers only real theaters, real films, and real
// times, so a Space can't be created with a showtime that doesn't exist.
//
// Coverage note: the cache holds whatever metros the backend scrapes
// (launch: Dallas–Fort Worth). An empty theater list here is the client's
// signal to say "no theaters near you yet", not an error.

export interface ShowtimeTheater {
  slug: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  movieCount: number;
}

export interface TheaterMovie {
  title: string;
  slug: string;
  times: { minutes: number; label: string }[];
}

export interface TheaterShowtimesDay {
  theaterSlug: string;
  theaterName: string | null;
  date: string; // YYYY-MM-DD
  availableDates: string[];
  lastUpdatedUtc: string | null;
  movies: TheaterMovie[];
}

// Nightly scrape → anything beyond ~a day and a half means the refresh has
// been failing and times may have drifted from reality. The data still
// shows; this only decides whether to warn.
export function isStale(lastUpdatedUtc: string | null | undefined): boolean {
  if (!lastUpdatedUtc) return false;
  const ageMs = Date.now() - new Date(lastUpdatedUtc).getTime();
  return ageMs > 36 * 60 * 60 * 1000;
}

const BASE = `${process.env.EXPO_PUBLIC_API_URL}/api/showtimes`;

// Nearest-first when the device's location is available; alphabetical
// otherwise (the backend handles both).
export async function fetchShowtimeTheaters(
  lat?: number | null,
  lng?: number | null,
): Promise<{ theaters: ShowtimeTheater[]; lastUpdatedUtc: string | null }> {
  const query = lat != null && lng != null ? `?lat=${lat}&lng=${lng}` : "";
  const res = await authFetch(`${BASE}/theaters${query}`);
  if (!res.ok) throw new Error(`Couldn't load theaters (${res.status}).`);
  const data = await res.json();
  return {
    theaters: (data.theaters ?? []) as ShowtimeTheater[],
    lastUpdatedUtc: data.lastUpdatedUtc ?? null,
  };
}

export async function fetchTheaterShowtimes(
  slug: string,
  date?: string,
): Promise<TheaterShowtimesDay> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  const res = await authFetch(`${BASE}/theaters/${encodeURIComponent(slug)}${query}`);
  if (!res.ok) throw new Error(`Couldn't load showtimes (${res.status}).`);
  return (await res.json()) as TheaterShowtimesDay;
}
