import { useState, useEffect, useRef } from "react";
import { supabase } from "@/frontend/config/supabase";
import { authFetch } from "@/frontend/services/api";
import { useForegroundPoll } from "@/frontend/hooks/use-foreground-poll";
import { mergeMessages } from "@/frontend/hooks/use-chat";

// Newest rows loaded on open; later polls fetch only what's newer. See
// use-chat.ts for the same scheme.
const INITIAL_PAGE = 100;

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
  sender_username?: string | null;
  sender_avatar_url?: string | null;
  // Set only on optimistic local messages: `pending` in flight, `failed` if
  // the insert errored (bubble stays so it can be retried). Server rows never
  // carry these.
  pending?: boolean;
  failed?: boolean;
}

export function useGroupChat(groupType: GroupChatType, groupId: string) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  // A ref, not state: this cache is never rendered directly (only merged into
  // `messages`), and the 4s poll below is a stable interval callback set up
  // once per groupId — if this were state, that callback would keep closing
  // over whatever profileCache was at effect-setup time, so newly cached
  // senders would never be seen by later polls and get needlessly re-fetched
  // from Supabase every 4s for the lifetime of the screen.
  const profileCacheRef = useRef<
    Record<string, { display_name: string; username: string | null; avatar_url: string | null }>
  >({});
  // Tracks whether fetchHistory has completed at least once — see the
  // comment inside fetchHistory for why this gates the loading spinner.
  const hasLoadedOnceRef = useRef(false);
  // created_at of the newest server row seen — subsequent polls ask only
  // for rows after it.
  // Keyed by chat: switching Spaces starts over (replace, not append).
  const newestSeenRef = useRef<{ key: string; at: string | null }>({ key: "", at: null });
  // Which chat is on screen right now — a poll response for a Space the user
  // has already left must not be merged into the new one.
  const activeKeyRef = useRef(`${groupType}:${groupId}`);
  useEffect(() => {
    activeKeyRef.current = `${groupType}:${groupId}`;
  }, [groupType, groupId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  // Sender name/avatar aren't stored on the message row — look them up from
  // profiles and merge in, caching per-user across fetches so we don't
  // re-fetch the same senders' profiles every 4s poll.
  const withSenderInfo = async (rows: GroupMessage[]) => {
    const cache = profileCacheRef.current;
    const unknownIds = [...new Set(rows.map((m) => m.sender_id))].filter(
      (id) => !cache[id],
    );

    if (unknownIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url")
        .in("id", unknownIds);

      (profiles || []).forEach((p) => {
        cache[p.id] = {
          display_name: p.display_name,
          username: p.username ?? null,
          avatar_url: p.avatar_url ?? null,
        };
      });
    }

    return rows.map((m) => ({
      ...m,
      sender_name: cache[m.sender_id]?.display_name,
      sender_username: cache[m.sender_id]?.username ?? null,
      sender_avatar_url: cache[m.sender_id]?.avatar_url ?? null,
    }));
  };

  const fetchHistory = async () => {
    if (!groupId) return;
    // Only the very first load shows a spinner. Without this guard, `loading`
    // flips true on every 4s background poll too — which unmounts the
    // FlatList and remounts it a moment later (the screen swaps to the
    // ActivityIndicator and back), showing up as the message list — and for
    // an empty chat, the "No messages yet" text — flickering every few
    // seconds.
    const chatKey = `${groupType}:${groupId}`;
    const switched = newestSeenRef.current.key !== chatKey;
    if (switched) hasLoadedOnceRef.current = false;
    if (!hasLoadedOnceRef.current) setLoading(true);
    const since = switched ? null : newestSeenRef.current.at;
    try {
      let query = supabase
        .from("group_messages")
        .select("id, sender_id, content, created_at")
        .eq("group_type", groupType)
        .eq("group_id", groupId);
      if (since) {
        query = query.gt("created_at", since).order("created_at", { ascending: true });
      } else {
        query = query.order("created_at", { ascending: false }).limit(INITIAL_PAGE);
      }
      const { data, error } = await query;
      if (error) throw error;
      if (chatKey !== activeKeyRef.current) return;

      const rows = since ? data || [] : [...(data || [])].reverse();
      newestSeenRef.current = {
        key: chatKey,
        at: rows.length > 0 ? rows[rows.length - 1].created_at : since,
      };
      const fetched = await withSenderInfo(rows);
      // Append, deduping by id. Optimistic temp_ bubbles survive every poll
      // (a failed send stays as its red "not sent" bubble until retried —
      // the old content+sender match wrongly dropped it whenever any row
      // shared its text); the confirmed row replaces the temp by id in
      // sendMessage.
      setMessages((prev) => {
        if (switched) return fetched;
        return mergeMessages(since ? prev : prev.filter((m) => m.id.startsWith("temp_")), fetched);
      });
    } catch (err) {
      console.error("Error fetching group chat history:", err);
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  };

  // Foreground-only: a backgrounded chat screen used to keep polling every 4s
  // indefinitely. Fires immediately on mount and again on resume, so the
  // behaviour on screen is unchanged — see useForegroundPoll.
  useForegroundPoll(
    fetchHistory,
    4000,
    Boolean(currentUserId && groupId),
    `${groupType}:${groupId}`,
  );

  // Marks the chat read, and keeps it marked as new messages arrive while the
  // screen is open — actively viewing a chat means you're caught up, so the
  // Spaces list's "N new messages" badge should clear and stay cleared.
  //
  // Marking only on mount left anything that landed mid-conversation still
  // counted as unread: you'd watch a message come in, leave, and the badge
  // would claim it was new. Keyed on Space + newest message timestamp so this
  // writes at most once per genuinely new message, not on every 4s poll, and
  // switching Spaces always re-marks even if both share a latest timestamp.
  const lastMarkedRef = useRef<string | null>(null);
  const latestMessageAt = messages.length ? messages[messages.length - 1].created_at : null;
  const markKey = latestMessageAt ? `${groupId}:${latestMessageAt}` : null;

  useEffect(() => {
    if (!currentUserId || !groupId || !markKey) return;
    if (lastMarkedRef.current === markKey) return;
    lastMarkedRef.current = markKey;

    supabase
      .from("group_message_reads")
      .upsert(
        { user_id: currentUserId, group_type: groupType, group_id: groupId, last_read_at: new Date().toISOString() },
        { onConflict: "user_id,group_type,group_id" },
      )
      .then(({ error }) => {
        if (error) {
          console.warn("Failed to mark chat as read:", error);
          // Clear the key so the next poll retries rather than treating a
          // failed write as done.
          lastMarkedRef.current = null;
        }
      });
  }, [currentUserId, groupId, groupType, markKey]);

  const sendMessage = async (content: string) => {
    if (!currentUserId || !groupId || !content.trim()) return { success: false };
    // Declared outside the try so the catch can roll the optimistic bubble back.
    const tempId = `temp_${Date.now()}`;
    try {
      const newMsg: GroupMessage = {
        id: tempId,
        sender_id: currentUserId,
        content,
        created_at: new Date().toISOString(),
        sender_name: profileCacheRef.current[currentUserId]?.display_name,
        sender_username: profileCacheRef.current[currentUserId]?.username ?? null,
        sender_avatar_url: profileCacheRef.current[currentUserId]?.avatar_url ?? null,
        pending: true,
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
        // If a poll already appended this row, drop the temp bubble instead
        // of producing a duplicate.
        setMessages((prev) =>
          prev.some((m) => m.id === sent.id)
            ? prev.filter((m) => m.id !== tempId)
            : prev.map((m) => (m.id === tempId ? sent : m)),
        );

        // Best-effort — group chat lives in Supabase, not the EF backend, so
        // there's no server-side trigger to hook a push notification off of.
        // A failure here should never surface as a failed send.
        if (groupType === "group") {
          authFetch(
            `${process.env.EXPO_PUBLIC_API_URL}/api/group/${groupId}/notify-message`,
            {
              method: "POST",
              body: JSON.stringify({
                senderName: sent.sender_name || "Someone",
                preview: content.trim(),
              }),
            },
          ).catch((err) => console.warn("Failed to notify group of new message:", err));
        }
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error sending group message:", err);
      // Keep the optimistic bubble but mark it failed, so it stays on screen in
      // a red "not sent" state the user can tap to retry (fetchHistory's merge
      // preserves temp_ messages, so it survives polls until retried/removed).
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)),
      );
      return { success: false, error: err.message };
    }
  };

  // Re-send a failed message: drop the failed bubble and send it fresh.
  const retryMessage = (failed: GroupMessage) => {
    setMessages((prev) => prev.filter((m) => m.id !== failed.id));
    return sendMessage(failed.content);
  };

  return { currentUserId, messages, loading, sendMessage, retryMessage, refresh: fetchHistory };
}
