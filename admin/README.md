# Admin Console

A private, real-data dashboard for the team — **separate from the mobile app**.
It reads live metrics from Supabase (users, calls, matches, messages, reports,
subscriptions, coins) through admin-only, RLS-protected functions.

> The numbers are **real**. Pre-launch that means small — that's the honest point.
> This is not the fake "ModerateAI / 7.8M users" mockup; it shows *your* platform.

## One-time setup

1. **Run the SQL** — in the Supabase SQL editor, run
   [`../jodiverse/supabase/admin-v19.sql`](../jodiverse/supabase/admin-v19.sql)
   (needs the earlier migrations). It creates the admin allowlist + read-only
   analytics functions.

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

## What it shows

- **Users** — total, new today / 7d, verified %, embedded (semantic-match ready)
- **Activity** — calls all-time / today / 7d, avg call length, active callers
- **Connections** — matches, messages, lounges
- **Money** — active subscribers, coins in circulation, gifts, open reports
- **Growth chart** — signups / calls / matches over 14 days
- **Trust & safety** — the reports queue, with one-click *Resolve*

Everything is gated by the `is_admin()` check — a normal app user calling these
functions gets `NOT_ADMIN`.
