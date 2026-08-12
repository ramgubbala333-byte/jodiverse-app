import "react-native-url-polyfill/auto";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";

// Session tokens live in the device keychain, not AsyncStorage.
//
// Android's keystore refuses values over 2048 bytes, and a Supabase session
// (access JWT + refresh token + user object) routinely exceeds that once the
// user has a full profile. expo-secure-store currently warns and may silently
// fail; the SDK has announced it will throw. Either way the symptom is the
// same and nasty: the session never persists, so the user is signed out every
// cold start with no error anywhere.
//
// So: split large values across numbered keys. `${k}__n` holds the chunk count
// and is the marker that a value is chunked; plain `k` is still read as a
// fallback so sessions written by the old adapter survive the upgrade.
const CHUNK = 1600; // bytes of headroom under the 2048 limit

const chunkKey = (k: string, i: number) => `${k}__${i}`;
const countKey = (k: string) => `${k}__n`;

async function clearChunks(k: string) {
  const n = Number(await SecureStore.getItemAsync(countKey(k))) || 0;
  await Promise.all([
    SecureStore.deleteItemAsync(countKey(k)),
    ...Array.from({ length: n }, (_, i) => SecureStore.deleteItemAsync(chunkKey(k, i))),
  ]);
}

const SecureStoreAdapter = {
  getItem: async (k: string) => {
    const n = Number(await SecureStore.getItemAsync(countKey(k))) || 0;
    if (!n) return SecureStore.getItemAsync(k); // unchunked / legacy value
    const parts = await Promise.all(
      Array.from({ length: n }, (_, i) => SecureStore.getItemAsync(chunkKey(k, i)))
    );
    // A missing chunk means a partial write — treat the whole thing as absent
    // rather than handing back a truncated token that fails in confusing ways.
    return parts.some((p) => p == null) ? null : parts.join("");
  },

  setItem: async (k: string, v: string) => {
    await clearChunks(k);
    if (v.length <= CHUNK) {
      await SecureStore.setItemAsync(k, v);
      return;
    }
    await SecureStore.deleteItemAsync(k);
    const parts: string[] = [];
    for (let i = 0; i < v.length; i += CHUNK) parts.push(v.slice(i, i + CHUNK));
    // Chunks first, count last: the count is what getItem trusts, so writing it
    // only after every chunk lands means an interrupted write reads as absent
    // rather than as a truncated session.
    await Promise.all(parts.map((p, i) => SecureStore.setItemAsync(chunkKey(k, i), p)));
    await SecureStore.setItemAsync(countKey(k), String(parts.length));
  },

  removeItem: async (k: string) => {
    await clearChunks(k);
    await SecureStore.deleteItemAsync(k);
  },
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
