// Supabase Edge Function: delete-account
// Deploy: supabase functions deploy delete-account
//
// Permanently deletes the calling user: storage photos, then the auth user
// (profiles/photos/swipes/matches/messages cascade via FK). Service role is
// required for auth.admin.deleteUser — the client cannot do this itself.

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
    if (!user) return json({ ok: false, reason: "not_authenticated" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Storage objects don't cascade — remove the user's photo folder first.
    const { data: files } = await admin.storage.from("photos").list(user.id);
    if (files?.length) {
      await admin.storage.from("photos")
        .remove(files.map((f) => `${user.id}/${f.name}`));
    }

    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) return json({ ok: false, reason: error.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, reason: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
