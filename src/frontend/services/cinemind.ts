// CineMind — daily cinema puzzle API client.
//
// Uses authFetch (not plain fetch) because every endpoint is per-user: the
// once-per-day lock, streaks and leaderboards all key off the Supabase JWT.

import { authFetch } from "@/frontend/services/api";

export interface PuzzleMovie {
  imdbId: string;
  title: string;
  releaseYear: number;
  posterPath: string | null;
}

export interface ConnectionView {
  movies: PuzzleMovie[];
  linkKind: "actor" | "director";
  options: string[];
}

// No releaseYear, mirroring the server: the year is the answer to Chronos, so
// it's stripped from the payload rather than merely left unrendered.
export interface ChronosMovie {
  imdbId: string;
  title: string;
  posterPath: string | null;
}

export interface ChronosView {
  movies: ChronosMovie[];
}

export interface CastDeductView {
  movieA: PuzzleMovie;
  movieB: PuzzleMovie;
  options: string[];
}

export interface PuzzleView {
  puzzleNumber: number;
  puzzleDate: string;
  connection: ConnectionView;
  chronos: ChronosView;
  castDeduct: CastDeductView;
}

// Discriminated on isLocked so the screen can't accidentally read a puzzle
// that the server deliberately withheld.
export type TodayResponse =
  | {
      isLocked: true;
      puzzleNumber: number;
      score: number;
      maxScore: number;
      timeTakenMs: number;
      streakCount: number;
      completedAt: string;
      secondsUntilNextPuzzle: number;
    }
  | {
      isLocked: false;
      secondsUntilNextPuzzle: number;
      streakCount: number;
      puzzle: PuzzleView;
    };

export interface SubmittedAnswers {
  connectionAnswer: string | null;
  chronosOrder: string[] | null;
  castDeductAnswer: string | null;
}

export interface ChallengeResult {
  correct: boolean;
  points: number;
  correctAnswer: string | null;
}

export interface SubmitResult {
  score: number;
  maxScore: number;
  timeTakenMs: number;
  streakCount: number;
  percentileRank: number;
  connection: ChallengeResult;
  chronos: ChallengeResult;
  castDeduct: ChallengeResult;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  score: number;
  timeTakenMs: number;
  streakCount: number;
  isYou: boolean;
}

export interface SpaceLeaderboard {
  spaceId: string;
  spaceName: string;
  puzzleDate: string;
  playedCount: number;
  memberCount: number;
  leaderboard: LeaderboardEntry[];
}

const BASE = `${process.env.EXPO_PUBLIC_API_URL}/api/game`;

export async function fetchTodayPuzzle(): Promise<TodayResponse> {
  const res = await authFetch(`${BASE}/puzzles/today`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Surfaced rather than swallowed: an unseeded catalog returns 503 here,
    // and silently showing an empty board would be indistinguishable from a
    // bug.
    throw new Error(body?.error || `Couldn't load today's puzzle (${res.status}).`);
  }
  return (await res.json()) as TodayResponse;
}

export async function submitPuzzle(
  answers: SubmittedAnswers,
  timeTakenMs: number,
): Promise<SubmitResult> {
  const res = await authFetch(`${BASE}/puzzles/submit`, {
    method: "POST",
    body: JSON.stringify({ answers, timeTakenMs }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Couldn't submit your answers (${res.status}).`);
  }
  return (await res.json()) as SubmitResult;
}

export async function fetchSpaceLeaderboard(spaceId: string): Promise<SpaceLeaderboard | null> {
  try {
    const res = await authFetch(`${BASE}/spaces/${spaceId}/leaderboard`);
    if (!res.ok) return null;
    return (await res.json()) as SpaceLeaderboard;
  } catch (err) {
    // A leaderboard is supplementary — never block the game on it.
    console.warn("fetchSpaceLeaderboard failed:", err);
    return null;
  }
}

// "1m 24s" — the format the share grid and results screen both use.
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// "05h 12m 34s" for the locked-state countdown.
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}
