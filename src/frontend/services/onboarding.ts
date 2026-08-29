import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { consumePendingRedirect } from "@/frontend/services/pending-redirect";

// Tracked client-side (AsyncStorage), not server-side — there's no Users
// table this app owns to put an "onboarded" flag on; auth is Supabase's.
const ONBOARDED_KEY = "hasOnboardedInterests";

export async function hasOnboardedInterests(): Promise<boolean> {
  return !!(await AsyncStorage.getItem(ONBOARDED_KEY));
}

// Shared by every exit point from the onboarding flow (skip on the genre
// picker, "Continue" on the discovery screen) so marking onboarded and
// honoring a pending deep-link redirect can't drift between them.
// Sign-out / account deletion: the flag is per-device, so without clearing it
// the next account to sign in on this phone skips onboarding entirely.
export async function clearOnboardingFlag() {
  try {
    await AsyncStorage.removeItem(ONBOARDED_KEY);
  } catch {
    /* best effort */
  }
}

export async function completeOnboarding() {
  await AsyncStorage.setItem(ONBOARDED_KEY, "1");
  router.replace(consumePendingRedirect() ?? "/");
}
