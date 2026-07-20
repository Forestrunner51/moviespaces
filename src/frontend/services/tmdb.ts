// Routed through our own backend (TmdbController) rather than calling TMDb
// directly: TMDb's rate limit is per API key, and a key embedded in every
// app install would mean the whole user base shares one ceiling. The backend
// also caches responses for 24h, so N users searching the same movie only
// costs one real TMDb request.
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w200";

export interface TmdbMovie {
  id: number;
  title: string;
  posterPath: string | null;
  releaseDate: string;
}

function mapResults(results: any[]): TmdbMovie[] {
  return (results || []).map((r: any) => ({
    id: r.id,
    title: r.title,
    posterPath: r.poster_path ? `${TMDB_IMAGE_BASE}${r.poster_path}` : null,
    releaseDate: r.release_date || "",
  }));
}

export async function searchMovies(query: string): Promise<TmdbMovie[]> {
  if (!query.trim()) return [];

  const url = `${process.env.EXPO_PUBLIC_API_URL}/api/tmdb/search?query=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  return mapResults(data.results);
}

// Box-office-active titles, used to pre-populate the movie picker before the
// host types anything — narrows the field to films actually worth starting
// a Space around instead of an empty list.
export async function getNowPlaying(): Promise<TmdbMovie[]> {
  const url = `${process.env.EXPO_PUBLIC_API_URL}/api/tmdb/now-playing`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  return mapResults(data.results);
}
