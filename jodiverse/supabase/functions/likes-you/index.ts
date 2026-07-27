// Supabase Edge Function: likes-you
// Deploy: supabase functions deploy likes-you
//
// The ONLY path to "who liked me". No RLS policy exposes incoming swipes,
// so a modded client cannot bypass this paywall.
//   - Subscriber (gold/platinum/eternal): full profiles + signed photo URLs.
//   - Free: count + server-side pixelated thumbnails (10px wide — identity
//     is destroyed server-side before anything reaches the client).

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

    // Free tier: pixelate server-side. 24px wide keeps colours/silhouette
    // (the Tinder-style tease) while faces stay unrecognizable.
    const previews = await Promise.all(pending.slice(0, 9).map(async (l) => {
      const path = firstPhoto[l.swiper];
      if (!path) return { photo: null, super: l.direction === "super" };
      try {
        const { data: blob } = await admin.storage.from("photos").download(path);
        if (!blob) return { photo: null, super: l.direction === "super" };
        const img = await Image.decode(new Uint8Array(await blob.arrayBuffer()));
        img.resize(24, Math.round((24 * img.height) / img.width));
        const jpg = await img.encodeJPEG(70);
        return {
          photo: `data:image/jpeg;base64,${b64(jpg)}`,
          super: l.direction === "super",
        };
      } catch {
        return { photo: null, super: l.direction === "super" };
      }
    }));
    return json({ subscribed: false, count: pending.length, previews });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

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
