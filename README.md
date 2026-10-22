# DostiConnect

> A dating app for India where the deck is ranked by how well you actually fit,
> not just a photo grid.
> *(The repo name `jodiverse-app` is the original project name. The app ships as
> **DostiConnect**, `com.dosticonnect.app`.)*

You browse a deck of verified people, ranked by a real compatibility score:
shared interests, reciprocal intent, language, traits, and meaning-level
similarity. Like someone or send a request; if it is mutual, you match and can
chat for free. Every photo passes automated screening plus a human review queue
before it is visible, and the verified badge comes from a selfie check backed by
device integrity (Play Integrity on Android, App Attest on iOS).

---

## How it works

1. **Build your profile**: photos, interests, traits, a short voice intro, and what you are looking for.
2. **Verify once**: a selfie check plus device integrity unlocks the verified badge and puts you in the deck.
3. **Swipe the deck**: profiles are ranked by `match_score_pct`, a weighted compatibility score that returns null rather than inventing a number when there is not enough signal.
4. **Match and chat**: a mutual like or an accepted request opens chat (text, images, GIFs, emoji). Chat with matches is free, forever.

Subscriptions sell *reach and insight* (priority matching, filters, boosts, seeing who
likes you). Coins are cosmetic-only. Neither ever buys time, messages, matching,
safety, or verification. See [SAFEGUARDS.md](SAFEGUARDS.md).

---

## Tech stack

| Layer | Choice |
|---|---|
| **Mobile** | Expo (SDK 54) · React Native 0.81 · React 19 · TypeScript |
| **Navigation** | React Navigation (native stack + bottom tabs) |
| **Backend** | Supabase: Postgres + Row-Level Security, Edge Functions, Realtime, Storage, Auth |
| **Verification** | Selfie check with Play Integrity (Android) and App Attest (iOS, fails closed) |
| **Semantic matching** | `pgvector` + Supabase's built-in `gte-small` embedding model |
| **AI** | Claude (edge function) for optional profile-bio generation |
| **Design** | "Aurora" dark theme · Unbounded + Plus Jakarta Sans · glass + haptics + motion |

Security lives in the **database** (RLS on every table), not the client. Cross-user data is only
reachable through `security definer` RPCs and auth-gated Edge Functions.

---

## Repository structure

```
.
├── jodiverse/                 # the Expo app (DostiConnect)
│   ├── App.tsx                # navigation + fonts + tab bar
│   ├── src/
│   │   ├── screens/           # Auth, Onboarding, Discover, Likes, Requests, Matched,
│   │   │                      #   Chat, Coins, Paywall, Verify, Profile, Settings…
│   │   ├── components/        # GlowBackdrop, GlassCard, PressableScale, …
│   │   ├── lib/               # supabase, auth, geo, photos, media, push, haptics, …
│   │   └── theme.ts           # single source of design tokens
│   ├── supabase/
│   │   ├── *.sql              # migrations, applied in version order (schema → v30)
│   │   └── functions/         # edge functions (verify-selfie, likes-you, moderate-photo, …)
│   ├── FEATURE-UPGRADES.md    # roadmap + status (P0–P4)
│   ├── DEPLOY.md              # backend deployment runbook
│   └── .env.example
├── website/                   # marketing site + the privacy/terms pages the app links to
├── admin/                     # standalone admin console (real-data dashboard)
├── design/                    # design notes / prompts
└── .github/workflows/         # CI (typecheck) + auto-deploy Supabase functions
```

---

## Key features

- **Ranked swipe deck**: the `get_deck` RPC ranks by `match_score_pct`, blending shared interests, reciprocal intent, language, traits, and embedding similarity (meaning-based).
- **Semantic matching**: profile embeddings (interests, occupation, goals, lifestyle, values) make "loves trekking" score close to "into Himalayan treks".
- **Today's picks** — up to 3 people you'd click with, each with an honest, metadata-only reason.
- **Likes you, structurally paid**: there is no RLS path to read swipes on yourself; the feature goes through an edge function that checks your subscription first.
- **Chat**: text, images, GIFs, and emoji with realtime delivery and push notifications, plus unmatch, report, and block/unblock (blocks are mutual and invisible).
- **Photo safety pipeline**: Cloud Vision auto-screen, then a human review queue. RLS hides anything not approved, and the pipeline fails closed.
- **Selfie verification**: Play Integrity on Android and App Attest on iOS gate who enters the deck.
- **Fair monetization**: subscriptions for reach/insight; cosmetic-only coins with a transparent, server-side ledger (see [SAFEGUARDS.md](SAFEGUARDS.md)).
- **Your data**: in-app data export and account deletion.
- **Admin console**: real-data overview, funnel, engagement, demographics, photo review, and reports in `admin/`.

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
1. In the Supabase **SQL editor**, run the SQL files in `jodiverse/supabase/` in version
   order: `bootstrap-mobile-app.sql` first (schema, RLS, triggers, deck), then the
   versioned files through `chat-hardening-v30.sql` (each is idempotent / `create or replace`).
   [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) Step 0 tracks the live project's exact state.
2. Run `storage-policies.sql` and create the private storage buckets it expects.
3. Deploy edge functions: `supabase functions deploy` (or let CI do it, see below).

> **Note:** The app ships via **EAS Build**. Push notifications do not work in Expo Go
> at all (SDK 53+), and selfie verification needs a dev build, so test those on a real build.

---

## CI/CD

Two GitHub Actions workflows (in `.github/workflows/`):

- **`ci.yml`** — runs `tsc --noEmit` on every push to `main` and every PR touching the app.
- **`deploy-supabase.yml`** — auto-deploys the edge functions on push to `main`
  (needs a `SUPABASE_ACCESS_TOKEN` repo secret).

The mobile app itself ships via **EAS Build** → App Store / Play Store (not part of CI yet).

---

## Launch status

Feature roadmap (`jodiverse/FEATURE-UPGRADES.md`): **P0–P4 complete**: tactile/visual polish,
semantic matching, Today's picks, richer embeddings, motion.

The app is in pre-launch hardening. Remaining work is launch-critical, not features:
device integrity enforcement, on-device face match for verification, photo moderation
credentials, legal page details, push credentials (FCM/APNs), payments (RevenueCat),
JWT secret rotation, and store assets. The authoritative, itemised list lives in
[LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md).

---

## License

MIT. See [LICENSE](LICENSE).
