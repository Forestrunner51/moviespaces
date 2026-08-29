import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Text, TextInput } from "@/frontend/components/scaled-text";
import { useLocalSearchParams, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, Palette, Type, Radius } from "@/frontend/constants/theme";
import { Avatar } from "@/frontend/components/avatar";
import { useGroupChat, GroupMessage, GroupChatType } from "@/frontend/hooks/use-group-chat";
import { reportContent, blockUser } from "@/frontend/services/moderation";
import { useBlockedIds } from "@/frontend/hooks/use-blocked-ids";
import { useFriends } from "@/frontend/hooks/use-friends";
import { useToast } from "@/frontend/components/toast";

// See chat/[userId].tsx — auto-scroll on new content only when already
// reading the latest messages.
const NEAR_BOTTOM_PX = 80;

// Memoized row: the 4s poll re-renders only rows that actually changed.
const MessageRow = memo(function MessageRow({
  item,
  isMe,
  onRetry,
  onLongPress,
}: {
  item: GroupMessage;
  isMe: boolean;
  onRetry: (m: GroupMessage) => void;
  onLongPress: (m: GroupMessage) => void;
}) {
  if (isMe) {
    return (
      <View style={styles.myMsgWrap}>
        <View
          style={[
            styles.bubble,
            styles.bubbleMe,
            { maxWidth: "100%", marginBottom: 0 },
            item.failed && styles.bubbleFailed,
            item.pending && styles.bubblePending,
          ]}
        >
          <Text style={[styles.bubbleText, styles.bubbleTextMe]}>{item.content}</Text>
        </View>
        {item.failed && (
          <TouchableOpacity onPress={() => onRetry(item)} style={styles.retryRow} activeOpacity={0.7}>
            <Ionicons name="alert-circle" size={13} color={Palette.danger} />
            <Text style={styles.retryText}>Not sent · Tap to retry</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
  return (
    <TouchableOpacity activeOpacity={0.9} onLongPress={() => onLongPress(item)} style={styles.rowThem}>
      <Avatar uri={item.sender_avatar_url} name={item.sender_name} size={28} />
      <View style={{ flex: 1 }}>
        <Text style={styles.senderName}>
          {item.sender_name || "Someone"}
          {item.sender_username ? (
            <Text style={styles.senderUsername}> @{item.sender_username}</Text>
          ) : null}
        </Text>
        <View style={[styles.bubble, styles.bubbleThem, { alignSelf: "flex-start", marginBottom: 0 }]}>
          <Text style={styles.bubbleText}>{item.content}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

export default function GroupChatScreen() {
  const { showToast } = useToast();
  const { id, type, title, showTime, showDate, seasonEpisodeInfo } = useLocalSearchParams<{
    id: string;
    type: GroupChatType;
    title?: string;
    showTime?: string;
    showDate?: string;
    seasonEpisodeInfo?: string;
  }>();
  // `type` is only supplied by group.tsx's navigation — a direct deep link
  // (moviespaces://group-chat/<id>) leaves it undefined, which used to reach
  // the hook as .eq("group_type", undefined): an empty history and a send
  // that violates the DB check constraint. "group" is the only value ever
  // written (see GroupChatType), so defaulting is always correct.
  const { currentUserId, messages, loading, sendMessage, retryMessage } = useGroupChat(type ?? "group", id);
  // Header height, derived from the safe-area top inset + the standard iOS
  // nav-bar content height (44). A hardcoded offset doesn't account for the
  // top inset (which varies with notch/Dynamic Island/no-notch), so the
  // KeyboardAvoidingView's padding math was off just enough that the Send
  // button's real hit-testable bounds landed under the keyboard's overlay:
  // it looked positioned correctly but taps didn't register. (expo-router
  // SDK 56 forbids importing @react-navigation's useHeaderHeight directly,
  // so this is computed from safe-area-context instead.)
  const insets = useSafeAreaInsets();
  const headerHeight = insets.top + 44;
  const { friends, sendFriendRequest } = useFriends();
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);
  // Shared, cached block list — updated in place by blockUser below.
  const blockedIds = useBlockedIds();
  // A ref, not state: a fast double-tap fires both handleSend calls before
  // React re-renders with the cleared input, so a state-based guard reads
  // stale on the second tap and the same message (and its push to every
  // other member) goes out twice. A ref updates synchronously, so the
  // second tap sees it in time.
  const sendingRef = useRef(false);
  const nearBottomRef = useRef(true);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
    nearBottomRef.current = distance < NEAR_BOTTOM_PX;
  }, []);
  const onContentSizeChange = useCallback(() => {
    if (nearBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
  }, []);

  const handleAddFriend = async (userId: string, name: string) => {
    const result = await sendFriendRequest(userId);
    showToast(
      result.success
        ? `We let ${name} know you'd like to be friends.`
        : result.error?.includes("already exists")
          ? `You've already got a friend request going with ${name}.`
          : result.error || "Couldn't send that friend request. Please try again.",
      result.success ? "success" : "error",
    );
  };

  const handleSend = async () => {
    const content = text.trim();
    if (!content || sendingRef.current) return;
    sendingRef.current = true;
    setText("");
    const result = await sendMessage(content);
    sendingRef.current = false;
    if (!result.success) {
      // The message now stays as a red "not sent" bubble you can tap to retry
      // (see renderItem), so we don't restore the input. Still say why.
      showToast(result.error || "Message not sent — tap it to retry.");
      return;
    }
    nearBottomRef.current = true;
    listRef.current?.scrollToEnd({ animated: true });
  };

  const handleLongPressMessage = (item: GroupMessage) => {
    const alreadyFriends = friends.some((f) => f.id === item.sender_id);
    Alert.alert(item.sender_name || "This message", "What would you like to do?", [
      { text: "Cancel", style: "cancel" },
      ...(alreadyFriends
        ? []
        : [
            {
              text: `Add ${item.sender_name || "User"} as Friend`,
              onPress: () => handleAddFriend(item.sender_id, item.sender_name || "them"),
            },
          ]),
      {
        text: "Report Message",
        onPress: async () => {
          const result = await reportContent("message", item.id, item.content);
          showToast(
            result.success
              ? "Thanks — our team will review this message."
              : result.error || "Couldn't report that. Please try again.",
            result.success ? "success" : "error",
          );
        },
      },
      {
        text: `Block ${item.sender_name || "User"}`,
        style: "destructive",
        onPress: async () => {
          const result = await blockUser(item.sender_id);
          if (!result.success) {
            showToast(result.error || "Couldn't block that person. Please try again.");
          }
        },
      },
    ]);
  };

  // Latest long-press handler behind a stable identity, so renderItem (and
  // every memoized row) doesn't rebuild whenever the friends list polls.
  const longPressRef = useRef(handleLongPressMessage);
  useEffect(() => {
    longPressRef.current = handleLongPressMessage;
  });
  const onLongPress = useCallback((m: GroupMessage) => longPressRef.current(m), []);

  const renderItem = useCallback(
    ({ item }: { item: GroupMessage }) => (
      <MessageRow
        item={item}
        isMe={item.sender_id === currentUserId}
        onRetry={retryMessage}
        onLongPress={onLongPress}
      />
    ),
    [currentUserId, retryMessage, onLongPress],
  );

  const visibleMessages = useMemo(
    () => messages.filter((m) => !blockedIds.has(m.sender_id)),
    [messages, blockedIds],
  );


  return (
    <Starfield>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
      >
        <Stack.Screen options={{ title: title || "Group Chat" }} />
        {(showTime || showDate || seasonEpisodeInfo) && (
          <View style={styles.contextBanner}>
            <Text style={styles.contextBannerText} numberOfLines={2}>
              {seasonEpisodeInfo ? `${seasonEpisodeInfo} • ` : ""}
              {[showDate, showTime].filter(Boolean).join(" • ")}
            </Text>
          </View>
        )}
        {loading && messages.length === 0 ? (
          <ActivityIndicator color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
        ) : (
          <FlatList
            ref={listRef}
            data={visibleMessages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            onScroll={onScroll}
            scrollEventThrottle={100}
            onContentSizeChange={onContentSizeChange}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                No messages yet — say hi to the group.
              </Text>
            }
          />
        )}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Message the group..."
            placeholderTextColor={SpaceTheme.mutedOrbit}
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity activeOpacity={0.8} style={styles.sendButton} onPress={handleSend}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contextBanner: {
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
    backgroundColor: Palette.accentDim,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  contextBannerText: { ...Type.caption, color: Palette.accent, fontWeight: "600" },
  list: { padding: 16, gap: 8 },
  emptyText: { ...Type.small, color: Palette.textMuted, textAlign: "center", marginTop: 24 },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: Radius.medium,
    marginBottom: 8,
  },
  bubbleMe: { backgroundColor: Palette.accent },
  myMsgWrap: { alignSelf: "flex-end", alignItems: "flex-end", maxWidth: "80%", marginBottom: 8 },
  bubbleFailed: { borderWidth: 1, borderColor: Palette.dangerBorder },
  bubblePending: { opacity: 0.6 },
  retryRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3, paddingVertical: 2 },
  retryText: { ...Type.caption, color: Palette.danger, fontWeight: "600" },
  // Raised surface, not a bordered card — bubbles stack directly on the
  // background, so an outline on every one was pure noise.
  bubbleThem: { backgroundColor: Palette.raised },
  bubbleText: { ...Type.body, color: Palette.text },
  // Your own bubble is filled with the amber accent, so its text has to be
  // dark. Cream-on-amber measured about 2.2:1 — far under the 4.5:1 floor.
  bubbleTextMe: { color: Palette.base },
  rowThem: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 8, maxWidth: "85%" },
  senderName: { ...Type.caption, color: Palette.textMuted, fontWeight: "600", marginBottom: 3, marginLeft: 2 },
  senderUsername: { ...Type.caption, color: Palette.textFaint, fontWeight: "400" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    ...Type.body,
    maxHeight: 100,
    backgroundColor: Palette.raised,
    borderWidth: 1,
    borderColor: Palette.border,
    color: Palette.text,
  },
  sendButton: {
    backgroundColor: Palette.accent,
    borderRadius: Radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sendButtonText: { ...Type.small, color: Palette.base, fontWeight: "700" },
});
