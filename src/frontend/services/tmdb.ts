// TMDb's v3 API key is designed to be used client-side (unlike MovieGlu's
// credentials, which required a paid partner relationship) — no backend
// proxy needed here.
const TMDB_API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY;
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w200";

export interface TmdbMovie {
  id: number;
  title: string;
  posterPath: string | null;
  releaseDate: string;
}

export async function searchMovies(query: string): Promise<TmdbMovie[]> {
  if (!query.trim() || !TMDB_API_KEY) return [];

  const url = `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  return (data.results || []).map((r: any) => ({
    id: r.id,
    title: r.title,
    posterPath: r.poster_path ? `${TMDB_IMAGE_BASE}${r.poster_path}` : null,
    releaseDate: r.release_date || "",
  }));
}
