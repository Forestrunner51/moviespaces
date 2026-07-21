import { supabase } from "@/frontend/config/supabase";

const USERNAME_REGEX = /^[a-z0-9_]{3,30}$/;

export function isValidUsernameFormat(username: string): boolean {
  return USERNAME_REGEX.test(username);
}

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export interface UsernameCheckResult {
  available: boolean;
  message: string;
}

// Direct Supabase query, not a backend endpoint — usernames live on the
// Supabase-owned `profiles` table (same as display_name/avatar_url), which
// this app already reads/writes straight from the client everywhere else.
export async function checkUsernameAvailable(
  username: string,
  currentUserId: string | null,
): Promise<UsernameCheckResult> {
  const normalized = normalizeUsername(username);

  if (!isValidUsernameFormat(normalized)) {
    return { available: false, message: "Only lowercase letters, numbers, and underscores (3-30 chars)." };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", normalized)
    .maybeSingle();

  if (error) {
    console.warn("Username availability check failed:", error);
    return { available: false, message: "Couldn't check availability — try again." };
  }

  if (data && data.id !== currentUserId) {
    return { available: false, message: `@${normalized} is already taken` };
  }

  return { available: true, message: `@${normalized} is available` };
}
