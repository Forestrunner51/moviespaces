import { useState, useEffect } from "react";
import { supabase } from "@/frontend/config/supabase";

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

export function useFriends() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<Profile[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Get current user id
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setCurrentUserId(user.id);
      }
    });
  }, []);

  const fetchFriendsAndRequests = async () => {
    if (!currentUserId) return;
    setLoading(true);
    try {
      // 1. Fetch friendships (accepted)
      const { data: friendshipsData, error: fError } = await supabase
        .from("friendships")
        .select("id, requester_id, receiver_id, status")
        .or(`requester_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
        .eq("status", "accepted");

      if (fError) throw fError;

      const friendIds = (friendshipsData || []).map((f) =>
        f.requester_id === currentUserId ? f.receiver_id : f.requester_id
      );

      // Fetch profiles of friends
      let friendsProfiles: Profile[] = [];
      if (friendIds.length > 0) {
        const { data: profiles, error: pError } = await supabase
          .from("profiles")
          .select("id, display_name, username, avatar_url")
          .in("id", friendIds);
        if (pError) throw pError;
        friendsProfiles = profiles || [];
      }
      setFriends(friendsProfiles);

      // 2. Fetch pending requests (where current user is the receiver)
      const { data: pendingData, error: rError } = await supabase
        .from("friendships")
        .select("id, requester_id")
        .eq("receiver_id", currentUserId)
        .eq("status", "pending");

      if (rError) throw rError;

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
    } catch (err) {
      console.error("Error fetching friends/requests:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUserId) {
      fetchFriendsAndRequests();

      // Poll instead of using Supabase Realtime.
      const interval = setInterval(fetchFriendsAndRequests, 15000);
      return () => clearInterval(interval);
    }
  }, [currentUserId]);

  const sendFriendRequest = async (targetUserId: string) => {
    if (!currentUserId) return { success: false, error: "Not authenticated" };
    try {
      const { data: existing, error: lookupError } = await supabase
        .from("friendships")
        .select("id")
        .or(
          `and(requester_id.eq.${currentUserId},receiver_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},receiver_id.eq.${currentUserId})`
        )
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) {
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

  const declineFriendRequest = async (friendshipId: string) => {
    try {
      const { error } = await supabase
        .from("friendships")
        .delete()
        .eq("id", friendshipId);
      if (error) throw error;
      await fetchFriendsAndRequests();
      return { success: true };
    } catch (err: any) {
      console.error("Error declining friend request:", err);
      return { success: false, error: err.message };
    }
  };

  const searchUsers = async (query: string): Promise<Profile[]> => {
    if (!currentUserId || !query.trim()) return [];
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url")
        .or(`display_name.ilike.%${query}%,username.ilike.%${query}%`)
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
    loading,
    refresh: fetchFriendsAndRequests,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    searchUsers,
  };
}
