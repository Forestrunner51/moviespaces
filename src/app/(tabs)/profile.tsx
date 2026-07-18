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
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";

interface ProfileData {
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  joinedAt: string | null;
}

export default function ProfileScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [pendingAvatarUri, setPendingAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      .select("display_name, avatar_url, created_at")
      .eq("id", user.id)
      .maybeSingle();

    const displayName =
      row?.display_name || user.user_metadata?.full_name || "Unknown User";

    setProfile({
      displayName,
      avatarUrl: row?.avatar_url ?? null,
      email: user.email ?? null,
      joinedAt: row?.created_at || user.created_at || null,
    });
    setNameInput(displayName);
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
    setPendingAvatarUri(null);
    setEditing(true);
  };

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
        .update({ display_name: nameInput.trim(), avatar_url: avatarUrl })
        .eq("id", userId);
      if (updateError) throw updateError;

      setProfile((prev) => (prev ? { ...prev, displayName: nameInput.trim(), avatarUrl } : prev));
      setEditing(false);
      setPendingAvatarUri(null);
    } catch (err: any) {
      Alert.alert("Couldn't save changes", err.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ActivityIndicator size="large" style={{ flex: 1 }} />;
  }

  const displayedAvatar = pendingAvatarUri || profile?.avatarUrl;
  const initial = (editing ? nameInput : profile?.displayName)?.trim()?.[0]?.toUpperCase() ?? "?";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>

      <View style={styles.card}>
        <TouchableOpacity
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
          <TextInput
            style={styles.nameInput}
            value={nameInput}
            onChangeText={setNameInput}
            placeholder="Display name"
            placeholderTextColor="#999"
          />
        ) : (
          <Text style={styles.name}>{profile?.displayName}</Text>
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
          <View style={styles.editActions}>
            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Save</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelEditButton}
              onPress={() => setEditing(false)}
              disabled={saving}
            >
              <Text style={styles.cancelEditButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.editButton} onPress={startEditing}>
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={styles.button} onPress={handleSignOut}>
        <Text style={styles.buttonText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1A1A1A",
    marginBottom: 20,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    marginBottom: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  avatarWrapper: { marginBottom: 16 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "#eee",
  },
  avatarPlaceholder: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPlaceholderText: { color: "#fff", fontSize: 32, fontWeight: "700" },
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
  avatarEditBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  name: { fontSize: 20, fontWeight: "700", color: "#1A1A1A" },
  nameInput: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1A1A1A",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 200,
    textAlign: "center",
  },
  email: { fontSize: 15, color: "#666", marginTop: 4 },
  joined: { fontSize: 13, color: "#999", marginTop: 8 },
  editButton: { marginTop: 16, padding: 8 },
  editButtonText: { color: "#007AFF", fontSize: 15, fontWeight: "600" },
  editActions: { flexDirection: "row", gap: 12, marginTop: 16 },
  saveButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  saveButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  cancelEditButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelEditButtonText: { color: "#666", fontSize: 15 },
  button: {
    backgroundColor: "#FF3B30",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
