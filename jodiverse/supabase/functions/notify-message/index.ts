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

    // Blocked either way ⇒ no push. The block may have landed after the
    // message row was written, and a push is the one part of the app that
    // reaches someone who has explicitly opted out of hearing from them.
    const { count: blocked } = await admin
      .from("blocks").select("blocker", { count: "exact", head: true })
      .or(`and(blocker.eq.${recipient},blocked.eq.${msg.sender}),` +
          `and(blocker.eq.${msg.sender},blocked.eq.${recipient})`);
    if (blocked && blocked > 0) return json({ ok: true, pushed: false, reason: "blocked" });

    const { data: tok } = await admin
      .from("push_tokens").select("token").eq("user_id", recipient).maybeSingle();
    if (!tok?.token) return json({ ok: true, pushed: false });

    const { data: senderProf } = await admin
      .from("profiles").select("display_name").eq("id", msg.sender).maybeSingle();
    const name = senderProf?.display_name ?? "Someone";

    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: tok.token,
        title: name,
        body: "sent you a message 💬",
        sound: "default",
        channelId: "default",
        // The client opens ChatRoom with exactly these params. matchId alone
        // is not enough — the screen also renders the header name and needs
        // otherId for the "view profile" tap.
        data: { matchId: msg.match_id, name, otherId: msg.sender },
      }),
    });

    // Expo answers 200 even for a dead token; the verdict is per-ticket.
    // An uninstalled app returns DeviceNotRegistered forever, so prune it —
    // otherwise every future message burns a request on a device that is gone.
    const ticket = await res.json().catch(() => null);
    const err = ticket?.data?.details?.error ?? ticket?.data?.[0]?.details?.error;
    if (err === "DeviceNotRegistered") {
      await admin.from("push_tokens").delete().eq("user_id", recipient);
      return json({ ok: true, pushed: false, reason: "device_not_registered" });
    }

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
