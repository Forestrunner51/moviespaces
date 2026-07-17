import { authFetch } from "@/frontend/services/api";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export interface TmdbMovie {
  id: number;
  title: string;
  posterPath: string | null;
  overview: string | null;
  releaseDate: string | null;
  voteAverage: number;
}

export interface Pledge {
  id: string;
  userId: string;
  pledgeAmount: number;
  status: "authorized" | "captured" | "released" | "failed";
  createdAt: string;
}

export interface CrowdfundSpace {
  id: string;
  movieId: string;
  movieTitle: string;
  moviePosterUrl: string | null;
  theaterId: string;
  theaterName: string;
  showtime: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  status: "funding" | "successful" | "failed" | "cancelled";
  creatorId: string;
  maxParticipants: number | null;
  pledges: Pledge[];
}

export interface CreateSpaceInput {
  movieId: string;
  movieTitle: string;
  moviePosterUrl: string | null;
  theaterId: string;
  theaterName: string;
  showtime: string;
  targetAmount: number;
  deadline: string;
  maxParticipants: number | null;
}

async function parseErrorOrThrow(res: Response, fallback: string) {
  let message = fallback;
  try {
    const body = await res.json();
    if (body?.error) message = body.error;
  } catch {
    // response wasn't JSON — keep the fallback message
  }
  throw new Error(message);
}

export async function searchMovies(query: string): Promise<TmdbMovie[]> {
  const res = await authFetch(
    `${API_URL}/api/tmdb/search?query=${encodeURIComponent(query)}`,
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((m: any) => ({
    id: m.id,
    title: m.title,
    posterPath: m.posterPath ?? null,
    overview: m.overview ?? null,
    releaseDate: m.releaseDate ?? null,
    voteAverage: m.voteAverage ?? 0,
  }));
}

export async function createSpace(input: CreateSpaceInput): Promise<string> {
  const res = await authFetch(`${API_URL}/api/space`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) await parseErrorOrThrow(res, "Failed to create space.");
  const data = await res.json();
  return data.spaceId;
}

export async function getSpace(id: string): Promise<CrowdfundSpace> {
  const res = await authFetch(`${API_URL}/api/space/${id}`);
  if (!res.ok) await parseErrorOrThrow(res, "Failed to load space.");
  return res.json();
}

export async function getMySpaces(): Promise<CrowdfundSpace[]> {
  const res = await authFetch(`${API_URL}/api/space/mine`);
  if (!res.ok) return [];
  return res.json();
}

export async function getOpenSpaces(filters?: {
  movieId?: string;
  theaterId?: string;
  showtime?: string; // ISO string — exact match against a specific cinema+time slot
}): Promise<CrowdfundSpace[]> {
  const params = new URLSearchParams();
  if (filters?.movieId) params.set("movieId", filters.movieId);
  if (filters?.theaterId) params.set("theaterId", filters.theaterId);
  if (filters?.showtime) params.set("showtime", filters.showtime);
  const qs = params.toString();
  const res = await authFetch(`${API_URL}/api/space/open${qs ? `?${qs}` : ""}`);
  if (!res.ok) return [];
  return res.json();
}

export async function cancelSpace(id: string): Promise<void> {
  const res = await authFetch(`${API_URL}/api/space/${id}/cancel`, { method: "POST" });
  if (!res.ok) await parseErrorOrThrow(res, "Failed to cancel space.");
}

export async function createPledge(
  spaceId: string,
  amount: number,
): Promise<{ pledgeId: string; clientSecret: string }> {
  const res = await authFetch(`${API_URL}/api/space/${spaceId}/pledges`, {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
  if (!res.ok) await parseErrorOrThrow(res, "Failed to create pledge.");
  return res.json();
}
