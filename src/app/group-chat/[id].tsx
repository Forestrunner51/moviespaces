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
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { useGroupChat, GroupMessage, GroupChatType } from "@/frontend/hooks/use-group-chat";

export default function GroupChatScreen() {
  const { id, type, title } = useLocalSearchParams<{
    id: string;
    type: GroupChatType;
    title?: string;
  }>();
  const { currentUserId, messages, loading, sendMessage } = useGroupChat(type, id);
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  const handleSend = async () => {
    const content = text.trim();
    if (!content) return;
    setText("");
    await sendMessage(content);
    listRef.current?.scrollToEnd({ animated: true });
  };

  const renderItem = ({ item }: { item: GroupMessage }) => {
    const isMe = item.sender_id === currentUserId;
    return (
      <View
        style={[
          styles.bubble,
          isMe ? styles.bubbleMe : styles.bubbleThem,
          { alignSelf: isMe ? "flex-end" : "flex-start" },
        ]}
      >
        <Text style={styles.bubbleText}>{item.content}</Text>
      </View>
    );
  };

  return (
    <Starfield>
      <View style={styles.container}>
        <Stack.Screen options={{ title: title || "Group Chat" }} />
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
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                No messages yet — say hi to the group.
              </Text>
            }
          />
        )}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={90}
        >
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
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 8 },
  emptyText: { color: SpaceTheme.mutedOrbit, textAlign: "center", marginTop: 24 },
  bubble: {
    maxWidth: "75%",
    padding: 10,
    borderRadius: 12,
    marginBottom: 8,
  },
  bubbleMe: { backgroundColor: SpaceTheme.supernovaPink },
  bubbleThem: { ...SpaceStyles.glassCard },
  bubbleText: { color: SpaceTheme.starWhite },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 100,
    backgroundColor: "rgba(255,255,255,0.08)",
    color: SpaceTheme.starWhite,
  },
  sendButton: {
    backgroundColor: SpaceTheme.glowCyan,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sendButtonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700" },
});
