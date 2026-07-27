// Movie/TV metadata via our backend (MoviesController → MoviesDatabase on
// RapidAPI). Routed through the backend so the RapidAPI key stays server-side
// and responses are cached. The backend already maps the provider's schema
// into { imdbId, title, posterUrl, releaseYear }, so this layer barely
// transforms — it only renames posterUrl → posterPath to match the existing
// MoviePoster / create-space consumers.

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

export interface SearchOutcome {
  results: Movie[];
  // Set when OMDb rejected the query itself (e.g. too short/generic) rather
  // than genuinely finding nothing — worth showing the user, not an error.
  notice: string | null;
}

export async function searchMovies(query: string): Promise<SearchOutcome> {
  if (!query.trim()) return { results: [], notice: null };

  const url = `${process.env.EXPO_PUBLIC_API_URL}/api/movies/search?query=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Movie search failed (${res.status})`);

  const data = await res.json();
  return { results: mapResults(data.results), notice: data.message ?? null };
}

export async function searchTvShows(query: string): Promise<SearchOutcome> {
  if (!query.trim()) return { results: [], notice: null };

  const url = `${process.env.EXPO_PUBLIC_API_URL}/api/movies/search-tv?query=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TV search failed (${res.status})`);

  const data = await res.json();
  return { results: mapResults(data.results), notice: data.message ?? null };
}

// A rotating "Surprise Me" pick, used to pre-populate the movie picker + home
// carousel before the host types anything. The backend rotates the set
// weekly from a larger curated pool (OMDb has no popularity/list endpoint).
export async function getNowPlaying(): Promise<Movie[]> {
  const url = `${process.env.EXPO_PUBLIC_API_URL}/api/movies/now-playing`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    return mapResults(data.results);
  } catch (err) {
    console.warn("getNowPlaying failed:", err);
    return [];
  }
}
