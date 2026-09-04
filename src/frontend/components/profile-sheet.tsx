import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import { track } from "@/frontend/services/analytics";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/frontend/config/supabase";
import { Avatar } from "@/frontend/components/avatar";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { useFriends } from "@/frontend/hooks/use-friends";
import { useBlockedIds } from "@/frontend/hooks/use-blocked-ids";
import { membershipLabel } from "@/frontend/constants/theater-memberships";
import { SpaceStyles, Palette, Type, Display, Radius } from "@/frontend/constants/theme";
import { useToast } from "@/frontend/components/toast";

// Tap any avatar in the app → this sheet. It's the payoff of the taste
// onboarding's promise ("shows on your profile so a crew knows who they're
// watching with") — until this existed, top/bottom 3 were visible only to
// their owner. Reads the same public `profiles` row every avatar already
// reads, plus the taste columns.

interface SheetProfile {
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  theaterMemberships: string[];
  favoriteMovies: { imdbId: string; title: string; posterPath: string | null }[];
  leastFavoriteMovies: { imdbId: string; title: string; posterPath: string | null }[];
}

const ProfileSheetContext = createContext<{ openProfile: (userId: string) => void } | null>(null);

// No-op outside the provider (subagents of the tree always have it — the
// provider mounts in the root layout).
export function useProfileSheet() {
  const ctx = useContext(ProfileSheetContext);
  return ctx ?? { openProfile: () => {} };
}

export function ProfileSheetProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const openProfile = useCallback((id: string) => {
    if (id) {
      track("profile_sheet_opened");
      setUserId(id);
    }
  }, []);

  return (
    <ProfileSheetContext.Provider value={{ openProfile }}>
      {children}
      {userId != null && <ProfileSheet userId={userId} onClose={() => setUserId(null)} />}
    </ProfileSheetContext.Provider>
  );
}

function ProfileSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { showToast } = useToast();
  const blockedIds = useBlockedIds();
  const { friends, sentRequests, sendFriendRequest } = useFriends();
  const [profile, setProfile] = useState<SheetProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [justRequested, setJustRequested] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // getSession, not getUser: it resolves from the local session with no
    // network round-trip, so "is this me?" is settled before the profile
    // fetch can win the race and briefly offer Add Friend on your own card.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setMyId(session?.user.id ?? null);
    });
    supabase
      .from("profiles")
      .select("display_name, username, avatar_url, theater_memberships, favorite_movies, least_favorite_movies")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setFailed(true);
          return;
        }
        setProfile({
          displayName: data.display_name || "Movie fan",
          username: data.username ?? null,
          avatarUrl: data.avatar_url ?? null,
          theaterMemberships: data.theater_memberships ? String(data.theater_memberships).split(",") : [],
          favoriteMovies: Array.isArray(data.favorite_movies) ? data.favorite_movies : [],
          leastFavoriteMovies: Array.isArray(data.least_favorite_movies) ? data.least_favorite_movies : [],
        });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // A blocked pair should never see each other's profiles — mirrors the RLS
  // that already refuses their messages both ways.
  if (blockedIds.has(userId)) return null;

  const isSelf = myId === userId;
  const isFriend = friends.some((f) => f.id === userId);
  const requested = justRequested || sentRequests.some((r) => r.receiver.id === userId);

  const handleAdd = async () => {
    if (requesting) return;
    setRequesting(true);
    const result = await sendFriendRequest(userId);
    setRequesting(false);
    if (result.success) setJustRequested(true);
    else if (!result.error?.includes("already exists")) {
      showToast(result.error || "Couldn't send that friend request.");
    }
  };

  const tasteRow = (label: string, danger: boolean, picks: SheetProfile["favoriteMovies"]) =>
    picks.length > 0 && (
      <View style={styles.tasteRow}>
        <Text style={[styles.tasteLabel, danger && styles.tasteLabelDanger]}>{label}</Text>
        {picks.slice(0, 3).map((m) => (
          <MoviePoster key={m.imdbId} uri={m.posterPath} width={52} />
        ))}
      </View>
    );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        {failed ? (
          <Text style={styles.failedText}>Couldn&apos;t load this profile — try again later.</Text>
        ) : !profile ? (
          <Text style={styles.failedText}>Loading…</Text>
        ) : (
          <ScrollView bounces={false}>
            <View style={styles.head}>
              <Avatar uri={profile.avatarUrl} name={profile.displayName} size={64} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{profile.displayName}</Text>
                {profile.username && <Text style={styles.username}>@{profile.username}</Text>}
                {isFriend && <Text style={styles.friendTag}>Friends</Text>}
              </View>
            </View>

            {profile.theaterMemberships.length > 0 && (
              <View style={styles.badgeRow}>
                {profile.theaterMemberships.map((key) => (
                  <View key={key} style={styles.badge}>
                    <Text style={styles.badgeText}>{membershipLabel(key)}</Text>
                  </View>
                ))}
              </View>
            )}

            {tasteRow("TOP 3", false, profile.favoriteMovies)}
            {tasteRow("BOTTOM 3", true, profile.leastFavoriteMovies)}
            {profile.favoriteMovies.length === 0 && profile.leastFavoriteMovies.length === 0 && (
              <Text style={styles.noTaste}>No taste picks yet — mysterious.</Text>
            )}

            {!isSelf && myId != null && (
              <View style={styles.actions}>
                {isFriend ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={styles.primaryAction}
                    onPress={() => {
                      onClose();
                      router.push({ pathname: "/chat/[userId]", params: { userId } });
                    }}
                  >
                    <Ionicons name="chatbubble-outline" size={16} color={Palette.base} />
                    <Text style={styles.primaryActionText}>Message</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={[styles.primaryAction, requested && styles.requestedAction]}
                    disabled={requested || requesting}
                    onPress={handleAdd}
                  >
                    <Ionicons
                      name={requested ? "checkmark" : "person-add-outline"}
                      size={16}
                      color={requested ? Palette.accent : Palette.base}
                    />
                    <Text style={[styles.primaryActionText, requested && styles.requestedActionText]}>
                      {requested ? "Requested" : "Add Friend"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,.55)" },
  sheet: {
    backgroundColor: Palette.raised,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 20,
    paddingBottom: 34,
    maxHeight: "75%",
  },
  grabber: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: Palette.border, marginBottom: 16 },
  head: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
  name: { ...Type.title, color: Palette.text, fontWeight: "700" },
  username: { ...Type.small, color: Palette.textMuted, marginTop: 1 },
  friendTag: { ...Type.caption, color: Palette.positive, fontWeight: "700", marginTop: 3 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  badge: {
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  badgeText: { ...Type.caption, color: Palette.textMuted },
  tasteRow: { ...SpaceStyles.glassCard, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, marginBottom: 10 },
  tasteLabel: { ...Display.section, fontSize: 13, lineHeight: 16, color: Palette.textFaint, width: 60 },
  tasteLabelDanger: { color: Palette.danger },
  noTaste: { ...Type.small, color: Palette.textFaint, fontStyle: "italic", marginBottom: 10 },
  actions: { marginTop: 8 },
  primaryAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Palette.accent,
    borderRadius: Radius.medium,
    paddingVertical: 13,
  },
  primaryActionText: { ...Type.body, color: Palette.base, fontWeight: "700" },
  requestedAction: { backgroundColor: Palette.accentDim, borderWidth: 1, borderColor: Palette.accentBorder },
  requestedActionText: { color: Palette.accent },
  failedText: { ...Type.small, color: Palette.textMuted, textAlign: "center", paddingVertical: 24 },
});
