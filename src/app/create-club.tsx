import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceStyles, Palette, Type, Display, Radius } from "@/frontend/constants/theme";
import { useToast } from "@/frontend/components/toast";
import { authFetch } from "@/frontend/services/api";
import { supabase } from "@/frontend/config/supabase";

// Kept in sync with the backend's allow-list in CreateCommunityClub — anything
// else collapses to "General" server-side.
const GENRES = ["Blockbusters", "Sci-Fi", "Horror", "Action", "Indie", "General"];

export default function CreateClubScreen() {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("General");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      showToast("Give your club a name.");
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const hostName = (user?.user_metadata?.full_name as string) || "A Movie Fan";
      const res = await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/group/community-clubs`, {
        method: "POST",
        body: JSON.stringify({ Name: trimmed, GenreCategory: genre, HostName: hostName }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(body?.error || "Couldn't create the club. Please try again.");
        return;
      }
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
