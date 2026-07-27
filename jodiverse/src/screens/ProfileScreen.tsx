import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Alert, StyleSheet, ScrollView, Image,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer,
  useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { supabase } from "../lib/supabase";
import { listOwnPhotos, pickPhoto, uploadPhoto, deletePhoto, type OwnPhoto } from "../lib/photos";
import { pickIntroVideo, uploadIntroVideo, removeIntroVideo, uploadIntroAudio,
  removeIntroAudio, signMediaPath, VIDEO_MIN_S, VIDEO_MAX_S } from "../lib/media";
import { theme } from "../theme";

const AUDIO_MAX_S = 30;

const TRAIT_LABEL: Record<string, string> = {
  good_listener: "🎧 Good listener", funny: "😄 Funny", curious: "🔍 Curious",
  storyteller: "📖 Storyteller", calm: "🌿 Calm", warm: "💛 Warm",
  easy_going: "😌 Easy to talk to", talkative: "💬 Talkative",
  concise: "⚡ Concise", engaged: "✅ Engaged",
};

export default function ProfileScreen() {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [verified, setVerified] = useState(false);
  const [active, setActive] = useState(false);
  const [photos, setPhotos] = useState<OwnPhoto[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [myTraits, setMyTraits] = useState<Record<string, number>>({});
  const nav = useNavigation<any>();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 500);
  const player = useAudioPlayer();

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUid(user.id);
    const { data } = await supabase.from("profiles")
      .select("display_name, bio, city, video_path, audio_path, is_verified, is_active")
      .eq("id", user.id).maybeSingle();
    if (data) {
      setName(data.display_name); setBio(data.bio ?? ""); setCity(data.city ?? "");
      setVerified(data.is_verified); setActive(data.is_active);
      setHasVideo(!!data.video_path);
      setAudioUrl(data.audio_path ? await signMediaPath(data.audio_path) : null);
    }
    setPhotos(await listOwnPhotos(user.id));
    const { data: tr } = await supabase.rpc("get_traits", { uid: user.id });
    if (tr?.[0]?.traits) setMyTraits(tr[0].traits);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    if (!uid) return;
    // Update ONLY editable fields — never resend birthdate/gender.
    const { error } = await supabase.from("profiles")
      .update({ display_name: name.trim(), bio: bio.trim() || null, city: city.trim() || null })
      .eq("id", uid);
    // Refresh the semantic embedding when the bio changes (fire-and-forget).
    if (!error) supabase.functions.invoke("embed-profile").catch(() => {});
    Alert.alert(error ? "Save failed" : "Saved", error?.message ?? "Profile updated.");
  };

  const addPhoto = async () => {
    if (!uid) return;
    const b64 = await pickPhoto();
    if (!b64) return;
    try {
      await uploadPhoto(uid, b64, photos.length);
      setPhotos(await listOwnPhotos(uid));
    } catch (e: any) {
      Alert.alert("Upload failed", e.message ?? String(e));
    }
  };

  const removePhoto = (p: OwnPhoto) => {
    Alert.alert("Remove photo?", "", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        await deletePhoto(p);
        if (uid) setPhotos(await listOwnPhotos(uid));
      }},
    ]);
  };

  const addVideo = async () => {
    if (!uid) return;
    try {
      const v = await pickIntroVideo();
      if (!v) return;
      setMediaBusy(true);
      await uploadIntroVideo(uid, v.uri);
      setHasVideo(true);
    } catch (e: any) {
      Alert.alert("Video problem", e.message ?? String(e));
    } finally { setMediaBusy(false); }
  };

  const dropVideo = () => {
    if (!uid) return;
    Alert.alert("Remove intro video?", "", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        await removeIntroVideo(uid); setHasVideo(false);
      }},
    ]);
  };

  const startRec = async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) { Alert.alert("Microphone needed", "Allow mic access to record a voice intro."); return; }
    player.pause();
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const stopRec = async (save: boolean) => {
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (!save || !recorder.uri || !uid) return;
    setMediaBusy(true);
    try {
      const path = await uploadIntroAudio(uid, recorder.uri);
      setAudioUrl(await signMediaPath(path));
    } catch (e: any) {
      Alert.alert("Upload failed", e.message ?? String(e));
    } finally { setMediaBusy(false); }
  };

  // Hard cap: auto-stop & save at 30 s.
  useEffect(() => {
    if (recState.isRecording && recState.durationMillis >= AUDIO_MAX_S * 1000) stopRec(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recState.isRecording, recState.durationMillis]);

  const dropAudio = () => {
    if (!uid) return;
    Alert.alert("Remove voice intro?", "", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        player.pause();
        await removeIntroAudio(uid); setAudioUrl(null);
      }},
    ]);
  };

  const playVoice = () => {
    if (!audioUrl) return;
    player.replace({ uri: audioUrl });
    player.play();
  };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 22, paddingTop: 64, paddingBottom: 40 }}>
      <View style={s.titleRow}>
        <Text style={s.title}>Profile</Text>
        <View style={s.titleActions}>
          <TouchableOpacity style={s.iconBtn} disabled={!uid}
            onPress={() => nav.navigate("MatchProfile",
              { otherId: uid, name: "Preview", self: true })}>
            <Ionicons name="eye-outline" size={22} color={theme.ink} />
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={() => nav.navigate("Settings")}>
            <Ionicons name="settings-outline" size={22} color={theme.ink} />
          </TouchableOpacity>
        </View>
      </View>

      {!active && (
        <TouchableOpacity style={s.banner} onPress={() => nav.navigate("Verify")}>
          <Ionicons name="shield-checkmark-outline" size={20} color={theme.gold} />
          <Text style={s.bannerText}>
            Verify your profile to enter the deck — tap to take a quick selfie.
          </Text>
          <Ionicons name="chevron-forward" size={18} color={theme.muted} />
        </TouchableOpacity>
      )}
      {Object.keys(myTraits).filter((k) => TRAIT_LABEL[k]).length > 0 && (
        <View style={s.insightCard}>
          <Text style={s.insightLabel}>YOUR CONVERSATION STYLE</Text>
          <View style={s.insightChips}>
            {Object.entries(myTraits).filter(([k]) => TRAIT_LABEL[k])
              .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => (
                <View key={k} style={s.insightChip}>
                  <Text style={s.insightChipText}>{TRAIT_LABEL[k]}</Text>
                </View>
              ))}
          </View>
          <Text style={s.insightNote}>
            Built from what people say after talking with you — never from how you sound.
            Shown on your profile to people you match with.
          </Text>
        </View>
      )}
      {verified && (
        <View style={[s.banner, { borderColor: "rgba(111,168,201,.4)" }]}>
          <Ionicons name="checkmark-circle" size={20} color="#6FA8C9" />
          <Text style={s.bannerText}>You're verified.</Text>
        </View>
      )}

      <Text style={s.label}>Photos</Text>
      <View style={s.grid}>
        {photos.map((p) => (
          <TouchableOpacity key={p.id} style={s.cell} onLongPress={() => removePhoto(p)}>
            <Image source={{ uri: p.url }} style={s.cellImg} />
          </TouchableOpacity>
        ))}
        {photos.length < 6 && (
          <TouchableOpacity style={s.cell} onPress={addPhoto}>
            <Text style={s.cellPlus}>＋</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={s.hint}>Long-press a photo to remove it.</Text>

      <Text style={s.label}>Intro video ({VIDEO_MIN_S}–{VIDEO_MAX_S} sec)</Text>
      {hasVideo ? (
        <View style={s.mediaRow}>
          <Ionicons name="videocam" size={20} color={theme.emerald} />
          <Text style={s.mediaText}>Intro video on your profile</Text>
          <TouchableOpacity onPress={addVideo} disabled={mediaBusy}>
            <Text style={s.mediaAction}>Replace</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={dropVideo} disabled={mediaBusy}>
            <Text style={[s.mediaAction, { color: theme.danger }]}>Remove</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={s.mediaAdd} onPress={addVideo} disabled={mediaBusy}>
          <Ionicons name="videocam-outline" size={20} color={theme.muted} />
          <Text style={s.mediaAddText}>
            {mediaBusy ? "Uploading…" : `Add a ${VIDEO_MIN_S}–${VIDEO_MAX_S} sec video — profiles with video get more likes`}
          </Text>
        </TouchableOpacity>
      )}

      <Text style={s.label}>Voice intro (up to {AUDIO_MAX_S} sec)</Text>
      {recState.isRecording ? (
        <View style={s.mediaRow}>
          <View style={s.recDot} />
          <Text style={s.mediaText}>
            Recording… {Math.min(AUDIO_MAX_S, Math.floor(recState.durationMillis / 1000))}s / {AUDIO_MAX_S}s
          </Text>
          <TouchableOpacity onPress={() => stopRec(true)}>
            <Text style={s.mediaAction}>Stop & save</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => stopRec(false)}>
            <Text style={[s.mediaAction, { color: theme.danger }]}>Discard</Text>
          </TouchableOpacity>
        </View>
      ) : audioUrl ? (
        <View style={s.mediaRow}>
          <TouchableOpacity onPress={playVoice}>
            <Ionicons name="play-circle" size={26} color={theme.rose} />
          </TouchableOpacity>
          <Text style={s.mediaText}>Voice intro on your profile</Text>
          <TouchableOpacity onPress={startRec} disabled={mediaBusy}>
            <Text style={s.mediaAction}>Re-record</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={dropAudio} disabled={mediaBusy}>
            <Text style={[s.mediaAction, { color: theme.danger }]}>Remove</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={s.mediaAdd} onPress={startRec} disabled={mediaBusy}>
          <Ionicons name="mic-outline" size={20} color={theme.muted} />
          <Text style={s.mediaAddText}>
            {mediaBusy ? "Uploading…" : "Record a voice intro — let them hear the real you"}
          </Text>
        </TouchableOpacity>
      )}

      <Text style={s.label}>Display name</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} maxLength={40}
        placeholderTextColor={theme.muted} />
      <Text style={s.label}>Bio</Text>
      <TextInput style={[s.input, { height: 100, textAlignVertical: "top" }]} value={bio}
        onChangeText={setBio} multiline maxLength={500} placeholderTextColor={theme.muted} />
      <Text style={s.label}>City</Text>
      <TextInput style={s.input} value={city} onChangeText={setCity} placeholderTextColor={theme.muted} />

      <TouchableOpacity onPress={save}>
        <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.btn}>
          <Text style={{ color: "#fff", fontWeight: "700" }}>Save</Text>
        </LinearGradient>
      </TouchableOpacity>
      <TouchableOpacity style={s.ghost} onPress={() => supabase.auth.signOut()}>
        <Text style={{ color: theme.muted, fontWeight: "600" }}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { fontSize: 30, fontFamily: theme.font.display, letterSpacing: -0.8, color: theme.ink },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 16 },
  titleActions: { flexDirection: "row", gap: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center" },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.card,
    borderWidth: 1, borderColor: "rgba(236,72,153,.4)", borderRadius: theme.radii.md, padding: 13,
    marginBottom: 18, ...theme.shadow.card },
  bannerText: { color: theme.ink, fontSize: 13, flex: 1, lineHeight: 18 },
  insightCard: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, padding: 16, marginBottom: 18, ...theme.shadow.card },
  insightLabel: { color: theme.gold, fontSize: 10, fontFamily: theme.font.black, letterSpacing: 1.3,
    marginBottom: 10 },
  insightChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  insightChip: { backgroundColor: theme.card2, borderRadius: 999, paddingHorizontal: 12,
    paddingVertical: 6 },
  insightChipText: { color: theme.ink, fontSize: 12.5, fontFamily: theme.font.semibold },
  insightNote: { color: theme.muted, fontSize: 11, marginTop: 10, lineHeight: 16 },
  label: { fontSize: 12, fontFamily: theme.font.bold, color: theme.muted, marginBottom: 8, marginTop: 10,
    textTransform: "uppercase", letterSpacing: 0.5 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cell: { width: "31%", aspectRatio: 3 / 4, borderRadius: theme.radii.md, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center",
    overflow: "hidden" },
  cellImg: { ...StyleSheet.absoluteFillObject },
  cellPlus: { color: theme.muted, fontSize: 30 },
  hint: { color: theme.muted, fontSize: 11, marginTop: 8, marginBottom: 6 },
  input: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, padding: 13, fontSize: 15, color: theme.ink, marginBottom: 8 },
  mediaRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, borderRadius: theme.radii.md, padding: 12, marginBottom: 8 },
  mediaText: { color: theme.ink, fontSize: 13, flex: 1 },
  mediaAction: { color: theme.purple, fontSize: 13, fontFamily: theme.font.bold, paddingHorizontal: 4 },
  mediaAdd: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, borderStyle: "dashed", borderRadius: theme.radii.md,
    padding: 12, marginBottom: 8 },
  mediaAddText: { color: theme.muted, fontSize: 13, flex: 1, lineHeight: 18 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger },
  btn: { borderRadius: 999, padding: 16, alignItems: "center", marginTop: 14, ...theme.shadow.cta },
  ghost: { alignItems: "center", padding: 14, marginTop: 8 },
});
