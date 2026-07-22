import { useEffect, useRef, useState } from "react";
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
  Alert,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { useGroupChat, GroupMessage, GroupChatType } from "@/frontend/hooks/use-group-chat";
import { reportContent, blockUser, getBlockedUserIds } from "@/frontend/services/moderation";
import { useFriends } from "@/frontend/hooks/use-friends";

export default function GroupChatScreen() {
  const { id, type, title, showTime, showDate, seasonEpisodeInfo } = useLocalSearchParams<{
    id: string;
    type: GroupChatType;
    title?: string;
    showTime?: string;
    showDate?: string;
    seasonEpisodeInfo?: string;
  }>();
  const { currentUserId, messages, loading, sendMessage } = useGroupChat(type, id);
  const { friends, sendFriendRequest } = useFriends();
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);

  useEffect(() => {
    getBlockedUserIds().then(setBlockedIds);
  }, []);

  const handleAddFriend = async (userId: string, name: string) => {
    const result = await sendFriendRequest(userId);
    Alert.alert(
      result.success ? "Friend request sent" : "Couldn't send request",
      result.success
        ? `We let ${name} know you'd like to be friends.`
        : result.error?.includes("already exists")
          ? `You've already got a friend request going with ${name}.`
          : result.error || "Please try again.",
    );
  };

  const handleSend = async () => {
    const content = text.trim();
    if (!content) return;
    setText("");
    await sendMessage(content);
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
          Alert.alert(
            result.success ? "Reported" : "Couldn't report",
            result.success
              ? "Thanks — our team will review this message."
              : result.error || "Please try again.",
          );
        },
      },
      {
        text: `Block ${item.sender_name || "User"}`,
        style: "destructive",
        onPress: async () => {
          const result = await blockUser(item.sender_id);
          if (result.success) {
            setBlockedIds((prev) => [...prev, item.sender_id]);
          } else {
            Alert.alert("Couldn't block user", result.error || "Please try again.");
          }
        },
      },
    ]);
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
      <TouchableOpacity
        activeOpacity={0.9}
        onLongPress={() => handleLongPressMessage(item)}
        style={styles.rowThem}
      >
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
  };

  const visibleMessages = messages.filter((m) => !blockedIds.includes(m.sender_id));

  return (
    <Starfield>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
      >
        <Stack.Screen options={{ title: title || "Group Chat" }} />
        {(showTime || showDate || seasonEpisodeInfo) && (
          <View style={styles.contextBanner}>
            <Text style={styles.contextBannerText} numberOfLines={2}>
              {seasonEpisodeInfo ? `📺 ${seasonEpisodeInfo} • ` : ""}
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
  contextBanner: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(56, 189, 248, 0.08)",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  contextBannerText: { color: SpaceTheme.glowCyan, fontSize: 12, fontWeight: "600" },
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
  senderUsername: { color: SpaceTheme.mutedOrbit, fontSize: 11, fontWeight: "400" },
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
