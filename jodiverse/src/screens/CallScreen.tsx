import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Animated, Easing, ActivityIndicator,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAudioPlayer } from "expo-audio";
import { supabase } from "../lib/supabase";
import { signMediaPath } from "../lib/media";
import { withEmoji } from "../lib/interests";
import { createTransport, VOICE_MODE, type CallState } from "../lib/voice";
import GlowBackdrop from "../components/GlowBackdrop";
import { haptic } from "../lib/haptics";
import { theme } from "../theme";

const REPORT_REASONS = ["Inappropriate language", "Harassment", "Scam / asking for money",
  "Sexual content", "Underage", "Other"];
const MIN_SECONDS = 90; // before leaving counts as a clean exit

type Them = { id: string; name: string; age: number; interests: string[];
  city: string | null; verified: boolean; shared: string[] };

// The call. Photos stay hidden here by design — this screen is a voice, a
// name, and what you have in common. Nothing else.
export default function CallScreen() {
  const { callId, isCaller } = useRoute().params as { callId: string; isCaller: boolean };
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<CallState>("connecting");
  const [them, setThem] = useState<Them | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [budget, setBudget] = useState(600);   // seconds this call may run
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [level, setLevel] = useState(0);
  const [introUrl, setIntroUrl] = useState<string | null>(null);
  const transport = useRef(createTransport()).current;
  const ended = useRef(false);
  const introPlayer = useAudioPlayer(introUrl ?? undefined);

  // ── load the call + the other person ──────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: call } = await supabase.from("calls")
        .select("*").eq("id", callId).maybeSingle();
      if (!call || !user) { nav.goBack(); return; }
      setBudget(call.budget_seconds ?? (call.max_minutes ?? 10) * 60);

      const otherId = call.caller === user.id ? call.callee : call.caller;
      const [{ data: prof }, { data: me }, { data: vp }] = await Promise.all([
        supabase.from("public_profiles")
          .select("id, display_name, age, interests, city, is_verified").eq("id", otherId).maybeSingle(),
        supabase.from("profiles").select("interests").eq("id", user.id).maybeSingle(),
        supabase.from("voice_profiles").select("storage_path").eq("user_id", otherId).maybeSingle(),
      ]);
      if (prof) {
        const mine = me?.interests ?? [];
        setThem({
          id: prof.id, name: prof.display_name, age: prof.age,
          interests: prof.interests ?? [], city: prof.city,
          verified: prof.is_verified,
          shared: (prof.interests ?? []).filter((i: string) => mine.includes(i)),
        });
      }
      if (vp?.storage_path) setIntroUrl(await signMediaPath(vp.storage_path));

      await supabase.from("calls").update({
        state: "active", started_at: new Date().toISOString(),
      }).eq("id", callId);

      await transport.join(call.room, isCaller, {
        onState: setState,
        onLevel: setLevel,
        onRemoteLeft: () => finish("callee_left"),
      });
    })();
    return () => { transport.leave(); };
  }, [callId]);

  // ── timers ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (state !== "active") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  const cap = budget;   // 10-min hard cap for everyone, or less if wallet is low
  useEffect(() => {
    if (state === "active" && elapsed >= cap) finish("timeout");
  }, [elapsed, cap, state]);

  // ── ending ────────────────────────────────────────────────────────────
  // We write ended_at + reason only; the DB trigger computes the true
  // duration from its own clock and debits both wallets. Client can't cheat.
  const finish = async (reason: string) => {
    if (ended.current) return;
    ended.current = true;
    await transport.leave();
    await supabase.from("calls").update({
      state: "ended", ended_at: new Date().toISOString(), end_reason: reason,
    }).eq("id", callId);
    nav.replace("PostCall", {
      callId, name: them?.name ?? "them", otherId: them?.id, duration: elapsed,
    });
  };

  const hangUp = () => {
    // Only nudge if there's meaningful time left in the budget.
    if (elapsed < MIN_SECONDS && state === "active" && cap - elapsed > 30) {
      Alert.alert("Leave already?",
        "Most good conversations take a minute to warm up — give it a few more seconds?",
        [{ text: "Stay", style: "cancel" },
         { text: "Leave", style: "destructive", onPress: () => finish("caller_left") }]);
      return;
    }
    finish("completed");
  };

  const report = () => {
    Alert.alert("Report this call", "This ends the call immediately for both of you.",
      [...REPORT_REASONS.map((r) => ({
        text: r,
        onPress: async () => {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && them) {
            await supabase.from("reports").insert({
              reporter: user.id, reported: them.id, reason: r,
            });
            await supabase.from("blocks").insert({ blocker: user.id, blocked: them.id });
          }
          finish("reported");
        },
      })), { text: "Cancel", style: "cancel" as const }]);
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const remaining = Math.max(0, cap - elapsed);
  const nearEnd = remaining <= 60 && state === "active";
  const live = state === "active";

  return (
    <View style={[s.wrap, { paddingTop: 14 + insets.top, paddingBottom: 12 + insets.bottom }]}>
      <GlowBackdrop />

      {/* top: ON AIR / status pill + report */}
      <View style={s.topRow}>
        <View style={[s.onAir, live && s.onAirLive]}>
          <View style={[s.onAirDot, live && { backgroundColor: theme.emerald }]} />
          <Text style={[s.onAirText, live && { color: theme.emerald }]}>
            {live ? "ON AIR" : state === "connecting" ? "CONNECTING" : "WAITING"}
          </Text>
        </View>
        {VOICE_MODE === "simulated" && <Text style={s.simTag}>SIMULATED AUDIO</Text>}
        <TouchableOpacity onPress={report} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="ellipsis-vertical" size={20} color={theme.muted} />
        </TouchableOpacity>
      </View>

      {/* visualizer + identity */}
      <View style={s.centerArea}>
        <CallVisualizer active={live} />
        {them ? (
          <>
            <View style={s.nameRow}>
              <Text style={s.name}>{them.name}</Text>
              {them.verified && (
                <Ionicons name="shield-checkmark" size={18} color={theme.info}
                  style={{ marginLeft: 7 }} />
              )}
            </View>
            <Text style={s.connected}>{live ? "CONNECTED" : "CONNECTING…"}</Text>
            <Text style={s.timer}>{mm}:{ss}</Text>
            {nearEnd && <Text style={s.endingSoon}>{remaining}s left</Text>}
          </>
        ) : <ActivityIndicator color={theme.gold} style={{ marginTop: 24 }} />}
      </View>

      {/* what you have in common — the whole point */}
      {them && them.shared.length > 0 && (
        <View style={s.sharedCard}>
          <Text style={s.sharedLabel}>YOU BOTH LIKE</Text>
          <View style={s.sharedRow}>
            {them.shared.slice(0, 6).map((i) => (
              <View key={i} style={s.sharedChip}>
                <Text style={s.sharedChipText}>{withEmoji(i)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* their intro, playable while waiting */}
      {introUrl && !live && (
        <TouchableOpacity style={s.introBtn}
          onPress={() => { introPlayer.seekTo(0); introPlayer.play(); }}>
          <Ionicons name="play-circle" size={20} color={theme.gold} />
          <Text style={s.introText}>Hear their intro while you wait</Text>
        </TouchableOpacity>
      )}

      <View style={{ flex: 1 }} />

      {/* becoming friends is how you keep talking past 10 min */}
      {live && nearEnd && (
        <Text style={s.nearEndHint}>
          Enjoying this? Say "yes" after the call to become friends and chat anytime.
        </Text>
      )}

      {/* controls — glass bar with labels */}
      <View style={s.controls}>
        <View style={s.ctrlCol}>
          <TouchableOpacity style={[s.ctrl, muted && s.ctrlOn]}
            onPress={() => { haptic.select(); const m = !muted; setMuted(m); transport.setMuted(m); }}>
            <Ionicons name={muted ? "mic-off" : "mic"} size={22}
              color={muted ? theme.onGold : theme.ink} />
          </TouchableOpacity>
          <Text style={s.ctrlLabel}>Mute</Text>
        </View>

        <View style={s.ctrlCol}>
          <TouchableOpacity style={s.hangUp} onPress={() => { haptic.medium(); hangUp(); }}>
            <Ionicons name="call" size={26} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          </TouchableOpacity>
          <Text style={[s.ctrlLabel, { color: theme.rose }]}>End</Text>
        </View>

        <View style={s.ctrlCol}>
          <TouchableOpacity style={[s.ctrl, speaker && s.ctrlOn]}
            onPress={() => { haptic.select(); const v = !speaker; setSpeaker(v); transport.setSpeaker(v); }}>
            <Ionicons name={speaker ? "volume-high" : "volume-low"} size={22}
              color={speaker ? theme.onGold : theme.ink} />
          </TouchableOpacity>
          <Text style={s.ctrlLabel}>Speaker</Text>
        </View>
      </View>
    </View>
  );
}

// Voice visualizer — a dark disc with aurora waveform bars over soft rings.
// The only "face" in a voice call (photos stay hidden here by design).
function CallVisualizer({ active }: { active: boolean }) {
  const bars = useRef([0.4, 0.7, 1, 0.6, 0.9, 0.5, 0.75].map((h) => new Animated.Value(h))).current;

  useEffect(() => {
    const loops = bars.map((b, i) =>
      Animated.loop(Animated.sequence([
        Animated.timing(b, { toValue: 1, duration: 380 + i * 80, delay: i * 60,
          easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(b, { toValue: 0.3, duration: 380 + i * 80,
          easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])));
    if (active) loops.forEach((l) => l.start());
    else bars.forEach((b) => b.setValue(0.32));
    return () => loops.forEach((l) => l.stop());
  }, [active, bars]);

  return (
    <View style={s.vizWrap}>
      <View style={[s.ring, s.ringOuter]} pointerEvents="none" />
      <View style={[s.ring, s.ringInner]} pointerEvents="none" />
      <View style={s.vizDisc}>
        <View style={s.bars}>
          {bars.map((b, i) => (
            <Animated.View key={i} style={[s.bar, { transform: [{ scaleY: b }] }]}>
              <LinearGradient colors={active ? ["#FFC48A", "#FF5E3A"] : ["#4A4550", "#3A3640"]}
                start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
          ))}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, overflow: "hidden", paddingHorizontal: 22 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 8 },
  onAir: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  onAirLive: { borderColor: "rgba(46,230,214,0.4)" },
  onAirDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.muted },
  onAirText: { color: theme.muted, fontSize: 11, fontFamily: theme.font.black, letterSpacing: 1.2 },
  simTag: { color: theme.gold, fontSize: 9, fontFamily: theme.font.black, letterSpacing: 1,
    borderWidth: 1, borderColor: theme.gold, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },

  centerArea: { alignItems: "center", marginTop: 30 },
  vizWrap: { width: 260, height: 260, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", borderRadius: 999, borderWidth: 1 },
  ringOuter: { width: 258, height: 258, borderColor: "rgba(255,122,46,0.10)" },
  ringInner: { width: 210, height: 210, borderColor: "rgba(255,122,46,0.18)" },
  vizDisc: { width: 172, height: 172, borderRadius: 86, backgroundColor: theme.card2,
    borderWidth: 1, borderColor: "rgba(255,177,139,0.35)", alignItems: "center", justifyContent: "center",
    ...theme.shadow.floating },
  bars: { flexDirection: "row", alignItems: "center", gap: 6, height: 84 },
  bar: { width: 7, height: 84, borderRadius: 4, overflow: "hidden", backgroundColor: theme.card },

  nameRow: { flexDirection: "row", alignItems: "center", marginTop: 22 },
  name: { color: theme.ink, fontSize: 30, fontFamily: theme.font.display, letterSpacing: -0.8 },
  connected: { color: theme.gold, fontSize: 12, fontFamily: theme.font.black, letterSpacing: 3,
    marginTop: 10 },
  timer: { color: theme.ink, fontSize: 26, fontFamily: theme.font.bold, marginTop: 8,
    fontVariant: ["tabular-nums"] },
  endingSoon: { color: theme.gold, fontSize: 12.5, fontFamily: theme.font.bold, marginTop: 4 },

  sharedCard: { backgroundColor: theme.card, borderRadius: theme.radii.lg, padding: 16, marginTop: 24,
    borderWidth: 1, borderColor: theme.line, ...theme.shadow.card },
  sharedLabel: { color: theme.gold, fontSize: 10, fontFamily: theme.font.black, letterSpacing: 1.3,
    marginBottom: 10 },
  sharedRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  sharedChip: { backgroundColor: theme.card2, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  sharedChipText: { color: theme.ink, fontSize: 12.5, fontFamily: theme.font.semibold },
  introBtn: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", marginTop: 18 },
  introText: { color: theme.gold, fontSize: 13.5, fontFamily: theme.font.bold },
  nearEndHint: { color: theme.gold, fontSize: 12.5, textAlign: "center", marginBottom: 18,
    paddingHorizontal: 30, lineHeight: 18 },

  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-around",
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: theme.radii.xl,
    paddingVertical: 18, paddingHorizontal: 10, ...theme.shadow.card },
  ctrlCol: { alignItems: "center", gap: 8 },
  ctrl: { width: 58, height: 58, borderRadius: 29, backgroundColor: theme.card2,
    borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center" },
  ctrlOn: { backgroundColor: theme.gold, borderColor: theme.gold },
  ctrlLabel: { color: theme.muted, fontSize: 12, fontFamily: theme.font.bold },
  hangUp: { width: 66, height: 66, borderRadius: 33, backgroundColor: theme.rose,
    alignItems: "center", justifyContent: "center",
    shadowColor: theme.rose, shadowOpacity: 0.5, shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 }, elevation: 10 },
});
