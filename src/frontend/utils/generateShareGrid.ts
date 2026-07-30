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
  // Optional Space to invite people into; omitted for a solo share.
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
  shareBaseUrl = "https://cinemind.app",
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

  lines.push("");
  lines.push(
    spaceId
      ? `Play today in Space: ${shareBaseUrl}/s/${spaceId}`
      : `Play today: ${shareBaseUrl}`,
  );

  return lines.join("\n");
}
