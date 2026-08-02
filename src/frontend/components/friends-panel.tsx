import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { useFriends, Profile } from "@/frontend/hooks/use-friends";
import { useDmUnreadCounts } from "@/frontend/hooks/use-dm-unread-counts";
import { blockUser } from "@/frontend/services/moderation";

export function FriendsPanel() {
  const {
    friends,
    pendingRequests,
    sentRequests,
    loading,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeFriend,
    searchUsers,
  } = useFriends();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);

  const unreadCounts = useDmUnreadCounts(friends.map((f) => f.id));
  const friendIds = new Set(friends.map((f) => f.id));
  const sentRequestByUserId = new Map(sentRequests.map((r) => [r.receiver.id, r.id]));

  // The same search box doubles as a live filter over your existing friends
  // — without this, a large friends list has no way to jump to a specific
  // person other than scrolling through an unfiltered wall of rows.
  const visibleFriends = query.trim()
    ? friends.filter((f) => {
        const q = query.trim().toLowerCase();
        return (
          f.display_name.toLowerCase().includes(q) ||
          (f.username ?? "").toLowerCase().includes(q)
        );
      })
    : friends;

  const handleSearch = async (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const found = await searchUsers(text);
    setResults(found);
    setSearching(false);
  };

  const handleAdd = async (userId: string) => {
    const result = await sendFriendRequest(userId);
    if (!result.success && !result.error?.includes("already exists")) {
      Alert.alert("Couldn't send request", result.error || "Please try again.");
    }
  };

  // Tapping "Requested" again un-sends it — same gesture, opposite direction.
  const handleCancelRequest = async (friendshipId: string) => {
    const result = await cancelFriendRequest(friendshipId);
    if (!result.success) {
      Alert.alert("Couldn't cancel request", result.error || "Please try again.");
    }
  };

  const handleRemoveFriend = (friendshipId: string, name: string) => {
    Alert.alert("Remove friend?", `${name} will be removed from your friends list.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const result = await removeFriend(friendshipId);
          if (!result.success) {
            Alert.alert("Couldn't remove friend", result.error || "Please try again.");
          }
        },
      },
    ]);
  };

  const handleBlockFriend = (userId: string, friendshipId: string, name: string) => {
    Alert.alert(
      "Block this person?",
      `${name} will be removed as a friend and won't be able to contact you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            const result = await blockUser(userId);
            if (!result.success) {
              Alert.alert("Couldn't block user", result.error || "Please try again.");
              return;
            }
            await removeFriend(friendshipId);
          },
        },
      ],
    );
  };

  // Remove/Block live behind a single "⋯" rather than as inline links —
  // three tap targets plus a name don't fit a row on a narrow screen, and
  // this matches how Explore already surfaces per-item actions.
  const handleFriendOptions = (friend: (typeof friends)[number]) => {
    Alert.alert(friend.display_name, undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove Friend",
        style: "destructive",
        onPress: () => handleRemoveFriend(friend.friendshipId, friend.display_name),
      },
      {
        text: "Block",
        style: "destructive",
        onPress: () => handleBlockFriend(friend.id, friend.friendshipId, friend.display_name),
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Search users by name or @username..."
        placeholderTextColor={SpaceTheme.mutedOrbit}
        value={query}
        onChangeText={handleSearch}
        autoCapitalize="none"
      />

      {searching && <ActivityIndicator color={SpaceTheme.glowCyan} style={{ marginVertical: 8 }} />}

      {results.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SEARCH RESULTS</Text>
          {results.map((user) => (
            <View key={user.id} style={styles.row}>
              <View style={styles.rowTextBlock}>
                <Text style={styles.rowText} numberOfLines={1}>
                  {user.display_name}
                </Text>
                {user.username && (
                  <Text style={styles.rowUsername} numberOfLines={1}>
                    @{user.username}
                  </Text>
                )}
              </View>
              {friendIds.has(user.id) ? (
                <Text style={styles.rowSubtext}>Friends</Text>
              ) : sentRequestByUserId.has(user.id) ? (
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.actionButton}
                  hitSlop={8}
                  onPress={() => handleCancelRequest(sentRequestByUserId.get(user.id)!)}
                >
                  <Text style={styles.cancelRequestText}>Requested ✕</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity activeOpacity={0.8} style={styles.actionButton} onPress={() => handleAdd(user.id)}>
                  <Text style={styles.actionButtonText}>Add</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {pendingRequests.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PENDING REQUESTS</Text>
          {pendingRequests.map((req) => (
            <View key={req.id} style={styles.row}>
              <View style={styles.rowTextBlock}>
                <Text style={styles.rowText} numberOfLines={1}>
                  {req.requester.display_name}
                </Text>
                {req.requester.username && (
                  <Text style={styles.rowUsername} numberOfLines={1}>
                    @{req.requester.username}
                  </Text>
                )}
              </View>
              <View style={styles.requestActions}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.actionButton}
                  onPress={() => acceptFriendRequest(req.id)}
                >
                  <Text style={styles.actionButtonText}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.actionButton}
                  onPress={() => declineFriendRequest(req.id)}
                >
                  <Text style={styles.declineButtonText}>Decline</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>MY FRIENDS</Text>
        {loading && friends.length === 0 ? (
          <ActivityIndicator color={SpaceTheme.glowCyan} style={{ marginVertical: 16 }} />
        ) : (
          <FlatList
            data={visibleFriends}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {friends.length === 0
                  ? "No friends yet — search above to add some."
                  : `No friends match "${query.trim()}".`}
              </Text>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.row}
                onPress={() =>
                  router.push({
                    pathname: "/chat/[userId]",
                    params: { userId: item.id, name: item.display_name },
                  })
                }
              >
                <View style={styles.rowTextBlock}>
                  <View style={styles.rowNameLine}>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {item.display_name}
                    </Text>
                    {!!unreadCounts[item.id] && (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadBadgeText}>
                          {unreadCounts[item.id] > 9 ? "9+" : unreadCounts[item.id]}
                        </Text>
                      </View>
                    )}
                  </View>
                  {item.username && (
                    <Text style={styles.rowUsername} numberOfLines={1}>
                      @{item.username}
                    </Text>
                  )}
                </View>
                <View style={styles.friendActions}>
                  <Text style={styles.rowSubtext}>Message</Text>
                  <TouchableOpacity
                    hitSlop={10}
                    onPress={(e) => {
                      e.stopPropagation();
                      handleFriendOptions(item);
                    }}
                  >
                    <Text style={styles.optionsLink}>⋯</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  input: {
    ...SpaceStyles.glassCard,
    color: SpaceTheme.starWhite,
    padding: 14,
    fontSize: 16,
    marginBottom: 8,
  },
  section: { marginTop: 20 },
  sectionLabel: { color: SpaceTheme.mutedOrbit, fontSize: 13, fontWeight: "700" },
  row: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    marginTop: 8,
  },
  // Names are user-supplied and can be long — let the name block take the
  // slack and truncate, so the action side never gets pushed off the row.
  rowTextBlock: { flex: 1, marginRight: 12 },
  rowNameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowText: { color: SpaceTheme.starWhite, fontSize: 16, flexShrink: 1 },
  rowUsername: { color: SpaceTheme.mutedOrbit, fontSize: 12, marginTop: 1 },
  unreadBadge: {
    backgroundColor: SpaceTheme.supernovaPink,
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  unreadBadgeText: { color: SpaceTheme.backgroundVoid, fontSize: 11, fontWeight: "800" },
  rowSubtext: { color: SpaceTheme.mutedOrbit, fontSize: 13 },
  friendActions: { flexDirection: "row", alignItems: "center", gap: 14, flexShrink: 0 },
  optionsLink: { color: SpaceTheme.mutedOrbit, fontSize: 20, fontWeight: "700", lineHeight: 22 },
  cancelRequestText: { color: SpaceTheme.mutedOrbit, fontSize: 13, fontWeight: "600" },
  emptyText: { color: SpaceTheme.mutedOrbit, marginTop: 12 },
  requestActions: { flexDirection: "row", gap: 12, flexShrink: 0 },
  actionButton: { flexShrink: 0 },
  actionButtonText: { color: SpaceTheme.glowCyan, fontWeight: "700", fontSize: 14 },
  declineButtonText: { color: SpaceTheme.mutedOrbit, fontWeight: "700", fontSize: 14 },
});
