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

const ageFrom = (birthdate?: string | null) => {
  if (!birthdate) return null;
  const b = new Date(birthdate); if (isNaN(b.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a > 0 && a < 120 ? a : null;
};

export default function ProfileScreen() {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [age, setAge] = useState<number | null>(null);
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
      .select("display_name, bio, city, birthdate, video_path, audio_path, is_verified, is_active")
      .eq("id", user.id).maybeSingle();
    if (data) {
      setName(data.display_name); setBio(data.bio ?? ""); setCity(data.city ?? "");
      setAge(ageFrom(data.birthdate));
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

  const preview = () => uid && nav.navigate("MatchProfile",
    { otherId: uid, name: "Preview", self: true });

  // Profile strength — nudges completion the way Hinge/Bumble do.
  const checks: [boolean, string][] = [
    [photos.length > 0, "Add a photo"],
    [!!audioUrl, "Record a voice intro"],
    [!!bio.trim(), "Write a short bio"],
    [hasVideo, "Add an intro video"],
    [!!city.trim(), "Add your city"],
  ];
  const done = checks.filter(([ok]) => ok).length;
  const pct = Math.round((done / checks.length) * 100);
  const nextTip = checks.find(([ok]) => !ok)?.[1] ?? null;
  const mainPhoto = photos[0]?.url ?? null;

  const topTraits = Object.entries(myTraits).filter(([k]) => TRAIT_LABEL[k])
    .sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 44 }}>
      {/* top bar */}
      <View style={s.topBar}>
        <Text style={s.title}>You</Text>
        <View style={s.titleActions}>
          <TouchableOpacity style={s.iconBtn} disabled={!uid} onPress={preview}>
            <Ionicons name="eye-outline" size={21} color={theme.ink} />
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={() => nav.navigate("Settings")}>
            <Ionicons name="settings-outline" size={21} color={theme.ink} />
          </TouchableOpacity>
        </View>
      </View>

      {/* HERO — this is how others see you. Tap to preview the full profile. */}
      <TouchableOpacity activeOpacity={0.92} onPress={preview} style={s.hero}>
        {mainPhoto ? (
          <Image source={{ uri: mainPhoto }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, s.heroEmpty]}>
            <Text style={s.heroInitial}>{name?.[0]?.toUpperCase() ?? "?"}</Text>
          </LinearGradient>
        )}
        <LinearGradient colors={["transparent", "rgba(8,10,18,0.85)"]}
          style={s.heroScrim} pointerEvents="none">
          <View style={s.heroNameRow}>
            <Text style={s.heroName} numberOfLines={1}>
              {name || "Your name"}{age ? `, ${age}` : ""}
            </Text>
            {verified && <Ionicons name="checkmark-circle" size={20} color="#6FA8C9" />}
          </View>
          {city ? <Text style={s.heroMeta}>📍 {city}</Text> : null}
        </LinearGradient>
        <View style={s.heroPill}>
          <Ionicons name="eye-outline" size={13} color={theme.onGold} />
          <Text style={s.heroPillText}>Preview</Text>
        </View>
      </TouchableOpacity>

      {/* profile strength */}
      <View style={s.strengthCard}>
        <View style={s.strengthTop}>
          <Text style={s.strengthLabel}>Profile strength</Text>
          <Text style={s.strengthPct}>{pct}%</Text>
        </View>
        <View style={s.strengthTrack}>
          <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={[s.strengthFill, { width: `${Math.max(pct, 4)}%` }]} />
        </View>
        {nextTip && (
          <Text style={s.strengthTip}>
            <Ionicons name="arrow-forward" size={12} color={theme.gold} /> {nextTip} to stand out
          </Text>
        )}
      </View>

      {!active && (
        <TouchableOpacity style={s.banner} onPress={() => nav.navigate("Verify")}>
          <Ionicons name="shield-checkmark-outline" size={20} color={theme.gold} />
          <Text style={s.bannerText}>
            Verify your profile to start talking — tap to take a quick selfie.
          </Text>
          <Ionicons name="chevron-forward" size={18} color={theme.muted} />
        </TouchableOpacity>
      )}

      {/* Voice intro — the hero of a voice-first profile */}
      <SectionHeader icon="mic" title="Voice intro"
        hint="Let them hear the real you — the first thing that stands out." />
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
        <View style={s.voiceCard}>
          <TouchableOpacity onPress={playVoice} style={s.voicePlay}>
            <Ionicons name="play" size={20} color={theme.onGold} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.voiceTitle}>Your voice intro</Text>
            <Text style={s.voiceSub}>Tap to listen · up to {AUDIO_MAX_S}s</Text>
          </View>
          <TouchableOpacity onPress={startRec} disabled={mediaBusy}>
            <Text style={s.mediaAction}>Redo</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={dropAudio} disabled={mediaBusy}>
            <Ionicons name="trash-outline" size={18} color={theme.danger} />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={s.mediaAdd} onPress={startRec} disabled={mediaBusy}>
          <Ionicons name="mic-outline" size={20} color={theme.gold} />
          <Text style={s.mediaAddText}>
            {mediaBusy ? "Uploading…" : "Record a voice intro"}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={theme.muted} />
        </TouchableOpacity>
      )}

      {/* Photos */}
      <SectionHeader icon="images" title="Photos"
        hint="Shown after you match on a call. Long-press to remove." />
      <View style={s.grid}>
        {photos.map((p, i) => (
          <TouchableOpacity key={p.id} style={s.cell} onLongPress={() => removePhoto(p)}>
            <Image source={{ uri: p.url }} style={s.cellImg} />
            {i === 0 && <View style={s.mainTag}><Text style={s.mainTagText}>MAIN</Text></View>}
          </TouchableOpacity>
        ))}
        {photos.length < 6 && (
          <TouchableOpacity style={[s.cell, s.cellAdd]} onPress={addPhoto}>
            <Ionicons name="add" size={30} color={theme.gold} />
          </TouchableOpacity>
        )}
      </View>

      {/* Intro video */}
      <SectionHeader icon="videocam" title="Intro video"
        hint={`A ${VIDEO_MIN_S}–${VIDEO_MAX_S} sec clip — profiles with video get more replies.`} />
      {hasVideo ? (
        <View style={s.mediaRow}>
          <Ionicons name="videocam" size={20} color={theme.emerald} />
          <Text style={s.mediaText}>Intro video on your profile</Text>
          <TouchableOpacity onPress={addVideo} disabled={mediaBusy}>
            <Text style={s.mediaAction}>Replace</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={dropVideo} disabled={mediaBusy}>
            <Ionicons name="trash-outline" size={18} color={theme.danger} />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={s.mediaAdd} onPress={addVideo} disabled={mediaBusy}>
          <Ionicons name="videocam-outline" size={20} color={theme.gold} />
          <Text style={s.mediaAddText}>{mediaBusy ? "Uploading…" : "Add an intro video"}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.muted} />
        </TouchableOpacity>
      )}

      {/* About you */}
      <SectionHeader icon="document-text" title="About you"
        hint="A line or two on who you are and what you're looking for." />
      <TextInput style={s.bioInput} value={bio} onChangeText={setBio} multiline
        maxLength={500} placeholder="Tell people what makes you, you…"
        placeholderTextColor={theme.muted} />
      <Text style={s.counter}>{bio.length}/500</Text>

      {/* Basics */}
      <SectionHeader icon="person" title="Basics" />
      <View style={s.fieldCard}>
        <Text style={s.fieldLabel}>Display name</Text>
        <TextInput style={s.fieldInput} value={name} onChangeText={setName} maxLength={40}
          placeholder="Your name" placeholderTextColor={theme.muted} />
        <View style={s.fieldHair} />
        <Text style={s.fieldLabel}>City</Text>
        <TextInput style={s.fieldInput} value={city} onChangeText={setCity}
          placeholder="Where you're based" placeholderTextColor={theme.muted} />
      </View>

      {/* Conversation style — earned from real calls */}
      {topTraits.length > 0 && (
        <>
          <SectionHeader icon="sparkles" title="Your conversation style"
            hint="Built from what people say after talking with you — never from how you sound." />
          <View style={s.traitWrap}>
            {topTraits.map(([k]) => (
              <View key={k} style={s.traitChip}>
                <Text style={s.traitChipText}>{TRAIT_LABEL[k]}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {verified && (
        <View style={[s.banner, { borderColor: "rgba(111,168,201,.4)", marginTop: 24 }]}>
          <Ionicons name="checkmark-circle" size={20} color="#6FA8C9" />
          <Text style={s.bannerText}>You're verified.</Text>
        </View>
      )}

      <TouchableOpacity onPress={save} style={{ marginTop: 26 }}>
        <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.saveBtn}>
          <Ionicons name="checkmark" size={19} color="#fff" />
          <Text style={s.saveText}>Save changes</Text>
        </LinearGradient>
      </TouchableOpacity>
      <TouchableOpacity style={s.ghost} onPress={() => supabase.auth.signOut()}>
        <Text style={s.ghostText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SectionHeader({ icon, title, hint }:
  { icon: any; title: string; hint?: string }) {
  return (
    <View style={s.sectionHead}>
      <View style={s.sectionTitleRow}>
        <Ionicons name={icon} size={16} color={theme.gold} />
        <Text style={s.sectionTitle}>{title}</Text>
      </View>
      {hint ? <Text style={s.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 22, paddingTop: 64, paddingBottom: 14 },
  title: { fontSize: 30, fontFamily: theme.font.display, letterSpacing: -0.8, color: theme.ink },
  titleActions: { flexDirection: "row", gap: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center" },

  // hero
  hero: { height: 380, marginHorizontal: 22, borderRadius: theme.radii.xl, overflow: "hidden",
    backgroundColor: theme.card, ...theme.shadow.floating },
  heroEmpty: { alignItems: "center", justifyContent: "center" },
  heroInitial: { color: "rgba(255,255,255,0.3)", fontSize: 130, fontFamily: theme.font.black },
  heroScrim: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20,
    paddingTop: 40, paddingBottom: 18 },
  heroNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroName: { color: "#fff", fontSize: 26, fontFamily: theme.font.display, letterSpacing: -0.6 },
  heroMeta: { color: "rgba(255,255,255,0.85)", fontSize: 13.5, marginTop: 5, fontFamily: theme.font.semibold },
  heroPill: { position: "absolute", top: 14, right: 14, flexDirection: "row", alignItems: "center",
    gap: 5, backgroundColor: theme.gold, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
    ...theme.shadow.cta },
  heroPillText: { color: theme.onGold, fontSize: 12, fontFamily: theme.font.black },

  // strength
  strengthCard: { marginHorizontal: 22, marginTop: 16, backgroundColor: theme.card, borderWidth: 1,
    borderColor: theme.line, borderRadius: theme.radii.lg, padding: 16, ...theme.shadow.card },
  strengthTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  strengthLabel: { color: theme.ink, fontSize: 14, fontFamily: theme.font.bold },
  strengthPct: { color: theme.gold, fontSize: 15, fontFamily: theme.font.black },
  strengthTrack: { height: 8, borderRadius: 4, backgroundColor: theme.card2, overflow: "hidden",
    marginTop: 10 },
  strengthFill: { height: 8, borderRadius: 4 },
  strengthTip: { color: theme.muted, fontSize: 12.5, marginTop: 10, fontFamily: theme.font.semibold },

  banner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.card,
    borderWidth: 1, borderColor: "rgba(236,72,153,.4)", borderRadius: theme.radii.md, padding: 13,
    marginHorizontal: 22, marginTop: 16, ...theme.shadow.card },
  bannerText: { color: theme.ink, fontSize: 13, flex: 1, lineHeight: 18 },

  // section headers
  sectionHead: { paddingHorizontal: 22, marginTop: 28, marginBottom: 12 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  sectionTitle: { color: theme.ink, fontSize: 17, fontFamily: theme.font.displayMd, letterSpacing: -0.3 },
  sectionHint: { color: theme.muted, fontSize: 12.5, marginTop: 5, lineHeight: 17 },

  // media rows
  mediaRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, borderRadius: theme.radii.md, padding: 14,
    marginHorizontal: 22, ...theme.shadow.card },
  mediaText: { color: theme.ink, fontSize: 13.5, flex: 1, fontFamily: theme.font.semibold },
  mediaAction: { color: theme.purple, fontSize: 13, fontFamily: theme.font.bold, paddingHorizontal: 2 },
  mediaAdd: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, borderStyle: "dashed", borderRadius: theme.radii.md,
    padding: 15, marginHorizontal: 22 },
  mediaAddText: { color: theme.ink, fontSize: 14, flex: 1, fontFamily: theme.font.semibold },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger },

  // voice card
  voiceCard: { flexDirection: "row", alignItems: "center", gap: 13, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, borderRadius: theme.radii.md, padding: 14,
    marginHorizontal: 22, ...theme.shadow.card },
  voicePlay: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center",
    backgroundColor: theme.gold, ...theme.shadow.cta },
  voiceTitle: { color: theme.ink, fontSize: 14.5, fontFamily: theme.font.bold },
  voiceSub: { color: theme.muted, fontSize: 12, marginTop: 2 },

  // photos
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 22 },
  cell: { width: "31%", aspectRatio: 3 / 4, borderRadius: theme.radii.md, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center",
    overflow: "hidden" },
  cellAdd: { borderStyle: "dashed", borderColor: theme.gold },
  cellImg: { ...StyleSheet.absoluteFillObject },
  mainTag: { position: "absolute", left: 6, bottom: 6, backgroundColor: "rgba(8,10,18,0.72)",
    borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  mainTagText: { color: "#fff", fontSize: 8.5, fontFamily: theme.font.black, letterSpacing: 0.6 },

  // bio
  bioInput: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, padding: 14, fontSize: 15, color: theme.ink, marginHorizontal: 22,
    minHeight: 96, textAlignVertical: "top", lineHeight: 21 },
  counter: { color: theme.muted, fontSize: 11, textAlign: "right", marginRight: 22, marginTop: 6 },

  // basics
  fieldCard: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, paddingHorizontal: 14, paddingVertical: 6, marginHorizontal: 22,
    ...theme.shadow.card },
  fieldLabel: { color: theme.muted, fontSize: 11, fontFamily: theme.font.bold, letterSpacing: 0.5,
    textTransform: "uppercase", marginTop: 10 },
  fieldInput: { color: theme.ink, fontSize: 15.5, paddingVertical: 8, fontFamily: theme.font.semibold },
  fieldHair: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line, marginVertical: 4 },

  // traits
  traitWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 22 },
  traitChip: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  traitChipText: { color: theme.ink, fontSize: 12.5, fontFamily: theme.font.semibold },

  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: theme.radii.pill, paddingVertical: 17, marginHorizontal: 22, ...theme.shadow.cta },
  saveText: { color: "#fff", fontFamily: theme.font.black, fontSize: 16 },
  ghost: { alignItems: "center", padding: 16, marginTop: 4 },
  ghostText: { color: theme.muted, fontFamily: theme.font.bold, fontSize: 14 },
});
