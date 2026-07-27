# JodiVerse — backend deployment runbook

## 1. SQL (Supabase → SQL Editor)
Run in order (each safe to re-run):
1. `supabase/storage-policies.sql` — already applied ✅
2. `supabase/deck-v3.sql` — already applied ✅
3. `supabase/backend-v4.sql` — **run now** (limits, ranker, unmatch, push_tokens)

## 2. Edge Functions (your terminal, in the project folder)
```bash
npx supabase login                       # opens browser once
npx supabase link --project-ref yqkvgbbordwurtgnyyxi
npx supabase functions deploy verify-selfie
npx supabase functions deploy likes-you
npx supabase functions deploy notify-message
npx supabase functions deploy revenuecat-webhook --no-verify-jwt
```

## 3. Function secrets
```bash
# DEV ONLY — allows selfie verification without Play Integrity:
npx supabase secrets set ALLOW_UNVERIFIED_DEVICES=true
# For RevenueCat later (any long random string, mirror it in RC dashboard):
npx supabase secrets set REVENUECAT_WEBHOOK_SECRET=<random>
```
⚠️ Before launch: remove ALLOW_UNVERIFIED_DEVICES and implement Play
Integrity / App Attest in verify-selfie (the only production-blocking TODO).

## 4. Push notification webhook (dashboard, once)
Database → Webhooks → Create:
- Name: `notify-message` · Table: `messages` · Events: **INSERT**
- Type: **Supabase Edge Function** → `notify-message`
(Remote push works only in an EAS dev build, not Expo Go — the app
registers tokens automatically when it becomes possible.)

## 5. Testing the paid tier
Give an account Gold manually (SQL Editor):
```sql
insert into subscriptions (user_id, tier, expires_at)
values ('<user-uuid>', 'gold', now() + interval '30 days')
on conflict (user_id) do update set tier = 'gold', expires_at = now() + interval '30 days';
```
Then Likes You shows full profiles; likes/messages become unlimited.

## What each piece enforces
- **10 likes/24h (free)** — DB trigger, client shows paywall on `LIKE_LIMIT_REACHED`
- **3 messages/match (free)** — DB trigger, paywall on `MESSAGE_LIMIT_REACHED`
- **Likes You** — edge function only; free = server-side pixelated previews
- **Verification** — selfie screen → verify-selfie → service role flips flags
  (manual Table-Editor flipping no longer needed once deployed)
- **Ranker** — verified > shared languages > same faith > proximity > new

## Dev-only settings still active (revert before launch)
- Site URL = `exp://192.168.1.95:8081`
- Email confirmation OFF
- `ALLOW_UNVERIFIED_DEVICES=true`
- Storage policy lets any signed-in user read active users' photos
