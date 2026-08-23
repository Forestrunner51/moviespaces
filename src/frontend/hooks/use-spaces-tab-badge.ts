import { useState, useCallback } from "react";
import { authFetch } from "@/frontend/services/api";
import { useForegroundPoll } from "@/frontend/hooks/use-foreground-poll";
import { useUnreadCounts } from "@/frontend/hooks/use-unread-counts";
import { useDmUnreadCounts } from "@/frontend/hooks/use-dm-unread-counts";
import { useFriends } from "@/frontend/hooks/use-friends";

// Total for the Spaces tab badge: unread group-chat messages across every
// Space the user is in, plus pending friend requests — the two things that
// already badge *inside* the tab, surfaced on the tab itself so they're
// visible from anywhere. Foreground-gated polling like everything else.
export function useSpacesTabBadge(): number {
  const [groupIds, setGroupIds] = useState<string[]>([]);

  const loadIds = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/mine`);
      if (!res.ok) return;
      const data: { id: string }[] = await res.json();
      setGroupIds((prev) => {
        const next = (data || []).map((g) => g.id);
        return prev.join(",") === next.join(",") ? prev : next;
      });
    } catch {
      /* keep the previous ids — a blip shouldn't clear the badge */
    }
  }, []);
  useForegroundPoll(loadIds, 30000, true, "spaces-tab-badge");

  const unreadCounts = useUnreadCounts(groupIds);
  const { friends, pendingRequests } = useFriends();
  const dmCounts = useDmUnreadCounts(friends.map((f) => f.id));

  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  return sum(unreadCounts) + sum(dmCounts) + pendingRequests.length;
}
