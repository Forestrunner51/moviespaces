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
  Image,
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
    if (isMe) {
      return (
        <View style={[styles.bubble, styles.bubbleMe, { alignSelf: "flex-end" }]}>
          <Text style={styles.bubbleText}>{item.content}</Text>
        </View>
      );
    }
    return (
      <View style={styles.rowThem}>
        {item.sender_avatar_url ? (
          <Image source={{ uri: item.sender_avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarFallbackText}>
              {(item.sender_name || "?").charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.senderName}>{item.sender_name || "Someone"}</Text>
          <View style={[styles.bubble, styles.bubbleThem, { alignSelf: "flex-start", marginBottom: 0 }]}>
            <Text style={styles.bubbleText}>{item.content}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <Starfield>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
      >
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
  rowThem: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 8, maxWidth: "85%" },
  avatar: { width: 28, height: 28, borderRadius: 14, marginBottom: 4 },
  avatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginBottom: 4,
    backgroundColor: SpaceTheme.deepSpace,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: { color: SpaceTheme.glowCyan, fontSize: 12, fontWeight: "700" },
  senderName: { color: SpaceTheme.mutedOrbit, fontSize: 11, fontWeight: "600", marginBottom: 3, marginLeft: 2 },
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
