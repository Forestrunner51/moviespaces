// Movie Roulette — spin for a random film plus a one-off practice CineMind
// challenge built around it. Uses authFetch (JWT-gated, same as CineMind)
// but never touches the daily streak or leaderboard — this is scratch
// practice, graded server-side and then discarded.

import { authFetchWithTimeout, authFetch } from "@/frontend/services/api";
import { PuzzleMovie, SubmittedAnswers, ChallengeResult } from "@/frontend/services/cinemind";

export type ChallengeType = "connection" | "chronos" | "castDeduct";

// No releaseYear — the reveal card only needs poster + title, and when the
// spin's challenge is Chronos this movie IS one of the four being ordered,
// so its year is an answer the client is never sent.
export interface RouletteMovie {
  imdbId: string;
  title: string;
  posterPath: string | null;
}

// Structurally identical to CineMind's ConnectionView/ChronosView/CastDeductView
// (see the backend comment in CineMindContracts.cs for why) — a discriminated
// union on challengeType, narrowed by the caller.
export interface RouletteConnectionChallenge {
  movies: PuzzleMovie[];
  linkKind: "actor" | "director";
  options: string[];
}
export interface RouletteChronosChallenge {
  movies: { imdbId: string; title: string; posterPath: string | null }[];
}
export interface RouletteCastDeductChallenge {
  movieA: PuzzleMovie;
  movieB: PuzzleMovie;
  options: string[];
}

export interface SpinResult {
  spinId: string;
  view: {
    movie: RouletteMovie;
    challengeType: ChallengeType;
    challenge: RouletteConnectionChallenge | RouletteChronosChallenge | RouletteCastDeductChallenge;
    // false when a genre was picked but the challenge's other films had to come
    // from outside it — some genres in a curated catalog simply can't field
    // four films sharing an actor. Surfaced in the UI rather than hidden, since
    // silently mixing genres is what made the filter look broken.
    genreScoped: boolean;
  };
}

// A fixed, curated set rather than reading whatever genres happen to exist in
// the catalog — the catalog is a moving target (reseed adds/changes films),
// and a pill list that silently gains or loses options between sessions would
// be a strange, unannounced UI change. These match OMDb's own genre strings.
export const ROULETTE_GENRES = [
  "Action", "Sci-Fi", "Drama", "Thriller", "Crime", "Animation", "Adventure", "Comedy",
] as const;

const BASE = `${process.env.EXPO_PUBLIC_API_URL}/api/roulette`;

// Same generous timeout as CineMind's cold-start-prone endpoints — Roulette
// hits the same backend and sleeps the same way.
export async function spinRoulette(genre: string | null): Promise<SpinResult> {
  const url = genre ? `${BASE}/spin?genre=${encodeURIComponent(genre)}` : `${BASE}/spin`;
  const res = await authFetchWithTimeout(url, {}, 45000);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Couldn't spin (${res.status}).`);
  }
  return (await res.json()) as SpinResult;
}

export async function gradeRouletteSpin(
  spinId: string,
  answer: SubmittedAnswers,
): Promise<ChallengeResult> {
  const res = await authFetch(`${BASE}/grade`, {
    method: "POST",
    body: JSON.stringify({ spinId, answer }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Couldn't grade that guess (${res.status}).`);
  }
  return (await res.json()) as ChallengeResult;
}
