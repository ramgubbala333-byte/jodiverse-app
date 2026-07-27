import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Switch, Modal, TextInput, PanResponder } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

// pref_distance = geohash prefix length: longer prefix ⇒ tighter radius
const DISTANCES = [[6, "Nearby"], [5, "~5 km"], [4, "~20 km"], [3, "~80 km"], [0, "Any"]] as const;

// ── sliders (no external deps: PanResponder thumbs over a plain track) ─────
const AGE_LO = 18, AGE_HI = 99, THUMB = 26;
const HIT = { top: 14, bottom: 14, left: 14, right: 14 };

// Dual-thumb age range slider. Live-updates while dragging, commits to the
// DB once on release so we don't spam profile updates.
function AgeRangeSlider({ lo, hi, onCommit }: {
  lo: number; hi: number; onCommit: (lo: number, hi: number) => void;
}) {
  const [w, setW] = useState(0);
  const [v, setV] = useState({ lo, hi });
  const ref = useRef({ w: 0, v: { lo, hi }, start: 0, commit: onCommit });
  ref.current.w = w; ref.current.v = v; ref.current.commit = onCommit;
  useEffect(() => { setV({ lo, hi }); }, [lo, hi]);

  const trackW = Math.max(1, w - THUMB);
  const x = (age: number) => ((age - AGE_LO) / (AGE_HI - AGE_LO)) * trackW;

  const mkPan = (which: "lo" | "hi") => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { ref.current.start = ref.current.v[which]; },
    onPanResponderMove: (_e, g) => {
      const { w, v, start } = ref.current;
      if (w <= THUMB) return;
      const raw = start + (g.dx / (w - THUMB)) * (AGE_HI - AGE_LO);
      const age = Math.round(Math.min(AGE_HI, Math.max(AGE_LO, raw)));
      setV(which === "lo"
        ? { lo: Math.min(age, v.hi - 1), hi: v.hi }
        : { lo: v.lo, hi: Math.max(age, v.lo + 1) });
    },
    onPanResponderRelease: () => ref.current.commit(ref.current.v.lo, ref.current.v.hi),
    onPanResponderTerminate: () => ref.current.commit(ref.current.v.lo, ref.current.v.hi),
  });
  const loPan = useRef(mkPan("lo")).current;
  const hiPan = useRef(mkPan("hi")).current;

  return (
    <View>
      <View style={s.sliderHead}>
        <Text style={s.prefLabel}>Age range</Text>
        <Text style={s.sliderVal}>{v.lo} – {v.hi}</Text>
      </View>
      <View style={s.sliderWrap} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <View style={s.track} />
        {w > 0 && <>
          <View style={[s.trackFill, { left: THUMB / 2 + x(v.lo), width: x(v.hi) - x(v.lo) }]} />
          <View style={[s.thumb, { left: x(v.lo) }]} {...loPan.panHandlers} hitSlop={HIT} />
          <View style={[s.thumb, { left: x(v.hi) }]} {...hiPan.panHandlers} hitSlop={HIT} />
        </>}
      </View>
    </View>
  );
}

// Single-thumb slider that snaps to a fixed list of options (e.g. distance).
function SnapSlider({ label, options, value, onCommit }: {
  label: string;
  options: readonly (readonly [number, string])[];
  value: number;
  onCommit: (v: number) => void;
}) {
  const [w, setW] = useState(0);
  const [idx, setIdx] = useState(() => Math.max(0, options.findIndex(([ov]) => ov === value)));
  const ref = useRef({ w: 0, idx, start: 0, commit: onCommit });
  ref.current.w = w; ref.current.idx = idx; ref.current.commit = onCommit;
  useEffect(() => {
    const i = options.findIndex(([ov]) => ov === value);
    if (i >= 0) setIdx(i);
  }, [value]);

  const n = options.length - 1;
  const trackW = Math.max(1, w - THUMB);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { ref.current.start = ref.current.idx; },
    onPanResponderMove: (_e, g) => {
      const { w, start } = ref.current;
      if (w <= THUMB) return;
      const raw = start + (g.dx / (w - THUMB)) * n;
      setIdx(Math.round(Math.min(n, Math.max(0, raw))));
    },
    onPanResponderRelease: () => ref.current.commit(options[ref.current.idx][0]),
    onPanResponderTerminate: () => ref.current.commit(options[ref.current.idx][0]),
  })).current;

  return (
    <View>
      <View style={s.sliderHead}>
        <Text style={s.prefLabel}>{label}</Text>
        <Text style={s.sliderVal}>{options[idx][1]}</Text>
      </View>
      <View style={s.sliderWrap} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <View style={s.track} />
        {w > 0 && <>
          <View style={[s.trackFill, { left: THUMB / 2, width: (idx / n) * trackW }]} />
          {options.map((_, i) => (
            <View key={i} style={[s.tick, { left: THUMB / 2 + (i / n) * trackW - 2 }]} />
          ))}
          <View style={[s.thumb, { left: (idx / n) * trackW }]} {...pan.panHandlers} hitSlop={HIT} />
        </>}
      </View>
    </View>
  );
}

// ── Hinge-style building blocks: flat list, section headers, hairline rows ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function LinkRow({ title, sub, value, onPress, badge }: {
  title: string; sub?: string; value?: string; onPress?: () => void; badge?: boolean;
}) {
  return (
    <TouchableOpacity style={s.row} onPress={onPress} disabled={!onPress}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={s.rowTitle}>{title}</Text>
          {badge && <Ionicons name="shield-checkmark" size={16} color={theme.gold} />}
        </View>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      {value ? <Text style={s.rowValue}>{value}</Text> : null}
      {onPress && <Ionicons name="chevron-forward" size={18} color={theme.muted} />}
    </TouchableOpacity>
  );
}

function ToggleRow({ title, sub, value, onChange }: {
  title: string; sub?: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange}
        trackColor={{ true: theme.gold, false: theme.line }} thumbColor={theme.ink} />
    </View>
  );
}

export default function SettingsScreen() {
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(99);
  const [dist, setDist] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showActive, setShowActive] = useState(true);
  const [verified, setVerified] = useState(false);
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setEmail(user?.email ?? "");
      if (user) {
        setUid(user.id);
        const [{ data: sub }, { data: prof }] = await Promise.all([
          supabase.from("subscriptions").select("tier, expires_at").eq("user_id", user.id)
            .gt("expires_at", new Date().toISOString()).maybeSingle(),
          // select * tolerates columns that predate the latest migration
          supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        ]);
        setTier(sub?.tier ?? null);
        if (prof) {
          setAgeMin(prof.pref_age_min ?? 18);
          setAgeMax(prof.pref_age_max ?? 99);
          setDist(prof.pref_distance ?? 0);
          setPaused(!!prof.paused);
          setShowActive(prof.show_last_active ?? true);
          setVerified(!!prof.is_verified);
        }
      }
    })();
  }, []);

  const savePref = (patch: Record<string, unknown>) => {
    if (uid) supabase.from("profiles").update(patch).eq("id", uid).then(() => {});
  };

  const [rateOpen, setRateOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const [rateText, setRateText] = useState("");
  const [rateBusy, setRateBusy] = useState(false);

  const submitRating = async () => {
    setRateBusy(true);
    const { data: won, error } = await supabase.rpc("submit_feedback",
      { r: stars, c: rateText.trim() || null });
    setRateBusy(false);
    setRateOpen(false); setStars(0); setRateText("");
    if (error) { Alert.alert("Couldn't send", error.message); return; }
    Alert.alert(
      won ? "⚡ You won a free Boost!" : "Thank you! 💜",
      won ? "Your feedback earned you a Boost — use it from the deck."
          : "Your feedback helps us build a better Dosti Connect.");
  };

  const stub = (title: string, body: string) => () => Alert.alert(title, body);

  const deleteAccount = () => {
    Alert.alert("Delete account?",
      "This permanently removes your profile, photos, matches and messages. This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete forever", style: "destructive", onPress: async () => {
        setDeleting(true);
        const { data, error } = await supabase.functions.invoke("delete-account");
        setDeleting(false);
        if (error || !data?.ok) {
          Alert.alert("Couldn't delete", error?.message ?? data?.reason ?? "Try again later.");
        } else {
          await supabase.auth.signOut();
        }
      }},
    ]);
  };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
      <Section title="Profile">
        <ToggleRow title="Pause"
          sub="Pausing prevents your profile from being shown to new people. You can still chat with your current matches."
          value={paused} onChange={(v) => { setPaused(v); savePref({ paused: v }); }} />
        <ToggleRow title="Show Last Active Status"
          sub="When off, no one can see when you were last active on Dosti Connect."
          value={showActive} onChange={(v) => { setShowActive(v); savePref({ show_last_active: v }); }} />
      </Section>

      <Section title="Dating preferences">
        <View style={s.prefBlock}>
          <AgeRangeSlider lo={ageMin} hi={ageMax}
            onCommit={(lo, hi) => {
              setAgeMin(lo); setAgeMax(hi);
              savePref({ pref_age_min: lo, pref_age_max: hi });
            }} />
          <SnapSlider label="Maximum distance" options={DISTANCES} value={dist}
            onCommit={(v) => { setDist(v); savePref({ pref_distance: v }); }} />
        </View>
      </Section>

      <Section title="Safety">
        <LinkRow title="Call & safety"
          sub="Who can call you, availability hours, Do Not Disturb, languages."
          onPress={() => nav.navigate("CallSettings")} />
        <LinkRow title="Selfie Verification" badge={verified}
          sub={verified ? "You're verified." : "Take a quick selfie — verified profiles get more calls."}
          onPress={() => nav.navigate("Verify")} />
        <LinkRow title="Block List"
          sub="Blocked people won't see you and you won't see them on Dosti Connect."
          onPress={stub("Block List", "Block anyone from their profile or chat. A full management list arrives before launch.")} />
      </Section>

      <Section title="Phone & email">
        <LinkRow title={email || "No email on file"} sub="Sign-in email · verified" />
      </Section>

      <Section title="Notifications">
        <LinkRow title="Push Notifications"
          onPress={stub("Push Notifications", "Notification preferences arrive with the full app release.")} />
      </Section>

      <Section title="Subscription">
        <LinkRow title={tier ? `Dosti Connect ${tier[0].toUpperCase()}${tier.slice(1)}` : "Subscribe to Dosti Connect"}
          sub={tier ? "Your plan is active." : "You are not currently subscribed."}
          onPress={() => nav.navigate("Paywall")} />
        <LinkRow title="Restore subscription"
          onPress={stub("Restore purchases", "Available once payments launch with RevenueCat.")} />
      </Section>

      <Section title="Privacy">
        <LinkRow title="Location"
          sub="Dosti Connect never stores your exact position — only a ~1 km area. Distance always shows as a range."
          onPress={stub("Location privacy",
            "Your location is stored only as a ~1 km cell, and other people only ever see a distance band like 'Within ~5 km'.")} />
      </Section>

      <Section title="Legal">
        <LinkRow title="Privacy Policy"
          onPress={stub("Privacy policy", "Being finalised with counsel before launch.")} />
        <LinkRow title="Terms of Service"
          onPress={stub("Terms of service", "Being finalised with counsel before launch.")} />
        <LinkRow title="Download My Data"
          onPress={stub("Download My Data", "A full data export arrives before launch — required and important.")} />
      </Section>

      <Section title="Community">
        <LinkRow title="Safe Dating Tips"
          onPress={stub("Safe Dating Tips",
            "Meet in public places. Tell a friend where you're going. Never send money — report anyone who asks. Video-chat before meeting.")} />
        <LinkRow title="Member Principles"
          onPress={stub("Member Principles",
            "Be yourself — real photos, real age. Respect is non-negotiable. One report can end an account.")} />
        <LinkRow title="Rate Dosti Connect" value="Win a Boost ⚡" onPress={() => setRateOpen(true)} />
      </Section>

      {/* centered account actions, Hinge-style */}
      <TouchableOpacity style={s.centerRow} onPress={() => supabase.auth.signOut()}>
        <Text style={s.centerText}>Log Out</Text>
      </TouchableOpacity>
      {deleting ? (
        <View style={s.centerRow}><ActivityIndicator color={theme.danger} /></View>
      ) : (
        <TouchableOpacity style={s.centerRow} onPress={deleteAccount}>
          <Text style={[s.centerText, { color: theme.danger }]}>Delete Account</Text>
        </TouchableOpacity>
      )}

      <Text style={s.version}>0.1.0 · Made for South Asians Worldwide</Text>

      {/* rate modal — rewards feedback itself, never the score (store policy) */}
      <Modal visible={rateOpen} transparent animationType="fade"
        onRequestClose={() => setRateOpen(false)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>How's Dosti Connect so far?</Text>
            <View style={s.starRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => setStars(n)}>
                  <Ionicons name={n <= stars ? "star" : "star-outline"} size={34}
                    color={n <= stars ? theme.gold : theme.muted} />
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={s.modalInput} value={rateText} onChangeText={setRateText}
              placeholder="Anything we should fix or build? (optional)"
              placeholderTextColor={theme.muted} multiline maxLength={1000} />
            <Text style={s.modalHint}>
              Every piece of feedback has a chance to win a free Boost — whatever you rate us.
            </Text>
            <View style={s.modalRow}>
              <TouchableOpacity style={s.modalGhost} onPress={() => setRateOpen(false)}>
                <Text style={{ color: theme.muted, fontWeight: "700" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1 }} disabled={!stars || rateBusy} onPress={submitRating}>
                <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={[s.modalSend, { opacity: stars && !rateBusy ? 1 : 0.4 }]}>
                  {rateBusy ? <ActivityIndicator color="#fff" /> :
                    <Text style={{ color: "#fff", fontWeight: "800" }}>Send feedback</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  section: { marginTop: 10 },
  sectionTitle: { color: theme.gold, fontSize: 11, fontFamily: theme.font.black,
    letterSpacing: 1.2, textTransform: "uppercase",
    paddingHorizontal: 20, paddingTop: 22, paddingBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  rowTitle: { color: theme.ink, fontSize: 16, fontFamily: theme.font.semibold },
  rowSub: { color: theme.muted, fontSize: 13, marginTop: 4, lineHeight: 19 },
  rowValue: { color: theme.muted, fontSize: 13 },
  centerRow: { paddingVertical: 18, alignItems: "center", marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  centerText: { color: theme.ink, fontSize: 16, fontFamily: theme.font.semibold },
  version: { color: theme.muted, fontSize: 12, textAlign: "center", marginTop: 28 },
  prefBlock: { paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  prefLabel: { color: theme.ink, fontSize: 14, fontFamily: theme.font.semibold, marginTop: 14, marginBottom: 8 },
  sliderHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  sliderVal: { color: theme.gold, fontSize: 14, fontFamily: theme.font.black, marginBottom: 8 },
  sliderWrap: { height: 44, justifyContent: "center" },
  track: { position: "absolute", left: THUMB / 2, right: THUMB / 2, height: 4,
    borderRadius: 2, backgroundColor: theme.line },
  trackFill: { position: "absolute", height: 4, borderRadius: 2, backgroundColor: theme.gold },
  tick: { position: "absolute", width: 4, height: 4, borderRadius: 2, backgroundColor: theme.muted },
  thumb: { position: "absolute", width: THUMB, height: THUMB, borderRadius: THUMB / 2,
    backgroundColor: theme.ink, borderWidth: 2, borderColor: theme.gold,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,.6)", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: theme.card, borderRadius: theme.radii.xl, padding: 20,
    borderWidth: 1, borderColor: theme.line, ...theme.shadow.floating },
  modalTitle: { color: theme.ink, fontSize: 19, fontFamily: theme.font.displayMd, textAlign: "center" },
  starRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginVertical: 16 },
  modalInput: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, padding: 12, color: theme.ink, minHeight: 64, textAlignVertical: "top" },
  modalHint: { color: theme.muted, fontSize: 11, marginTop: 10, textAlign: "center", lineHeight: 16 },
  modalRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  modalGhost: { paddingHorizontal: 14, paddingVertical: 12 },
  modalSend: { borderRadius: 999, padding: 14, alignItems: "center", ...theme.shadow.cta },
});
