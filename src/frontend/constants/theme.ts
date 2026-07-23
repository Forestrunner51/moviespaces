/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import "@/frontend/global.css";
import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#000000",
    background: "#ffffff",
    backgroundElement: "#F0F0F3",
    backgroundSelected: "#E0E1E6",
    textSecondary: "#60646C",
  },
  dark: {
    text: "#ffffff",
    background: "#000000",
    backgroundElement: "#212225",
    backgroundSelected: "#2E3135",
    textSecondary: "#B0B4BA",
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

// Deep-space palette for the MovieSpaces cosmic theme — a single fixed dark
// theme (not light/dark adaptive like Colors above), used by screens wrapped
// in <Starfield />.
export const SpaceTheme = {
  backgroundVoid: "#030712",
  deepSpace: "#0A0F24",
  nebulaCard: "rgba(19, 26, 53, 0.8)",
  starWhite: "#FFFFFF",
  glowCyan: "#38BDF8",
  supernovaPink: "#F472B6",
  // Warm cinema accent (marquee gold) — the counterweight to the cool
  // cyan/pink so the palette reads a bit more "movies" and less "generic
  // neon startup". Used sparingly for highlights (ratings, price, hot spaces).
  accentGold: "#F5C518",
  // Real red for destructive actions, kept distinct from supernovaPink so
  // pink can mean one thing (the Watch Party category) instead of also
  // doubling as the delete color.
  danger: "#F87171",
  success: "#4ADE80",
  // Secondary text/icons. Was #475569 (~3:1 on backgroundVoid — under WCAG
  // AA), which made every subtitle/placeholder/metadata line hard to read.
  // #94A3B8 lands around 7:1 while still reading clearly as secondary.
  mutedOrbit: "#94A3B8",
} as const;

// Semantic colour ROLES — the single source of truth for "what colour means
// what". Screens should reach for these (primary/destructive/…) rather than
// picking a raw hue, so the app teaches a consistent visual language:
//   primary  = the main go-forward action (cyan)
//   positive = confirm / success (green)
//   destructive = delete / cancel (red)
//   watchParty = the private-rental category accent (pink)
//   highlight = premium/attention accent (gold)
export const Roles = {
  primary: SpaceTheme.glowCyan,
  onPrimary: SpaceTheme.backgroundVoid,
  positive: SpaceTheme.success,
  onPositive: SpaceTheme.backgroundVoid,
  destructive: SpaceTheme.danger,
  watchParty: SpaceTheme.supernovaPink,
  highlight: SpaceTheme.accentGold,
} as const;

// The display/wordmark typeface. Bebas Neue is a tall condensed marquee face —
// it reads "cinema" and gives titles a distinct identity vs. the system font
// used for body text. Loaded at runtime via useFonts in the root layout
// (no native rebuild needed); `undefined` fallback = system font until loaded.
export const DisplayFont = "BebasNeue_400Regular";

// Shared glassmorphism/glow style fragments so every screen doesn't
// redeclare the same numbers. Spread into a component's own StyleSheet, e.g.
// `card: { ...SpaceStyles.glassCard, padding: 16 }`.
export const SpaceStyles = {
  glassCard: {
    backgroundColor: SpaceTheme.nebulaCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  // React Native's text-glow uses textShadow*, not the View shadow* props.
  // Softened from a tight radius-4 hard glow to a wider, dimmer bloom — the
  // hard glow read a bit cheap/gamer-y; this is a subtler premium halo.
  glowText: {
    textShadowColor: "rgba(56, 189, 248, 0.45)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  // Brand wordmark — display font + generous letter tracking, for the big
  // "MovieSpaces" titles (auth, home).
  wordmark: {
    fontFamily: DisplayFont,
    letterSpacing: 2,
  },
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
