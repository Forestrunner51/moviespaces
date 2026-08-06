import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/frontend/config/supabase";
import { useForegroundPoll } from "@/frontend/hooks/use-foreground-poll";

// Same shape/purpose as use-unread-counts.ts (Spaces' "N new messages"
// badge), but for DMs — which live in the separate `messages` table
// (sender_id/receiver_id), not group_messages. Read markers still go through
// group_message_reads, keyed as group_type "dm" / group_id = the friend's
// user id (see use-chat.ts's read-marking effect).
// How far back to look for unread messages from a conversation the user has
// never opened. Anything older than this stops counting toward the badge —
// a "new message" notice for something this stale isn't useful, and without
// a floor the query has to scan the account's entire message history.
const UNREAD_LOOKBACK_DAYS = 60;

export function useDmUnreadCounts(friendIds: string[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const friendIdsKey = friendIds.join(",");

  // Guards the post-await setState after unmount — previously a `cancelled`
  // flag scoped to the polling effect. `load` has to outlive that effect now
  // (useForegroundPoll owns the interval), so the flag becomes a ref that a
  // dedicated unmount effect flips.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (friendIds.length === 0) setCounts({});
  }, [friendIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(
    async () => {
      if (friendIds.length === 0) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: reads } = await supabase
        .from("group_message_reads")
        .select("group_id, last_read_at")
        .eq("group_type", "dm")
        .eq("user_id", user.id)
        .in("group_id", friendIds);

      if (cancelledRef.current) return;

      const lastReadByFriend: Record<string, string> = {};
      (reads || []).forEach((r) => {
        lastReadByFriend[r.group_id] = r.last_read_at;
      });

      // Only fetch messages that could possibly still be unread, instead of
      // every DM the user has ever received — this runs every 15s, so pulling
      // full history grows unbounded with the account's age.
      //
      // The floor is the oldest "last read" across these friends; a friend
      // with no marker at all falls back to the lookback window, since an
      // unread badge for something months old isn't actionable anyway.
      //
      // Compared as epoch numbers, not ISO strings: PostgREST returns
      // timestamptz as "…+00:00" while toISOString() emits "…Z", so a
      // lexicographic min between the two formats isn't reliable.
      const lookbackFloorMs = Date.now() - UNREAD_LOOKBACK_DAYS * 86400_000;
      const floorMs = friendIds.reduce((min, id) => {
        const read = lastReadByFriend[id];
        const ms = read ? Date.parse(read) : lookbackFloorMs;
        return ms < min ? ms : min;
      }, Date.now());
      const floor = new Date(floorMs).toISOString();

      const { data: messages } = await supabase
        .from("messages")
        .select("sender_id, created_at")
        .eq("receiver_id", user.id)
        .in("sender_id", friendIds)
        .gt("created_at", floor);

      if (cancelledRef.current) return;

      const next: Record<string, number> = {};
      (messages || []).forEach((m) => {
        const lastRead = lastReadByFriend[m.sender_id];
        if (!lastRead || new Date(m.created_at) > new Date(lastRead)) {
          next[m.sender_id] = (next[m.sender_id] || 0) + 1;
        }
      });

      setCounts(next);
    },
    // friendIdsKey, not friendIds: an array literal's identity changes every
    // render even when its contents don't, which would rebuild `load` (and
    // restart the poll) constantly.
    [friendIdsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useForegroundPoll(load, 15000, friendIds.length > 0, friendIdsKey);

  return counts;
}
