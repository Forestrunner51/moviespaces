import { useState, useEffect } from "react";
import { supabase } from "@/frontend/config/supabase";

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

      // Realtime subscription
      const channel = supabase
        .channel(`chat_${chatTargetId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
          },
          (payload) => {
            const newMsg = payload.new as Message;
            // Only add message if it belongs to this specific chat thread
            if (
              (newMsg.sender_id === currentUserId && newMsg.receiver_id === chatTargetId) ||
              (newMsg.sender_id === chatTargetId && newMsg.receiver_id === currentUserId)
            ) {
              setMessages((prev) => {
                // Prevent duplicate addition if local optimistic update or quick double events
                if (prev.some((m) => m.id === newMsg.id)) return prev;
                return [...prev, newMsg];
              });
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [currentUserId, chatTargetId]);

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
