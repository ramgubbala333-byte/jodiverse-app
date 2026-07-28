# Voice-First Dating App

> **Talk first. Find your connection.**
> A voice-first dating app for India — you meet people through a real conversation, not a photo.
> *(Product name is being finalized; the repo name `jodiverse-app` is a placeholder.)*

Instead of swiping on photos, you tap once and you're instantly in a **10-minute voice call**
with someone who shares your interests. Photos stay hidden until you've both had a real
conversation. Chemistry leads; appearance doesn't.

---

## How it works

1. **Set your vibe** — pick what you're in the mood to talk about.
2. **Get connected** — the queue matches you with a compatible person and starts a call.
3. **Click? Become friends** — if you both want to talk again, you match and can chat anytime, free forever.

Free tier: **3 voice calls/day**, a universal **10-min-per-call cap**, unlimited chat with matches.
Subscriptions sell *reach and insight* (priority matching, filters, boosts) — never a person's time.

---

## Tech stack

| Layer | Choice |
|---|---|
| **Mobile** | Expo (SDK 54) · React Native 0.81 · React 19 · TypeScript |
| **Navigation** | React Navigation (native stack + bottom tabs) |
| **Backend** | Supabase — Postgres + Row-Level Security, Edge Functions, Realtime, Storage, Auth |
| **Voice** | Peer-to-peer WebRTC signalled over Supabase Realtime (no paid media server) |
| **Semantic matching** | `pgvector` + Supabase's built-in `gte-small` embedding model |
| **AI** | Claude (edge function) for optional profile-bio generation |
| **Design** | "Aurora" dark theme · Unbounded + Plus Jakarta Sans · glass + haptics + motion |

Security lives in the **database** (RLS on every table), not the client. Cross-user data is only
reachable through `security definer` RPCs and auth-gated Edge Functions.

---

## Repository structure

```
.
├── jodiverse/                 # the Expo app
│   ├── App.tsx                # navigation + fonts + tab bar
│   ├── src/
│   │   ├── screens/           # Auth, Onboarding, Queue (Talk), Call, Matched,
│   │   │                      #   Chat, Matches, Lounges, Paywall, Coins, Profile…
│   │   ├── components/        # GlowBackdrop, GlassCard, PressableScale, …
│   │   ├── lib/               # supabase, voice (WebRTC/simulated), haptics, media, …
│   │   └── theme.ts           # single source of design tokens
│   ├── supabase/
│   │   ├── *.sql              # migrations, applied in version order (schema → v18)
│   │   └── functions/         # edge functions (embed-profile, generate-profile, …)
│   ├── FEATURE-UPGRADES.md    # roadmap + status (P0–P4)
│   └── .env.example
├── design/                    # design notes / prompts
└── .github/workflows/         # CI (typecheck) + auto-deploy Supabase functions
```

---

## Key features

- **Voice discovery queue** — instant matching by shared interests, with race-safe pairing (`FOR UPDATE SKIP LOCKED`).
- **Server-authoritative calls** — duration/limits computed in the DB; the client can't cheat.
- **Semantic matching** — `match_score` blends shared interests, completion rate, reciprocal intent, language, traits, time-of-day, **and embedding similarity** (meaning-based).
- **Today's picks** — up to 3 people you'd click with, each with an honest, metadata-only reason.
- **Photo reveal ladder** — hidden → blurred → full, on mutual opt-in or a 2nd call.
- **Conversational traits & date-readiness** — derived only from call metadata + peer feedback, never audio.
- **Interest Lounges** — live topic-based audio rooms.
- **Fair monetization** — subscriptions for reach/insight; cosmetic-only coins (never buy time/messages/matching).
- **Safety** — availability windows, DND, verification gating, block/report, mutual-invisible blocks.

---

## Getting started

**Prerequisites:** Node 20+, a Supabase project, the [Expo Go](https://expo.dev/go) app on your phone.

```bash
cd jodiverse
npm install
cp .env.example .env          # then fill in your Supabase URL + anon key
npx expo start                # scan the QR with Expo Go
```

**Backend setup (one time):**
1. In the Supabase **SQL editor**, run the migrations in `jodiverse/supabase/` in version order —
   `schema.sql` first, then `deck-v3` → `daily-picks-v18` (each is idempotent / `create or replace`).
2. Run `storage-policies.sql` and create the private storage buckets it expects.
3. Deploy edge functions: `supabase functions deploy` (or let CI do it — see below).

> **Note:** Voice currently runs in a **simulated** transport (`VOICE_MODE = "simulated"` in
> `src/lib/voice.ts`) so the full flow is testable in Expo Go. Real WebRTC audio needs an
> **EAS dev build** (`react-native-webrtc` doesn't run in Expo Go).

---

## CI/CD

Two GitHub Actions workflows (in `.github/workflows/`):

- **`ci.yml`** — runs `tsc --noEmit` on every push to `main` and every PR touching the app.
- **`deploy-supabase.yml`** — auto-deploys the edge functions on push to `main`
  (needs a `SUPABASE_ACCESS_TOKEN` repo secret).

The mobile app itself ships via **EAS Build** → App Store / Play Store (not part of CI yet).

---

## Roadmap status

Feature roadmap (`jodiverse/FEATURE-UPGRADES.md`): **P0–P4 complete** — tactile/visual polish,
semantic matching, Today's picks, richer embeddings, motion.

Remaining work is launch-critical, not features:
1. 🎙️ **Real voice audio** (EAS dev build + WebRTC)
2. 💳 **Real payments** (RevenueCat + UPI; currently dev stubs)
3. 📦 **EAS Build + store submission**
4. 🏷️ **Final product name**

---

## License

Private / all rights reserved. Not for redistribution.
