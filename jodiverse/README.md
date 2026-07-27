# JodiVerse — production starter

React Native (Expo) + Supabase. Tinder-pattern UI: swipeable deck, "It's a Jodi" match screen, realtime chat, bottom tabs (Home / Likes / Chats / Profile). Security is enforced in the database with Row Level Security, not in the client.

## Run it (about 15 minutes)

1. **Create a Supabase project** at supabase.com (free tier is fine to start).
2. **Run the schema**: open SQL Editor, paste `supabase/schema.sql`, run.
3. **Enable Realtime**: Dashboard → Database → Replication → turn on for `messages` and `matches`.
4. **Create a private Storage bucket** named `photos` (do NOT make it public).
5. **Keys**: copy `.env.example` to `.env`, fill in Project URL and anon key from Settings → API.
6. **Install and run**:
   ```bash
   npm install
   npx expo start        # scan the QR with Expo Go on your phone
   ```
7. Sign up with an email — you're in.

## Architecture decisions worth knowing

- **RLS is the security model.** Every table denies by default. The deck comes only through the `get_deck` RPC; strangers' rows are otherwise unreadable. Messages are readable only by the two people in an un-blocked match — and Supabase Realtime respects the same policies.
- **"Who likes you" is structurally paid.** There is deliberately no RLS policy letting a user read swipes on themselves — the feature must go through an Edge Function that checks `subscriptions` with the service role. The paywall can't be bypassed by calling the API directly.
- **Location** is stored as a ~1 km geohash cell only, never coordinates, and profiles expose it to no one (the public view omits it). Distance features should compute bands server-side from cells.
- **Blocking is mutual and invisible** — enforced inside `is_in_match`, so a block silently kills message access in both directions.
- **Auth tokens** are kept in the device keychain via expo-secure-store, not AsyncStorage.
- **Photos**: private bucket + `createSignedUrl` with short expiry. Never public URLs.

## What's stubbed and what to build next, in order

1. **Onboarding** — birthdate/gender collection, photo upload with EXIF stripping, selfie verification (the `is_active` flag already gates unverified profiles out of the deck).
2. **Apple/Google sign-in** — `signInWithOAuth` after enabling providers in the dashboard; App Store requires Apple sign-in if you offer Google.
3. **Payments** — RevenueCat is the sane choice for cross-platform subscriptions; its webhook writes to the `subscriptions` table (service role).
4. **Likes-you Edge Function** — subscription check → return likers with signed photo URLs.
5. **Matching ranker** — replace `order by random()` in `get_deck`.
6. **AI features** — Edge Functions calling your model provider; never put model API keys in the app.
7. **Moderation** — reports table exists; build the admin view on the service role, add photo-scanning on upload.
8. **Push notifications** — Expo Notifications + a DB webhook on `messages` insert.

## Honest scope

This is a real, runnable foundation with production-grade data security — it is not a finished product. Before charging money or launching publicly you need: store developer accounts (Apple $99/yr, Google $25 once), a privacy policy, DPDP/GDPR compliance review, content moderation staffing, and a penetration test. Dating apps are the most sensitive consumer category there is; the RLS layer here is the right start, not the whole job.
