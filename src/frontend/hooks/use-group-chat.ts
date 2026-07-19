import { useState, useEffect } from "react";
import { supabase } from "@/frontend/config/supabase";

// Only "group" is ever written now — the "crowdfund" group_type value in the
// DB check constraint is a leftover from the removed Stripe-based feature,
// harmless to leave as-is in the schema.
export type GroupChatType = "group";

export interface GroupMessage {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender_name?: string;
  sender_avatar_url?: string | null;
}

export function useGroupChat(groupType: GroupChatType, groupId: string) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileCache, setProfileCache] = useState<
    Record<string, { display_name: string; avatar_url: string | null }>
  >({});

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  // Sender name/avatar aren't stored on the message row — look them up from
  // profiles and merge in, caching per-user across fetches so we don't
  // re-fetch the same senders' profiles every 4s poll.
  const withSenderInfo = async (rows: GroupMessage[]) => {
    const unknownIds = [...new Set(rows.map((m) => m.sender_id))].filter(
      (id) => !profileCache[id],
    );

    let cache = profileCache;
    if (unknownIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", unknownIds);

      const additions: typeof profileCache = {};
      (profiles || []).forEach((p) => {
        additions[p.id] = { display_name: p.display_name, avatar_url: p.avatar_url ?? null };
      });
      cache = { ...profileCache, ...additions };
      setProfileCache(cache);
    }

    return rows.map((m) => ({
      ...m,
      sender_name: cache[m.sender_id]?.display_name,
      sender_avatar_url: cache[m.sender_id]?.avatar_url ?? null,
    }));
  };

  const fetchHistory = async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("group_messages")
        .select("id, sender_id, content, created_at")
        .eq("group_type", groupType)
        .eq("group_id", groupId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setMessages(await withSenderInfo(data || []));
    } catch (err) {
      console.error("Error fetching group chat history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUserId && groupId) {
      fetchHistory();
      const interval = setInterval(fetchHistory, 4000);
      return () => clearInterval(interval);
    }
  }, [currentUserId, groupId, groupType]);

  const sendMessage = async (content: string) => {
    if (!currentUserId || !groupId || !content.trim()) return { success: false };
    try {
      const tempId = `temp_${Date.now()}`;
      const newMsg: GroupMessage = {
        id: tempId,
        sender_id: currentUserId,
        content,
        created_at: new Date().toISOString(),
        sender_name: profileCache[currentUserId]?.display_name,
        sender_avatar_url: profileCache[currentUserId]?.avatar_url ?? null,
      };
      setMessages((prev) => [...prev, newMsg]);

      const { data, error } = await supabase
        .from("group_messages")
        .insert([
          {
            group_type: groupType,
            group_id: groupId,
            sender_id: currentUserId,
            content: content.trim(),
          },
        ])
        .select();

      if (error) throw error;

      if (data && data.length > 0) {
        const [sent] = await withSenderInfo(data as GroupMessage[]);
        setMessages((prev) => prev.map((m) => (m.id === tempId ? sent : m)));
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error sending group message:", err);
      fetchHistory();
      return { success: false, error: err.message };
    }
  };

  return { currentUserId, messages, loading, sendMessage, refresh: fetchHistory };
}
