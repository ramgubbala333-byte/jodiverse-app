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

## P2 — "Today's picks" with a written why-you-click
**What:** 3 suggested people to call today, each with a one-line, honest reason
("You both love live music and late-night talks").
**How:** a `daily_picks(uid)` RPC ranks by the P1 score; a lightweight edge
function (reuse the `generate-profile` Claude pattern) writes the blurb from
*shared interests + call-metadata traits only* — never appearance, never audio
content (keeps our stated privacy/ethics rules). Cache one blurb per pair/day.
**Effort:** medium. **Guardrail:** respects existing `reveal_state` (no photos in picks).

## P3 — Deeper onboarding
Grow the 4-step builder toward richer signal (looking-for, age range, languages,
a voice-prompt answer) — better data feeds P1/P2. Reuse existing Onboarding UI.

## P4 — Reanimated-grade motion (optional)
If we want shared-element transitions / gesture-driven sheets beyond the current
`Animated` API, add `react-native-reanimated` (needs the babel plugin). Defer
until the above ship — current `Animated` covers the polish pass.

---

### Explicitly out of scope
- Swipe/Tinder deck mechanics — conflicts with the voice-first thesis.
- Copying any UI component code or specific visual design from licensed repos.
