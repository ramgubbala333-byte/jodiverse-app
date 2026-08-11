import "react-native-url-polyfill/auto";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";

// Session tokens live in the device keychain, not AsyncStorage.
const SecureStoreAdapter = {
  getItem: (k: string) => SecureStore.getItemAsync(k),
  setItem: (k: string, v: string) => SecureStore.setItemAsync(k, v),
  removeItem: (k: string) => SecureStore.deleteItemAsync(k),
};

// EXPO_PUBLIC_* values are inlined at BUILD time. `.env` is gitignored, and
// EAS does not upload gitignored files — so unless these are set as EAS
// environment variables, a cloud build silently ships `undefined` here and
// every request 404s with no obvious cause. Fail loudly instead.
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON) {
  throw new Error(
    "Supabase config missing. Locally: copy .env.example to .env. " +
    "For EAS builds: eas env:create --name EXPO_PUBLIC_SUPABASE_URL ... " +
    "(and EXPO_PUBLIC_SUPABASE_ANON_KEY) for each build profile."
  );
}

export const supabase = createClient(
  URL,
  ANON,
  {
    auth: {
      storage: SecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
