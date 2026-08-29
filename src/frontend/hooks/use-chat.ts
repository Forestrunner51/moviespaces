import { useState, useEffect, useRef } from "react";
import { supabase } from "@/frontend/config/supabase";
import { authFetch } from "@/frontend/services/api";
import { loadBlockedIds } from "@/frontend/services/moderation";
import { useForegroundPoll } from "@/frontend/hooks/use-foreground-poll";

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  // Set only on optimistic local messages: `pending` while the insert is in
  // flight, `failed` if it errored (the bubble stays so it can be retried).
  // Real messages loaded from the server never carry these.
  pending?: boolean;
  failed?: boolean;
}

// chatTargetId arrives via a deep-linkable route param
// (moviespaces://chat/<anything>) and is interpolated into a PostgREST .or()
// filter, where commas/parens are syntax. RLS keeps other users' rows
// unreadable regardless, but a crafted link shouldn't get to mangle the
// query at all — anything that isn't a UUID is simply not a chat target.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Newest rows loaded on open. Older history isn't paged in yet — a DM
// thread deeper than this is rare, and the previous behaviour (re-download
// everything every 4s) was the actual problem.
const INITIAL_PAGE = 100;

// Appends `incoming` server rows onto `prev`, dropping any whose id is already
// present (the row we optimistically inserted and then confirmed, or an
// overlap at the poll boundary). Optimistic temp_ bubbles are kept at the
// end so an in-flight send never disappears under a poll.
export function mergeMessages<T extends { id: string; created_at: string }>(prev: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return prev;
  const seen = new Set(prev.map((m) => m.id));
  const added = incoming.filter((m) => !seen.has(m.id));
  if (added.length === 0) return prev;
  const real = prev.filter((m) => !m.id.startsWith("temp_"));
  const temps = prev.filter((m) => m.id.startsWith("temp_"));
  return [...real, ...added, ...temps];
}

export function useChat(chatTargetId: string) {
  const validTargetId = UUID_RE.test(chatTargetId) ? chatTargetId : "";
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  // Same client-side moderation gate group-chat applies: messages from
  // someone you've blocked stop rendering, including in the DM thread
  // itself. (RLS still delivers the rows — this is the display-layer filter
  // the App Store moderation flow expects.)
  const blockedIdsRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    loadBlockedIds()
      .then((ids) => {
        blockedIdsRef.current = ids;
      })
      .catch(() => {});
  }, []);

  // Incremental polling: the first fetch takes the newest INITIAL_PAGE rows;
  // every poll after that asks only for rows newer than the newest one seen
  // and appends. Previously each 4s tick re-downloaded the entire thread.
  // Keyed by conversation: switching targets starts over (replace, not
  // append) rather than stacking the new thread onto the old one.
  const newestSeenRef = useRef<{ key: string; at: string | null }>({ key: "", at: null });
  // Which conversation is on screen right now — a poll response for a chat
  // the user has already left must not be merged into the new one.
  const activeTargetRef = useRef(validTargetId);
  useEffect(() => {
    activeTargetRef.current = validTargetId;
  }, [validTargetId]);

  // Get current user id
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setCurrentUserId(user.id);
      }
    });
  }, []);

  const fetchHistory = async () => {
    if (!currentUserId || !validTargetId) return;
    const switched = newestSeenRef.current.key !== validTargetId;
    const since = switched ? null : newestSeenRef.current.at;
    const targetAtStart = validTargetId;
    if (switched) setLoading(true);
    try {
      let query = supabase
        .from("messages")
        .select("id, sender_id, receiver_id, content, created_at")
        .or(
          `and(sender_id.eq.${currentUserId},receiver_id.eq.${validTargetId}),and(sender_id.eq.${validTargetId},receiver_id.eq.${currentUserId})`
        );
      if (since) {
        query = query.gt("created_at", since).order("created_at", { ascending: true });
      } else {
        query = query.order("created_at", { ascending: false }).limit(INITIAL_PAGE);
      }
      const { data, error } = await query;
      if (error) throw error;
      // Stale response for a conversation we've already left.
      if (targetAtStart !== activeTargetRef.current) return;

      const rows = since ? data || [] : [...(data || [])].reverse();
      newestSeenRef.current = {
        key: validTargetId,
        at: rows.length > 0 ? rows[rows.length - 1].created_at : since,
      };
      const fresh = rows.filter((m) => !blockedIdsRef.current.has(m.sender_id));
      setMessages((prev) => {
        if (switched) return fresh;
        return mergeMessages(since ? prev : prev.filter((m) => m.id.startsWith("temp_")), fresh);
      });
    } catch (err) {
      console.error("Error fetching message history:", err);
    } finally {
      setLoading(false);
    }
  };

  // Poll instead of using Supabase Realtime — but only while foregrounded, so
  // a DM left open in the background stops hitting Supabase every 4s.
  useForegroundPoll(fetchHistory, 4000, Boolean(currentUserId && validTargetId), validTargetId);

  // Marks this DM read, and keeps it marked as new messages arrive while the
  // screen is open. Marking only on mount (the original approach, and what
  // use-group-chat.ts did) left anything that landed mid-conversation counted
  // as unread — you'd read a reply live, leave, and still see a badge for it.
  //
  // Keyed on conversation + newest message timestamp rather than firing on
  // every 4s poll, so this writes at most once per genuinely new message. The
  // conversation id is part of the key so switching to a different chat always
  // re-marks, even in the edge case where both conversations' newest messages
  // share a timestamp — that's why there's no separate "reset on change"
  // effect, which would have run *after* this one and immediately undone it.
  const lastMarkedRef = useRef<string | null>(null);
  const latestMessageAt = messages.length ? messages[messages.length - 1].created_at : null;
  const markKey = latestMessageAt ? `${validTargetId}:${latestMessageAt}` : null;

  useEffect(() => {
    if (!currentUserId || !validTargetId || !markKey) return;
    if (lastMarkedRef.current === markKey) return;
    lastMarkedRef.current = markKey;

    supabase
      .from("group_message_reads")
      .upsert(
        { user_id: currentUserId, group_type: "dm", group_id: validTargetId, last_read_at: new Date().toISOString() },
        { onConflict: "user_id,group_type,group_id" },
      )
      .then(({ error }) => {
        if (error) {
          console.warn("Failed to mark DM as read:", error);
          // Clear the key so the next poll retries instead of treating a
          // failed write as done.
          lastMarkedRef.current = null;
        }
      });
  }, [currentUserId, validTargetId, markKey]);

  const notifyRecipient = async (preview: string) => {
    if (!currentUserId || !validTargetId) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", currentUserId)
      .maybeSingle();

    await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/pushtokens/notify-dm`, {
      method: "POST",
      body: JSON.stringify({
        recipientUserId: validTargetId,
        senderName: profile?.display_name || "Someone",
        preview,
      }),
    });
  };

  const sendMessage = async (content: string) => {
    if (!currentUserId || !validTargetId || !content.trim()) return { success: false };
    // Declared outside the try so the catch can find this exact bubble by id.
    const tempId = `temp_${Date.now()}`;
    const newMsg: Message = {
      id: tempId,
      sender_id: currentUserId,
      receiver_id: validTargetId,
      content,
      created_at: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, newMsg]); // optimistic
    try {
      const { data, error } = await supabase
        .from("messages")
        .insert([
          {
            sender_id: currentUserId,
            receiver_id: validTargetId,
            content: content.trim(),
          },
        ])
        .select();

      if (error) throw error;

      // Replace temporary message with the actual saved one — unless a poll
      // already appended that row, in which case just drop the temp bubble
      // (otherwise the same message shows twice).
      if (data && data.length > 0) {
        const sent = data[0] as Message;
        setMessages((prev) =>
          prev.some((m) => m.id === sent.id)
            ? prev.filter((m) => m.id !== tempId)
            : prev.map((m) => (m.id === tempId ? sent : m)),
        );
      }

      // Best-effort — DMs live in Supabase, not the EF backend, so there's no
      // server-side trigger to hook a push notification off of. A failure
      // here should never surface as a failed send.
      notifyRecipient(content.trim()).catch(() => {});

      return { success: true };
    } catch (err) {
      console.error("Error sending message:", err);
      // Keep the optimistic bubble but mark it failed, so it stays on screen
      // in a red "not sent" state the user can tap to retry — instead of
      // silently vanishing (the old fetchHistory() rollback).
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)),
      );
      return { success: false };
    }
  };

  // Re-send a failed message: drop the failed bubble and send it fresh.
  const retryMessage = (failed: Message) => {
    setMessages((prev) => prev.filter((m) => m.id !== failed.id));
    return sendMessage(failed.content);
  };

  return {
    currentUserId,
    messages,
    retryMessage,
    loading,
    sendMessage,
    refresh: fetchHistory,
  };
}
