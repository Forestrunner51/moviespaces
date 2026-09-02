// Movie/TV metadata via our backend (MoviesController → OMDb). Routed
// through the backend so the OMDb key stays server-side and responses are
// cached. The backend already maps the provider's schema into { imdbId,
// title, posterUrl, releaseYear }, so this layer barely transforms — it only
// renames posterUrl → posterPath to match the existing MoviePoster /
// create-space consumers.
//
// authFetch, not plain fetch — MoviesController is [Authorize]d (an
// unauthenticated proxy to a quota-limited API would let anyone burn OMDb's
// daily request quota), so every call here needs the bearer token.

import { authFetch } from "@/frontend/services/api";

export interface Movie {
  imdbId: string; // standard IMDb id, e.g. "tt1160419"
  title: string;
  posterPath: string | null; // full poster URL (MoviesDatabase primaryImage.url)
  releaseYear: number | null;
}

function mapResults(results: any[]): Movie[] {
  return (results || []).map((r: any) => ({
    imdbId: r.imdbId,
    title: r.title,
    posterPath: r.posterUrl ?? null,
    releaseYear: r.releaseYear ?? null,
  }));
}

// Resolve a marquee title (a scraped showtime's bare title, no year or id)
// to the most plausible film. A title on a marquee is either a current
// release or a re-release of a famous film, and OMDb's own result order
// roughly tracks fame — so: exact-title matches released in the current
// theatrical window first (a remake in theaters now beats the original),
// otherwise the top exact match in OMDb's order (a "Jaws" re-release is the
// 1975 film, not whatever same-titled short is newest — sorting by newest
// year here is how wrong posters happened), otherwise the top result with a
// poster at all. Callers that need "was this an exact match?" (to trust the
// imdbId) can compare the pick's title themselves.
export function pickFilmForShowing(results: Movie[], marqueeTitle: string): Movie | null {
  const wanted = marqueeTitle.trim().toLowerCase();
  const withPoster = results.filter((r) => r.posterPath);
  const exact = withPoster.filter((r) => r.title.trim().toLowerCase() === wanted);
  const windowStart = new Date().getFullYear() - 1;
  const current = exact.filter((r) => r.releaseYear != null && r.releaseYear >= windowStart);
  return current[0] ?? exact[0] ?? withPoster[0] ?? null;
}

export interface SearchOutcome {
  results: Movie[];
  // Set when OMDb rejected the query itself (e.g. too short/generic) rather
  // than genuinely finding nothing — worth showing the user, not an error.
  notice: string | null;
}

export async function searchMovies(query: string): Promise<SearchOutcome> {
  if (!query.trim()) return { results: [], notice: null };

  const url = `${process.env.EXPO_PUBLIC_API_URL}/api/movies/search?query=${encodeURIComponent(query)}`;
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`Movie search failed (${res.status})`);

  const data = await res.json();
  return { results: mapResults(data.results), notice: data.message ?? null };
}

export async function searchTvShows(query: string): Promise<SearchOutcome> {
  if (!query.trim()) return { results: [], notice: null };

  const url = `${process.env.EXPO_PUBLIC_API_URL}/api/movies/search-tv?query=${encodeURIComponent(query)}`;
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`TV search failed (${res.status})`);

  const data = await res.json();
  return { results: mapResults(data.results), notice: data.message ?? null };
}

// A rotating "Surprise Me" pick, used to pre-populate the movie picker + home
// carousel before the host types anything. The backend rotates the set
// weekly from a larger curated pool (OMDb has no popularity/list endpoint).
//
// mediaType "tv" returns the same rotating list drawn from the TV catalog —
// the picker's TV mode used to render an empty modal until you typed, which
// looked broken next to movie mode filling itself in.
export async function getNowPlaying(mediaType: "movie" | "tv" = "movie"): Promise<Movie[]> {
  const url = `${process.env.EXPO_PUBLIC_API_URL}/api/movies/now-playing?mediaType=${mediaType}`;
  try {
    const res = await authFetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    return mapResults(data.results);
  } catch (err) {
    console.warn("getNowPlaying failed:", err);
    return [];
  }
}
