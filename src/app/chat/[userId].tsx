import { memo, useCallback, useRef, useState } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Text, TextInput } from "@/frontend/components/scaled-text";
import { FilmLoader } from "@/frontend/components/film-loader";
import { useLocalSearchParams, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, Palette, Type, Radius } from "@/frontend/constants/theme";
import { useChat, Message } from "@/frontend/hooks/use-chat";
import { useToast } from "@/frontend/components/toast";

// How close to the bottom (px) still counts as "reading the latest" — new
// messages auto-scroll only then, so someone scrolled up reading history
// isn't yanked to the end every poll.
const NEAR_BOTTOM_PX = 80;

// Memoized so the 4s poll (which replaces the messages array only when
// something was appended) re-renders just the new rows, not every bubble.
const MessageRow = memo(function MessageRow({
  item,
  isMe,
  onRetry,
}: {
  item: Message;
  isMe: boolean;
  onRetry: (m: Message) => void;
}) {
  return (
    <View style={[styles.msgWrap, { alignSelf: isMe ? "flex-end" : "flex-start" }]}>
      <View
        style={[
          styles.bubble,
          isMe ? styles.bubbleMe : styles.bubbleThem,
          item.failed && styles.bubbleFailed,
          item.pending && styles.bubblePending,
        ]}
      >
        <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.content}</Text>
      </View>
      {item.failed && (
        <TouchableOpacity onPress={() => onRetry(item)} style={styles.retryRow} activeOpacity={0.7}>
          <Ionicons name="alert-circle" size={13} color={Palette.danger} />
          <Text style={styles.retryText}>Not sent · Tap to retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
});

export default function ChatScreen() {
  const { showToast } = useToast();
  const { userId, name } = useLocalSearchParams<{
    userId: string;
    name?: string;
  }>();
  const { currentUserId, messages, loading, sendMessage, retryMessage } = useChat(userId);
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);
  // See group-chat/[id].tsx for why a hardcoded offset caused the Send button
  // to silently stop registering taps with the keyboard up. Header height =
  // safe-area top inset + standard iOS nav-bar height (44).
  const insets = useSafeAreaInsets();
  const headerHeight = insets.top + 44;
  // A ref, not state: a fast double-tap fires both handleSend calls before
  // React re-renders with the cleared input, so a state-based guard reads
  // stale on the second tap and the same message (and its push) goes out
  // twice. A ref updates synchronously, so the second tap sees it in time.
  const sendingRef = useRef(false);
  // Scroll-position tracking for the auto-scroll rule above. Starts true so
  // the initial load lands at the newest message.
  const nearBottomRef = useRef(true);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
    nearBottomRef.current = distance < NEAR_BOTTOM_PX;
  }, []);
  const onContentSizeChange = useCallback(() => {
    if (nearBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
  }, []);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || sendingRef.current) return;
    sendingRef.current = true;
    setText("");
    const result = await sendMessage(content);
    sendingRef.current = false;
    if (!result.success) {
      // The message now stays on screen as a red "not sent" bubble you can tap
      // to retry (see renderItem), so we don't restore the input. Still surface
      // the most likely reason — you can only DM accepted friends.
      showToast("Not sent — you can only message people you're friends with.");
      return;
    }
    nearBottomRef.current = true;
    listRef.current?.scrollToEnd({ animated: true });
  };

  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <MessageRow item={item} isMe={item.sender_id === currentUserId} onRetry={retryMessage} />
    ),
    [currentUserId, retryMessage],
  );

  return (
    <Starfield>
      {/* The KAV wraps the whole screen, like group-chat/[id].tsx — wrapping
          only the input row pushed the row up but left the FlatList at full
          height behind it, so the newest messages stayed hidden under the
          keyboard. */}
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
      >
        <Stack.Screen options={{ title: name || "Chat" }} />
        {loading && messages.length === 0 ? (
          <FilmLoader full />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No messages yet — say hi.</Text>
            }
            onScroll={onScroll}
            scrollEventThrottle={100}
            onContentSizeChange={onContentSizeChange}
          />
        )}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Message..."
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
  list: { padding: 16, gap: 8 },
  msgWrap: { maxWidth: "80%", marginBottom: 8 },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: Radius.medium,
  },
  bubbleFailed: { borderWidth: 1, borderColor: Palette.dangerBorder },
  bubblePending: { opacity: 0.6 },
  retryRow: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end", marginTop: 3, paddingVertical: 2 },
  retryText: { ...Type.caption, color: Palette.danger, fontWeight: "600" },
  bubbleMe: { backgroundColor: Palette.accent },
  // A received message is a raised surface, not a bordered card — bubbles sit
  // directly on the background in a stack, so the extra outline just added
  // noise at every message.
  bubbleThem: { backgroundColor: Palette.raised },
  bubbleText: { ...Type.body, color: Palette.text },
  // Cream on the amber accent measures ~2.2:1 — well under the 4.5:1 floor.
  bubbleTextMe: { color: Palette.base },
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
  emptyText: {
    ...Type.small,
    color: Palette.textMuted,
    textAlign: "center",
    marginTop: 32,
  },
});
