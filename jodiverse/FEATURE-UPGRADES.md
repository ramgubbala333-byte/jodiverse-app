# Feature upgrades — roadmap

Ideas worth adopting, drawn from studying modern dating apps (incl. the
CC BY-NC "Heartly" educational repo). **No third-party code is used** — every
item below is our own implementation on our existing stack
(Expo + Supabase Postgres/RLS/Edge Functions + our Aurora design system).
Concepts/features aren't copyrightable; only their code is, which we don't touch.

Ordered by value-to-effort. ✅ = already shipped.

---

## ✅ P0 — Tactile & visual polish  (DONE 2026-07-27)
- `expo-haptics` wrapper (`src/lib/haptics.ts`) — success on match/coin-buy,
  medium on call start/end, select on tab + call-control + paywall selection,
  light on send/match-open.
- `PressableScale` — spring-down + haptic on any tappable; animates the Pressable
  root so `flex`/`aspectRatio` layouts (grid cards, tabs) stay intact.
- `GlassCard` — frosted `expo-blur` surface over the GlowBackdrop glow.
- **Wired into:** tab bar, Talk queue (glass calls-card + spring CTA), Call
  (controls/end), Match (success), Chat (send), **Paywall** (tier/plan spring
  select + glass perks panel + CTA + coins card), **Coins** (packs + success),
  **Matches** (taps + chat btn), **Lounges** (room cards).

## ✅ P1 — Semantic interest matching via pgvector  (BUILT 2026-07-27 — deploy pending)
**What:** rank matches by *meaning*, not just exact shared-interest counts —
"loves trekking" and "into Himalayan treks" now score as compatible.
**Built:**
- `semantic-matching-v17.sql` — enables `vector`, adds `profiles.interest_embedding
  vector(384)`, `interest_similarity(a,b)` helper, and folds a cosine term
  (up to 20 pts) into `match_score` (coalesces to 0 until both users embedded).
- `supabase/functions/embed-profile` — embeds interests+bio with Supabase's
  built-in **`gte-small`** model (in-runtime, **no external API/key, ₹0**), writes
  the 384-dim vector via service role. Auth-gated to the caller's own row.
- Client fires `functions.invoke("embed-profile")` (fire-and-forget) on
  onboarding finish and on bio save.
**⚠️ TO ACTIVATE (user must run):**
1. Run `supabase/semantic-matching-v17.sql` in the Supabase SQL editor.
2. `supabase functions deploy embed-profile`.
3. Existing users re-embed on their next bio save; new users on signup.
**Cost:** ₹0 (gte-small runs in the edge runtime). **Voice-first preserved.**

## ✅ P2 — "Today's picks" (BUILT 2026-07-27 — run v18 SQL to activate)
Up to 3 people you'd most click with today, each with an honest reason.
**Built:**
- `daily-picks-v18.sql` — `daily_picks()` RPC. Filters candidates through the SAME
  `voice_compatible` eligibility as live matching (age/gender prefs, blocks,
  calls-left), excludes already-matched + called-in-last-3-days, ranks by
  `match_score` (incl. the v17 semantic term), returns top 3 with a composed,
  **metadata-only** reason (shared interests → language → vibe). No photos.
- UI: a horizontal "Today's picks" row on the Talk queue. Tapping a card **tunes
  the queue** to that person's shared interests (voice-first — no broken
  direct-call button, since there's no receiver-side incoming-call listener yet).
**⚠️ TO ACTIVATE:** run `supabase/daily-picks-v18.sql` in the SQL editor.
**Future:** a global incoming-call listener would unlock true "call this pick"
(also fixes Lounge invites).

## ✅ P3 — Richer embedding signal (BUILT + DEPLOYED 2026-07-27)
Onboarding already collects a lot, so the win was USING it: `embed-profile` now
embeds interests + **occupation + relationship_goal + lifestyle + values + fun
facts + bio** (not just interests+bio) → far better semantic matching, zero new
onboarding UI. Deployed. Existing users refresh their vector on next bio save.

## ✅ P4 — Motion polish (DONE 2026-07-27)
Delivered with the built-in `Animated` API (native-thread, useNativeDriver —
smooth, zero new deps): Today's-picks row fades + rises in; Matches list fades
in on mount (on top of the P0 spring/haptic layer). **Full `react-native-
reanimated` deliberately deferred** — we have no gesture-driven sheets that need
it yet, and its babel-plugin change is best validated on a device build.

---

### Explicitly out of scope
- Swipe/Tinder deck mechanics — conflicts with the voice-first thesis.
- Copying any UI component code or specific visual design from licensed repos.
