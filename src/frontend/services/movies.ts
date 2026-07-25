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

export async function searchMovies(query: string): Promise<Movie[]> {
  if (!query.trim()) return [];

  const url = `${process.env.EXPO_PUBLIC_API_URL}/api/movies/search?query=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  return mapResults(data.results);
}

export async function searchTvShows(query: string): Promise<Movie[]> {
  if (!query.trim()) return [];

  const url = `${process.env.EXPO_PUBLIC_API_URL}/api/movies/search-tv?query=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  return mapResults(data.results);
}

// Most-popular current movies, used to pre-populate the movie picker + home
// carousel before the host types anything. (MoviesDatabase has no literal
// "now playing in theaters" list; this is the closest equivalent.)
export async function getNowPlaying(): Promise<Movie[]> {
  const url = `${process.env.EXPO_PUBLIC_API_URL}/api/movies/now-playing`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  return mapResults(data.results);
}
