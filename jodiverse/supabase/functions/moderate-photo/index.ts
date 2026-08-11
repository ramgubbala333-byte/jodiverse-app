// Supabase Edge Function: moderate-photo
// Deploy: supabase functions deploy moderate-photo
//
// Screens a freshly uploaded profile photo. Called by the app right after
// upload; also safe to call again (idempotent per photo).
//
// Verdicts written to photos.moderation:
//   approved — clean, visible to everyone
//   flagged  — needs a human; hidden until an admin approves it
//   rejected — clearly violating; hidden
//
// FAILS CLOSED. If Vision isn't configured, the API errors, or anything
// throws, the photo stays 'pending' (hidden) and lands in the admin queue.
// A moderation system that opens the gate when it breaks is worse than none,
// because you'd believe you had one.
//
// Required secret:
//   GOOGLE_SERVICE_ACCOUNT_JSON — service account with Cloud Vision API enabled
//   (the same key can be reused for verify-selfie's Play Integrity check).

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const { photoId } = await req.json();
    if (!photoId) return json({ ok: false, reason: "missing_photo_id" }, 400);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ ok: false, reason: "not_authenticated" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Only ever moderate the caller's OWN photo — stops one user forcing a
    // re-scan (or a state change) on someone else's picture.
    const { data: photo } = await admin
      .from("photos").select("id, owner, storage_path, moderation")
      .eq("id", photoId).maybeSingle();
    if (!photo) return json({ ok: false, reason: "no_such_photo" }, 404);
    if (photo.owner !== user.id) return json({ ok: false, reason: "not_your_photo" }, 403);

    const { data: blob } = await admin.storage.from("photos").download(photo.storage_path);
    if (!blob) return json({ ok: false, reason: "download_failed" }, 500);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const verdict = await screen(bytes);
    await admin.from("photos").update({
      moderation: verdict.state,
      moderation_reason: verdict.reason,
      moderated_at: new Date().toISOString(),
    }).eq("id", photo.id);

    return json({ ok: true, moderation: verdict.state, reason: verdict.reason });
  } catch (e) {
    console.error("[moderate-photo]", e);
    // Leaves the row 'pending' → hidden, queued for a human.
    return json({ ok: false, reason: "error" }, 500);
  }
});

type Verdict = { state: "approved" | "flagged" | "rejected"; reason: string | null };

async function screen(bytes: Uint8Array): Promise<Verdict> {
  const saRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!saRaw) {
    console.error("[moderate-photo] Vision not configured — flagging for human review");
    return { state: "flagged", reason: "auto-moderation not configured" };
  }

  const token = await googleAccessToken(
    JSON.parse(saRaw), "https://www.googleapis.com/auth/cloud-platform");
  if (!token) return { state: "flagged", reason: "auth failed" };

  const res = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        image: { content: b64(bytes) },
        features: [
          { type: "SAFE_SEARCH_DETECTION" },
          { type: "FACE_DETECTION", maxResults: 5 },
        ],
      }],
    }),
  });
  if (!res.ok) {
    console.error("[moderate-photo] Vision HTTP", res.status, await res.text());
    return { state: "flagged", reason: "moderation service error" };
  }

  const r = (await res.json())?.responses?.[0];
  const safe = r?.safeSearch ?? {};
  const rank = (v: string) =>
    ["UNKNOWN", "VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY"].indexOf(v ?? "UNKNOWN");

  // LIKELY/VERY_LIKELY adult, violence or racy → straight rejection.
  if (rank(safe.adult) >= 4 || rank(safe.violence) >= 4 || rank(safe.racy) >= 5) {
    return { state: "rejected", reason: "explicit or violent content" };
  }
  // POSSIBLE → a human decides. Cheap insurance against false positives on
  // e.g. beach photos, which are legitimate on a dating app.
  if (rank(safe.adult) >= 3 || rank(safe.violence) >= 3 || rank(safe.racy) >= 4) {
    return { state: "flagged", reason: "possibly explicit — needs review" };
  }
  if (rank(safe.spoof) >= 4) {
    return { state: "flagged", reason: "possible meme/spoof image" };
  }
  // No face at all is worth a look — profile photos should show the person,
  // and it's the most common catfish/stock-image signal.
  if (!r?.faceAnnotations?.length) {
    return { state: "flagged", reason: "no face detected" };
  }
  return { state: "approved", reason: null };
}

function b64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000; // avoid arg-limit blowups on large images
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Short-lived Google access token from a service-account key (JWT bearer).
async function googleAccessToken(
  sa: { client_email: string; private_key: string }, scope: string,
): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const enc = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
      iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token",
      iat: now, exp: now + 3600,
    })}`;

    const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
    const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
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
    if (!res.ok) return null;
    return (await res.json()).access_token ?? null;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
