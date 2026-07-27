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

  return (
    <View style={[s.wrap, { paddingTop: 24 + insets.top, paddingBottom: 12 + insets.bottom }]}>
      <GlowBackdrop />
      {/* status line */}
      <View style={s.statusRow}>
        <View style={[s.dot, state === "active" && { backgroundColor: theme.emerald }]} />
        <Text style={s.status}>
          {state === "connecting" ? "Connecting…"
            : state === "ringing" ? "Waiting for them to join…"
            : state === "active" ? "Live" : "Call ended"}
        </Text>
        {VOICE_MODE === "simulated" && <Text style={s.simTag}>SIMULATED AUDIO</Text>}
      </View>

      {/* speaking orb */}
      <View style={s.orbArea}>
        <SpeakingOrb level={state === "active" ? level : 0} active={state === "active"} />
        {them ? (
          <>
            <View style={s.nameRow}>
              <Text style={s.name}>{them.name}</Text>
              <Text style={s.age}>, {them.age}</Text>
              {them.verified && (
                <Ionicons name="shield-checkmark" size={19} color={theme.info}
                  style={{ marginLeft: 6 }} />
              )}
            </View>
            {them.city ? <Text style={s.city}>{them.city}</Text> : null}
            <Text style={s.timer}>{mm}:{ss}</Text>
            {nearEnd && (
              <Text style={s.endingSoon}>{remaining}s left</Text>
            )}
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
      {introUrl && state !== "active" && (
        <TouchableOpacity style={s.introBtn}
          onPress={() => { introPlayer.seekTo(0); introPlayer.play(); }}>
          <Ionicons name="play-circle" size={20} color={theme.gold} />
          <Text style={s.introText}>Hear their intro while you wait</Text>
        </TouchableOpacity>
      )}

      <View style={{ flex: 1 }} />

      {/* becoming friends is how you keep talking past 10 min */}
      {state === "active" && nearEnd && (
        <Text style={s.nearEndHint}>
          Enjoying this? Say "yes" after the call to become friends and chat anytime.
        </Text>
      )}

      {/* controls */}
      <View style={s.controls}>
        <TouchableOpacity style={[s.ctrl, muted && s.ctrlOn]}
          onPress={() => { const m = !muted; setMuted(m); transport.setMuted(m); }}>
          <Ionicons name={muted ? "mic-off" : "mic"} size={23}
            color={muted ? theme.onGold : theme.ink} />
        </TouchableOpacity>

        <TouchableOpacity style={s.hangUp} onPress={hangUp}>
          <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
        </TouchableOpacity>

        <TouchableOpacity style={[s.ctrl, speaker && s.ctrlOn]}
          onPress={() => { const v = !speaker; setSpeaker(v); transport.setSpeaker(v); }}>
          <Ionicons name={speaker ? "volume-high" : "volume-low"} size={23}
            color={speaker ? theme.onGold : theme.ink} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={report} style={s.reportBtn}>
        <Ionicons name="flag-outline" size={14} color={theme.muted} />
        <Text style={s.reportText}>Report</Text>
      </TouchableOpacity>
    </View>
  );
}

// Audio-reactive orb — the only "face" in a voice call.
function SpeakingOrb({ level, active }: { level: number; active: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  const idle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(v, { toValue: level, duration: 200,
      easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, [level, v]);

  useEffect(() => {
    if (active) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(idle, { toValue: 1, duration: 1400, useNativeDriver: true }),
      Animated.timing(idle, { toValue: 0, duration: 1400, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, idle]);

  const scale = active
    ? v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.32] })
    : idle.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const glow = active
    ? v.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.5] })
    : idle.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.25] });

  return (
    <View style={s.orbWrap}>
      <Animated.View style={[s.orbGlow,
        { transform: [{ scale }], opacity: glow,
          backgroundColor: active ? theme.emerald : theme.gold }]} />
      <LinearGradient colors={active ? [...theme.gradLive] : [...theme.grad]} style={s.orb}>
        <Ionicons name="mic" size={34} color={theme.onGold} />
      </LinearGradient>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, overflow: "hidden", paddingHorizontal: 22 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.muted },
  status: { color: theme.muted, fontSize: 13, fontFamily: theme.font.semibold },
  simTag: { color: theme.gold, fontSize: 9, fontFamily: theme.font.black, letterSpacing: 1,
    borderWidth: 1, borderColor: theme.gold, borderRadius: 4, paddingHorizontal: 5,
    paddingVertical: 1 },
  orbArea: { alignItems: "center", marginTop: 34 },
  orbWrap: { alignItems: "center", justifyContent: "center", height: 168, width: 168 },
  orb: { width: 108, height: 108, borderRadius: 54, alignItems: "center",
    justifyContent: "center", ...theme.shadow.cta },
  orbGlow: { position: "absolute", width: 152, height: 152, borderRadius: 76 },
  nameRow: { flexDirection: "row", alignItems: "center", marginTop: 14 },
  name: { color: theme.ink, fontSize: 30, fontFamily: theme.font.display, letterSpacing: -0.8 },
  age: { color: theme.muted, fontSize: 22, fontFamily: theme.font.medium },
  city: { color: theme.muted, fontSize: 14, marginTop: 4 },
  timer: { color: theme.ink, fontSize: 18, fontFamily: theme.font.bold, marginTop: 16,
    fontVariant: ["tabular-nums"] },
  endingSoon: { color: theme.gold, fontSize: 12.5, fontFamily: theme.font.bold, marginTop: 4 },
  sharedCard: { backgroundColor: theme.card, borderRadius: theme.radii.lg, padding: 16, marginTop: 26,
    borderWidth: 1, borderColor: theme.line, ...theme.shadow.card },
  sharedLabel: { color: theme.gold, fontSize: 10, fontFamily: theme.font.black, letterSpacing: 1.3,
    marginBottom: 10 },
  sharedRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  sharedChip: { backgroundColor: theme.card2, borderRadius: 999, paddingHorizontal: 12,
    paddingVertical: 6 },
  sharedChipText: { color: theme.ink, fontSize: 12.5, fontFamily: theme.font.semibold },
  introBtn: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center",
    marginTop: 18 },
  introText: { color: theme.gold, fontSize: 13.5, fontFamily: theme.font.bold },
  nearEndHint: { color: theme.gold, fontSize: 12.5, textAlign: "center", marginBottom: 18,
    paddingHorizontal: 30, lineHeight: 18 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 26 },
  ctrl: { width: 58, height: 58, borderRadius: 29, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center",
    ...theme.shadow.card },
  ctrlOn: { backgroundColor: theme.gold, borderColor: theme.gold },
  hangUp: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.danger,
    alignItems: "center", justifyContent: "center",
    shadowColor: theme.danger, shadowOpacity: 0.5, shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  reportBtn: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "center",
    marginTop: 20, padding: 8 },
  reportText: { color: theme.muted, fontSize: 12.5, fontFamily: theme.font.semibold },
});
