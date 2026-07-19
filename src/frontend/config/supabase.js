import { createClient } from "@supabase/supabase-js"; // Fixed package name here!
import AsyncStorage from "@react-native-async-storage/async-storage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// AsyncStorage's web implementation reads window.localStorage, which doesn't
// exist during Expo Router's Node-side SSR render. Fall back to a no-op
// storage there so the client can construct without crashing the SSR bundle.
const noopStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: typeof window === "undefined" ? noopStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Required for React Native/Expo environments
  },
});
