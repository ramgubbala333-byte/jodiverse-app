# Admin Console

A private, real-data dashboard for the team — **separate from the mobile app**.
It reads live metrics from Supabase (users, calls, matches, messages, reports,
subscriptions, coins) through admin-only, RLS-protected functions.

> The numbers are **real**. Pre-launch that means small — that's the honest point.
> This is not the fake "ModerateAI / 7.8M users" mockup; it shows *your* platform.

## One-time setup

1. **Run the SQL** — in the Supabase SQL editor, run **both**
   [`../jodiverse/supabase/admin-v19.sql`](../jodiverse/supabase/admin-v19.sql) **then**
   [`../jodiverse/supabase/admin-analytics-v20.sql`](../jodiverse/supabase/admin-analytics-v20.sql)
   (need the earlier migrations). They create the admin allowlist + all the
   read-only analytics functions.

2. **Make yourself an admin** — run once (use the email you sign in to the app with):
   ```sql
   insert into admins (user_id)
   select id from auth.users where email = 'ram.gubbala333@gmail.com'
   on conflict do nothing;
   ```

3. **Add your anon key** — open `index.html`, and set `ANON_KEY` to your project's
   **anon/public** key (Supabase → Settings → API). *(This key is public and safe to
   embed — RLS protects everything. Never paste the **service role** key here.)*

## Open it

Easiest (recommended — avoids browser file:// quirks):
```bash
npx serve admin
```
then open the printed URL (e.g. http://localhost:3000). Or just double-click `index.html`.

Sign in with your admin email → you'll get a **6-digit code** by email → enter it → done.

> **If the email has a link but no code:** in Supabase → Authentication → Email
> Templates → *Magic Link*, make sure the template includes `{{ .Token }}` (that's
> the 6-digit code). Then request a new code.

## What it shows (sidebar sections)

Mirrors the requested dashboard design — every panel is present, on **real data**;
fictional "AI systems" from the mockup are honestly labelled **Roadmap** (see the
sidebar's *System status*), never faked.

- **Overview** — headline KPIs + a 14-day growth chart
- **Moderation** — top report reasons, most-reported users, the reports queue
  (one-click *Resolve*). *(AI/NLP content moderation = roadmap.)*
- **Match Quality** — matches, match-rate per call, avg post-call rating,
  "talk again" %, completion % (real feedback, not a fabricated score)
- **Verification & Risk** — verified/unverified, active/inactive, reported users,
  blocks. *(ML fake-profile detection = roadmap.)*
- **Audience** — gender, age, language & city breakdowns (our honest "localization")
- **User Behavior** — calls by hour-of-day, plus the growth trend
- **Revenue** — active subs by tier, coins in circulation, gifts. *(Payments are
  dev stubs; billing-fraud ML = roadmap.)*

Everything is gated by `is_admin()` — a normal app user calling these functions
gets `NOT_ADMIN`.
