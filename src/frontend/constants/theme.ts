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
  mutedOrbit: "#475569",
} as const;

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
  // React Native's text-glow uses textShadow*, not the View shadow* props —
  // shadowColor/shadowRadius/shadowOpacity don't render a glow on <Text>.
  glowText: {
    textShadowColor: SpaceTheme.glowCyan,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
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
