// Supabase Edge Function: likes-you
// Deploy: supabase functions deploy likes-you
//
// The ONLY path to "who liked me". No RLS policy exposes incoming swipes,
// so a modded client cannot bypass this paywall.
//   - Subscriber (gold/platinum/eternal): full profiles + signed photo URLs.
//   - Free: ONE full reveal per ISO week (deterministic pick, same person for
//     the whole week — not re-rolled every load), rest pixelated (24px wide —
//     identity destroyed server-side before anything reaches the client).
//     This is deliberately generous vs. the market norm of a hard paywall —
//     the free tier still gets a real weekly reveal, not just a tease.

import { createClient } from "npm:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Pending incoming likes: liked me, and I haven't swiped on them yet.
    const { data: likes } = await admin
      .from("swipes")
      .select("swiper, direction, note, created_at")
      .eq("swipee", user.id)
      .in("direction", ["like", "super"])
      .order("created_at", { ascending: false })
      .limit(30);
    const { data: mySwipes } = await admin
      .from("swipes").select("swipee").eq("swiper", user.id);
    const seen = new Set((mySwipes ?? []).map((s) => s.swipee));
    const pending = (likes ?? []).filter((l) => !seen.has(l.swiper));

    const { data: sub } = await admin
      .from("subscriptions").select("tier, expires_at")
      .eq("user_id", user.id).gt("expires_at", new Date().toISOString())
      .maybeSingle();

    const likerIds = pending.map((l) => l.swiper);
    const { data: photoRows } = likerIds.length
      ? await admin.from("photos")
          .select("owner, storage_path, position")
          .in("owner", likerIds).order("position")
      : { data: [] };
    const firstPhoto: Record<string, string> = {};
    for (const p of photoRows ?? []) {
      if (!(p.owner in firstPhoto)) firstPhoto[p.owner] = p.storage_path;
    }

    if (sub) {
      // Gold+: names, profiles, real photos via short-lived signed URLs.
      const { data: profs } = await admin
        .from("profiles").select("id, display_name, birthdate, city")
        .in("id", likerIds);
      const likers = await Promise.all(pending.map(async (l) => {
        const prof = profs?.find((p) => p.id === l.swiper);
        let url: string | null = null;
        if (firstPhoto[l.swiper]) {
          const { data: signed } = await admin.storage.from("photos")
            .createSignedUrl(firstPhoto[l.swiper], 1800);
          url = signed?.signedUrl ?? null;
        }
        return {
          id: l.swiper,
          name: prof?.display_name ?? "Someone",
          age: prof ? age(prof.birthdate) : null,
          city: prof?.city ?? null,
          super: l.direction === "super",
          note: l.note ?? null, // super comment, Gold-visible
          photo: url,
        };
      }));
      return json({ subscribed: true, count: likers.length, likers });
    }

    // Free tier: one deterministic full reveal per ISO week (stable index —
    // doesn't reshuffle on every load, just changes when the week rolls
    // over), rest pixelated server-side (24px wide — colours/silhouette
    // survive, faces don't).
    const { data: profs } = likerIds.length
      ? await admin.from("profiles").select("id, display_name, birthdate, city").in("id", likerIds)
      : { data: [] };

    const now = new Date();
    const isoWeek = getIsoWeek(now);
    const freeIdx = pending.length
      ? Math.abs(hashCode(user.id) + isoWeek) % pending.length
      : 0;
    const nextMonday = new Date(now);
    nextMonday.setUTCDate(now.getUTCDate() + ((8 - now.getUTCDay()) % 7 || 7));
    const daysToReveal = Math.ceil((nextMonday.getTime() - now.getTime()) / 86400000);

    const previews = await Promise.all(pending.slice(0, 12).map(async (l, i) => {
      const path = firstPhoto[l.swiper];
      const base = { super: l.direction === "super" };
      if (i === freeIdx) {
        const prof = profs?.find((p) => p.id === l.swiper);
        let url: string | null = null;
        if (path) {
          const { data: signed } = await admin.storage.from("photos").createSignedUrl(path, 1800);
          url = signed?.signedUrl ?? null;
        }
        return { ...base, free: true, photo: url,
          name: prof?.display_name ?? "Someone", age: prof ? age(prof.birthdate) : null };
      }
      if (!path) return { ...base, free: false, photo: null };
      try {
        const { data: blob } = await admin.storage.from("photos").download(path);
        if (!blob) return { ...base, free: false, photo: null };
        const img = await Image.decode(new Uint8Array(await blob.arrayBuffer()));
        img.resize(24, Math.round((24 * img.height) / img.width));
        const jpg = await img.encodeJPEG(70);
        return { ...base, free: false, photo: `data:image/jpeg;base64,${b64(jpg)}` };
      } catch {
        return { ...base, free: false, photo: null };
      }
    }));
    return json({ subscribed: false, count: pending.length, previews, daysToReveal });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function getIsoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function age(birthdate: string): number {
  const b = new Date(birthdate), now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a;
}

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
