# Safeguards — learning from FRND's 1★ reviews

We studied FRND's real Play Store complaints and designed against them. The good
news: our **fair model already prevents most of FRND's worst failures.** This doc
maps each recurring complaint to our safeguard so we never regress into them.

| FRND complaint (from reviews) | Our safeguard | Status |
|---|---|---|
| **"Coins are too expensive / surge at night / no different from others"** | Coins are **cosmetic-only** — you never *need* them. Talking is free (3 calls/day). No per-minute charging, no surge. | ✅ By design |
| **"Aggressive paywall — unplayable without paying"** | No pay-to-continue. Core loop (voice match, chat with matches) is fully free forever. | ✅ By design |
| **"Hosts push nude calls / ask for money / attitude changes when gifts stop"** | We have **no paid hosts / celebrity / "experts make your FRND"** model. No pay-for-attention. Report + block + admin review for solicitation. | ✅ By design (moderation to staff) |
| **"Earnings stuck — can't withdraw my money"** | Coins are **not cashable** — there's no "earn real money / withdraw" mechanic, so no payout to get stuck. | ✅ By design |
| **"My ₹290 / earnings vanished after re-login; balance showed ₹0"** | Wallet is **100% server-side** (`coin_wallet` keyed by user id) — it can't be wiped by a client/login. + a **transparent coin ledger**: every credit/debit is recorded and viewable in *Transactions*, so nothing ever "silently disappears." | ✅ Built (v23) |
| **"Balance gone after logging in with phone again"** | Risk if a person uses phone one time and Google the next → two accounts. **TODO:** pick one primary identity or add account-linking before launch. | 🔲 Launch item |
| **"Account/device blocked with no reason, no warning, no appeal, no support reply"** | **Policy, baked in:** never silent-ban, never device-ban. Any action = a clear reason + a **warning first** for minor issues + an **appeal/contact** path. Reports go to a **human** admin queue (no auto-ban). | 🔲 Enforce when moderation ships |
| **"Support gives false assurances / never responds"** | A real support inbox + SLA before scale; the admin console already surfaces reports for action. | 🔲 Ops |
| **"Feature removed / notification leads to no screen / can't find X"** | Quality bar: every notification deep-links to a real screen; don't remove features users rely on without a migration path. | 🔲 Principle |
| **"Wrong-language matching wastes my paid coins"** | Matching never costs coins (free). Language is a matching signal, and mismatches cost the user nothing. | ✅ By design |

## The policy commitments we will not break
1. **Talking is free.** Coins never buy time, messages, matching, safety, or verification.
2. **No cashable earnings** → no withdrawal to hold hostage.
3. **No paid hosts / pay-for-attention.**
4. **Never a silent or device-level ban.** Reason + warning + appeal, human-reviewed.
5. **Transparent wallet.** Every coin movement is logged and user-visible.

*The single biggest reason FRND sits at 3.9★ is that its money model makes users
feel exploited. Our differentiation is that ours doesn't — this doc is how we keep it.*
