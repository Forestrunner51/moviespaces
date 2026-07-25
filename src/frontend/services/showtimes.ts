// Routed through our backend (ShowtimesController → International Showtimes on
// RapidAPI). Never call the provider from the client: the key stays
// server-side, and the backend caches results to keep RapidAPI volume low.
// Showtimes are looked up by the movie's IMDb id (from MoviesDatabase search)
// near the picked theater's coordinates.
import { authFetch } from "./api";

export interface ShowingTime {
  time: string; // ISO 8601 start_at, e.g. "2026-07-25T19:15:00Z"
  bookingUrl?: string | null;
}

export interface Showing {
  type: string; // "Standard" | "3D" | "IMAX"
  times: ShowingTime[];
}

export interface Theater {
  name: string;
  address: string;
  showings: Showing[];
}

// source: "cache" | "live" | "none" — mirrors ShowtimeResponseDto.Source.
export interface ShowtimeResponse {
  source: string;
  theaters: Theater[];
}

// The exact slot a host taps, handed back to the create-space form to populate
// theater + date/time (+ any booking link). `time` is the ISO start_at.
export interface SelectedShowtime {
  theaterName: string;
  address: string;
  showingType: string;
  time: string;
  bookingUrl?: string | null;
}

// The backend always returns { source, theaters } (empty "none" on any
// failure), so the client just renders an empty state. A network/timeout
// failure is normalized to the same empty "none".
export async function fetchShowtimes(
  imdbId: string,
  lat: number,
  lng: number,
  date?: string,
): Promise<ShowtimeResponse> {
  const empty: ShowtimeResponse = { source: "none", theaters: [] };
  if (!imdbId.trim() || lat == null || lng == null) return empty;

  try {
    const params = new URLSearchParams({ imdbId, lat: String(lat), lng: String(lng) });
    if (date) params.set("date", date);
    const url = `${process.env.EXPO_PUBLIC_API_URL}/api/showtimes?${params.toString()}`;

    const res = await authFetch(url);
    if (!res.ok) return empty;

    const data = (await res.json()) as Partial<ShowtimeResponse> | null;
    return {
      source: data?.source ?? "none",
      theaters: Array.isArray(data?.theaters) ? data!.theaters : [],
    };
  } catch {
    return empty;
  }
}
