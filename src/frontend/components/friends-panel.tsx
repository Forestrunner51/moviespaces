import { useRef, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@/frontend/components/avatar";
import { SpaceTheme, SpaceStyles, Palette, Type, Radius, Display } from "@/frontend/constants/theme";
import { useFriends, Profile } from "@/frontend/hooks/use-friends";
import { useDmUnreadCounts } from "@/frontend/hooks/use-dm-unread-counts";
import { blockUser } from "@/frontend/services/moderation";
import { useToast } from "@/frontend/components/toast";

export function FriendsPanel() {
  const { showToast } = useToast();
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

  // Debounced (same 300ms idiom as profile.tsx's username check) and guarded
  // against out-of-order responses: firing a request per keystroke meant the
  // "an" response could land after "ann" and overwrite the right results.
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);
  const handleSearch = (text: string) => {
    setQuery(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const seq = ++searchSeqRef.current;
    if (!text.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      const found = await searchUsers(text);
      if (seq !== searchSeqRef.current) return; // a newer keystroke superseded this
      setResults(found);
      setSearching(false);
    }, 300);
  };

  // One row's action in flight at a time — Accept/Decline/Add are async, and
  // a double-tap on any of them used to fire the mutation twice.
  const [busyId, setBusyId] = useState<string | null>(null);
  const runRowAction = async (id: string, action: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await action();
    } finally {
      setBusyId(null);
    }
  };

  const handleAdd = async (userId: string) => {
    const result = await sendFriendRequest(userId);
    if (!result.success && !result.error?.includes("already exists")) {
      showToast(result.error || "Couldn't send that friend request. Please try again.");
    }
  };

  // Tapping "Requested" again un-sends it — same gesture, opposite direction.
  const handleCancelRequest = async (friendshipId: string) => {
    const result = await cancelFriendRequest(friendshipId);
    if (!result.success) {
      showToast(result.error || "Couldn't cancel that request. Please try again.");
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
            showToast(result.error || "Couldn't remove friend. Please try again.");
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
              showToast(result.error || "Couldn't block that user. Please try again.");
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
        placeholder="Search by name or @username"
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
              <Avatar uri={user.avatar_url} name={user.display_name} size={40} />
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
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.actionButton}
                  hitSlop={8}
                  disabled={busyId === user.id}
                  onPress={() => runRowAction(user.id, () => handleAdd(user.id))}
                >
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
              <Avatar uri={req.requester.avatar_url} name={req.requester.display_name} size={40} />
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
                  hitSlop={8}
                  disabled={busyId === req.id}
                  onPress={() => runRowAction(req.id, () => acceptFriendRequest(req.id))}
                >
                  <Text style={styles.actionButtonText}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.actionButton}
                  hitSlop={8}
                  disabled={busyId === req.id}
                  onPress={() => runRowAction(req.id, () => declineFriendRequest(req.id))}
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
                {/* avatar_url was already being fetched by useFriends and
                    then discarded — a social list rendered as plain text. */}
                <Avatar uri={item.avatar_url} name={item.display_name} size={40} />
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
                  <Ionicons name="chatbubble-outline" size={18} color={Palette.textMuted} />
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
    ...SpaceStyles.field,
    color: Palette.text,
    padding: 14,
    ...Type.body,
    marginBottom: 8,
  },
  section: { marginTop: 24 },
  sectionLabel: {
    ...Display.section,
    color: Palette.textMuted,
    textTransform: "uppercase" as const,
    marginBottom: 6,
  },
  // A flat row with a hairline rule, not a card. A friends list is a
  // sequence of people, not a set of discrete objects — stacking each one in
  // its own bordered panel was what made every list in the app look the same.
  row: {
    ...SpaceStyles.row,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  // Names are user-supplied and can be long — let the name block take the
  // slack and truncate, so the action side never gets pushed off the row.
  rowTextBlock: { flex: 1 },
  rowNameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowText: { ...Type.body, color: Palette.text, flexShrink: 1 },
  rowUsername: { ...Type.caption, color: Palette.textMuted, marginTop: 1 },
  unreadBadge: {
    backgroundColor: Palette.accent,
    borderRadius: Radius.pill,
    minWidth: 20,
    alignItems: "center",
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  unreadBadgeText: { color: Palette.base, fontSize: 11, fontWeight: "800" },
  rowSubtext: { ...Type.small, color: Palette.textMuted },
  friendActions: { flexDirection: "row", alignItems: "center", gap: 16, flexShrink: 0 },
  optionsLink: { color: Palette.textMuted, fontSize: 20, fontWeight: "700", lineHeight: 22 },
  cancelRequestText: { ...Type.small, color: Palette.textMuted, fontWeight: "600" },
  emptyText: { ...Type.small, color: Palette.textMuted, marginTop: 12 },
  requestActions: { flexDirection: "row", gap: 16, flexShrink: 0 },
  // Padding + the hitSlop at each usage site gets these text-only buttons to
  // the 44pt minimum; bare Type.small text alone was a ~20pt target.
  actionButton: { flexShrink: 0, paddingVertical: 8, paddingHorizontal: 4 },
  actionButtonText: { ...Type.small, color: Palette.accent, fontWeight: "700" },
  declineButtonText: { ...Type.small, color: Palette.textMuted, fontWeight: "700" },
});
