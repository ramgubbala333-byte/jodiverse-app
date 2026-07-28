# Launch checklist

The product is feature-complete and polished. What's left is the work that turns
a great prototype into something real users can safely pay for. Ordered by leverage.
✅ = done · 🔲 = pending.

---

## 🚀 Launch-blocking (must be real before public launch)

### 🔲 1. Decide the app name
Still undecided — it blocks the bundle ID, domain, store listing, and marketing.
Screened-open finalists: **Lilt · Zing · Talq · Murmr · Muchchata · Mishri**.
*Everything below is cleaner once this is locked.*

### 🔲 2. Real voice audio (WebRTC)
Calls currently use a **simulated** transport (`VOICE_MODE = "simulated"` in
`src/lib/voice.ts`). Real peer-to-peer audio needs:
- an **EAS dev build** (`react-native-webrtc` doesn't run in Expo Go),
- flip `VOICE_MODE` to real + wire the `WebRtcTransport` sketch already in `voice.ts`,
- test on **two physical phones**.

### 🔲 3. Real profile verification (biometric + device integrity)
Today it's a **working pipeline with a stubbed brain** — the security is real (only the
`verify-selfie` edge function, via service role, can set `is_verified`/`is_active`;
`trg_guard_flags` blocks clients), but the actual checks are not implemented:
- **On-device face-match + liveness** (iOS Vision / Android ML Kit) — needs the EAS dev
  build; today the app just sends `passed: true`.
- **Device integrity** in `verify-selfie` → implement **Play Integrity (Android)** +
  **App Attest (iOS)** in `verifyIntegrity()` using app credentials.
- Turn **OFF** the `ALLOW_UNVERIFIED_DEVICES` dev-bypass secret.
- Nothing biometric is ever stored — only the boolean. Keep it that way.

### 🔲 4. Real payments (RevenueCat + UPI)
Subscriptions & coins are **dev stubs** (`DEV_INSTANT_CREDIT` in `CoinsScreen`, the
Paywall CTA is an alert). Wire **RevenueCat**; its webhook already writes the
`subscriptions` table. Add UPI as a payment method for India.

### 🔲 5. EAS Build + store submission
Produce the `.aab` / `.ipa`, then Play Store ($25 once) + App Store (Apple Dev $99/yr).
This is what unlocks items 2 & 3 (real audio, ML verification), haptics, and push.

---

## 🔧 Backend activation (SQL to run in the Supabase editor)

- 🔲 **`lounges-antighost-v15.sql`** — lounges tables + RPCs (the Lounges tab + anti-ghosting).
  *(Note: run its lounge parts; keep v16's `invite_to_call` — don't let v15 revert it.)*
- ✅ v17 semantic · v18 picks · v19/v20 admin · v21 offboarding — run.
- 🔲 **Embeddings backfill** — existing users (created before v17) have no
  `interest_embedding`; they self-heal on next bio save, or run a one-time backfill.

## 🔑 Login providers (the new multi-option login screen is built)

The login UI (phone-OTP · Google · Facebook · email) ships in `AuthScreen`. To make
each provider actually work, enable it in Supabase → Auth → Providers:
- ✅ **Google** — already working.
- 🔲 **Email** — working (built-in; Supabase's default email is flaky → add custom SMTP).
- 🔲 **Phone OTP** — needs an **SMS provider** (Twilio / MSG91) *plus* **India DLT**
  registration for OTP templates. Enable "Phone" provider + paste credentials.
  Until then the app shows "phone login isn't switched on yet — use Google."
- 🔲 **Facebook** — create a **Facebook app** (developers.facebook.com), get through
  Facebook Login **app review**, and paste the App ID + secret into the Facebook
  provider. Add the Supabase callback URL to the FB app. Until then it shows a
  friendly "not switched on yet" message.

---

## 🧊 Pre-launch polish / compliance (not blocking a beta, needed for public)

- 🔲 **Privacy Policy + Terms** (store requirement) — currently stubbed in Settings.
- 🔲 **Push notifications** delivery (needs dev build) — messages / anti-ghosting nudges.
- 🔲 **Trait-privacy toggle UI** (`set_trait_privacy` RPC exists, unused).
- 🔲 **Reliable email** (custom SMTP) — Supabase's built-in email is rate-limited/flaky.
- 🔲 **Moderation staffing / process** for reports (the queue + admin console are ready).
- 🔲 **DPDP / data-export** ("Download My Data" is stubbed).

---

## ✅ Already done
Voice-first app (P0–P4 features), Aurora design system, semantic matching, Today's
picks, admin console (real-data, 8 panels + churn), deletion-deflection flow, CI/CD,
private GitHub repo. See `jodiverse/FEATURE-UPGRADES.md` for the feature roadmap.
