import { useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, Palette, Type, Radius } from "@/frontend/constants/theme";
import { useChat, Message } from "@/frontend/hooks/use-chat";
import { useToast } from "@/frontend/components/toast";

export default function ChatScreen() {
  const { showToast } = useToast();
  const { userId, name } = useLocalSearchParams<{
    userId: string;
    name?: string;
  }>();
  const { currentUserId, messages, loading, sendMessage } = useChat(userId);
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

  const handleSend = async () => {
    const content = text.trim();
    if (!content || sendingRef.current) return;
    sendingRef.current = true;
    setText("");
    const result = await sendMessage(content);
    sendingRef.current = false;
    if (!result.success) {
      // The optimistic bubble is rolled back by the hook's fetchHistory; tell
      // the user why instead of letting the message just silently disappear
      // (most likely cause: you can only DM accepted friends).
      showToast("You can only message people you're friends with. Send them a friend request first.");
      setText(content);
      return;
    }
    listRef.current?.scrollToEnd({ animated: true });
  };

  const renderItem = ({ item }: { item: Message }) => {
    const isMe = item.sender_id === currentUserId;
    return (
      <View
        style={[
          styles.bubble,
          isMe ? styles.bubbleMe : styles.bubbleThem,
          { alignSelf: isMe ? "flex-end" : "flex-start" },
        ]}
      >
        <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.content}</Text>
      </View>
    );
  };

  return (
    <Starfield>
      <View style={styles.container}>
        <Stack.Screen options={{ title: name || "Chat" }} />
        {loading && messages.length === 0 ? (
          <ActivityIndicator color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
        >
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
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 8 },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: Radius.medium,
    marginBottom: 8,
  },
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
});
