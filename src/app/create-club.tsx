import { useState } from "react";
import {
  View,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Text, TextInput } from "@/frontend/components/scaled-text";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { uploadImage } from "@/frontend/services/image-upload";
import { supabase } from "@/frontend/config/supabase";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceStyles, Palette, Type, Display, Radius } from "@/frontend/constants/theme";
import { useToast } from "@/frontend/components/toast";
import { authFetch } from "@/frontend/services/api";
import { track } from "@/frontend/services/analytics";
import { resolveDisplayName } from "@/frontend/services/display-name";
import { getDeviceLocation } from "@/frontend/services/nearby-theaters";

// Kept in sync with the backend's allow-list in CreateCommunityClub — anything
// else collapses to "General" server-side.
const GENRES = [
  "Blockbusters",
  "Sci-Fi",
  "Horror",
  "Action",
  "Indie",
  "Comedy",
  "Thriller",
  "Anime",
  "Romance",
  "Classics",
  "Documentary",
  "Family",
  "General",
];

export default function CreateClubScreen() {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("General");
  const [creating, setCreating] = useState(false);
  // Pin the club to the creator's rough location so "Near me" in Discover can
  // surface it. Off by default — a club about a genre isn't inherently local.
  const [localClub, setLocalClub] = useState(false);
  // Optional club cover. Left unset, the server falls back to a film poster
  // from the club's genre, so this is a nicety rather than a required field.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Same flow as a Space cover photo: upload straight to Supabase Storage
  // under the uploader's own folder (Storage RLS scopes writes that way), and
  // hand the backend only the resulting public URL.
  const handlePickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast("Allow photo access to add a club photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [2, 3],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;

    setUploadingPhoto(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You need to be signed in to upload a photo.");
      const url = await uploadImage(
        "space-photos",
        `${user.id}/club-${Date.now()}.jpg`,
        result.assets[0].uri,
      );
      setPhotoUrl(url);
    } catch (err: any) {
      showToast(err?.message || "Couldn't upload that photo. Please try again.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      showToast("Give your club a name.");
      return;
    }
    if (creating) return;
    // An upload still in flight would be dropped by the create call below,
    // silently losing the photo the user just picked.
    if (uploadingPhoto) {
      showToast("Hang on — your photo is still uploading.");
      return;
    }
    setCreating(true);
    try {
      const hostName = await resolveDisplayName();
      // Best-effort: a denied permission or slow fix just creates the club
      // without a pin (getDeviceLocation already races a timeout).
      const loc = localClub ? await getDeviceLocation() : null;
      const res = await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/community-clubs`, {
        method: "POST",
        body: JSON.stringify({
          Name: trimmed,
          GenreCategory: genre,
          HostName: hostName,
          Latitude: loc?.latitude ?? null,
          Longitude: loc?.longitude ?? null,
          PhotoUrl: photoUrl,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(body?.error || "Couldn't create the club. Please try again.");
        return;
      }
      track("club_created");
      router.replace({ pathname: "/group", params: { groupId: body.groupId } });
    } catch {
      showToast("Network error — please try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Starfield>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.backButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/explore"))}
        >
          <Ionicons name="chevron-back" size={22} color={Palette.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Create a Film Club</Text>
        <Text style={styles.subtitle}>
          A public club anyone can find and join. Give it a name and a genre — you&apos;ll be its first member.
        </Text>

        <Text style={styles.label}>Club name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Late Night Horror Crew"
          placeholderTextColor={Palette.textMuted}
          value={name}
          onChangeText={setName}
          maxLength={60}
          autoFocus
        />

        <Text style={styles.label}>Genre</Text>
        <View style={styles.genreRow}>
          {GENRES.map((g) => (
            <TouchableOpacity
              key={g}
              activeOpacity={0.8}
              style={[styles.genreChip, genre === g && styles.genreChipActive]}
              onPress={() => setGenre(g)}
            >
              <Text style={[styles.genreChipText, genre === g && styles.genreChipTextActive]}>{g}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.photoRow}
          onPress={handlePickPhoto}
          disabled={uploadingPhoto}
          accessibilityRole="button"
          accessibilityLabel={photoUrl ? "Change club photo" : "Add a club photo"}
        >
          <MoviePoster uri={photoUrl} width={56} fallbackIcon="camera-outline" />
          <View style={{ flex: 1 }}>
            <Text style={styles.photoLabel}>
              {photoUrl ? "Change club photo" : "Add a club photo (optional)"}
            </Text>
            <Text style={styles.photoHint}>
              Shown on the club and in Discover. Without one, we pick art from the genre.
            </Text>
          </View>
          {uploadingPhoto && <ActivityIndicator color={Palette.accent} />}
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.localRow, localClub && styles.localRowActive]}
          onPress={() => setLocalClub((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: localClub }}
          accessibilityLabel="Local club"
        >
          <Ionicons
            name={localClub ? "location" : "location-outline"}
            size={18}
            color={localClub ? Palette.accent : Palette.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.localTitle, localClub && styles.localTitleActive]}>Local club</Text>
            <Text style={styles.localSub}>
              Attach your rough location so people nearby find it under &quot;Near me&quot;.
            </Text>
          </View>
          <Ionicons
            name={localClub ? "checkbox" : "square-outline"}
            size={20}
            color={localClub ? Palette.accent : Palette.textMuted}
          />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.createButton, creating && styles.createButtonDisabled]}
          onPress={handleCreate}
          disabled={creating}
        >
          {creating ? (
            <ActivityIndicator color={Palette.base} />
          ) : (
            <Text style={styles.createButtonText}>Create Club</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.note}>
          Clubs are public and open to everyone. Keep names friendly — anything abusive is removed.
        </Text>
      </ScrollView>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 40 },
  backButton: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 2, marginBottom: 8, paddingVertical: 4, paddingRight: 8 },
  backText: { ...Type.body, color: Palette.text },
  title: { ...Display.heading, color: Palette.text, marginBottom: 6 },
  subtitle: { ...Type.small, color: Palette.textMuted, marginBottom: 24, lineHeight: 20 },
  label: { ...Type.small, color: Palette.text, fontWeight: "600", marginBottom: 8 },
  input: { ...SpaceStyles.field, color: Palette.text, padding: 14, ...Type.body, marginBottom: 24 },
  genreRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 28 },
  genreChip: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Palette.raised,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  genreChipActive: { backgroundColor: Palette.accentDim, borderColor: Palette.accentBorder },
  genreChipText: { ...Type.small, color: Palette.textMuted },
  genreChipTextActive: { color: Palette.accent, fontWeight: "600" },
  localRow: {
    ...SpaceStyles.field,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  localRowActive: { borderColor: Palette.accentBorder },
  photoRow: {
    ...SpaceStyles.field,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginBottom: 20,
  },
  photoLabel: { ...Type.small, color: Palette.text, fontWeight: "700", marginBottom: 2 },
  photoHint: { ...Type.caption, color: Palette.textMuted, lineHeight: 16 },
  localTitle: { ...Type.small, color: Palette.text, fontWeight: "700" },
  localTitleActive: { color: Palette.accent },
  localSub: { ...Type.caption, color: Palette.textMuted, marginTop: 1 },
  createButton: {
    backgroundColor: Palette.accent,
    padding: 16,
    borderRadius: Radius.medium,
    alignItems: "center",
  },
  createButtonDisabled: { opacity: 0.6 },
  createButtonText: { ...Type.title, color: Palette.base, fontWeight: "700" },
  note: { ...Type.caption, color: Palette.textMuted, marginTop: 16, textAlign: "center", lineHeight: 16 },
});
