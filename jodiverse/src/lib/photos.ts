import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "./supabase";

// Decode base64 → bytes for storage upload (Hermes ships atob).
function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export type OwnPhoto = { id: string; storage_path: string; position: number; url: string;
  moderation?: "pending" | "approved" | "rejected" | "flagged";
  moderation_reason?: string | null };

/**
 * Pick from the gallery, resize + re-encode to JPEG.
 * Re-encoding via ImageManipulator strips ALL EXIF (GPS included) —
 * required before anything leaves the device.
 * Profile photos crop to 3:4; chat photos keep their natural shape.
 */
export async function pickPhoto(opts?: { crop?: boolean }): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const crop = opts?.crop ?? true;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: crop,
    ...(crop ? { aspect: [3, 4] as [number, number] } : {}),
    quality: 1,
  });
  if (res.canceled) return null;
  const out = await ImageManipulator.manipulateAsync(
    res.assets[0].uri,
    [{ resize: { width: 1080 } }],
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  return out.base64 ?? null;
}

/** Upload a chat image under chat/<matchId>/… — visible only to the match. */
export async function uploadChatImage(matchId: string, base64: string): Promise<string> {
  const path = `chat/${matchId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage
    .from("photos")
    .upload(path, base64ToBytes(base64).buffer as ArrayBuffer, { contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}

/** Signed URLs for storage-based chat image paths (http URLs pass through). */
export async function signChatPaths(paths: string[]): Promise<Record<string, string>> {
  const storagePaths = paths.filter((p) => !p.startsWith("http"));
  const out: Record<string, string> = {};
  for (const p of paths) if (p.startsWith("http")) out[p] = p;
  if (storagePaths.length) {
    const { data } = await supabase.storage.from("photos").createSignedUrls(storagePaths, 3600);
    storagePaths.forEach((p, i) => { if (data?.[i]?.signedUrl) out[p] = data[i].signedUrl; });
  }
  return out;
}

/** Upload to the private bucket at <uid>/<uuid>.jpg and record it in photos. */
export async function uploadPhoto(userId: string, base64: string, position: number) {
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error: upErr } = await supabase.storage
    .from("photos")
    .upload(path, base64ToBytes(base64).buffer as ArrayBuffer, { contentType: "image/jpeg" });
  if (upErr) throw upErr;
  const { data: row, error: rowErr } = await supabase
    .from("photos")
    .insert({ owner: userId, storage_path: path, position })
    .select("id")
    .single();
  if (rowErr) throw rowErr;

  // Screen it. The row lands as 'pending' (hidden to others) and this flips it
  // to approved/flagged/rejected. Deliberately awaited — but a failure here
  // must not lose the upload, so we swallow: the photo simply stays pending
  // and shows up in the admin review queue.
  try {
    await supabase.functions.invoke("moderate-photo", { body: { photoId: row.id } });
  } catch { /* stays pending → hidden → human review */ }

  return path;
}

/** Own photos with fresh signed URLs (private bucket — no public URLs ever). */
export async function listOwnPhotos(userId: string): Promise<OwnPhoto[]> {
  const { data, error } = await supabase
    .from("photos")
    .select("id, storage_path, position, moderation, moderation_reason")
    .eq("owner", userId)
    .order("position");
  if (error || !data?.length) return [];
  const { data: signed } = await supabase.storage
    .from("photos")
    .createSignedUrls(data.map((p) => p.storage_path), 3600);
  return data.map((p, i) => ({ ...p, url: signed?.[i]?.signedUrl ?? "" }));
}

export async function deletePhoto(photo: { id: string; storage_path: string }) {
  await supabase.storage.from("photos").remove([photo.storage_path]);
  await supabase.from("photos").delete().eq("id", photo.id);
}

/** All photos of another (active) user, signed — for the match profile view. */
export async function listUserPhotos(ownerId: string): Promise<string[]> {
  const { data } = await supabase
    .from("photos")
    .select("storage_path, position")
    .eq("owner", ownerId)
    .order("position");
  if (!data?.length) return [];
  const { data: signed } = await supabase.storage
    .from("photos")
    .createSignedUrls(data.map((p) => p.storage_path), 3600);
  return (signed ?? []).map((x) => x.signedUrl).filter(Boolean) as string[];
}

/** ALL photos per owner for the deck → { ownerId: [signedUrl, …] } (tap-to-cycle). */
export async function deckAllPhotoUrls(ownerIds: string[]): Promise<Record<string, string[]>> {
  if (!ownerIds.length) return {};
  const { data } = await supabase
    .from("photos")
    .select("owner, storage_path, position")
    .in("owner", ownerIds)
    .order("position");
  if (!data?.length) return {};
  const paths = data.map((p) => p.storage_path);
  const { data: signed } = await supabase.storage.from("photos").createSignedUrls(paths, 3600);
  const out: Record<string, string[]> = {};
  data.forEach((p, i) => {
    const url = signed?.[i]?.signedUrl;
    if (!url) return;
    (out[p.owner] ??= []).push(url);
  });
  return out;
}

/** First photo per owner for a set of deck profiles → { ownerId: signedUrl }. */
export async function deckPhotoUrls(ownerIds: string[]): Promise<Record<string, string>> {
  if (!ownerIds.length) return {};
  const { data, error } = await supabase
    .from("photos")
    .select("owner, storage_path, position")
    .in("owner", ownerIds)
    .order("position");
  if (!data?.length) return {};
  const first: Record<string, string> = {};
  for (const p of data) if (!(p.owner in first)) first[p.owner] = p.storage_path;
  const paths = Object.values(first);
  const { data: signed, error: signErr } = await supabase.storage.from("photos").createSignedUrls(paths, 3600);
  // Signing can fail per-path (deleted object, expired policy). Returning ""
  // for those made every caller render <Image uri="" /> — a warning plus a
  // broken-image box. Omit the owner entirely so the initials fallback runs.
  const byPath: Record<string, string> = {};
  paths.forEach((path, i) => {
    const url = signed?.[i]?.signedUrl;
    if (url) byPath[path] = url;
  });
  const out: Record<string, string> = {};
  for (const [owner, path] of Object.entries(first)) {
    if (byPath[path]) out[owner] = byPath[path];
  }
  return out;
}
