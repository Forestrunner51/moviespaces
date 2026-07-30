// CineMind — daily cinema puzzle API client.
//
// Uses authFetch (not plain fetch) because every endpoint is per-user: the
// once-per-day lock, streaks and leaderboards all key off the Supabase JWT.

import { authFetch } from "@/frontend/services/api";
import { supabase } from "@/frontend/config/supabase";

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
// Per-challenge outcome only — deliberately booleans with no answers, so a
// player who's finished can't read the solutions back out and pass them on.
export interface LockedResults {
  connection: boolean;
  chronos: boolean;
  castDeduct: boolean;
}

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
      results: LockedResults | null;
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

// The backend never reads Supabase's `profiles` table (the client owns that
// read everywhere in this app), so the display name for the global
// leaderboard has to be sent along with the answers. Best-effort: a failure
// here must not cost someone their submission — they just show as "Player".
async function currentDisplayName(): Promise<string | null> {
  try {
    // getSession() reads the cached session; getUser() would round-trip to
    // Supabase to re-validate the token, and this sits directly between
    // tapping Submit and seeing a score.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return null;

    const { data } = await supabase
      .from("profiles")
      .select("display_name, username")
      .eq("id", session.user.id)
      .maybeSingle();

    return data?.display_name || data?.username || null;
  } catch (err) {
    console.warn("Couldn't resolve display name for leaderboard:", err);
    return null;
  }
}

export async function submitPuzzle(
  answers: SubmittedAnswers,
  timeTakenMs: number,
): Promise<SubmitResult> {
  const displayName = await currentDisplayName();
  const res = await authFetch(`${BASE}/puzzles/submit`, {
    method: "POST",
    body: JSON.stringify({ answers, timeTakenMs, displayName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Couldn't submit your answers (${res.status}).`);
  }
  return (await res.json()) as SubmitResult;
}

export interface CineMindStats {
  gamesPlayed: number;
  currentStreak: number;
  maxStreak: number;
  perfectCount: number;
  averageScore: number;
  playedToday: boolean;
  distribution: {
    perfect: number;
    twoOfThree: number;
    oneOfThree: number;
    blank: number;
  };
}

// Returns null rather than throwing: stats decorate a screen that already has
// a result on it, so a failure here should never replace a working screen
// with an error.
export async function fetchStats(): Promise<CineMindStats | null> {
  try {
    const res = await authFetch(`${BASE}/stats`);
    if (!res.ok) return null;
    return (await res.json()) as CineMindStats;
  } catch (err) {
    console.warn("fetchStats failed:", err);
    return null;
  }
}

export interface GlobalLeaderboard {
  puzzleDate: string;
  playedCount: number;
  // True when more people played than the returned slice — the board is
  // capped, so the list isn't the full field.
  isTruncated: boolean;
  // Present once you've played today, even if you rank below the cutoff.
  you: LeaderboardEntry | null;
  leaderboard: LeaderboardEntry[];
}

// Unlike the per-Space board, this throws on failure: it backs a whole screen
// whose only job is to show it, so a silent null would render an empty tab
// that looks identical to "nobody has played".
export async function fetchGlobalLeaderboard(): Promise<GlobalLeaderboard> {
  const res = await authFetch(`${BASE}/leaderboard/global`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Couldn't load the leaderboard (${res.status}).`);
  }
  return (await res.json()) as GlobalLeaderboard;
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
