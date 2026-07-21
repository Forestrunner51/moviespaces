import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { supabase } from "@/frontend/config/supabase";
import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { THEATER_MEMBERSHIPS, membershipLabel } from "@/frontend/constants/theater-memberships";
import { checkUsernameAvailable, normalizeUsername } from "@/frontend/services/username";

interface ProfileData {
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  email: string | null;
  joinedAt: string | null;
  theaterMemberships: string[];
}

export default function ProfileScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [pendingAvatarUri, setPendingAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [membershipsInput, setMembershipsInput] = useState<string[]>([]);
  const [usernameInput, setUsernameInput] = useState("");
  const [usernameCheck, setUsernameCheck] = useState<{ available: boolean; message: string } | null>(
    null,
  );
  const [checkingUsername, setCheckingUsername] = useState(false);

  const toggleMembership = (key: string) => {
    setMembershipsInput((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key],
    );
  };

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    setUserId(user.id);

    const { data: row } = await supabase
      .from("profiles")
      .select("display_name, avatar_url, created_at, theater_memberships, username")
      .eq("id", user.id)
      .maybeSingle();

    const displayName =
      row?.display_name || user.user_metadata?.full_name || "Unknown User";
    const theaterMemberships = row?.theater_memberships
      ? row.theater_memberships.split(",")
      : [];

    setProfile({
      displayName,
      username: row?.username ?? null,
      avatarUrl: row?.avatar_url ?? null,
      email: user.email ?? null,
      joinedAt: row?.created_at || user.created_at || null,
      theaterMemberships,
    });
    setNameInput(displayName);
    setUsernameInput(row?.username ?? "");
    setMembershipsInput(theaterMemberships);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const startEditing = () => {
    setNameInput(profile?.displayName ?? "");
    setUsernameInput(profile?.username ?? "");
    setUsernameCheck(null);
    setMembershipsInput(profile?.theaterMemberships ?? []);
    setPendingAvatarUri(null);
    setEditing(true);
  };

  // Debounced availability check — fires 400ms after typing stops.
  useEffect(() => {
    if (!editing) return;
    const trimmed = usernameInput.trim();
    if (!trimmed || normalizeUsername(trimmed) === profile?.username) {
      setUsernameCheck(null);
      return;
    }
    setCheckingUsername(true);
    const handle = setTimeout(() => {
      checkUsernameAvailable(trimmed, userId)
        .then(setUsernameCheck)
        .finally(() => setCheckingUsername(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [usernameInput, editing, userId, profile?.username]);

  const pickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo access to set a profile picture.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      setPendingAvatarUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!userId) return;
    if (!nameInput.trim()) {
      Alert.alert("Name required", "Please enter a display name.");
      return;
    }

    const trimmedUsername = usernameInput.trim();
    const normalizedUsername = trimmedUsername ? normalizeUsername(trimmedUsername) : null;
    if (normalizedUsername && normalizedUsername !== profile?.username) {
      if (usernameCheck?.available === false) {
        Alert.alert("Username unavailable", usernameCheck.message);
        return;
      }
      // Hasn't finished (or never ran) a check yet — verify right before
      // saving rather than trusting stale/debounce-pending state.
      const result = await checkUsernameAvailable(normalizedUsername, userId);
      if (!result.available) {
        setUsernameCheck(result);
        Alert.alert("Username unavailable", result.message);
        return;
      }
    }

    setSaving(true);
    try {
      let avatarUrl = profile?.avatarUrl ?? null;

      if (pendingAvatarUri) {
        const response = await fetch(pendingAvatarUri);
        const blob = await response.blob();
        const path = `${userId}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, blob, { contentType: "image/jpeg", upsert: true });
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from("avatars")
          .getPublicUrl(path);
        // Cache-bust so the new image actually shows instead of a stale CDN copy.
        avatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          display_name: nameInput.trim(),
          username: normalizedUsername,
          avatar_url: avatarUrl,
          theater_memberships: membershipsInput.length > 0 ? membershipsInput.join(",") : null,
        })
        .eq("id", userId);
      if (updateError) throw updateError;

      setProfile((prev) =>
        prev
          ? {
              ...prev,
              displayName: nameInput.trim(),
              username: normalizedUsername,
              avatarUrl,
              theaterMemberships: membershipsInput,
            }
          : prev,
      );
      setEditing(false);
      setPendingAvatarUri(null);
    } catch (err: any) {
      Alert.alert("Couldn't save changes", err.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Starfield>
        <ActivityIndicator size="large" color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
      </Starfield>
    );
  }

  const displayedAvatar = pendingAvatarUri || profile?.avatarUrl;
  const initial = (editing ? nameInput : profile?.displayName)?.trim()?.[0]?.toUpperCase() ?? "?";

  return (
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.title, SpaceStyles.glowText]}>Profile</Text>

        <View style={styles.card}>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!editing}
            onPress={pickAvatar}
            style={styles.avatarWrapper}
          >
            {displayedAvatar ? (
              <Image source={{ uri: displayedAvatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarPlaceholderText}>{initial}</Text>
              </View>
            )}
            {editing && (
              <View style={styles.avatarEditBadge}>
                <Text style={styles.avatarEditBadgeText}>Edit</Text>
              </View>
            )}
          </TouchableOpacity>

          {editing ? (
            <>
              <TextInput
                style={styles.nameInput}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="Display name"
                placeholderTextColor={SpaceTheme.mutedOrbit}
              />
              <TextInput
                style={[styles.nameInput, styles.usernameInput]}
                value={usernameInput}
                onChangeText={(text) => setUsernameInput(text.toLowerCase())}
                placeholder="username"
                placeholderTextColor={SpaceTheme.mutedOrbit}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {checkingUsername ? (
                <ActivityIndicator size="small" color={SpaceTheme.mutedOrbit} style={{ marginTop: 6 }} />
              ) : (
                usernameCheck && (
                  <Text
                    style={[
                      styles.usernameCheckText,
                      { color: usernameCheck.available ? "#4ADE80" : SpaceTheme.supernovaPink },
                    ]}
                  >
                    {usernameCheck.available ? "✓" : "✗"} {usernameCheck.message}
                  </Text>
                )
              )}
            </>
          ) : (
            <>
              <Text style={styles.name}>{profile?.displayName}</Text>
              {profile?.username && <Text style={styles.usernameText}>@{profile.username}</Text>}
            </>
          )}

          {profile?.email && <Text style={styles.email}>{profile.email}</Text>}
          {profile?.joinedAt && (
            <Text style={styles.joined}>
              Member since{" "}
              {new Date(profile.joinedAt).toLocaleDateString(undefined, {
                month: "long",
                year: "numeric",
              })}
            </Text>
          )}

          {editing ? (
            <View style={styles.membershipsSection}>
              <Text style={styles.membershipsLabel}>Theater Memberships</Text>
              <View style={styles.chipRow}>
                {THEATER_MEMBERSHIPS.map((m) => (
                  <TouchableOpacity
                    key={m.key}
                    activeOpacity={0.8}
                    style={[
                      styles.membershipChip,
                      membershipsInput.includes(m.key) && styles.membershipChipActive,
                    ]}
                    onPress={() => toggleMembership(m.key)}
                  >
                    <Text
                      style={[
                        styles.membershipChipText,
                        membershipsInput.includes(m.key) && styles.membershipChipTextActive,
                      ]}
                    >
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            profile && profile.theaterMemberships.length > 0 && (
              <View style={[styles.chipRow, styles.membershipsSection]}>
                {profile.theaterMemberships.map((key) => (
                  <View key={key} style={styles.membershipBadge}>
                    <Text style={styles.membershipBadgeText}>{membershipLabel(key)}</Text>
                  </View>
                ))}
              </View>
            )
          )}

          {editing ? (
            <View style={styles.editActions}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.saveButton}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={SpaceTheme.backgroundVoid} />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.cancelEditButton}
                onPress={() => setEditing(false)}
                disabled={saving}
              >
                <Text style={styles.cancelEditButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity activeOpacity={0.8} style={styles.editButton} onPress={startEditing}>
              <Text style={styles.editButtonText}>Edit Profile</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity activeOpacity={0.8} style={styles.button} onPress={handleSignOut}>
          <Text style={styles.buttonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: SpaceTheme.starWhite,
    marginBottom: 20,
  },
  card: {
    ...SpaceStyles.glassCard,
    padding: 24,
    alignItems: "center",
    marginBottom: 32,
  },
  avatarWrapper: { marginBottom: 16 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  avatarPlaceholder: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: SpaceTheme.glowCyan,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPlaceholderText: { color: SpaceTheme.backgroundVoid, fontSize: 32, fontWeight: "700" },
  avatarEditBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderBottomLeftRadius: 42,
    borderBottomRightRadius: 42,
    paddingVertical: 4,
    alignItems: "center",
  },
  avatarEditBadgeText: { color: SpaceTheme.starWhite, fontSize: 11, fontWeight: "700" },
  name: { fontSize: 20, fontWeight: "700", color: SpaceTheme.starWhite },
  usernameText: { fontSize: 14, color: SpaceTheme.mutedOrbit, marginTop: 2 },
  usernameInput: { marginTop: 8, fontSize: 15 },
  usernameCheckText: { fontSize: 12, fontWeight: "600", marginTop: 6 },
  nameInput: {
    fontSize: 18,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 200,
    textAlign: "center",
  },
  email: { fontSize: 15, color: SpaceTheme.mutedOrbit, marginTop: 4 },
  joined: { fontSize: 13, color: SpaceTheme.mutedOrbit, marginTop: 8 },
  membershipsSection: { marginTop: 16, width: "100%" },
  membershipsLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: SpaceTheme.mutedOrbit,
    marginBottom: 8,
    textTransform: "uppercase",
    textAlign: "center",
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  membershipChip: {
    ...SpaceStyles.glassCard,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  membershipChipActive: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderColor: SpaceTheme.glowCyan,
  },
  membershipChipText: { fontSize: 13, fontWeight: "600", color: SpaceTheme.mutedOrbit },
  membershipChipTextActive: { color: SpaceTheme.glowCyan },
  membershipBadge: {
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.35)",
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  membershipBadgeText: { fontSize: 12, fontWeight: "600", color: SpaceTheme.glowCyan },
  editButton: { marginTop: 16, padding: 8 },
  editButtonText: { color: SpaceTheme.glowCyan, fontSize: 15, fontWeight: "600" },
  editActions: { flexDirection: "row", gap: 12, marginTop: 16 },
  saveButton: {
    backgroundColor: SpaceTheme.glowCyan,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  saveButtonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", fontSize: 15 },
  cancelEditButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelEditButtonText: { color: SpaceTheme.mutedOrbit, fontSize: 15 },
  button: {
    backgroundColor: SpaceTheme.supernovaPink,
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: { color: SpaceTheme.backgroundVoid, fontWeight: "700", fontSize: 16 },
});
