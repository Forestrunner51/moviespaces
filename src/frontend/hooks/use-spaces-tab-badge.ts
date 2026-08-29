import { useFriends } from "@/frontend/hooks/use-friends";

// Total for the Spaces tab badge: unread group-chat messages across every
// Space the user is in, unread DMs, plus pending friend requests — the things
// that already badge *inside* the tab, surfaced on the tab itself so they're
// visible from anywhere. All three come from the single FriendsProvider poll
// (this used to run its own copies of every poller).
export function useSpacesTabBadge(): number {
  const { unreadCounts, dmUnreadCounts, pendingRequests } = useFriends();
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  return sum(unreadCounts) + sum(dmUnreadCounts) + pendingRequests.length;
}
