import { useState, useEffect } from "react";
import { supabase } from "@/frontend/config/supabase";
import { authFetch } from "@/frontend/services/api";

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
}

export function useChat(chatTargetId: string) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  // Get current user id
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setCurrentUserId(user.id);
      }
    });
  }, []);

  const fetchHistory = async () => {
    if (!currentUserId || !chatTargetId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id, sender_id, receiver_id, content, created_at")
        .or(
          `and(sender_id.eq.${currentUserId},receiver_id.eq.${chatTargetId}),and(sender_id.eq.${chatTargetId},receiver_id.eq.${currentUserId})`
        )
        .order("created_at", { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (err) {
      console.error("Error fetching message history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUserId && chatTargetId) {
      fetchHistory();

      // Poll instead of using Supabase Realtime.
      const interval = setInterval(fetchHistory, 4000);
      return () => clearInterval(interval);
    }
  }, [currentUserId, chatTargetId]);

  // Marks this DM as read as of now, once per screen visit — mirrors
  // use-group-chat.ts's read marker so friends-panel.tsx's "N new" badge
  // clears once you've actually opened the conversation. group_id here is
  // the other person's user id (there's no separate DM/thread id), group_type
  // "dm" distinguishes this row from a real group/Space with the same uuid.
  useEffect(() => {
    if (!currentUserId || !chatTargetId) return;
    supabase
      .from("group_message_reads")
      .upsert(
        { user_id: currentUserId, group_type: "dm", group_id: chatTargetId, last_read_at: new Date().toISOString() },
        { onConflict: "user_id,group_type,group_id" },
      )
      .then(({ error }) => {
        if (error) console.warn("Failed to mark DM as read:", error);
      });
  }, [currentUserId, chatTargetId]);

  const notifyRecipient = async (preview: string) => {
    if (!currentUserId || !chatTargetId) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", currentUserId)
      .maybeSingle();

    await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/pushtokens/notify-dm`, {
      method: "POST",
      body: JSON.stringify({
        recipientUserId: chatTargetId,
        senderName: profile?.display_name || "Someone",
        preview,
      }),
    });
  };

  const sendMessage = async (content: string) => {
    if (!currentUserId || !chatTargetId || !content.trim()) return { success: false };
    try {
      const tempId = `temp_${Date.now()}`;
      const newMsg: Message = {
        id: tempId,
        sender_id: currentUserId,
        receiver_id: chatTargetId,
        content,
        created_at: new Date().toISOString(),
      };

      // Optimistic update
      setMessages((prev) => [...prev, newMsg]);

      const { data, error } = await supabase
        .from("messages")
        .insert([
          {
            sender_id: currentUserId,
            receiver_id: chatTargetId,
            content: content.trim(),
          },
        ])
        .select();

      if (error) throw error;

      // Replace temporary message with the actual saved one
      if (data && data.length > 0) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? (data[0] as Message) : m))
        );
      }

      // Best-effort — DMs live in Supabase, not the EF backend, so there's no
      // server-side trigger to hook a push notification off of. A failure
      // here should never surface as a failed send.
      notifyRecipient(content.trim()).catch(() => {});

      return { success: true };
    } catch (err) {
      console.error("Error sending message:", err);
      // Remove optimistic message on error
      fetchHistory();
      return { success: false };
    }
  };

  return {
    currentUserId,
    messages,
    loading,
    sendMessage,
    refresh: fetchHistory,
  };
}
