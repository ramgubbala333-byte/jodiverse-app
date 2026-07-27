import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Animated,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer,
  useAudioRecorder, useAudioRecorderState,
} from "expo-audio";
import { supabase } from "../lib/supabase";
import { uploadIntroAudio, signMediaPath } from "../lib/media";
import { theme } from "../theme";

const MIN_S = 10;
const MAX_S = 45;

// Rotating prompts — people freeze on "say something about yourself".
const PROMPTS = [
  "What's the last thing that made you laugh out loud?",
  "Describe your perfect Sunday in 20 seconds.",
  "What are you unreasonably passionate about?",
  "Where's the best place you've eaten this year?",
  "What's something you're learning right now?",
  "What would you talk about for an hour without prep?",
];

// The voice intro is the quality gate for the whole product: no intro,
// no queue. It's also the first low-stakes recording, which makes the
// first live call feel far less intimidating.
export default function VoiceProfileScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 250);
  const [uri, setUri] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [promptIdx, setPromptIdx] = useState(0);
  const player = useAudioPlayer(uri ?? existing ?? undefined);
  const pulse = useRef(new Animated.Value(0)).current;

  const seconds = Math.floor((recState.durationMillis ?? 0) / 1000);
  const recording = recState.isRecording;

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from("voice_profiles")
          .select("storage_path").eq("user_id", user.id).maybeSingle();
        if (data?.storage_path) setExisting(await signMediaPath(data.storage_path));
      }
      setLoading(false);
    })();
  }, []);

  // Breathing ring while recording.
  useEffect(() => {
    if (!recording) { pulse.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  // Hard stop at the ceiling so uploads stay small.
  useEffect(() => {
    if (recording && seconds >= MAX_S) stop();
  }, [recording, seconds]);

  const start = async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Microphone needed", "Allow microphone access to record your intro.");
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    setUri(null);
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const stop = async () => {
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (recorder.uri) setUri(recorder.uri);
  };

  const publish = async () => {
    if (!uri) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const path = await uploadIntroAudio(user.id, uri);
      const { error } = await supabase.from("voice_profiles").upsert({
        user_id: user.id,
        storage_path: path,
        duration_s: Math.max(MIN_S, Math.min(MAX_S, seconds)),
        status: "approved",       // auto-approve until moderation ships
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      Alert.alert("You're on the air 🎙️",
        "Your voice intro is live. You can now join voice discovery.",
        [{ text: "Start talking", onPress: () => nav.goBack() }]);
    } catch (e: any) {
      Alert.alert("Couldn't publish", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <View style={[s.wrap, s.center]}><ActivityIndicator color={theme.gold} /></View>;
  }

  const tooShort = !!uri && seconds < MIN_S;
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.05] });

  return (
    <View style={[s.wrap, { paddingBottom: 12 + insets.bottom }]}>
      <View style={s.head}>
        <Text style={s.title}>Your voice intro</Text>
        <Text style={s.sub}>
          {MIN_S}–{MAX_S} seconds. This is what people hear before they decide to
          talk to you — it's the only thing they get.
        </Text>
      </View>

      {/* prompt card */}
      <TouchableOpacity style={s.promptCard}
        onPress={() => setPromptIdx((i) => (i + 1) % PROMPTS.length)}>
        <Text style={s.promptLabel}>TRY ANSWERING</Text>
        <Text style={s.promptText}>{PROMPTS[promptIdx]}</Text>
        <Text style={s.promptSwap}>Tap for another ↻</Text>
      </TouchableOpacity>

      {/* record orb */}
      <View style={s.orbWrap}>
        {recording && (
          <Animated.View style={[s.orbRing,
            { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
        )}
        <TouchableOpacity activeOpacity={0.85} onPress={recording ? stop : start}>
          <LinearGradient colors={recording ? ["#E0674F", "#C4503A"] : [...theme.grad]}
            style={s.orb}>
            <Ionicons name={recording ? "stop" : "mic"} size={40} color={theme.onGold} />
          </LinearGradient>
        </TouchableOpacity>
        <Text style={[s.timer, seconds >= MIN_S && { color: theme.emerald }]}>
          {recording || uri ? `0:${String(seconds).padStart(2, "0")}` : "Tap to record"}
        </Text>
        {recording && (
          <Text style={s.hint}>
            {seconds < MIN_S ? `Keep going — ${MIN_S - seconds}s more` : "Sounding good. Stop when ready."}
          </Text>
        )}
      </View>

      {/* playback + publish */}
      {(uri || existing) && !recording && (
        <View style={s.actions}>
          <TouchableOpacity style={s.ghostBtn}
            onPress={() => { player.seekTo(0); player.play(); }}>
            <Ionicons name="play" size={17} color={theme.ink} />
            <Text style={s.ghostText}>{uri ? "Play back" : "Play current intro"}</Text>
          </TouchableOpacity>
          {uri && (
            <TouchableOpacity style={s.ghostBtn} onPress={start}>
              <Ionicons name="refresh" size={17} color={theme.ink} />
              <Text style={s.ghostText}>Re-record</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={{ flex: 1 }} />

      {tooShort && <Text style={s.warn}>Too short — go for at least {MIN_S} seconds.</Text>}

      <TouchableOpacity disabled={!uri || tooShort || busy} onPress={publish}
        style={{ opacity: !uri || tooShort || busy ? 0.4 : 1 }}>
        <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={s.cta}>
          {busy ? <ActivityIndicator color={theme.onGold} />
            : <Text style={s.ctaText}>{existing && !uri ? "Keep current intro" : "Publish intro"}</Text>}
        </LinearGradient>
      </TouchableOpacity>

      <Text style={s.privacy}>
        Your intro is stored privately and only played to people you're matched with in
        discovery. It's never public and never downloadable.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, padding: 22, paddingTop: 20 },
  center: { alignItems: "center", justifyContent: "center" },
  head: { marginBottom: 18 },
  title: { color: theme.ink, fontSize: 27, fontFamily: theme.font.display, letterSpacing: -0.8 },
  sub: { color: theme.muted, fontSize: 14, marginTop: 10, lineHeight: 20 },
  promptCard: { backgroundColor: theme.card, borderRadius: theme.radii.lg, padding: 18,
    borderWidth: 1, borderColor: theme.line, ...theme.shadow.card },
  promptLabel: { color: theme.gold, fontSize: 10, fontFamily: theme.font.black, letterSpacing: 1.4 },
  promptText: { color: theme.ink, fontSize: 17, fontFamily: theme.font.semibold, marginTop: 8,
    lineHeight: 24 },
  promptSwap: { color: theme.muted, fontSize: 11.5, marginTop: 10 },
  orbWrap: { alignItems: "center", marginTop: 42 },
  orb: { width: 116, height: 116, borderRadius: 58, alignItems: "center",
    justifyContent: "center", ...theme.shadow.cta },
  orbRing: { position: "absolute", top: 0, width: 116, height: 116, borderRadius: 58,
    backgroundColor: theme.danger },
  timer: { color: theme.ink, fontSize: 22, fontFamily: theme.font.black, marginTop: 18,
    fontVariant: ["tabular-nums"] },
  hint: { color: theme.muted, fontSize: 13, marginTop: 6 },
  actions: { flexDirection: "row", gap: 10, justifyContent: "center", marginTop: 26 },
  ghostBtn: { flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  ghostText: { color: theme.ink, fontFamily: theme.font.bold, fontSize: 13.5 },
  warn: { color: theme.danger, fontSize: 13, textAlign: "center", marginBottom: 10 },
  cta: { borderRadius: theme.radii.pill, padding: 18, alignItems: "center", ...theme.shadow.cta },
  ctaText: { color: theme.onGold, fontFamily: theme.font.black, fontSize: 16, letterSpacing: 0.2 },
  privacy: { color: theme.muted, fontSize: 11.5, textAlign: "center", marginTop: 14,
    lineHeight: 17, paddingBottom: 8 },
});
