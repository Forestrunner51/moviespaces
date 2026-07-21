import { useEffect, useState } from "react";
import { supabase } from "@/frontend/config/supabase";

// Counts messages sent (by someone else) after the user's last read marker
// for each group, so a Spaces list can show "N new messages" per card.
// One pair of queries total regardless of how many spaces are passed in —
// not a query per space.
export function useUnreadCounts(groupIds: string[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});

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

      const [{ data: reads }, { data: messages }] = await Promise.all([
        supabase
          .from("group_message_reads")
          .select("group_id, last_read_at")
          .eq("group_type", "group")
          .eq("user_id", user.id)
          .in("group_id", groupIds),
        supabase
          .from("group_messages")
          .select("group_id, created_at")
          .eq("group_type", "group")
          .in("group_id", groupIds)
          .neq("sender_id", user.id),
      ]);

      if (cancelled) return;

      const lastReadByGroup: Record<string, string> = {};
      (reads || []).forEach((r) => {
        lastReadByGroup[r.group_id] = r.last_read_at;
      });

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
  }, [groupIds.join(",")]);

  return counts;
}
