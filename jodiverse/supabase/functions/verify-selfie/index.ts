// Supabase Edge Function: verify-selfie
// Deploy: supabase functions deploy verify-selfie
//
// Flow (privacy-preserving by design):
//   1. The APP runs liveness + face-match ON DEVICE (e.g. iOS Vision /
//      ML Kit face detection against the profile photos). The raw video
//      never leaves the phone.
//   2. The app calls this function with the on-device result plus a
//      device-integrity token (Play Integrity / App Attest).
//   3. This function verifies the integrity token with Google/Apple,
//      then — and only then — flips is_verified/is_active using the
//      service role. Clients cannot set those flags themselves
//      (enforced by trg_guard_flags in the schema).
//
// Nothing biometric is stored server-side. What persists is one boolean.

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const { passed, integrityToken, platform } = await req.json();

    // Identify the caller from their JWT (anon-key client context).
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) {
      return json({ ok: false, reason: "not_authenticated" }, 401);
    }

    if (!passed) {
      return json({ ok: false, reason: "liveness_failed" }, 200);
    }

    // Verify device integrity so a rooted device / emulator / script
    // can't just POST { passed: true }. This is the actual gate.
    const deviceOk = await verifyIntegrity(platform, integrityToken);
    if (!deviceOk) {
      return json({ ok: false, reason: "device_integrity_failed" }, 200);
    }

    // Service role — the only identity allowed to set these flags.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { error: upErr } = await admin
      .from("profiles")
      .update({ is_verified: true, is_active: true })
      .eq("id", user.id);
    if (upErr) return json({ ok: false, reason: "db_error" }, 500);

    return json({ ok: true });
  } catch {
    return json({ ok: false, reason: "bad_request" }, 400);
  }
});

async function verifyIntegrity(platform: string, token: string): Promise<boolean> {
  // PRODUCTION REQUIREMENT — implement before launch:
  //  android: POST token to Play Integrity API
  //           (playintegrity.googleapis.com/v1/...:decodeIntegrityToken)
  //           and require verdict MEETS_DEVICE_INTEGRITY.
  //  ios:     verify App Attest assertion against Apple's root cert.
  // Both need your app credentials, so they can't be filled in here.
  // This stub REJECTS by default so it fails safe if deployed unfinished —
  // set ALLOW_UNVERIFIED_DEVICES=true in function secrets for dev testing only.
  if (Deno.env.get("ALLOW_UNVERIFIED_DEVICES") === "true") return true;
  return false;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
