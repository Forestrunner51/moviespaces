import {
  View,
  Image,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type ImageStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SpaceTheme, Palette } from "@/frontend/constants/theme";

interface MoviePosterProps {
  uri?: string | null;
  width: number;
  // Poster art is 2:3 — height derives from width unless overridden.
  height?: number;
  // Only layout/box props are ever passed (margins, radius) — valid on both
  // an Image and the fallback View.
  style?: StyleProp<ViewStyle & ImageStyle>;
  // For Mystery Movie's tiered poster reveal — RN's Image supports this
  // natively, no new dependency needed.
  blurRadius?: number;
  // Event-category icon (see event-categories.ts) shown instead of the
  // generic film icon when there's no real poster — a fight card and a
  // gaming night have no OMDb poster either way, but they shouldn't both
  // render an identical film-camera icon as if they were both movies.
  //
  // This replaced a `fallbackEmoji` string. Emoji render differently on every
  // OS version, can't take a colour from the theme, and sat off the optical
  // centre of the tile; an icon does all three properly.
  fallbackIcon?: keyof typeof Ionicons.glyphMap;
}

// Renders a movie poster (2:3) with a themed fallback for Spaces that have no
// poster (legacy rows, non-movie events, or a manually typed title OMDb
// didn't match) — the event category's emoji if known, a generic film icon
// otherwise.
export function MoviePoster({ uri, width, height, style, blurRadius, fallbackIcon }: MoviePosterProps) {
  const h = height ?? Math.round(width * 1.5);
  const dims = { width, height: h, borderRadius: Math.max(6, Math.round(width * 0.06)) };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.poster, dims, style]}
        resizeMode="cover"
        blurRadius={blurRadius}
      />
    );
  }
  return (
    <View style={[styles.poster, styles.fallback, dims, style]}>
      <Ionicons
        name={fallbackIcon ?? "film-outline"}
        size={Math.round(width * 0.32)}
        color={SpaceTheme.mutedOrbit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  poster: { backgroundColor: Palette.fill },
  fallback: { alignItems: "center", justifyContent: "center" },
});
