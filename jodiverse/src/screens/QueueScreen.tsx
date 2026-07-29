import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Animated, Easing,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import { INTEREST_GROUPS, withEmoji } from "../lib/interests";
import GlowBackdrop from "../components/GlowBackdrop";
import PressableScale from "../components/PressableScale";
import { haptic } from "../lib/haptics";
import { theme } from "../theme";

type Predicate = { label: string; matches: number };
const POLL_MS = 2500;      // matchmaker tick
const FALLBACK_AFTER = 30; // seconds before we stop making people wait
const WORDMARK = "Dosti Connect"; // TODO: swap when the final app name is locked

type CallStatus = { used: number; cap: number; remaining: number; subscribed: boolean };
type Pick = { id: string; name: string; age: number | null; city: string | null;
  shared_interests: string[]; reason: string; score: number };

// Voice discovery. Two taps to set tonight's intent, then a queue that
// narrates what it's looking for instead of showing a spinner.
export default function QueueScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [myInterests, setMyInterests] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [status, setStatus] = useState<CallStatus>({ used: 0, cap: 3, remaining: 3, subscribed: false });
  const [picks, setPicks] = useState<Pick[]>([]);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [preds, setPreds] = useState<Predicate[]>([]);
  const [waited, setWaited] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showTopics, setShowTopics] = useState(false); // topic picker is opt-in, not a form
  const [coins, setCoins] = useState<number | null>(null);
  const [initial, setInitial] = useState("");
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const fade = useRef(new Animated.Value(0)).current;
  const picksIn = useRef(new Animated.Value(0)).current;   // P2 section entrance
  const micPulse = useRef(new Animated.Value(1)).current;  // breathing hero mic

  // Hero mic breathes while idle — the app's signature motion.
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(micPulse, { toValue: 1.09, duration: 1500,
        easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(micPulse, { toValue: 1, duration: 1500,
        easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [micPulse]);

  const clearTimers = () => { timers.current.forEach(clearInterval); timers.current = []; };

  useFocusEffect(useCallback(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: prof }, { data: st }, { data: pk }, { data: bal }] = await Promise.all([
        supabase.from("profiles").select("interests, display_name").eq("id", user.id).maybeSingle(),
        supabase.rpc("my_call_status"),
        supabase.rpc("daily_picks"),
        supabase.rpc("my_coin_balance"),
      ]);
      const ints = prof?.interests ?? [];
      setMyInterests(ints);
      setPicked((p) => (p.length ? p : ints.slice(0, 3)));
      setInitial((prof?.display_name?.[0] ?? "").toUpperCase());
      setCoins(bal ?? 0);
      if (st) setStatus(st as CallStatus);
      if (pk && (pk as Pick[]).length) {
        setPicks(pk as Pick[]);
        // P4 · fade + rise the picks row in once it loads
        Animated.timing(picksIn, { toValue: 1, duration: 460,
          easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      }
    })();
    return () => { clearTimers(); };
  }, []));

  // Set the queue's interests to match a pick's shared vibe.
  const tuneToPick = (pk: Pick) => {
    if (pk.shared_interests?.length) setPicked(pk.shared_interests.slice(0, 5));
  };

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
  const outOfCalls = status.remaining <= 0 && !status.subscribed;
  return (
    <View style={s.wrap}>
      <GlowBackdrop />

      {/* top app bar — wordmark, coins, avatar */}
      <View style={[s.appBar, { paddingTop: insets.top + 8 }]}>
        <Text style={s.brand}>{WORDMARK}</Text>
        <View style={s.appBarRight}>
          <TouchableOpacity style={s.coinPill} onPress={() => nav.navigate("Coins")}>
            <Ionicons name="logo-bitcoin" size={15} color={theme.gold} />
            <Text style={s.coinText}>{coins == null ? "—" : coins.toLocaleString()}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.avatarBtn}
            onPress={() => nav.navigate("Tabs", { screen: "Profile" })}>
            <Text style={s.avatarInitial}>{initial || "?"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}>
        <Text style={s.h1}>Talk to someone new</Text>
        <Text style={s.h1sub}>No photos, no swiping — tap and we'll connect you in seconds.</Text>

        {/* HERO MIC — the signature interaction. Tap = join the voice queue. */}
        <View style={s.micWrap}>
          <View style={[s.ring, s.ringOuter]} pointerEvents="none" />
          <View style={[s.ring, s.ringInner]} pointerEvents="none" />
          <Animated.View pointerEvents="none"
            style={[s.micGlow, { transform: [{ scale: micPulse }] }]} />
          <PressableScale onPress={joinQueue} disabled={busy} haptics="medium">
            <Animated.View style={{ transform: [{ scale: micPulse }] }}>
              <LinearGradient colors={[...theme.grad]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
                style={s.mic}>
                <Ionicons name="mic" size={58} color="#fff" />
              </LinearGradient>
            </Animated.View>
          </PressableScale>
        </View>
        <Text style={s.micHint}>{busy ? "Connecting…" : "Tap to start talking"}</Text>

        {/* daily call count — talking is always free, this just shows today's tally */}
        <PressableScale onPress={() => !status.subscribed && nav.navigate("Paywall")}
          haptics={status.subscribed ? false : "light"} style={{ marginTop: 26 }}>
          <View style={[s.activityCard, outOfCalls && { borderColor: theme.danger }]}>
            <View style={s.activityIcon}>
              <Ionicons name="mic-circle" size={22} color={outOfCalls ? theme.danger : theme.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.activityTitle}>
                {status.subscribed
                  ? `${status.remaining} calls left today · unlimited plan`
                  : outOfCalls
                    ? "Out of free calls for today"
                    : `${status.remaining} of ${status.cap} free calls left today`}
              </Text>
              <Text style={s.activitySub}>
                {outOfCalls ? "Resets tomorrow — or go unlimited with Plus"
                  : "Talking is always free · 10 min max per call"}
              </Text>
            </View>
            {!status.subscribed && <Ionicons name="chevron-forward" size={18} color={theme.muted} />}
          </View>
        </PressableScale>

        {/* Today's picks — 2-col glass grid (metadata only, no photos) */}
        {picks.length > 0 && (
          <Animated.View style={{
            marginTop: 30, opacity: picksIn,
            transform: [{ translateY: picksIn.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }}>
            <Text style={s.picksTitle}>Today's picks</Text>
            <Text style={s.picksSub}>People we think you'll click with — tap one to tune your search.</Text>
            <View style={s.picksGrid}>
              {picks.slice(0, 4).map((pk) => (
                <PressableScale key={pk.id} style={s.pickCard} haptics="light" onPress={() => tuneToPick(pk)}>
                  <View style={s.pickRing}>
                    <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={s.pickRingGrad}>
                      <View style={s.pickAvatarInner}>
                        <Text style={s.pickInitial}>{pk.name?.[0]?.toUpperCase() ?? "?"}</Text>
                      </View>
                    </LinearGradient>
                    <View style={s.onlineDot} />
                  </View>
                  <Text style={s.pickName} numberOfLines={1}>
                    {pk.name}{pk.age ? `, ${pk.age}` : ""}
                  </Text>
                  <Text style={s.pickReason} numberOfLines={2}>{pk.reason}</Text>
                </PressableScale>
              ))}
            </View>
          </Animated.View>
        )}

        {/* Topics are OPTIONAL — collapsed so the screen never feels like a form.
            Empty = meet anyone; picking some just biases who we find. */}
        <TouchableOpacity style={s.refineRow} onPress={() => setShowTopics((v) => !v)} activeOpacity={0.7}>
          <Ionicons name="options-outline" size={16} color={theme.gold} />
          <Text style={s.refineText}>
            {picked.length
              ? `Looking for people into ${picked.length} topic${picked.length > 1 ? "s" : ""}`
              : "Want to talk about something specific? (optional)"}
          </Text>
          <Ionicons name={showTopics ? "chevron-up" : "chevron-down"} size={16} color={theme.muted} />
        </TouchableOpacity>
        {showTopics && (
          <View style={{ marginTop: 12 }}>
            <Text style={s.labelHint}>
              Pick up to 5 — we'll prefer people who share them. Leave it empty to meet anyone.
            </Text>
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
          </View>
        )}
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
    marginTop: 8, lineHeight: 38, textAlign: "center" },
  h1sub: { color: theme.muted, fontSize: 14.5, marginTop: 12, lineHeight: 21, textAlign: "center",
    alignSelf: "center", maxWidth: 300 },

  // top app bar
  appBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 22, paddingBottom: 12 },
  brand: { color: theme.gold, fontSize: 20, fontFamily: theme.font.displayMd, letterSpacing: -0.4 },
  appBarRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  coinPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, borderRadius: theme.radii.pill,
    paddingHorizontal: 12, paddingVertical: 7 },
  coinText: { color: theme.ink, fontSize: 12.5, fontFamily: theme.font.bold },
  avatarBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: theme.gold,
    alignItems: "center", justifyContent: "center", backgroundColor: theme.card2 },
  avatarInitial: { color: theme.ink, fontSize: 15, fontFamily: theme.font.black },

  // hero mic
  micWrap: { height: 258, alignItems: "center", justifyContent: "center", marginTop: 14 },
  ring: { position: "absolute", borderRadius: 999, borderWidth: 1 },
  ringOuter: { width: 240, height: 240, borderColor: "rgba(255,122,46,0.10)" },
  ringInner: { width: 186, height: 186, borderColor: "rgba(255,122,46,0.20)" },
  micGlow: { position: "absolute", width: 168, height: 168, borderRadius: 84,
    backgroundColor: "rgba(255,94,58,0.28)" },
  mic: { width: 152, height: 152, borderRadius: 76, alignItems: "center", justifyContent: "center",
    shadowColor: "#FF5E3A", shadowOpacity: 0.55, shadowRadius: 30, shadowOffset: { width: 0, height: 0 },
    elevation: 16 },
  micHint: { color: theme.muted, fontSize: 13.5, textAlign: "center", marginTop: 4,
    fontFamily: theme.font.semibold },

  // activity / status glass card
  activityCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, borderRadius: theme.radii.lg, padding: 14,
    ...theme.shadow.card },
  activityIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.goldSoft,
    alignItems: "center", justifyContent: "center" },
  activityTitle: { color: theme.ink, fontFamily: theme.font.bold, fontSize: 14 },
  activitySub: { color: theme.muted, fontSize: 12, marginTop: 3 },

  // today's picks
  picksTitle: { color: theme.ink, fontSize: 20, fontFamily: theme.font.displayMd, letterSpacing: -0.3 },
  picksSub: { color: theme.muted, fontSize: 12.5, marginTop: 4, marginBottom: 14, lineHeight: 17 },
  picksGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 },
  pickCard: { width: "47.5%", backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, padding: 14, alignItems: "center", ...theme.shadow.card },
  pickRing: { width: 64, height: 64, marginBottom: 8 },
  pickRingGrad: { width: 64, height: 64, borderRadius: 32, padding: 2, alignItems: "center",
    justifyContent: "center" },
  pickAvatarInner: { width: "100%", height: "100%", borderRadius: 30, backgroundColor: theme.card2,
    alignItems: "center", justifyContent: "center" },
  pickInitial: { color: theme.ink, fontFamily: theme.font.black, fontSize: 20 },
  onlineDot: { position: "absolute", bottom: 2, right: 2, width: 14, height: 14, borderRadius: 7,
    backgroundColor: "#22C55E", borderWidth: 2, borderColor: theme.card },
  pickName: { color: theme.ink, fontFamily: theme.font.bold, fontSize: 14, textAlign: "center" },
  pickReason: { color: theme.muted, fontSize: 11.5, lineHeight: 15.5, marginTop: 5, textAlign: "center" },
  label: { color: theme.ink, fontSize: 16, fontFamily: theme.font.bold, marginTop: 32 },
  labelHint: { color: theme.muted, fontSize: 12, marginTop: 3, marginBottom: 12 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card,
    paddingHorizontal: 15, paddingVertical: 10, borderRadius: theme.radii.pill },
  chipOn: { borderColor: theme.gold, backgroundColor: theme.goldSoft },
  chipText: { color: theme.muted, fontSize: 13, fontFamily: theme.font.semibold },
  chipTextOn: { color: theme.gold },
  editLink: { color: theme.muted, fontSize: 12.5, marginTop: 14, fontFamily: theme.font.semibold },
  refineRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 22,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: theme.radii.md,
    borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card },
  refineText: { color: theme.ink, fontSize: 13.5, fontFamily: theme.font.semibold, flex: 1 },
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
