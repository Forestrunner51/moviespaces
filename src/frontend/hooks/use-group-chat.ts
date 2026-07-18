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
}

export function useGroupChat(groupType: GroupChatType, groupId: string) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

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
      setMessages(data || []);
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
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? (data[0] as GroupMessage) : m)),
        );
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
