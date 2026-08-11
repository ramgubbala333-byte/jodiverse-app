import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, FlatList,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

const FAITHS = ["Any", "Hindu", "Muslim", "Sikh", "Christian", "Jain", "Buddhist", "Spiritual"];
const SEEKING = ["Women", "Men", "Everyone"];
const LANGS = ["Any", "Hindi", "Telugu", "Tamil", "Punjabi", "Bengali", "Marathi",
  "Gujarati", "Kannada", "Malayalam", "Urdu", "English"];
const GOALS = ["Any", "Life partner", "Long-term", "Long-term, open to short", "Still figuring it out"];
const DISTANCES: [number, string][] = [
  [0, "Anywhere"], [3, "Within ~80 km"], [4, "Within ~20 km"], [5, "Within ~5 km"], [6, "Nearby"],
];

// All filters, free for everyone. Dil Mil paywalls its "advanced" filters
// (community/education/career) behind VIP — we don't: filtering who YOU see
// costs us nothing and gating it is exactly the pattern users hate most.
export default function FiltersScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(99);
  const [dist, setDist] = useState(0);
  const [seeking, setSeeking] = useState<string>("Everyone");
  const [faith, setFaith] = useState("Any");
  const [lang, setLang] = useState("Any");
  const [goal, setGoal] = useState("Any");
  const [picker, setPicker] = useState<null | {
    title: string; options: string[]; value: string; onPick: (v: string) => void;
  }>(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUid(user.id);
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (data) {
        setAgeMin(data.pref_age_min ?? 18);
        setAgeMax(data.pref_age_max ?? 99);
        setDist(data.pref_distance ?? 0);
        setSeeking((data.seeking?.[0] ?? "everyone").replace(/^./, (c: string) => c.toUpperCase()));
        setFaith(data.filter_faith ?? "Any");
        setLang(data.filter_language ?? "Any");
        setGoal(data.filter_goal ?? "Any");
      }
      setLoading(false);
    })();
  }, []));

  const save = (patch: Record<string, unknown>) => {
    if (uid) supabase.from("profiles").update(patch).eq("id", uid).then(() => {});
  };

  if (loading) return <View style={[s.wrap, s.center]}><ActivityIndicator color={theme.gold} /></View>;

  const distLabel = DISTANCES.find(([v]) => v === dist)?.[1] ?? "Anywhere";

  return (
    <View style={s.wrap}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        <Text style={s.note}>
          Every filter is free — we never charge you to choose who you see.
        </Text>

        <Text style={s.section}>The basics</Text>
        <View style={s.card}>
          <Row icon="calendar" label="Age" value={`${ageMin} – ${ageMax}`}
            onPress={() => nav.navigate("Settings")} />
          <View style={s.hair} />
          <Row icon="navigate" label="Distance" value={distLabel}
            onPress={() => setPicker({
              title: "Maximum distance",
              options: DISTANCES.map(([, l]) => l),
              value: distLabel,
              onPick: (l) => {
                const v = DISTANCES.find(([, lbl]) => lbl === l)?.[0] ?? 0;
                setDist(v); save({ pref_distance: v });
              },
            })} />
          <View style={s.hair} />
          <Row icon="people" label="Show me" value={seeking}
            onPress={() => setPicker({
              title: "Show me", options: [...SEEKING], value: seeking,
              onPick: (v) => { setSeeking(v); save({ seeking: [v.toLowerCase()] }); },
            })} />
        </View>

        <Text style={s.section}>Preferences</Text>
        <View style={s.card}>
          <Row icon="sunny" label="Religion" value={faith}
            onPress={() => setPicker({
              title: "Religion", options: FAITHS, value: faith,
              onPick: (v) => { setFaith(v); save({ filter_faith: v === "Any" ? null : v }); },
            })} />
          <View style={s.hair} />
          <Row icon="language" label="Language" value={lang}
            onPress={() => setPicker({
              title: "Language", options: LANGS, value: lang,
              onPick: (v) => { setLang(v); save({ filter_language: v === "Any" ? null : v }); },
            })} />
          <View style={s.hair} />
          <Row icon="heart" label="Looking for" value={goal}
            onPress={() => setPicker({
              title: "Looking for", options: GOALS, value: goal,
              onPick: (v) => { setGoal(v); save({ filter_goal: v === "Any" ? null : v }); },
            })} />
        </View>

        <Text style={s.footer}>
          The more selective you are, the fewer people you'll see — and the
          fewer will see you. We'll always tell you when a filter is shrinking
          your pool.
        </Text>
      </ScrollView>

      <Modal visible={picker !== null} transparent animationType="slide"
        onRequestClose={() => setPicker(null)}>
        <View style={s.sheetBg}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>{picker?.title}</Text>
              <TouchableOpacity onPress={() => setPicker(null)}>
                <Ionicons name="close" size={24} color={theme.muted} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={picker?.options ?? []}
              keyExtractor={(o) => o}
              renderItem={({ item }) => {
                const on = picker?.value === item;
                return (
                  <TouchableOpacity style={s.optRow}
                    onPress={() => { picker?.onPick(item); setPicker(null); }}>
                    <Text style={[s.optText, on && { color: theme.gold, fontFamily: theme.font.bold }]}>
                      {item}
                    </Text>
                    {on && <Ionicons name="checkmark" size={18} color={theme.gold} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ icon, label, value, onPress }:
  { icon: any; label: string; value: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.row} onPress={onPress}>
      <View style={s.rowIcon}><Ionicons name={icon} size={17} color={theme.gold} /></View>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={1}>{value}</Text>
      <Ionicons name="chevron-forward" size={17} color={theme.muted} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { alignItems: "center", justifyContent: "center" },
  note: { color: theme.muted, fontSize: 12.5, lineHeight: 18, padding: 20, paddingBottom: 6 },
  section: { color: theme.ink, fontSize: 16, fontFamily: theme.font.displayMd, letterSpacing: -0.3,
    marginTop: 18, marginBottom: 10, paddingHorizontal: 20 },
  card: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, marginHorizontal: 20, paddingHorizontal: 14,
    ...theme.shadow.card },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15 },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.goldSoft,
    alignItems: "center", justifyContent: "center" },
  rowLabel: { color: theme.ink, fontSize: 14.5, fontFamily: theme.font.semibold, flex: 1 },
  rowValue: { color: theme.muted, fontSize: 14, maxWidth: 150, textAlign: "right" },
  hair: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
  footer: { color: theme.muted, fontSize: 12, lineHeight: 18, padding: 20, marginTop: 6 },
  sheetBg: { flex: 1, backgroundColor: "rgba(0,0,0,.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: "70%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 10 },
  sheetTitle: { color: theme.ink, fontSize: 18, fontFamily: theme.font.displayMd },
  optRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  optText: { color: theme.ink, fontSize: 15, fontFamily: theme.font.medium },
});
