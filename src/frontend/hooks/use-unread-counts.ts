import { useEffect, useState } from "react";
import { supabase } from "@/frontend/config/supabase";

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

  useEffect(() => {
    if (groupIds.length === 0) {
      setCounts({});
      return;
    }

    let cancelled = false;

    const load = async () => {
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

      if (cancelled) return;

      const lastReadByGroup: Record<string, string> = {};
      (reads || []).forEach((r) => {
        lastReadByGroup[r.group_id] = r.last_read_at;
      });

      // Bounded to messages that could still be unread rather than every
      // message in every Space the user belongs to — this polls every 15s, so
      // an unbounded fetch grows with the account's whole chat history. The
      // floor is the oldest "last read" across these Spaces; a Space never
      // opened falls back to the lookback window.
      const lookbackFloor = new Date(Date.now() - UNREAD_LOOKBACK_DAYS * 86400_000).toISOString();
      const floor = groupIds
        .map((id) => lastReadByGroup[id] ?? lookbackFloor)
        .reduce((min, cur) => (cur < min ? cur : min), new Date().toISOString());

      const { data: messages } = await supabase
        .from("group_messages")
        .select("group_id, created_at")
        .eq("group_type", "group")
        .in("group_id", groupIds)
        .neq("sender_id", user.id)
        .gt("created_at", floor);

      if (cancelled) return;

      const next: Record<string, number> = {};
      (messages || []).forEach((m) => {
        const lastRead = lastReadByGroup[m.group_id];
        if (!lastRead || new Date(m.created_at) > new Date(lastRead)) {
          next[m.group_id] = (next[m.group_id] || 0) + 1;
        }
      });

      setCounts(next);
    };

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [groupIdsKey]);

  return counts;
}
