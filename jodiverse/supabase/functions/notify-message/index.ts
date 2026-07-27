// Supabase Edge Function: notify-message
// Deploy: supabase functions deploy notify-message
// Wire-up: Dashboard → Database → Webhooks → Create →
//   table: messages · events: INSERT · type: Supabase Edge Function →
//   notify-message (the dashboard adds the service-role auth header).
//
// Sends an Expo push to the recipient of a new message. Body text is a
// generic prompt — message CONTENT never rides inside a push payload
// (it would sit readable in notification trays and push-provider logs).

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const msg = payload.record; // { id, match_id, sender, body, ... }
    if (!msg?.match_id) return json({ ok: false, reason: "no_record" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: match } = await admin
      .from("matches").select("a, b, unmatched").eq("id", msg.match_id).maybeSingle();
    if (!match || match.unmatched) return json({ ok: false, reason: "no_match" });

    const recipient = match.a === msg.sender ? match.b : match.a;
    const { data: tok } = await admin
      .from("push_tokens").select("token").eq("user_id", recipient).maybeSingle();
    if (!tok?.token) return json({ ok: true, pushed: false });

    const { data: senderProf } = await admin
      .from("profiles").select("display_name").eq("id", msg.sender).maybeSingle();

    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: tok.token,
        title: senderProf?.display_name ?? "New message",
        body: "sent you a message 💬",
        data: { matchId: msg.match_id },
      }),
    });
    return json({ ok: res.ok, pushed: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
