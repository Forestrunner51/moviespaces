import { NativeModules } from "react-native";

// Gives supabase-js a secure crypto.getRandomValues for the PKCE verifier it
// generates on EVERY auth call (signUp/signIn/resetPassword — not just OAuth)
// once flowType: "pkce" is set on the client. Only installed when its native
// module (RNGetRandomValues / ExpoRandom / ExpoCrypto) is actually linked in
// — i.e. after a fresh EAS build. Installing it unconditionally is worse than
// doing nothing: it replaces `crypto === undefined` (which supabase-js safely
// detects and falls back to Math.random() for) with a `crypto` object whose
// getRandomValues() *throws* "Native module not found" the moment anything
// calls it — silently breaking every signUp/signIn/resetPassword on any build
// that predates adding this package. Once rebuilt, this check passes and the
// real, secure polyfill installs as intended.
export const hasRandomValuesNativeModule =
  !!NativeModules.RNGetRandomValues ||
  !!NativeModules.ExpoRandom ||
  !!(globalThis as any).ExpoModules?.ExpoRandom ||
  !!(globalThis as any).expo?.modules?.ExpoCrypto?.getRandomValues;

if (hasRandomValuesNativeModule) {
  // A conditional side-effect import can't be a static `import` — the whole
  // point is deciding at runtime whether to load it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react-native-get-random-values");
}
