import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/frontend/config/supabase";
import { loadBlockedIds } from "@/frontend/services/moderation";
import { useForegroundPoll } from "@/frontend/hooks/use-foreground-poll";

// Counts messages sent (by someone else) after the user's last read marker
// for each group, so a Spaces list can show "N new messages" per card.
// One pair of queries total regardless of how many spaces are passed in —
// not a query per space.
// Matches use-dm-unread-counts.ts — see there for why a floor exists at all.
const UNREAD_LOOKBACK_DAYS = 60;

export function useUnreadCounts(groupIds: string[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // A stable, primitive dependency for the effect below — an array literal's
  // identity changes every render even when its contents don't, which would
  // re-trigger this effect (and its poll interval) constantly.
  const groupIdsKey = groupIds.join(",");

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
    if (groupIds.length === 0) setCounts({});
  }, [groupIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(
    async () => {
      if (groupIds.length === 0) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: reads } = await supabase
        .from("group_message_reads")
        .select("group_id, last_read_at")
        .eq("group_type", "group")
        .eq("user_id", user.id)
        .in("group_id", groupIds);

      if (cancelledRef.current) return;

      const lastReadByGroup: Record<string, string> = {};
      (reads || []).forEach((r) => {
        lastReadByGroup[r.group_id] = r.last_read_at;
      });

      // Bounded to messages that could still be unread rather than every
      // message in every Space the user belongs to — this polls every 15s, so
      // an unbounded fetch grows with the account's whole chat history. The
      // floor is the oldest "last read" across these Spaces; a Space never
      // opened falls back to the lookback window.
      //
      // Epoch-number comparison, not string: PostgREST returns timestamptz as
      // "…+00:00" while toISOString() emits "…Z", so taking a lexicographic
      // min across the two formats isn't reliable.
      const lookbackFloorMs = Date.now() - UNREAD_LOOKBACK_DAYS * 86400_000;
      const floorMs = groupIds.reduce((min, id) => {
        const read = lastReadByGroup[id];
        const ms = read ? Date.parse(read) : lookbackFloorMs;
        return ms < min ? ms : min;
      }, Date.now());
      const floor = new Date(floorMs).toISOString();

      const { data: messages } = await supabase
        .from("group_messages")
        .select("group_id, sender_id, created_at")
        .eq("group_type", "group")
        .in("group_id", groupIds)
        .neq("sender_id", user.id)
        .gt("created_at", floor);

      if (cancelledRef.current) return;

      // Messages from someone you've blocked don't count — they aren't shown
      // in the chat either, so a badge for them would never clear.
      const blocked = await loadBlockedIds().catch(() => new Set<string>());
      if (cancelledRef.current) return;

      const next: Record<string, number> = {};
      (messages || []).forEach((m) => {
        if (blocked.has(m.sender_id)) return;
        const lastRead = lastReadByGroup[m.group_id];
        if (!lastRead || new Date(m.created_at) > new Date(lastRead)) {
          next[m.group_id] = (next[m.group_id] || 0) + 1;
        }
      });

      setCounts(next);
    },
    // groupIdsKey, not groupIds: an array literal's identity changes every
    // render even when its contents don't, which would rebuild `load` (and
    // restart the poll) constantly. Same reasoning as the original effect's
    // dependency — see groupIdsKey above.
    [groupIdsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useForegroundPoll(load, 15000, groupIds.length > 0, groupIdsKey);

  return counts;
}
