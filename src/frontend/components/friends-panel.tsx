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

export function FriendsPanel() {
  const {
    friends,
    pendingRequests,
    loading,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    searchUsers,
  } = useFriends();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());

  const friendIds = new Set(friends.map((f) => f.id));

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
    if (result.success) {
      setRequestedIds((prev) => new Set(prev).add(userId));
    } else if (result.error?.includes("already exists")) {
      // Already friends/requested — just reflect that in the UI, no need to alert.
      setRequestedIds((prev) => new Set(prev).add(userId));
    } else {
      Alert.alert("Couldn't send request", result.error || "Please try again.");
    }
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
              <View>
                <Text style={styles.rowText}>{user.display_name}</Text>
                {user.username && <Text style={styles.rowUsername}>@{user.username}</Text>}
              </View>
              {friendIds.has(user.id) ? (
                <Text style={styles.rowSubtext}>Friends</Text>
              ) : requestedIds.has(user.id) ? (
                <Text style={styles.rowSubtext}>Requested</Text>
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
              <View>
                <Text style={styles.rowText}>{req.requester.display_name}</Text>
                {req.requester.username && (
                  <Text style={styles.rowUsername}>@{req.requester.username}</Text>
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
            data={friends}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No friends yet — search above to add some.</Text>
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
                <View>
                  <Text style={styles.rowText}>{item.display_name}</Text>
                  {item.username && <Text style={styles.rowUsername}>@{item.username}</Text>}
                </View>
                <Text style={styles.rowSubtext}>Message</Text>
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
  rowText: { color: SpaceTheme.starWhite, fontSize: 16 },
  rowUsername: { color: SpaceTheme.mutedOrbit, fontSize: 12, marginTop: 1 },
  rowSubtext: { color: SpaceTheme.mutedOrbit, fontSize: 13 },
  emptyText: { color: SpaceTheme.mutedOrbit, marginTop: 12 },
  requestActions: { flexDirection: "row", gap: 12 },
  actionButton: { marginLeft: 12 },
  actionButtonText: { color: SpaceTheme.glowCyan, fontWeight: "700", fontSize: 14 },
  declineButtonText: { color: SpaceTheme.mutedOrbit, fontWeight: "700", fontSize: 14 },
});
