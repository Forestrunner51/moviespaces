import { createContext, createElement, useCallback, useContext, useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/frontend/config/supabase";
import { authFetch } from "@/frontend/services/api";
import { loadBlockedIds } from "@/frontend/services/moderation";
import { useForegroundPoll } from "@/frontend/hooks/use-foreground-poll";
import { useUnreadCounts } from "@/frontend/hooks/use-unread-counts";
import { useDmUnreadCounts } from "@/frontend/hooks/use-dm-unread-counts";

export interface Profile {
  id: string;
  display_name: string;
  username?: string | null;
  avatar_url?: string;
}

export interface PendingRequest {
  id: string; // friendship ID
  requester: Profile;
}

export interface SentRequest {
  id: string; // friendship ID
  receiver: Profile;
}

export interface Friend extends Profile {
  friendshipId: string;
}

export interface FriendsApi {
  currentUserId: string | null;
  friends: Friend[];
  pendingRequests: PendingRequest[];
  sentRequests: SentRequest[];
  loading: boolean;
  refresh: () => Promise<void>;
  sendFriendRequest: (targetUserId: string) => Promise<{ success: boolean; error?: string }>;
  acceptFriendRequest: (friendshipId: string) => Promise<{ success: boolean; error?: string }>;
  declineFriendRequest: (friendshipId: string) => Promise<{ success: boolean; error?: string }>;
  cancelFriendRequest: (friendshipId: string) => Promise<{ success: boolean; error?: string }>;
  removeFriend: (friendshipId: string) => Promise<{ success: boolean; error?: string }>;
  searchUsers: (query: string) => Promise<Profile[]>;
  // Unread group-chat messages per Space id (every Space the user is in) and
  // unread DMs per friend id — owned here so the Spaces list, the Friends
  // panel and the tab badge read one poll instead of each running their own.
  unreadCounts: Record<string, number>;
  dmUnreadCounts: Record<string, number>;
}

// One poller for the whole app. Every screen that called useFriends() used to
// run its own copy of this — five 15s pollers (six Supabase queries each)
// stacked whenever the Spaces tab, Profile tab, a Space and its chat were
// all mounted. FriendsProvider (root layout) runs exactly one; useFriends()
// reads from it. The `enabled` flag exists only so a useFriends() call
// outside the provider still works standalone.
function useFriendsSource(enabled: boolean): FriendsApi {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [sentRequests, setSentRequests] = useState<SentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // Only the first fetch shows the full-screen spinner. This function is the
  // 15s poll callback too, so flipping `loading` true on every tick made the
  // Friends tab's empty state flash to a spinner and back every 15 seconds for
  // a user with no friends yet.
  const hasLoadedFriendsOnce = useRef(false);

  // Track the signed-in user across sign-in/sign-out, not just at mount —
  // the provider outlives the session, so a one-shot getUser() would leave
  // it stuck on whoever (or nobody) was signed in at app launch.
  // Every Space the user belongs to, for the unread-count poll (see below).
  const [groupIds, setGroupIds] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const applyUser = (id: string | null) => {
      setCurrentUserId(id);
      if (id) return;
      // Sign-out: clear per-user state so the next account doesn't briefly
      // see the previous one's friends or badge counts.
      setFriends([]);
      setPendingRequests([]);
      setSentRequests([]);
      setGroupIds([]);
      hasLoadedFriendsOnce.current = false;
    };
    supabase.auth.getSession().then(({ data: { session } }) => {
      applyUser(session?.user?.id ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applyUser(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, [enabled]);

  const fetchFriendsAndRequests = async () => {
    if (!currentUserId) return;
    if (!hasLoadedFriendsOnce.current) setLoading(true);
    try {
      // Requests to or from someone you've blocked never surface — the
      // block table is client-enforced, so without this a blocked user
      // could keep re-sending requests that show up as pending.
      const blocked = await loadBlockedIds().catch(() => new Set<string>());

      // 1. Fetch friendships (accepted)
      const { data: friendshipsData, error: fError } = await supabase
        .from("friendships")
        .select("id, requester_id, receiver_id, status")
        .or(`requester_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
        .eq("status", "accepted");

      if (fError) throw fError;

      const friendshipIdByUserId = new Map(
        (friendshipsData || []).map((f) => [
          f.requester_id === currentUserId ? f.receiver_id : f.requester_id,
          f.id,
        ]),
      );
      const friendIds = Array.from(friendshipIdByUserId.keys());

      // Fetch profiles of friends
      let friendsProfiles: Friend[] = [];
      if (friendIds.length > 0) {
        const { data: profiles, error: pError } = await supabase
          .from("profiles")
          .select("id, display_name, username, avatar_url")
          .in("id", friendIds)
          .order("display_name");
        if (pError) throw pError;
        friendsProfiles = (profiles || []).map((p) => ({
          ...p,
          friendshipId: friendshipIdByUserId.get(p.id)!,
        }));
      }
      setFriends(friendsProfiles);

      // 2. Fetch pending requests (where current user is the receiver)
      const { data: pendingRaw, error: rError } = await supabase
        .from("friendships")
        .select("id, requester_id")
        .eq("receiver_id", currentUserId)
        .eq("status", "pending");

      if (rError) throw rError;
      const pendingData = (pendingRaw || []).filter((p) => !blocked.has(p.requester_id));

      const requesterIds = (pendingData || []).map((p) => p.requester_id);
      let pendingList: PendingRequest[] = [];

      if (requesterIds.length > 0) {
        const { data: reqProfiles, error: rpError } = await supabase
          .from("profiles")
          .select("id, display_name, username, avatar_url")
          .in("id", requesterIds);
        if (rpError) throw rpError;

        pendingList = (pendingData || []).map((item) => {
          const profile = (reqProfiles || []).find((p) => p.id === item.requester_id);
          return {
            id: item.id,
            requester: profile || { id: item.requester_id, display_name: "Unknown User" },
          };
        });
      }
      setPendingRequests(pendingList);

      // 3. Fetch requests the current user sent that are still pending, so
      // "Requested" in the UI can be un-sent instead of being a dead end.
      const { data: sentRaw, error: sError } = await supabase
        .from("friendships")
        .select("id, receiver_id")
        .eq("requester_id", currentUserId)
        .eq("status", "pending");

      if (sError) throw sError;
      const sentData = (sentRaw || []).filter((s) => !blocked.has(s.receiver_id));

      const receiverIds = (sentData || []).map((s) => s.receiver_id);
      let sentList: SentRequest[] = [];

      if (receiverIds.length > 0) {
        const { data: recProfiles, error: recError } = await supabase
          .from("profiles")
          .select("id, display_name, username, avatar_url")
          .in("id", receiverIds);
        if (recError) throw recError;

        sentList = (sentData || []).map((item) => {
          const profile = (recProfiles || []).find((p) => p.id === item.receiver_id);
          return {
            id: item.id,
            receiver: profile || { id: item.receiver_id, display_name: "Unknown User" },
          };
        });
      }
      setSentRequests(sentList);
    } catch (err) {
      console.error("Error fetching friends/requests:", err);
    } finally {
      hasLoadedFriendsOnce.current = true;
      setLoading(false);
    }
  };

  // Poll instead of using Supabase Realtime — foreground-only, so friend
  // requests stop being polled the moment the app is backgrounded.
  useForegroundPoll(
    fetchFriendsAndRequests,
    15000,
    enabled && Boolean(currentUserId),
    currentUserId ?? "",
  );

  // Group-id poll: 30s — the membership list changes rarely; the counts
  // themselves poll at 15s.
  const loadGroupIds = useCallback(async () => {
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
  useForegroundPoll(loadGroupIds, 30000, enabled && Boolean(currentUserId), currentUserId ?? "");

  const unreadCounts = useUnreadCounts(enabled ? groupIds : []);
  const dmUnreadCounts = useDmUnreadCounts(enabled ? friends.map((f) => f.id) : []);

  const sendFriendRequest = async (targetUserId: string) => {
    if (!currentUserId) return { success: false, error: "Not authenticated" };
    try {
      const blocked = await loadBlockedIds().catch(() => new Set<string>());
      if (blocked.has(targetUserId)) {
        return { success: false, error: "You've blocked this person. Unblock them first to send a request." };
      }
      const { data: existing, error: lookupError } = await supabase
        .from("friendships")
        .select("id")
        .or(
          `and(requester_id.eq.${currentUserId},receiver_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},receiver_id.eq.${currentUserId})`
        )
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) {
        // The local list is out of date if we got here — refresh so the row
        // flips to "Requested"/"Friends" instead of staying a dead "Add".
        await fetchFriendsAndRequests();
        return { success: false, error: "A friend request already exists with this user." };
      }

      const { error } = await supabase.from("friendships").insert([
        {
          requester_id: currentUserId,
          receiver_id: targetUserId,
          status: "pending",
        },
      ]);
      if (error) {
        // 23505 = unique_pair violation (race with a concurrent request)
        if (error.code === "23505") {
          return { success: false, error: "A friend request already exists with this user." };
        }
        throw error;
      }
      await fetchFriendsAndRequests();
      return { success: true };
    } catch (err: any) {
      console.error("Error sending friend request:", err);
      return { success: false, error: err.message };
    }
  };

  const acceptFriendRequest = async (friendshipId: string) => {
    try {
      const { error } = await supabase
        .from("friendships")
        .update({ status: "accepted", updated_at: new Date().toISOString() })
        .eq("id", friendshipId);
      if (error) throw error;
      await fetchFriendsAndRequests();
      return { success: true };
    } catch (err: any) {
      console.error("Error accepting friend request:", err);
      return { success: false, error: err.message };
    }
  };

  // Deletes a friendships row by id regardless of its status — this is the
  // right operation whether you're declining an incoming request, un-sending
  // one you sent, or removing an already-accepted friend. Exposed under
  // three names below so call sites read clearly at each use.
  const deleteFriendship = async (friendshipId: string) => {
    try {
      const { error } = await supabase
        .from("friendships")
        .delete()
        .eq("id", friendshipId);
      if (error) throw error;
      await fetchFriendsAndRequests();
      return { success: true };
    } catch (err: any) {
      console.error("Error deleting friendship:", err);
      return { success: false, error: err.message };
    }
  };

  const searchUsers = async (query: string): Promise<Profile[]> => {
    if (!currentUserId || !query.trim()) return [];
    // The query is interpolated into a PostgREST .or() expression, where
    // commas and parens are structural and a double-quote opens a quoted
    // value — a search for "Smith, J" split the filter into malformed clauses
    // (400 → silently "no results"), and crafted input could rewrite the
    // predicate. Strip only those structural characters. Apostrophes are NOT
    // special in a PostgREST filter, so they stay — otherwise "O'Brien"
    // becomes "O Brien" and matches nobody.
    const sanitized = query.replace(/[,()"\\]/g, " ").trim();
    if (!sanitized) return [];
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url")
        .or(`display_name.ilike.%${sanitized}%,username.ilike.%${sanitized}%`)
        .neq("id", currentUserId)
        .limit(10);

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error("Error searching users:", err);
      return [];
    }
  };

  return {
    currentUserId,
    friends,
    pendingRequests,
    sentRequests,
    loading,
    refresh: fetchFriendsAndRequests,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest: deleteFriendship,
    cancelFriendRequest: deleteFriendship,
    removeFriend: deleteFriendship,
    searchUsers,
    unreadCounts,
    dmUnreadCounts,
  };
}

const FriendsContext = createContext<FriendsApi | null>(null);

export function FriendsProvider({ children }: { children: ReactNode }) {
  const value = useFriendsSource(true);
  return createElement(FriendsContext.Provider, { value }, children);
}

// Reads the shared poll from FriendsProvider. Falls back to a private poller
// only when rendered outside the provider (which nothing in the app does —
// the provider wraps the root layout).
export function useFriends(): FriendsApi {
  const shared = useContext(FriendsContext);
  const local = useFriendsSource(shared === null);
  return shared ?? local;
}
