import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Animated, Easing,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import { INTEREST_GROUPS, withEmoji } from "../lib/interests";
import GlowBackdrop from "../components/GlowBackdrop";
import GlassCard from "../components/GlassCard";
import PressableScale from "../components/PressableScale";
import { haptic } from "../lib/haptics";
import { theme } from "../theme";

type Predicate = { label: string; matches: number };
const POLL_MS = 2500;      // matchmaker tick
const FALLBACK_AFTER = 30; // seconds before we stop making people wait

type CallStatus = { used: number; cap: number; remaining: number; subscribed: boolean };

// Voice discovery. Two taps to set tonight's intent, then a queue that
// narrates what it's looking for instead of showing a spinner.
export default function QueueScreen() {
  const nav = useNavigation<any>();
  const [myInterests, setMyInterests] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [status, setStatus] = useState<CallStatus>({ used: 0, cap: 3, remaining: 3, subscribed: false });
  const [entryId, setEntryId] = useState<string | null>(null);
  const [preds, setPreds] = useState<Predicate[]>([]);
  const [waited, setWaited] = useState(0);
  const [busy, setBusy] = useState(false);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const fade = useRef(new Animated.Value(0)).current;

  const clearTimers = () => { timers.current.forEach(clearInterval); timers.current = []; };

  useFocusEffect(useCallback(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: prof }, { data: st }] = await Promise.all([
        supabase.from("profiles").select("interests").eq("id", user.id).maybeSingle(),
        supabase.rpc("my_call_status"),
      ]);
      const ints = prof?.interests ?? [];
      setMyInterests(ints);
      setPicked((p) => (p.length ? p : ints.slice(0, 3)));
      if (st) setStatus(st as CallStatus);
    })();
    return () => { clearTimers(); };
  }, []));

  // ── queue lifecycle ─────────────────────────────────────────────────────
  const joinQueue = async () => {
    if (status.remaining <= 0) {
      Alert.alert("Out of free calls for today",
        status.subscribed
          ? "You've hit today's fair-use limit — it resets in a few hours."
          : "Free members get 3 voice calls a day. Go unlimited with Plus, or come back tomorrow.",
        [{ text: "Later", style: "cancel" },
         ...(status.subscribed ? [] : [{ text: "See plans", onPress: () => nav.navigate("Paywall") }])]);
      return;
    }
    haptic.medium();
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(false); return; }

    // Clear any stale entry, then take a fresh one.
    await supabase.from("queue_entries").update({ state: "cancelled" })
      .eq("user_id", user.id).eq("state", "waiting");
    const { data, error } = await supabase.from("queue_entries")
      .insert({ user_id: user.id, interests: picked, max_minutes: 10 })
      .select("id").single();
    setBusy(false);
    if (error?.message?.includes("CALL_LIMIT_REACHED")) {
      Alert.alert("Out of free calls for today", "Go unlimited with Plus, or come back tomorrow.",
        [{ text: "Later", style: "cancel" },
         { text: "See plans", onPress: () => nav.navigate("Paywall") }]);
      return;
    }
    if (error || !data) { Alert.alert("Couldn't join", error?.message ?? "Try again."); return; }

    setEntryId(data.id);
    setWaited(0);
    Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    refreshPredicates();

    timers.current.push(setInterval(() => setWaited((w) => w + 1), 1000));
    timers.current.push(setInterval(() => tick(data.id), POLL_MS));
    timers.current.push(setInterval(refreshPredicates, 5000));
  };

  const refreshPredicates = async () => {
    const { data } = await supabase.rpc("queue_predicates", { want: picked });
    if (data) setPreds(data as Predicate[]);
  };

  // Each tick tries to pair us. try_match is atomic, so both sides are safe.
  const tick = async (id: string) => {
    const { data: callId } = await supabase.rpc("try_match", { p_entry: id });
    if (callId) { goToCall(callId as string, true); return; }
    // Someone else may have matched US — check our entry.
    const { data: entry } = await supabase.from("queue_entries")
      .select("state, call_id").eq("id", id).maybeSingle();
    if (entry?.state === "matched" && entry.call_id) goToCall(entry.call_id, false);
  };

  const goToCall = (callId: string, isCaller: boolean) => {
    haptic.success();
    clearTimers();
    setEntryId(null);
    nav.navigate("Call", { callId, isCaller });
  };

  const leaveQueue = async () => {
    clearTimers();
    if (entryId) {
      await supabase.from("queue_entries").update({ state: "cancelled" }).eq("id", entryId);
    }
    setEntryId(null);
    setPreds([]);
    fade.setValue(0);
  };

  const toggle = (label: string) =>
    setPicked((p) => p.includes(label) ? p.filter((x) => x !== label)
      : p.length >= 5 ? p : [...p, label]);

  // ── waiting view ────────────────────────────────────────────────────────
  if (entryId) {
    const showFallback = waited >= FALLBACK_AFTER;
    return (
      <View style={s.wrap}>
        <GlowBackdrop />
        <View style={s.searchTop}>
          <PulseOrb />
          <Text style={s.searchTitle}>Finding someone who…</Text>
          <Animated.View style={{ opacity: fade, width: "100%" }}>
            {preds.map((p) => (
              <View key={p.label} style={s.predRow}>
                <Ionicons name={p.matches > 0 ? "checkmark-circle" : "ellipse-outline"}
                  size={17} color={p.matches > 0 ? theme.emerald : theme.muted} />
                <Text style={[s.predLabel, p.matches === 0 && { color: theme.muted }]}>
                  {withEmoji(p.label)}
                </Text>
                <Text style={s.predCount}>{p.matches}</Text>
              </View>
            ))}
          </Animated.View>
          <Text style={s.waitTime}>
            {waited < 60 ? `${waited}s` : `${Math.floor(waited / 60)}m ${waited % 60}s`}
          </Text>
        </View>

        {showFallback && (
          <View style={s.fallback}>
            <Text style={s.fallbackTitle}>Quiet right now. Want to try something else?</Text>
            {[
              ["radio-outline", "Join a live lounge instead", () => {
                leaveQueue(); nav.navigate("Tabs", { screen: "Lounges" });
              }],
              ["notifications-outline", "Notify me when someone's free", () => {
                Alert.alert("We'll ping you", "You'll get a push as soon as a good match comes online.");
                leaveQueue();
              }],
              ["options-outline", "Widen my interests", () => leaveQueue()],
            ].map(([icon, label, fn]: any) => (
              <TouchableOpacity key={label} style={s.fallbackRow} onPress={fn}>
                <Ionicons name={icon} size={18} color={theme.gold} />
                <Text style={s.fallbackLabel}>{label}</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.muted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={{ flex: 1 }} />
        <TouchableOpacity style={s.cancelBtn} onPress={leaveQueue}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── intent view ─────────────────────────────────────────────────────────
  const suggested = myInterests.length ? myInterests : INTEREST_GROUPS[0].items.map((i) => i.label);
  return (
    <View style={s.wrap}>
      <GlowBackdrop />
      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 40 }}>
      <Text style={s.h1}>Talk to someone new</Text>
      <Text style={s.h1sub}>
        No photos, no swiping. Tap and you're instantly talking to someone —
        pick what you're in the mood for and we'll find a good match.
      </Text>

      {/* daily call count — talking is always free, this just shows today's tally */}
      <PressableScale onPress={() => !status.subscribed && nav.navigate("Paywall")}
        haptics={status.subscribed ? false : "light"} style={{ marginTop: 24 }}>
        <GlassCard style={[s.timeCard, status.remaining <= 0 && s.timeCardEmpty]}>
          <Ionicons name="mic-circle-outline" size={22}
            color={status.remaining <= 0 ? theme.danger : theme.gold} />
          <View style={{ flex: 1 }}>
            <Text style={s.timeVal}>
              {status.subscribed
                ? `${status.remaining} calls left today · unlimited plan`
                : status.remaining <= 0
                  ? "Out of free calls for today"
                  : `${status.remaining} of ${status.cap} free calls left today`}
            </Text>
            <Text style={s.timeSub}>
              {status.remaining <= 0 ? "Resets tomorrow — or go unlimited with Plus"
                : "Talking is always free · resets daily · 10 min max per call"}
            </Text>
          </View>
          {!status.subscribed && <Text style={s.timeAdd}>Plus →</Text>}
        </GlassCard>
      </PressableScale>

      <Text style={s.label}>I want to talk about</Text>
      <Text style={s.labelHint}>{picked.length}/5 picked</Text>
      <View style={s.chipWrap}>
        {suggested.map((i) => (
          <TouchableOpacity key={i} onPress={() => toggle(i)}
            style={[s.chip, picked.includes(i) && s.chipOn]}>
            <Text style={[s.chipText, picked.includes(i) && s.chipTextOn]}>{withEmoji(i)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity onPress={() => nav.navigate("Tabs", { screen: "Profile" })}>
        <Text style={s.editLink}>Edit my interests →</Text>
      </TouchableOpacity>

      <PressableScale onPress={joinQueue} disabled={busy || picked.length === 0}
        haptics={false} style={{ marginTop: 34 }}>
        <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={s.cta}>
          <Ionicons name="mic" size={19} color={theme.onGold} />
          <Text style={s.ctaText}>
            {status.remaining <= 0 && !status.subscribed ? "See Plus to keep talking" : "Start talking"}
          </Text>
        </LinearGradient>
      </PressableScale>
      <Text style={s.quota}>You'll be connected instantly · calls cap at 10 minutes</Text>
      </ScrollView>
    </View>
  );
}

// Breathing orb while searching.
function PulseOrb() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, {
      toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
    }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  return (
    <View style={s.orbWrap}>
      <Animated.View style={[s.orbPulse, { transform: [{ scale }], opacity }]} />
      <LinearGradient colors={[...theme.grad]} style={s.orbCore}>
        <Ionicons name="mic" size={26} color={theme.onGold} />
      </LinearGradient>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, overflow: "hidden" },
  h1: { color: theme.ink, fontSize: 32, fontFamily: theme.font.display, letterSpacing: -1,
    marginTop: 44, lineHeight: 38 },
  h1sub: { color: theme.muted, fontSize: 14.5, marginTop: 12, lineHeight: 21 },
  timeCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  timeCardEmpty: { borderColor: theme.danger },
  timeVal: { color: theme.ink, fontFamily: theme.font.bold, fontSize: 15 },
  timeSub: { color: theme.muted, fontSize: 12, marginTop: 3 },
  timeAdd: { color: theme.gold, fontFamily: theme.font.black, fontSize: 13 },
  label: { color: theme.ink, fontSize: 16, fontFamily: theme.font.bold, marginTop: 32 },
  labelHint: { color: theme.muted, fontSize: 12, marginTop: 3, marginBottom: 12 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card,
    paddingHorizontal: 15, paddingVertical: 10, borderRadius: theme.radii.pill },
  chipOn: { borderColor: theme.gold, backgroundColor: theme.goldSoft },
  chipText: { color: theme.muted, fontSize: 13, fontFamily: theme.font.semibold },
  chipTextOn: { color: theme.gold },
  editLink: { color: theme.muted, fontSize: 12.5, marginTop: 14, fontFamily: theme.font.semibold },
  cta: { borderRadius: theme.radii.pill, paddingVertical: 18, alignItems: "center", flexDirection: "row",
    justifyContent: "center", gap: 9, ...theme.shadow.cta },
  ctaText: { color: theme.onGold, fontFamily: theme.font.black, fontSize: 16.5, letterSpacing: 0.2 },
  quota: { color: theme.muted, fontSize: 12, textAlign: "center", marginTop: 16 },

  // searching
  searchTop: { alignItems: "center", paddingHorizontal: 26, paddingTop: 80 },
  orbWrap: { alignItems: "center", justifyContent: "center", height: 96, marginBottom: 10 },
  orbCore: { width: 68, height: 68, borderRadius: 34, alignItems: "center",
    justifyContent: "center", ...theme.shadow.cta },
  orbPulse: { position: "absolute", width: 68, height: 68, borderRadius: 34,
    backgroundColor: theme.gold },
  searchTitle: { color: theme.ink, fontSize: 22, fontFamily: theme.font.displayMd, marginBottom: 20,
    letterSpacing: -0.5 },
  predRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  predLabel: { color: theme.ink, fontSize: 15, flex: 1 },
  predCount: { color: theme.muted, fontSize: 13, fontFamily: theme.font.bold,
    fontVariant: ["tabular-nums"] },
  waitTime: { color: theme.muted, fontSize: 13, marginTop: 20,
    fontVariant: ["tabular-nums"] },
  fallback: { margin: 22, backgroundColor: theme.card, borderRadius: theme.radii.lg, padding: 18,
    borderWidth: 1, borderColor: theme.line, ...theme.shadow.card },
  fallbackTitle: { color: theme.ink, fontSize: 14.5, fontFamily: theme.font.bold, marginBottom: 10 },
  fallbackRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
  fallbackLabel: { color: theme.ink, fontSize: 14, flex: 1 },
  cancelBtn: { alignItems: "center", padding: 18, marginBottom: 20 },
  cancelText: { color: theme.muted, fontFamily: theme.font.bold, fontSize: 15 },
});
