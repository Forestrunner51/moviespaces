import { useState } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { ThemedText } from "@/frontend/components/themed-text";
import { useTheme } from "@/frontend/hooks/use-theme";
import { useFriends, Profile } from "@/frontend/hooks/use-friends";

export function FriendsPanel() {
  const theme = useTheme();
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
        style={[
          styles.input,
          { backgroundColor: theme.backgroundElement, color: theme.text },
        ]}
        placeholder="Search users by name..."
        placeholderTextColor={theme.textSecondary}
        value={query}
        onChangeText={handleSearch}
        autoCapitalize="none"
      />

      {searching && <ActivityIndicator style={{ marginVertical: 8 }} />}

      {results.length > 0 && (
        <View style={styles.section}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            SEARCH RESULTS
          </ThemedText>
          {results.map((user) => (
            <View
              key={user.id}
              style={[styles.row, { backgroundColor: theme.backgroundElement }]}
            >
              <ThemedText>{user.display_name}</ThemedText>
              {friendIds.has(user.id) ? (
                <ThemedText themeColor="textSecondary" type="small">
                  Friends
                </ThemedText>
              ) : requestedIds.has(user.id) ? (
                <ThemedText themeColor="textSecondary" type="small">
                  Requested
                </ThemedText>
              ) : (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleAdd(user.id)}
                >
                  <ThemedText type="smallBold">Add</ThemedText>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {pendingRequests.length > 0 && (
        <View style={styles.section}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            PENDING REQUESTS
          </ThemedText>
          {pendingRequests.map((req) => (
            <View
              key={req.id}
              style={[styles.row, { backgroundColor: theme.backgroundElement }]}
            >
              <ThemedText>{req.requester.display_name}</ThemedText>
              <View style={styles.requestActions}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => acceptFriendRequest(req.id)}
                >
                  <ThemedText type="smallBold">Accept</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => declineFriendRequest(req.id)}
                >
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    Decline
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          MY FRIENDS
        </ThemedText>
        {loading && friends.length === 0 ? (
          <ActivityIndicator style={{ marginVertical: 16 }} />
        ) : (
          <FlatList
            data={friends}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            ListEmptyComponent={
              <ThemedText themeColor="textSecondary" style={{ marginTop: 12 }}>
                No friends yet — search above to add some.
              </ThemedText>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.row, { backgroundColor: theme.backgroundElement }]}
                onPress={() =>
                  router.push({
                    pathname: "/chat/[userId]",
                    params: { userId: item.id, name: item.display_name },
                  })
                }
              >
                <ThemedText>{item.display_name}</ThemedText>
                <ThemedText themeColor="textSecondary" type="small">
                  Message
                </ThemedText>
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
    padding: 14,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 8,
  },
  section: { marginTop: 20 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderRadius: 8,
    marginTop: 8,
  },
  requestActions: { flexDirection: "row", gap: 12 },
  actionButton: { marginLeft: 12 },
});
