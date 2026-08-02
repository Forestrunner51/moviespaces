import { useEffect, useState } from "react";
import { supabase } from "@/frontend/config/supabase";

// Same shape/purpose as use-unread-counts.ts (Spaces' "N new messages"
// badge), but for DMs — which live in the separate `messages` table
// (sender_id/receiver_id), not group_messages. Read markers still go through
// group_message_reads, keyed as group_type "dm" / group_id = the friend's
// user id (see use-chat.ts's read-marking effect).
export function useDmUnreadCounts(friendIds: string[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const friendIdsKey = friendIds.join(",");

  useEffect(() => {
    if (friendIds.length === 0) {
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
          .eq("group_type", "dm")
          .eq("user_id", user.id)
          .in("group_id", friendIds),
        supabase
          .from("messages")
          .select("sender_id, created_at")
          .eq("receiver_id", user.id)
          .in("sender_id", friendIds),
      ]);

      if (cancelled) return;

      const lastReadByFriend: Record<string, string> = {};
      (reads || []).forEach((r) => {
        lastReadByFriend[r.group_id] = r.last_read_at;
      });

      const next: Record<string, number> = {};
      (messages || []).forEach((m) => {
        const lastRead = lastReadByFriend[m.sender_id];
        if (!lastRead || new Date(m.created_at) > new Date(lastRead)) {
          next[m.sender_id] = (next[m.sender_id] || 0) + 1;
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
  }, [friendIdsKey]);

  return counts;
}
