import {
  View,
  Image,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type ImageStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SpaceTheme } from "@/frontend/constants/theme";

interface MoviePosterProps {
  uri?: string | null;
  width: number;
  // Poster art is 2:3 — height derives from width unless overridden.
  height?: number;
  // Only layout/box props are ever passed (margins, radius) — valid on both
  // an Image and the fallback View.
  style?: StyleProp<ViewStyle & ImageStyle>;
}

// Renders a movie poster (2:3) with a themed film-icon fallback for Spaces
// that have no poster (legacy rows, non-movie "other" events, or a manually
// typed title TMDb didn't match).
export function MoviePoster({ uri, width, height, style }: MoviePosterProps) {
  const h = height ?? Math.round(width * 1.5);
  const dims = { width, height: h, borderRadius: Math.max(6, Math.round(width * 0.06)) };

  if (uri) {
    return <Image source={{ uri }} style={[styles.poster, dims, style]} resizeMode="cover" />;
  }
  return (
    <View style={[styles.poster, styles.fallback, dims, style]}>
      <Ionicons name="film-outline" size={Math.round(width * 0.32)} color={SpaceTheme.mutedOrbit} />
    </View>
  );
}

const styles = StyleSheet.create({
  poster: { backgroundColor: "rgba(255,255,255,0.05)" },
  fallback: { alignItems: "center", justifyContent: "center" },
});
