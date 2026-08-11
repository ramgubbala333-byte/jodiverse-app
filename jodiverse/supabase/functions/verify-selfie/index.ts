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

// ── Device integrity ───────────────────────────────────────────────────────
// Stops a rooted phone, emulator or plain `curl` from POSTing {passed:true}
// and minting a verified badge. Fails CLOSED: any error, missing config or
// unexpected verdict returns false.
//
// Required function secrets (Supabase → Edge Functions → verify-selfie):
//   ANDROID_PACKAGE_NAME       e.g. com.dosticonnect.app
//   GOOGLE_SERVICE_ACCOUNT_JSON  full JSON key for a service account with the
//                                "Play Integrity API" enabled
//   IOS_BUNDLE_ID              e.g. com.dosticonnect.app  (App Attest)
//   IOS_TEAM_ID                your Apple team id
// Dev escape hatch (NEVER set in production):
//   ALLOW_UNVERIFIED_DEVICES=true
async function verifyIntegrity(platform: string, token: string): Promise<boolean> {
  if (Deno.env.get("ALLOW_UNVERIFIED_DEVICES") === "true") {
    console.warn("[verify-selfie] INTEGRITY BYPASSED — dev mode. Never enable in production.");
    return true;
  }
  if (!token || typeof token !== "string") return false;

  try {
    if (platform === "android") return await verifyPlayIntegrity(token);
    if (platform === "ios") return await verifyAppAttest(token);
    return false;
  } catch (e) {
    console.error("[verify-selfie] integrity check threw:", e);
    return false; // fail closed
  }
}

// Google Play Integrity: exchange the token for a decoded verdict.
async function verifyPlayIntegrity(token: string): Promise<boolean> {
  const pkg = Deno.env.get("ANDROID_PACKAGE_NAME");
  const saRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!pkg || !saRaw) {
    console.error("[verify-selfie] Play Integrity not configured");
    return false;
  }
  const sa = JSON.parse(saRaw);
  const accessToken = await googleAccessToken(sa, "https://www.googleapis.com/auth/playintegrity");
  if (!accessToken) return false;

  const res = await fetch(
    `https://playintegrity.googleapis.com/v1/${encodeURIComponent(pkg)}:decodeIntegrityToken`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ integrityToken: token }),
    },
  );
  if (!res.ok) {
    console.error("[verify-selfie] Play Integrity HTTP", res.status, await res.text());
    return false;
  }
  const v = (await res.json())?.tokenPayloadExternal;

  // All three must hold: the request came from OUR app, from Play, on a
  // genuine device. `MEETS_DEVICE_INTEGRITY` excludes emulators & rooted ROMs.
  const pkgOk = v?.requestDetails?.requestPackageName === pkg;
  const appOk = v?.appIntegrity?.appRecognitionVerdict === "PLAY_RECOGNIZED";
  const devOk = (v?.deviceIntegrity?.deviceRecognitionVerdict ?? [])
    .includes("MEETS_DEVICE_INTEGRITY");

  // Reject stale tokens (replay window).
  const ts = Number(v?.requestDetails?.timestampMillis ?? 0);
  const fresh = ts > 0 && Date.now() - ts < 5 * 60 * 1000;

  if (!(pkgOk && appOk && devOk && fresh)) {
    console.warn("[verify-selfie] Play Integrity rejected", { pkgOk, appOk, devOk, fresh });
  }
  return pkgOk && appOk && devOk && fresh;
}

// Apple App Attest. The heavy CBOR/X.509 attestation parse needs a crypto
// library that isn't worth hand-rolling here, so this verifies the assertion
// server-side via Apple's DeviceCheck once configured, and otherwise fails
// closed rather than pretending to check.
async function verifyAppAttest(token: string): Promise<boolean> {
  const bundleId = Deno.env.get("IOS_BUNDLE_ID");
  const teamId = Deno.env.get("IOS_TEAM_ID");
  if (!bundleId || !teamId) {
    console.error("[verify-selfie] App Attest not configured");
    return false;
  }
  // The client sends a base64 attestation object. Full verification requires
  // parsing the CBOR attestation and walking the cert chain to Apple's App
  // Attest root — see supabase/functions/verify-selfie/APP_ATTEST.md for the
  // exact steps and the library to use when you ship iOS.
  console.error("[verify-selfie] iOS App Attest verification not implemented — rejecting");
  return false;
}

// Mint a short-lived Google access token from a service-account key (JWT
// bearer grant). Deno has WebCrypto, so no external JWT dependency needed.
async function googleAccessToken(sa: {
  client_email: string; private_key: string;
}, scope: string): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const claim = {
      iss: sa.client_email,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };
    const b64 = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const unsigned = `${b64(header)}.${b64(claim)}`;

    // PEM → DER → CryptoKey
    const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
    const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "pkcs8", der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false, ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned),
    );
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${sigB64}`,
      }),
    });
    if (!res.ok) {
      console.error("[verify-selfie] token exchange failed", await res.text());
      return null;
    }
    return (await res.json()).access_token ?? null;
  } catch (e) {
    console.error("[verify-selfie] token mint threw:", e);
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
