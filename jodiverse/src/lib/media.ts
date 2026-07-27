import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "./supabase";

// Intro media lives beside photos in the private bucket at fixed paths —
// one video + one audio per user, upsert-replaced on change. The existing
// storage policies (owner folder + "read active users photos") cover both.
const videoPath = (uid: string) => `${uid}/intro-video.mp4`;
const audioPath = (uid: string) => `${uid}/intro-audio.m4a`;

export const VIDEO_MIN_S = 3;
export const VIDEO_MAX_S = 6;

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function uploadFile(uri: string, path: string, contentType: string) {
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  const { error } = await supabase.storage.from("photos")
    .upload(path, base64ToBytes(b64).buffer as ArrayBuffer, { contentType, upsert: true });
  if (error) throw error;
}

/**
 * Pick a 3–6 s intro video from the gallery. iOS trims in the picker via
 * videoMaxDuration; Android may return longer clips, so duration is
 * re-checked here (with a little slack for container rounding).
 */
export async function pickIntroVideo(): Promise<{ uri: string } | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["videos"],
    allowsEditing: true,
    videoMaxDuration: VIDEO_MAX_S,
    quality: 0.8,
  });
  if (res.canceled) return null;
  const a = res.assets[0];
  const durS = (a.duration ?? 0) / 1000;
  if (durS && (durS < VIDEO_MIN_S - 0.5 || durS > VIDEO_MAX_S + 1)) {
    throw new Error(`Your clip is ${Math.round(durS)}s — it needs to be ${VIDEO_MIN_S}–${VIDEO_MAX_S} seconds.`);
  }
  return { uri: a.uri };
}

/** Upload the intro video and record its path on the profile. */
export async function uploadIntroVideo(uid: string, uri: string): Promise<string> {
  const path = videoPath(uid);
  await uploadFile(uri, path, "video/mp4");
  const { error } = await supabase.from("profiles").update({ video_path: path }).eq("id", uid);
  if (error) throw error;
  return path;
}

/** Upload a recorded voice intro (m4a from expo-audio) onto the profile. */
export async function uploadIntroAudio(uid: string, uri: string): Promise<string> {
  const path = audioPath(uid);
  await uploadFile(uri, path, "audio/mp4");
  const { error } = await supabase.from("profiles").update({ audio_path: path }).eq("id", uid);
  if (error) throw error;
  return path;
}

export async function removeIntroVideo(uid: string) {
  await supabase.storage.from("photos").remove([videoPath(uid)]);
  await supabase.from("profiles").update({ video_path: null }).eq("id", uid);
}

export async function removeIntroAudio(uid: string) {
  await supabase.storage.from("photos").remove([audioPath(uid)]);
  await supabase.from("profiles").update({ audio_path: null }).eq("id", uid);
}

/** Signed URL for any intro-media storage path (1 h, same as photos). */
export async function signMediaPath(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from("photos").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
