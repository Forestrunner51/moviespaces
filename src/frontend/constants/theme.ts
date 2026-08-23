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

// The app palette: tinted warm dark + a single lamp-amber accent.
//
// This replaced a blue-black/cyan/magenta "cosmic" palette built from
// Tailwind's stock slate-950 / sky-400 / pink-400 — the single most common
// generated-app look there is, on a metaphor (void, nebula, supernova) that
// described outer space rather than people getting together to watch
// something.
//
// The first pass at replacing it swapped one stock ramp for another (stone)
// and used IMDb's brand yellow, which is a different flavour of the same
// problem: framework defaults and borrowed identity. These values are
// hand-picked and belong to no ramp.
//
// Rule of thumb: amber = the go-forward action or the thing to look at.
// Green and red only ever mean confirmed and destructive. Everything else is
// a neutral. If a screen needs a fourth colour, it probably needs less
// content.
export const Palette = {
  // A *tinted* dark, not a neutral one. Every channel is deliberately
  // unequal (R22 G16 B13) so the ground reads as warm brown-black — dim
  // room, wood, leather — rather than grey. This matters more than it
  // sounds: stock neutral ramps (Tailwind's slate/stone/zinc) are what most
  // generated interfaces sit on, and a neutral dark reads as *untouched*
  // where a tinted one reads as chosen. Warm also keeps skin tones in
  // avatars from going sickly, which cool blue-blacks do.
  base: "#16100D",
  raised: "#221913",
  // Card fill. Solid rather than translucent — the old glassmorphism meant
  // every surface sat at the same visual depth no matter its importance.
  surface: "#2B201A",
  surfaceHover: "#35281F",
  // Warm cream rather than pure #FFF (which glares on warm darks) and
  // deliberately not #FAFAF9, which is a stock ramp value.
  text: "#F7F0E8",
  // Secondary text/icons — warm taupe, ~7:1 on base, comfortably past WCAG
  // AA while still clearly reading as secondary.
  textMuted: "#B3A296",
  textFaint: "#7D6D61",
  // Lamp amber: the one accent, meant to read as light thrown into a dim
  // room. Deliberately NOT the previous #F5C518 — that's IMDb's brand
  // yellow, i.e. borrowed identity — and not a stop on any framework ramp.
  accent: "#EF8A3C",
  accentDim: "rgba(239, 138, 60, 0.14)",
  accentBorder: "rgba(239, 138, 60, 0.38)",
  // Status colours. Danger is pushed to a rose-crimson specifically so it
  // can't be mistaken for the amber accent — an orange accent and an orange
  // "delete" would be genuinely ambiguous.
  positive: "#6FBF73",
  danger: "#E0525F",
  // Tinted fills/borders for status surfaces (banners, badges). These exist
  // because ~50 hardcoded rgba() literals from the old cyan/pink/green
  // palette were scattered through the screens, which is how a retheme ends
  // up half-applied — the tokens change and the literals don't.
  positiveDim: "rgba(111, 191, 123, 0.13)",
  positiveBorder: "rgba(111, 191, 123, 0.35)",
  dangerDim: "rgba(224, 82, 95, 0.12)",
  dangerBorder: "rgba(224, 82, 95, 0.38)",
  // Hairlines and dividers — the main structural device now that most lists
  // are flat on the background instead of stacked cards.
  border: "rgba(247, 240, 232, 0.10)",
  borderStrong: "rgba(247, 240, 232, 0.18)",
  // Subtle translucent fills (neutral badges, disabled buttons, toggle
  // tracks). Cream-based like border/borderStrong — the screens were doing
  // this ad hoc with rgba(255,255,255,…) literals, which read cool against
  // the warm ground, exactly the half-applied-retheme problem these tokens
  // exist to prevent.
  fill: "rgba(247, 240, 232, 0.07)",
  fillStrong: "rgba(247, 240, 232, 0.14)",
} as const;

// Back-compat alias. The old key names are referenced in ~200 places across
// the app; mapping them onto the new palette rethemes everything at once
// without a risky mass rename. New code should prefer `Palette`/`Roles`.
// Note several old keys deliberately collapse onto the same new value —
// cyan and pink were doing overlapping jobs, which is part of why the old
// palette had no hierarchy.
export const SpaceTheme = {
  backgroundVoid: Palette.base,
  deepSpace: Palette.raised,
  nebulaCard: Palette.surface,
  starWhite: Palette.text,
  // Was cyan: the primary action colour. Now the single amber accent.
  glowCyan: Palette.accent,
  // Was magenta, used for the Watch Party category *and* as a second accent.
  // Category is now conveyed by icon + label rather than a competing hue.
  supernovaPink: Palette.accent,
  accentGold: Palette.accent,
  danger: Palette.danger,
  success: Palette.positive,
  mutedOrbit: Palette.textMuted,
} as const;

// A real type scale. The app previously used 17 distinct font sizes chosen
// ad hoc per screen (10,11,12,13,14,15,16,17,18,20,22,24,26,28,30,32,46),
// which is what makes an interface read as unconsidered — the eye picks up
// the inconsistent rhythm even when no single screen looks wrong.
// Body face. Karla — a grotesque with a slightly quirky, hand-drawn feel
// (the open 'a', the angled terminals) that reads as chosen rather than
// defaulted. Deliberately NOT the system font, Inter, Roboto or a geometric
// (DM Sans / Outfit / Plus Jakarta): those are what every generated UI ships
// with, and the body text is 95% of what a person reads, so it's where the
// app's voice actually lives. Loaded at runtime in the root layout next to
// Bebas. On iOS, expo-font registers the whole family under one alias, so a
// `fontWeight` on a Karla style resolves to the matching loaded weight —
// still, prefer the explicit `Font.*` families below for new code.
export const Font = {
  regular: "Karla_400Regular",
  medium: "Karla_500Medium",
  semibold: "Karla_600SemiBold",
  bold: "Karla_700Bold",
} as const;

export const Type = {
  // Metadata, timestamps, badge text.
  caption: { fontFamily: Font.regular, fontSize: 12, lineHeight: 16 },
  // Secondary/supporting copy.
  small: { fontFamily: Font.regular, fontSize: 14, lineHeight: 20 },
  // Default body.
  body: { fontFamily: Font.regular, fontSize: 16, lineHeight: 22 },
  // Card titles, section headers.
  title: { fontFamily: Font.semibold, fontSize: 20, lineHeight: 26 },
  // Screen headings.
  heading: { fontFamily: Font.bold, fontSize: 28, lineHeight: 34 },
  // The event date on a Space — the primary content of an event app.
  display: { fontFamily: Font.bold, fontSize: 34, lineHeight: 38 },
} as const;

// Three radii, not fifteen. Pill is for chips/avatars only.
export const Radius = {
  small: 8,
  medium: 12,
  pill: 999,
} as const;

export const DisplayFont = "BebasNeue_400Regular";

// The display face, used properly.
//
// Bebas Neue was already loaded and paid for at runtime but applied to only
// nine screen titles — every other character in the app was the system font.
// A display/body pairing with real contrast between them is the most reliable
// way an interface reads as designed by a person rather than assembled, and
// this app was leaving it entirely on the table.
//
// Bebas Neue is a caps-only face (lowercase glyphs render as capitals), so
// these are for dates, numbers, and short headers — never body copy. Line
// heights are generous relative to the size because tall condensed faces clip
// their ascenders in React Native otherwise.
export const Display = {
  // The event date on a Space screen. Clearly subordinate to the film title
  // above it: on a detail screen you already know which event you tapped, so
  // the title anchors identity and the date is its most important attribute.
  // At 38 it was *larger* than that title — same face, bigger size — which
  // inverted the reading order and is most of why the block felt bolted on.
  date: { fontFamily: DisplayFont, fontSize: 25, lineHeight: 29, letterSpacing: 0.5 },
  // Event date on a list card.
  dateCard: { fontFamily: DisplayFont, fontSize: 24, lineHeight: 29, letterSpacing: 0.4 },
  // Screen headings.
  heading: { fontFamily: DisplayFont, fontSize: 32, lineHeight: 38, letterSpacing: 1 },
  // Section headers ("WHO'S GOING", "MY FRIENDS").
  section: { fontFamily: DisplayFont, fontSize: 17, lineHeight: 21, letterSpacing: 1.4 },
  // Counts and stats.
  stat: { fontFamily: DisplayFont, fontSize: 21, lineHeight: 25, letterSpacing: 0.4 },
} as const;

// Semantic colour ROLES — the single source of truth for "what colour means
// what". Screens should reach for these (primary/destructive/…) rather than
// picking a raw hue, so the app teaches a consistent visual language:
//   primary  = the main go-forward action (amber)
//   positive = confirm / success (green)
//   destructive = delete / cancel (rose-crimson)
//   watchParty = the private-rental category accent
//   highlight = attention accent
export const Roles = {
  primary: Palette.accent,
  onPrimary: Palette.base,
  positive: Palette.positive,
  onPositive: Palette.base,
  destructive: Palette.danger,
  watchParty: Palette.accent,
  highlight: Palette.accent,
} as const;

// The display/wordmark typeface. Bebas Neue is a tall condensed marquee face —
// it reads "cinema" and gives titles a distinct identity vs. the system font
// used for body text. Loaded at runtime via useFonts in the root layout
// (no native rebuild needed); `undefined` fallback = system font until loaded.


// Shared glassmorphism/glow style fragments so every screen doesn't
// redeclare the same numbers. Spread into a component's own StyleSheet, e.g.
// `card: { ...SpaceStyles.glassCard, padding: 16 }`.
export const SpaceStyles = {
  // A card now means "a discrete, tappable object" — a Space, a nav choice.
  // It used to be spread onto 58 different surfaces including plain list
  // rows, text inputs and icon circles, which left nothing looking more
  // important than anything else. Rows and inputs should use `row`/`field`
  // below instead, so that when something *is* a card it carries weight.
  glassCard: {
    backgroundColor: Palette.surface,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  // Flat list row: no fill, hairline separator. The default for member
  // lists, friend lists, settings rows — anything that's a sequence rather
  // than a set of objects.
  row: {
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  // Form input — recessed rather than raised, so it reads as somewhere to
  // type instead of another card.
  field: {
    backgroundColor: Palette.raised,
    borderRadius: Radius.small,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  // Kept as a no-op so the ~10 call sites don't have to change in lockstep.
  // The cyan text-glow it used to apply is one of the strongest "generated
  // UI" signals there is, and it fought the warm palette besides.
  glowText: {},
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
