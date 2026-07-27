import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, ActivityIndicator, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

const WHO = [
  ["anyone", "Anyone", "Fastest matching — anyone in the queue can connect with you"],
  ["verified_only", "Verified only", "Only people who've passed selfie verification"],
  ["matches_only", "Matches only", "No new voice calls — only people you've already matched with"],
] as const;

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const LANGS = ["Hindi", "Telugu", "Tamil", "Punjabi", "Bengali", "Marathi",
  "Gujarati", "Kannada", "Malayalam", "Urdu", "English"];

const hLabel = (h: number) => {
  const ap = h < 12 ? "AM" : "PM"; const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ap}`;
};

// Safety & availability controls — all free, never paywalled. Availability
// matters far more for voice than swiping: nobody should get a call at 2am.
export default function CallSettingsScreen() {
  const insets = useSafeAreaInsets();
  const [uid, setUid] = useState<string | null>(null);
  const [who, setWho] = useState("anyone");
  const [fromH, setFromH] = useState(8);
  const [toH, setToH] = useState(23);
  const [dnd, setDnd] = useState(false);
  const [langs, setLangs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUid(user.id);
      const [{ data: cp }, { data: prof }] = await Promise.all([
        supabase.from("call_preferences").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("profiles").select("languages").eq("id", user.id).maybeSingle(),
      ]);
      if (cp) {
        setWho(cp.who_can_call ?? "anyone");
        setFromH(parseInt((cp.available_from ?? "08:00").slice(0, 2), 10));
        setToH(parseInt((cp.available_to ?? "23:00").slice(0, 2), 10));
        setDnd(!!cp.dnd_until && new Date(cp.dnd_until) > new Date());
      }
      setLangs(prof?.languages ?? []);
      setLoading(false);
    })();
  }, []);

  // Debounced-ish save: persist on every change (cheap upsert).
  const persist = async (patch: Record<string, unknown>, langsNext?: string[]) => {
    if (!uid) return;
    await supabase.from("call_preferences").upsert({
      user_id: uid,
      who_can_call: patch.who ?? who,
      available_from: `${String(patch.fromH ?? fromH).padStart(2, "0")}:00`,
      available_to: `${String(patch.toH ?? toH).padStart(2, "0")}:59`,
      dnd_until: (patch.dnd ?? dnd)
        ? new Date(Date.now() + 8 * 3600 * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    });
    if (langsNext) {
      await supabase.from("profiles").update({ languages: langsNext }).eq("id", uid);
    }
    setSavedAt(Date.now());
  };

  const toggleLang = (l: string) => {
    const next = langs.includes(l) ? langs.filter((x) => x !== l) : [...langs, l];
    setLangs(next); persist({}, next);
  };

  if (loading) {
    return <View style={[s.wrap, s.center]}><ActivityIndicator color={theme.gold} /></View>;
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 22, paddingBottom: 40 + insets.bottom }}>
      <Text style={s.note}>
        <Ionicons name="shield-checkmark" size={13} color={theme.emerald} /> Safety controls
        are free, always. Blocking, reporting and muting live inside every call.
      </Text>

      {/* who can call */}
      <Text style={s.section}>Who can call me</Text>
      {WHO.map(([v, label, desc]) => (
        <TouchableOpacity key={v} style={[s.optRow, who === v && s.optOn]}
          onPress={() => { setWho(v); persist({ who: v }); }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.optLabel, who === v && { color: theme.gold }]}>{label}</Text>
            <Text style={s.optDesc}>{desc}</Text>
          </View>
          <Ionicons name={who === v ? "radio-button-on" : "radio-button-off"}
            size={20} color={who === v ? theme.gold : theme.muted} />
        </TouchableOpacity>
      ))}

      {/* availability window */}
      <Text style={s.section}>When I'm available</Text>
      <View style={s.card}>
        <TimeRow label="From" value={fromH}
          onChange={(h) => { setFromH(h); persist({ fromH: h }); }} />
        <View style={s.hair} />
        <TimeRow label="Until" value={toH}
          onChange={(h) => { setToH(h); persist({ toH: h }); }} />
      </View>
      <Text style={s.hint}>No calls will reach you outside these hours.</Text>

      {/* DND */}
      <View style={[s.card, s.dndRow]}>
        <View style={{ flex: 1 }}>
          <Text style={s.optLabel}>Do Not Disturb</Text>
          <Text style={s.optDesc}>Pause all incoming calls for 8 hours</Text>
        </View>
        <Switch value={dnd} onValueChange={(v) => { setDnd(v); persist({ dnd: v }); }}
          trackColor={{ true: theme.gold, false: theme.line }} thumbColor={theme.ink} />
      </View>

      {/* languages */}
      <Text style={s.section}>Languages I speak</Text>
      <Text style={s.hint}>We surface people who share a language with you.</Text>
      <View style={s.chipWrap}>
        {LANGS.map((l) => (
          <TouchableOpacity key={l} onPress={() => toggleLang(l)}
            style={[s.chip, langs.includes(l) && s.chipOn]}>
            <Text style={[s.chipText, langs.includes(l) && s.chipTextOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {savedAt > 0 && (
        <Text style={s.saved}>
          <Ionicons name="checkmark-circle" size={13} color={theme.emerald} /> Saved
        </Text>
      )}
    </ScrollView>
  );
}

function TimeRow({ label, value, onChange }:
  { label: string; value: number; onChange: (h: number) => void }) {
  return (
    <View style={s.timeRow}>
      <Text style={s.timeLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
        {HOURS.map((h) => (
          <TouchableOpacity key={h} onPress={() => onChange(h)}
            style={[s.timePill, value === h && s.timePillOn]}>
            <Text style={[s.timePillText, value === h && { color: theme.onGold }]}>
              {hLabel(h)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { alignItems: "center", justifyContent: "center" },
  note: { color: theme.muted, fontSize: 12.5, lineHeight: 18, marginBottom: 8 },
  section: { color: theme.ink, fontSize: 16, fontFamily: theme.font.displayMd, marginTop: 24,
    marginBottom: 10, letterSpacing: -0.3 },
  optRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.card,
    borderWidth: 1.5, borderColor: theme.line, borderRadius: theme.radii.md, padding: 15,
    marginBottom: 10, ...theme.shadow.card },
  optOn: { borderColor: theme.gold, backgroundColor: theme.goldSoft },
  optLabel: { color: theme.ink, fontSize: 15, fontFamily: theme.font.bold },
  optDesc: { color: theme.muted, fontSize: 12.5, marginTop: 3, lineHeight: 17 },
  card: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, padding: 6, ...theme.shadow.card },
  hair: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line, marginHorizontal: 10 },
  dndRow: { flexDirection: "row", alignItems: "center", padding: 15, marginTop: 20 },
  timeRow: { paddingVertical: 10 },
  timeLabel: { color: theme.muted, fontSize: 12, fontFamily: theme.font.bold, marginBottom: 8,
    marginLeft: 6 },
  timePill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line },
  timePillOn: { backgroundColor: theme.gold, borderColor: theme.gold },
  timePillText: { color: theme.ink, fontSize: 13, fontFamily: theme.font.bold },
  hint: { color: theme.muted, fontSize: 12, marginTop: 8, marginBottom: 4, lineHeight: 17 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  chipOn: { borderColor: theme.gold, backgroundColor: theme.goldSoft },
  chipText: { color: theme.muted, fontSize: 13, fontFamily: theme.font.semibold },
  chipTextOn: { color: theme.gold },
  saved: { color: theme.emerald, fontSize: 13, fontFamily: theme.font.bold, textAlign: "center",
    marginTop: 22 },
});
