// Supabase Edge Function: embed-profile
// Deploy: supabase functions deploy embed-profile
//
// Generates a 384-dim embedding of the caller's interests + bio using Supabase's
// built-in `gte-small` model (runs INSIDE the edge runtime — no external API, no
// API key, ₹0 marginal cost) and stores it in profiles.interest_embedding, which
// powers the semantic term in match_score (see semantic-matching-v17.sql).
// Auth required; a user can only (re)embed their OWN profile.

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_authenticated" }, 401);

    // RLS lets a user read their own row.
    const { data: prof } = await userClient
      .from("profiles").select("interests, bio").eq("id", user.id).maybeSingle();

    const interests: string[] = Array.isArray(prof?.interests) ? prof!.interests : [];
    const bio = typeof prof?.bio === "string" ? prof!.bio : "";
    const text = [
      interests.length ? `Interests: ${interests.join(", ")}.` : "",
      bio ? `About: ${bio}` : "",
    ].filter(Boolean).join(" ").trim();

    if (!text) return json({ error: "no_signal", note: "add interests or a bio first" }, 400);

    // gte-small: 384-dim, mean-pooled + L2-normalised so cosine works cleanly.
    // deno-lint-ignore no-explicit-any
    const model = new (globalThis as any).Supabase.ai.Session("gte-small");
    const embedding: number[] = await model.run(text, { mean_pool: true, normalize: true });
    if (!Array.isArray(embedding) || embedding.length !== 384) {
      return json({ error: "embed_failed" }, 502);
    }

    // Write with service role, scoped to the caller's own row.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { error } = await admin.from("profiles")
      .update({ interest_embedding: embedding }).eq("id", user.id);
    if (error) throw error;

    return json({ ok: true, dims: embedding.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
