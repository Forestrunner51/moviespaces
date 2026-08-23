import { useCallback, useState } from "react";
import { fetchTodayPuzzle } from "@/frontend/services/cinemind";
import { useForegroundPoll } from "@/frontend/hooks/use-foreground-poll";

// True while today's CineMind puzzle exists and hasn't been played yet —
// drives the badge on the CineMind tab. isLocked flips to true the moment
// the day's puzzle is submitted, so finishing it clears the badge on the
// next poll; the five-minute interval also picks up the midnight rollover.
export function useCineMindBadge(): boolean {
  const [available, setAvailable] = useState(false);
  const load = useCallback(async () => {
    try {
      const today = await fetchTodayPuzzle();
      setAvailable(!today.isLocked);
    } catch {
      /* offline or signed out — no badge rather than a stale one */
      setAvailable(false);
    }
  }, []);
  useForegroundPoll(load, 5 * 60 * 1000, true, "cinemind-badge");
  return available;
}
