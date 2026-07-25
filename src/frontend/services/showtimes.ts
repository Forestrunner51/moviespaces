// Routed through our own backend (ShowtimesController) — NEVER call SerpApi
// from the client: the SerpApi key must stay server-side, and the backend
// caches results in Postgres so N hosts looking up the same movie+location
// cost one paid SerpApi search, not N.
import { authFetch } from "./api";

export interface Showing {
  type: string; // "Standard" | "IMAX" | "Dolby" | ...
  times: string[]; // e.g. ["7:15pm", "10:30pm"]
}

export interface Theater {
  name: string;
  address: string;
  showings: Showing[];
  ticketUrl: string; // SerpApi's booking link; "" when none provided
}

// source: "cache" | "live" | "none" — matches ShowtimeResponseDto.Source.
export interface ShowtimeResponse {
  source: string;
  theaters: Theater[];
}

// The exact time slot a host taps in ShowtimeSelector, handed back to the
// create-space form to populate theater + time (+ any real ticket URL).
export interface SelectedShowtime {
  theaterName: string;
  address: string;
  showingType: string;
  time: string;
  ticketUrl?: string;
}

// The backend always returns 200 with a { source, theaters } body (even on
// SerpApi failure it returns source "none" + []), so the client never has to
// handle a thrown error to render an empty state — but a network/timeout
// failure still lands here, so we normalize that to an empty "none" too.
export async function fetchShowtimes(
  movieTitle: string,
  location: string,
): Promise<ShowtimeResponse> {
  const empty: ShowtimeResponse = { source: "none", theaters: [] };
  if (!movieTitle.trim() || !location.trim()) return empty;

  try {
    const url =
      `${process.env.EXPO_PUBLIC_API_URL}/api/v1/showtimes` +
      `?movieTitle=${encodeURIComponent(movieTitle)}` +
      `&location=${encodeURIComponent(location)}`;

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
