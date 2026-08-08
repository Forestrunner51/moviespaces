// Builds the message for the game's entire growth loop: sharing a result.
//
// Deliberately short, and leads with a REAL link (the backend's own
// /cinemind-result/{id} page — see GameController.ResultPage) rather than
// pasting a multi-line emoji grid as the message itself. A wall of 🟩🟥 rows
// copy-pasted into a chat reads as generated/templated; a short brag line
// plus one real link a friend can actually open reads like something a
// person typed. The rows themselves still exist — they're just rendered on
// the webpage the link opens, not duplicated in the text.
//
// SPOILER-FREE either way: neither the message nor the linked page reveals
// any answer, only whether each challenge was solved.

import { formatDuration } from "@/frontend/services/cinemind";

// Structural, not `SubmitResult`, so the locked state can build the same
// message from the booleans it gets back on a return visit. SubmitResult
// satisfies this shape as-is.
export interface ShareableResult {
  score: number;
  maxScore: number;
  timeTakenMs: number;
  streakCount: number;
}

export interface ShareGridOptions {
  puzzleNumber: number;
  result: ShareableResult;
  // The UserDailyProgress row's own id (SubmitResult.shareId, or the locked
  // response's shareId) — required, not optional: without a real id there's
  // no real page to link to, which is the exact problem this replaced.
  shareId: string;
  // Optional Space to invite people into; omitted for a solo share.
  spaceId?: string | null;
  shareBaseUrl?: string;
}

export function generateShareGrid({
  puzzleNumber,
  result,
  shareId,
  spaceId,
  shareBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? "",
}: ShareGridOptions): string {
  const perfect = result.score === result.maxScore;
  const lines: string[] = [
    `CineMind #${puzzleNumber} 🧠 — ${result.score}/${result.maxScore} in ${formatDuration(result.timeTakenMs)}${perfect ? " 🏆" : ""}`,
  ];

  // A streak is only worth bragging about once it's a streak.
  if (result.streakCount > 1) {
    lines.push(`🔥 ${result.streakCount} day streak`);
  }

  // Only append links when there's a real base URL to build them on — with
  // EXPO_PUBLIC_API_URL unset, "/cinemind-result/<id>" is a bare relative
  // path pasted into a chat, which reads as a broken link. The score lines
  // above are still worth sharing on their own.
  if (shareBaseUrl) {
    lines.push(`${shareBaseUrl}/cinemind-result/${shareId}`);

    if (spaceId) {
      lines.push(`Join my Space: ${shareBaseUrl}/space/${spaceId}`);
    }
  }

  return lines.join("\n");
}
