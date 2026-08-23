import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/frontend/config/supabase";

// The one way to answer "what should this user be called right now".
// Profile edits write profiles.display_name and never touch
// auth user_metadata.full_name, so anything reading only full_name shows the
// name from signup forever. Order: profile → auth metadata → the name cached
// on this device at signup → fallback.
export async function resolveDisplayName(fallback = "A Movie Fan"): Promise<string> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: row } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();
      const name = row?.display_name || user.user_metadata?.full_name || user.user_metadata?.name;
      if (name) return String(name);
    }
  } catch {
    /* fall through to the device cache */
  }
  return (await AsyncStorage.getItem("userName")) || fallback;
}
