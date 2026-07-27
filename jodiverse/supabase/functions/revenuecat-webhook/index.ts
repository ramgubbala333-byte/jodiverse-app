// Supabase Edge Function: revenuecat-webhook
// Deploy: supabase functions deploy revenuecat-webhook --no-verify-jwt
// Secrets: supabase secrets set REVENUECAT_WEBHOOK_SECRET=<random-string>
// RevenueCat dashboard → Integrations → Webhooks →
//   URL: https://<ref>.supabase.co/functions/v1/revenuecat-webhook
//   Authorization header: Bearer <same random string>
//
// Writes the subscriptions table with the service role — the ONLY writer.
// app_user_id in RevenueCat must be set to the Supabase auth user id.

import { createClient } from "npm:@supabase/supabase-js@2";

const TIER_BY_PRODUCT: Record<string, string> = {
  // Map your store product ids → tiers. Update alongside store setup.
  "jodiverse_plus_monthly": "gold",       // Plus maps to gold until schema adds 'plus'
  "jodiverse_gold_monthly": "gold",
  "jodiverse_gold_6mo": "gold",
  "jodiverse_gold_12mo": "gold",
  "jodiverse_platinum_monthly": "platinum",
};

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
    if (!secret || auth !== `Bearer ${secret}`) {
      return json({ ok: false, reason: "unauthorized" }, 401);
    }

    const { event } = await req.json();
    const userId = event?.app_user_id;
    if (!userId) return json({ ok: false, reason: "no_user" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const type = event.type as string;

    // Consumable boost packs (NON_RENEWING_PURCHASE)
    const BOOST_PACKS: Record<string, number> = {
      "jodiverse_boost_1": 1, "jodiverse_boost_5": 5, "jodiverse_boost_10": 10,
    };
    if (type === "NON_RENEWING_PURCHASE" && BOOST_PACKS[event.product_id]) {
      const { data: prof } = await admin.from("profiles")
        .select("boost_credits").eq("id", userId).maybeSingle();
      if (prof) {
        await admin.from("profiles")
          .update({ boost_credits: (prof.boost_credits ?? 0) + BOOST_PACKS[event.product_id] })
          .eq("id", userId);
      }
      return json({ ok: true });
    }

    if (["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE"].includes(type)) {
      const tier = TIER_BY_PRODUCT[event.product_id] ?? "gold";
      const expires = event.expiration_at_ms
        ? new Date(event.expiration_at_ms).toISOString()
        : new Date(Date.now() + 32 * 24 * 3600 * 1000).toISOString();
      await admin.from("subscriptions").upsert({
        user_id: userId, tier, expires_at: expires,
      });
      // Gold+ perk: each purchase/renewal grants a Boost credit.
      const { data: prof } = await admin.from("profiles")
        .select("boost_credits").eq("id", userId).maybeSingle();
      if (prof) {
        await admin.from("profiles")
          .update({ boost_credits: (prof.boost_credits ?? 0) + 1 })
          .eq("id", userId);
      }
    } else if (["CANCELLATION", "EXPIRATION"].includes(type)) {
      // CANCELLATION keeps access until expiry; EXPIRATION ends it now.
      if (type === "EXPIRATION") {
        await admin.from("subscriptions").delete().eq("user_id", userId);
      }
    }
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
