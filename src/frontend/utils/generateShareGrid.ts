// Builds the copy-pasteable result block — the game's entire growth loop.
//
// Two constraints drive the format:
//  1. SPOILER-FREE. It reports whether each challenge was solved, never what
//     the answers were, so it's safe to paste into a group chat where others
//     haven't played today's puzzle yet.
//  2. Plain text + emoji only. No markdown, no links that need unfurling —
//     it has to survive iMessage, WhatsApp, X and Discord unchanged.

import { formatDuration } from "@/frontend/services/cinemind";

// Structural, not `SubmitResult`, so the locked state can build the same grid
// from the booleans it gets back on a return visit. SubmitResult satisfies
// this shape as-is.
export interface ShareableResult {
  score: number;
  maxScore: number;
  timeTakenMs: number;
  streakCount: number;
  connection: { correct: boolean };
  chronos: { correct: boolean };
  castDeduct: { correct: boolean };
}

export interface ShareGridOptions {
  puzzleNumber: number;
  result: ShareableResult;
  // Optional Space (its SpaceCode or id) to invite people into; omitted for
  // a solo share. When given, the link uses the backend's own working
  // web-invite page (moviespaces.onrender.com/space/{code}) — the same
  // mechanism group.tsx's own share button already uses, and the only
  // domain this app actually owns and serves. There's no reason to invent a
  // second, fake one.
  spaceId?: string | null;
  shareBaseUrl?: string;
}

// Chronos is the only challenge that can be partially right (order of four),
// so it's the only one that can show yellow. The other two are binary.
function marker(correct: boolean): string {
  return correct ? "🟩" : "🟥";
}

export function generateShareGrid({
  puzzleNumber,
  result,
  spaceId,
  shareBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? "",
}: ShareGridOptions): string {
  const lines: string[] = [];

  lines.push(`CineMind #${puzzleNumber} 🧠`);
  lines.push(`⚡ Score: ${result.score}/${result.maxScore} | ${formatDuration(result.timeTakenMs)}`);

  // A streak is only worth bragging about once it's a streak.
  if (result.streakCount > 1) {
    lines.push(`🔥 Streak: ${result.streakCount} Days`);
  }

  lines.push("");
  lines.push(`${marker(result.connection.correct)} The Connection`);
  lines.push(`${marker(result.chronos.correct)} Chronos`);
  lines.push(`${marker(result.castDeduct.correct)} Cast Deduct`);

  if (result.score === result.maxScore) {
    lines.push("");
    lines.push("🏆 Perfect score!");
  }

  // Solo shares get no link at all rather than a fabricated one — there's no
  // real web landing page for CineMind on its own yet (pre-launch, no app
  // store listing), and a dead URL pasted into a group chat is worse than no
  // URL. A Space invite has a real, working link, so that case gets one.
  lines.push("");
  lines.push(spaceId ? `Play today in Space: ${shareBaseUrl}/space/${spaceId}` : "Play today on MovieSpaces 🍿");

  return lines.join("\n");
}
