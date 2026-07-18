import { useRef, useState } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { ThemedText } from "@/frontend/components/themed-text";
import { ThemedView } from "@/frontend/components/themed-view";
import { useTheme } from "@/frontend/hooks/use-theme";
import { useGroupChat, GroupMessage, GroupChatType } from "@/frontend/hooks/use-group-chat";

export default function GroupChatScreen() {
  const { id, type, title } = useLocalSearchParams<{
    id: string;
    type: GroupChatType;
    title?: string;
  }>();
  const theme = useTheme();
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
          {
            alignSelf: isMe ? "flex-end" : "flex-start",
            backgroundColor: isMe ? "#E50914" : theme.backgroundElement,
          },
        ]}
      >
        <ThemedText>{item.content}</ThemedText>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: title || "Group Chat" }} />
      {loading && messages.length === 0 ? (
        <ActivityIndicator style={{ flex: 1 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={{ textAlign: "center", marginTop: 24 }}>
              No messages yet — say hi to the group.
            </ThemedText>
          }
        />
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <View style={styles.inputRow}>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: theme.backgroundElement, color: theme.text },
            ]}
            placeholder="Message the group..."
            placeholderTextColor={theme.textSecondary}
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
            <ThemedText type="smallBold">Send</ThemedText>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 8 },
  bubble: {
    maxWidth: "75%",
    padding: 10,
    borderRadius: 12,
    marginBottom: 8,
  },
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
  },
  sendButton: {
    backgroundColor: "#E50914",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
