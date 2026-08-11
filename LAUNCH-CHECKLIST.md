# Launch checklist

Ordered by what blocks what. Everything above the line stops a public launch;
everything below it makes the launch good. ✅ done · 🔲 pending.

The app is **DostiConnect** (`com.dosticonnect.app`, scheme `dosticonnect`).
Supabase project: `yqkvgbbordwurtgnyyxi` (org `ramvenkat1515-eng`).

---

## Step 0 — run these, in this order

These are already written. Nothing else works until they're applied.

| # | What | Where |
|---|------|-------|
| 🔲 1 | `bootstrap-mobile-app.sql` | SQL editor — schema, RLS, triggers, deck ✅ *(already run)* |
| 🔲 2 | `dilmil-parity-v26.sql` | requests, insights, extended deck ✅ *(already run)* |
| 🔲 3 | `admin-v27.sql` | admin RPCs + real `match_score_pct` — **re-run after the pre-flight-drop fix** |
| 🔲 4 | `moderation-v28.sql` | photo moderation, block list, `export_my_data()` |

Then deploy the edge functions:

```bash
cd jodiverse
supabase functions deploy moderate-photo    # new
supabase functions deploy likes-you         # id-in-payload fix
supabase functions deploy verify-selfie     # real Play Integrity
supabase functions deploy notify-message    # routing payload + token pruning
```

---

# 🚨 Launch-blocking

### 🔲 1. Turn device integrity ON
`verify-selfie` implements Play Integrity for real, but honours a dev escape:

```
ALLOW_UNVERIFIED_DEVICES=true    ← DELETE this secret before launch
```

With it set, anyone can POST `{ passed: true }` and become verified. Also set:

- `ANDROID_PACKAGE_NAME=com.dosticonnect.app`
- `GOOGLE_SERVICE_ACCOUNT_JSON` — service account with the Play Integrity API
  enabled, linked to the app in Play Console → Release → App integrity.
- iOS: finish App Attest per `supabase/functions/verify-selfie/APP_ATTEST.md`.
  Until it's done `verifyAppAttest()` **fails closed**, so iOS verification is
  simply unavailable rather than fakeable.

### 🔲 2. On-device face match + liveness
`src/screens/VerifyScreen.tsx:34` sends `passed: true` unconditionally. The
server-side gate is real, but the *client's claim* is not checked. Needs an EAS
dev build plus ML Kit (Android) / Vision (iOS) to compare the live selfie
against the profile photo. **Do not ship the verified badge until this is real** —
a badge that means nothing is worse than no badge.

### 🔲 3. Google Cloud Vision key for photo moderation
`moderate-photo` needs `GOOGLE_SERVICE_ACCOUNT_JSON` (same SA is fine) with the
Cloud Vision API enabled. Without it every upload lands in the `flagged` queue
and no photo is ever visible — the app looks empty rather than unsafe, which is
the correct failure direction, but it's still broken.

### 🔲 4. EAS environment variables
`.env` is gitignored, so EAS does **not** upload it. `src/lib/supabase.ts` now
throws a clear error instead of shipping `undefined`, but you must set:

```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_URL      --value https://yqkvgbbordwurtgnyyxi.supabase.co
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key>
eas env:create --name EXPO_PUBLIC_GIPHY_KEY         --value <giphy key>   # optional; GIF picker
```

Repeat per environment (`development` / `preview` / `production`).

### 🔲 5. OAuth redirect URLs
Supabase → Authentication → URL Configuration → Redirect URLs, add:

```
dosticonnect://**
```

Google sign-in works in Expo Go today only because of the dev proxy. **In a real
build it breaks without this.** Also add the production bundle IDs to the Google
and Facebook OAuth client configs.

### 🔲 6. Legal pages must be live and filled in
`website/privacy.html` and `website/terms.html` are written against how the app
actually behaves, but every `[BRACKETED]` value is a placeholder rendered in red.
Fill in the legal entity, address, emails, jurisdiction, and dates, have a
lawyer review, then host them. Both stores fetch these URLs and check.

The app links to `${EXPO_PUBLIC_LEGAL_BASE}/privacy.html`. Set that to the real
domain in `eas.json` (currently `https://dosticonnect.app`).

### 🔲 7. Push notifications end-to-end
Code is done — token registration, tap routing into `ChatRoom`, dead-token
pruning, token deletion on logout. What's left is infrastructure:

- **Database webhook**: Supabase → Database → Webhooks → Create.
  Table `messages`, event `INSERT`, type *Supabase Edge Function* →
  `notify-message`. (The dashboard attaches the service-role header.)
- **FCM v1**: upload the service account JSON to Expo
  (`eas credentials` → Android → *FCM V1 service account key*).
- **APNs**: `eas credentials` → iOS → push key (Expo can generate it).
- Test on a real device — **push does not work in Expo Go at all** (SDK 53+).

### 🔲 8. Payments *(deliberately deferred)*
`src/screens/CoinsScreen.tsx:16` has `DEV_INSTANT_CREDIT = true` — it grants
coins **without charging anyone**. Harmless while testing, free money in
production. Either wire `react-native-purchases` + the `revenuecat-webhook`
function, or set the flag to `false` and hide the purchase UI before launch.

### 🔲 9. App store assets
Icon (1024×1024), splash, 5–8 screenshots per platform, feature graphic
(Android), description, keywords, support URL, and the **data safety /
privacy nutrition label** — fill it from §2 of `website/privacy.html`, which is
already itemised for exactly this.

---

# 🟡 Should do before real users

- 🔲 **Seed the deck.** `is_active` defaults false and only `verify-selfie` can
  flip it. With integrity on and zero verified users, every deck is empty. Plan
  the first ~50 profiles.
- 🔲 **Moderation rota.** Someone has to watch the Photo review panel in
  `admin/index.html` daily, and answer the appeals address promised in §7 of
  the Terms.
- 🔲 **Error monitoring.** Sentry or equivalent — right now a crash in
  production is invisible.
- 🔲 **Rate limits** on the edge functions (`likes-you`, `generate-profile`,
  `moderate-photo`) — each one costs money per call.
- 🔲 **Delete the calorie-app POC leftovers** in project `mkwdfbffcboqzyspuhmt`:
  stray profile columns and a `trg_guard_flags` trigger that will break that
  project's inserts. Applied there by mistake; unrelated to this app.

---

# ✅ Done

- Schema, RLS, triggers, deck ranking, match scoring (`match_score_pct` — real
  weighted score, returns null rather than inventing a number)
- Swipe deck, likes, requests, matches, chat (text / image / GIF / emoji),
  unmatch, report, block **and unblock** (Settings → Block list)
- Profile editing incl. traits, love language, exercise, voice intro,
  compatibility questionnaire
- Photo moderation pipeline: Cloud Vision auto-screen → human queue → RLS hides
  anything not approved, fails closed
- Real Play Integrity in `verify-selfie`; App Attest fails closed with a
  documented finish-line
- Push: registration, tap routing, dead-token pruning, logout cleanup
- Data export (`export_my_data()` → share sheet) and in-app account deletion
- Admin console on real data — overview, 30-day chart, funnel, engagement,
  demographics, photo review, reports, churn
- Privacy Policy and Terms of Service written against actual app behaviour
- `eas.json` with development / preview / production profiles
- Voice-calling feature fully removed (product pivot, 2026-08)
