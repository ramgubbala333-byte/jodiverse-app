import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Alert, StyleSheet, ScrollView, Image, Modal, FlatList,
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
const MAX_PROMPTS = 3;
const MAX_TRAITS = 6;

// Kept in sync with OnboardingScreen — same options, so a profile edited
// here can never end up with a value the signup flow wouldn't produce.
const LOVE_LANGUAGES = ["Physical Touch", "Words of Affirmation", "Acts of Service",
  "Quality Time", "Receiving Gifts"];
const WORKOUTS = ["Often", "Sometimes", "Rarely"];
const TRAIT_OPTIONS = ["Adventurous", "Flexible", "Active Listener", "Easy Going", "Caring",
  "Courageous", "Foodie", "Ambitious", "Funny", "Creative", "Loyal", "Curious"];

// Preset prompt questions — Hinge-style. Likes on prompts convert to real
// dates ~47% better than likes on photos alone (2024 industry data), so this
// replaces "just a bio" as the primary way people express personality.
const PROMPT_QUESTIONS = [
  "My ideal weekend", "I'm looking for...", "Two truths and a lie",
  "A random fact I love", "My simple pleasures", "Together, we could...",
  "The way to win me over", "I'll know it's time to delete this app when...",
  "My most controversial opinion", "Green flags I look for",
  "A life goal of mine", "My love language is",
];

type Prompt = { q: string; a: string };

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
  const [traits, setTraits] = useState<string[]>([]);
  const [loveLanguage, setLoveLanguage] = useState<string | null>(null);
  const [workout, setWorkout] = useState<string | null>(null);
  // Held whole so the strength meter can weigh fields this screen doesn't edit.
  const [raw, setRaw] = useState<any>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [editSlot, setEditSlot] = useState<number | null>(null); // which slot (0-2) is being edited
  const [pickedQ, setPickedQ] = useState<string | null>(null);
  const [draftA, setDraftA] = useState("");
  const nav = useNavigation<any>();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 500);
  const player = useAudioPlayer();

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUid(user.id);
    const { data } = await supabase.from("profiles")
      .select("display_name, bio, city, birthdate, video_path, audio_path, is_verified, is_active, prompts, traits, love_language, workout, interests, faith, languages, height_cm, occupation, education, relationship_goal")
      .eq("id", user.id).maybeSingle();
    if (data) {
      setName(data.display_name); setBio(data.bio ?? ""); setCity(data.city ?? "");
      setAge(ageFrom(data.birthdate));
      setVerified(data.is_verified); setActive(data.is_active);
      setHasVideo(!!data.video_path);
      setAudioUrl(data.audio_path ? await signMediaPath(data.audio_path) : null);
      setPrompts(Array.isArray(data.prompts) ? data.prompts : []);
      setTraits(Array.isArray(data.traits) ? data.traits : []);
      setLoveLanguage(data.love_language ?? null);
      setWorkout(data.workout ?? null);
      setRaw(data);
    }
    setPhotos(await listOwnPhotos(user.id));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    if (!uid) return;
    // Update ONLY editable fields — never resend birthdate/gender.
    const { error } = await supabase.from("profiles")
      .update({ display_name: name.trim(), bio: bio.trim() || null, city: city.trim() || null,
                prompts, traits, love_language: loveLanguage, workout })
      .eq("id", uid);
    // Refresh the semantic embedding when the bio/prompts change (fire-and-forget).
    if (!error) supabase.functions.invoke("embed-profile").catch(() => {});
    Alert.alert(error ? "Save failed" : "Saved", error?.message ?? "Profile updated.");
  };

  const openSlot = (slot: number) => {
    setEditSlot(slot);
    setPickedQ(prompts[slot]?.q ?? null);
    setDraftA(prompts[slot]?.a ?? "");
  };

  const savePrompt = () => {
    if (editSlot === null || !pickedQ || !draftA.trim()) return;
    setPrompts((cur) => {
      const next = [...cur];
      next[editSlot] = { q: pickedQ, a: draftA.trim() };
      return next;
    });
    setEditSlot(null); setPickedQ(null); setDraftA("");
  };

  const removePrompt = (slot: number) => {
    setPrompts((cur) => cur.filter((_, i) => i !== slot));
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

  // Profile strength — nudges completion rather than gating on it, which is
  // what every major app settled on: blocking the product until a form is
  // finished is the biggest single source of signup drop-off.
  //
  // Ordered by real effect on being seen and liked, NOT by how easy each is to
  // fill in. The old list led with an intro video and a city while ignoring
  // photo count, prompts, and verification — so it nudged hardest toward the
  // things that matter least.
  const checks: [boolean, string][] = [
    [photos.length >= 3, "Add at least 3 photos"],
    [(raw?.prompts?.length ?? 0) >= 1, "Answer a prompt"],
    [verified, "Verify your profile — unverified profiles are shown far less"],
    [(raw?.interests?.length ?? 0) >= 3, "Pick your interests"],
    [!!bio.trim(), "Write a short bio"],
    [(raw?.prompts?.length ?? 0) >= 3, "Answer all 3 prompts"],
    [!!raw?.relationship_goal, "Say what you're looking for"],
    [!!audioUrl, "Record a voice intro"],
    [(raw?.languages?.length ?? 0) > 0, "Add the languages you speak"],
    [!!raw?.occupation, "Add your job"],
    [!!raw?.education, "Add your education"],
    [!!raw?.height_cm, "Add your height"],
    [!!city.trim(), "Add your city"],
    [hasVideo, "Add an intro video"],
  ];
  const done = checks.filter(([ok]) => ok).length;
  const pct = Math.round((done / checks.length) * 100);
  const nextTip = checks.find(([ok]) => !ok)?.[1] ?? null;
  const mainPhoto = photos[0]?.url ?? null;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 44 }}>
      {/* top bar */}
      <View style={s.topBar}>
        <Text style={s.title}>You</Text>
        <View style={s.titleActions}>
          <TouchableOpacity style={s.iconBtn} onPress={() => nav.navigate("Insights")}>
            <Ionicons name="stats-chart-outline" size={20} color={theme.ink} />
          </TouchableOpacity>
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
        {photos.map((p, i) => {
          // Photos are hidden from others until moderation clears them — say so,
          // otherwise "why is nobody seeing me?" is invisible to the user.
          const pending = p.moderation === "pending" || p.moderation === "flagged";
          const rejected = p.moderation === "rejected";
          return (
            <TouchableOpacity key={p.id} style={s.cell} onLongPress={() => removePhoto(p)}>
              <Image source={{ uri: p.url }} style={s.cellImg} />
              {(pending || rejected) && <View style={s.modScrim} />}
              {i === 0 && !pending && !rejected && (
                <View style={s.mainTag}><Text style={s.mainTagText}>MAIN</Text></View>
              )}
              {pending && (
                <View style={[s.modTag, { backgroundColor: "rgba(8,10,18,.8)" }]}>
                  <Ionicons name="time-outline" size={11} color={theme.gold} />
                  <Text style={[s.modTagText, { color: theme.gold }]}>In review</Text>
                </View>
              )}
              {rejected && (
                <View style={[s.modTag, { backgroundColor: "rgba(8,10,18,.85)" }]}>
                  <Ionicons name="close-circle" size={11} color={theme.danger} />
                  <Text style={[s.modTagText, { color: theme.danger }]}>Rejected</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
        {photos.length < 6 && (
          <TouchableOpacity style={[s.cell, s.cellAdd]} onPress={addPhoto}>
            <Ionicons name="add" size={30} color={theme.gold} />
          </TouchableOpacity>
        )}
      </View>

      {/* My Prompts — Hinge-style, the primary way to show personality */}
      <View style={s.sectionHead}>
        <View style={s.promptsHeadRow}>
          <View style={s.sectionTitleRow}>
            <Ionicons name="chatbox-ellipses" size={16} color={theme.gold} />
            <Text style={s.sectionTitle}>My Prompts</Text>
          </View>
          <View style={s.promptsCountPill}>
            <Text style={s.promptsCountText}>{prompts.length}/{MAX_PROMPTS} Completed</Text>
          </View>
        </View>
        <Text style={s.sectionHint}>Answer a few — these show up in Discover, not just your bio.</Text>
      </View>
      <View style={{ paddingHorizontal: 22, gap: 10 }}>
        {prompts.map((p, i) => (
          <TouchableOpacity key={i} style={s.promptFilled} onPress={() => openSlot(i)}>
            <View style={{ flex: 1 }}>
              <Text style={s.promptFilledQ}>{p.q}</Text>
              <Text style={s.promptFilledA} numberOfLines={2}>{p.a}</Text>
            </View>
            <TouchableOpacity onPress={() => removePrompt(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={18} color={theme.muted} />
            </TouchableOpacity>
          </TouchableOpacity>
        ))}
        {prompts.length < MAX_PROMPTS && (
          <TouchableOpacity style={s.promptEmpty} onPress={() => openSlot(prompts.length)}>
            <Ionicons name="add" size={18} color={theme.purple} />
            <Text style={s.promptEmptyText}>Pick a question</Text>
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

      {/* Personality — self-selected, shown on your card in Discover */}
      <SectionHeader icon="sparkles" title="My personality"
        hint={`Pick up to ${MAX_TRAITS}. These show on your profile and help us match you.`} />
      <View style={s.traitWrap}>
        {TRAIT_OPTIONS.map((t) => {
          const on = traits.includes(t);
          return (
            <TouchableOpacity key={t} style={[s.traitChip, on && s.traitChipOn]}
              onPress={() => setTraits((cur) =>
                cur.includes(t) ? cur.filter((x) => x !== t)
                  : cur.length >= MAX_TRAITS ? cur : [...cur, t])}>
              <Text style={[s.traitChipText, on && s.traitChipTextOn]}>{t}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <SectionHeader icon="heart-half" title="My love language" />
      <View style={s.traitWrap}>
        {LOVE_LANGUAGES.map((l) => {
          const on = loveLanguage === l;
          return (
            <TouchableOpacity key={l} style={[s.traitChip, on && s.traitChipOn]}
              onPress={() => setLoveLanguage(on ? null : l)}>
              <Text style={[s.traitChipText, on && s.traitChipTextOn]}>{l}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <SectionHeader icon="barbell" title="Do you work out?" />
      <View style={s.traitWrap}>
        {WORKOUTS.map((w) => {
          const on = workout === w;
          return (
            <TouchableOpacity key={w} style={[s.traitChip, on && s.traitChipOn]}
              onPress={() => setWorkout(on ? null : w)}>
              <Text style={[s.traitChipText, on && s.traitChipTextOn]}>{w}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

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

      {/* prompt editor: pick a question, then write an answer */}
      <Modal visible={editSlot !== null} transparent animationType="fade"
        onRequestClose={() => setEditSlot(null)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            {!pickedQ ? (
              <>
                <Text style={s.modalTitle}>Pick a question</Text>
                <FlatList data={PROMPT_QUESTIONS.filter((q) =>
                    q === prompts[editSlot ?? -1]?.q || !prompts.some((p) => p.q === q))}
                  keyExtractor={(q) => q} style={{ maxHeight: 340 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={s.qRow} onPress={() => setPickedQ(item)}>
                      <Text style={s.qRowText}>{item}</Text>
                      <Ionicons name="chevron-forward" size={16} color={theme.muted} />
                    </TouchableOpacity>
                  )} />
                <TouchableOpacity style={s.modalGhost} onPress={() => setEditSlot(null)}>
                  <Text style={s.modalGhostText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.modalTitle}>{pickedQ}</Text>
                <TextInput style={s.modalInput} value={draftA} onChangeText={setDraftA}
                  placeholder="Your answer…" placeholderTextColor={theme.muted}
                  maxLength={150} multiline autoFocus />
                <Text style={s.counter}>{draftA.length}/150</Text>
                <View style={s.modalRow}>
                  <TouchableOpacity style={s.modalGhostBtn} onPress={() => setPickedQ(null)}>
                    <Text style={s.modalGhostText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ flex: 1 }} onPress={savePrompt} disabled={!draftA.trim()}>
                    <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                      style={[s.modalSend, !draftA.trim() && { opacity: 0.5 }]}>
                      <Text style={s.modalSendText}>Save</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
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
  modScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,10,18,.55)" },
  modTag: { position: "absolute", left: 5, bottom: 5, right: 5, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 6, paddingVertical: 4 },
  modTagText: { fontSize: 8.5, fontFamily: theme.font.black, letterSpacing: 0.4 },

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
  traitChipText: { color: theme.muted, fontSize: 12.5, fontFamily: theme.font.semibold },
  traitChipOn: { borderColor: theme.gold, backgroundColor: theme.goldSoft },
  traitChipTextOn: { color: theme.gold },

  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: theme.radii.pill, paddingVertical: 17, marginHorizontal: 22, ...theme.shadow.cta },
  saveText: { color: "#fff", fontFamily: theme.font.black, fontSize: 16 },
  ghost: { alignItems: "center", padding: 16, marginTop: 4 },
  ghostText: { color: theme.muted, fontFamily: theme.font.bold, fontSize: 14 },

  // prompts
  promptsHeadRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  promptsCountPill: { backgroundColor: theme.goldSoft, borderRadius: 999, paddingHorizontal: 10,
    paddingVertical: 4 },
  promptsCountText: { color: theme.gold, fontSize: 11, fontFamily: theme.font.bold },
  promptFilled: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: theme.card,
    borderWidth: 1, borderColor: "rgba(255,122,46,.3)", borderRadius: theme.radii.md, padding: 14,
    ...theme.shadow.card },
  promptFilledQ: { color: theme.gold, fontSize: 10.5, fontFamily: theme.font.black, letterSpacing: 1,
    textTransform: "uppercase", marginBottom: 4 },
  promptFilledA: { color: theme.ink, fontSize: 14, fontFamily: theme.font.medium, lineHeight: 19 },
  promptEmpty: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line, borderStyle: "dashed",
    borderRadius: theme.radii.md, paddingVertical: 20 },
  promptEmptyText: { color: theme.muted, fontSize: 13.5, fontFamily: theme.font.semibold },

  // prompt-editor modal
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,.6)", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: theme.card, borderRadius: theme.radii.xl, padding: 20,
    borderWidth: 1, borderColor: theme.line, ...theme.shadow.floating },
  modalTitle: { color: theme.ink, fontSize: 17, fontFamily: theme.font.displayMd, marginBottom: 12 },
  modalInput: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, padding: 12, color: theme.ink, minHeight: 70, textAlignVertical: "top" },
  modalRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  modalGhost: { alignItems: "center", paddingVertical: 14, marginTop: 8 },
  modalGhostBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  modalGhostText: { color: theme.muted, fontFamily: theme.font.bold },
  modalSend: { borderRadius: 999, padding: 14, alignItems: "center" },
  modalSendText: { color: "#fff", fontFamily: theme.font.black, fontSize: 14.5 },
  qRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  qRowText: { color: theme.ink, fontSize: 14.5, fontFamily: theme.font.medium, flex: 1 },
});
