import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import Heart3D from "./Heart3D";
import { theme } from "../theme";

type Reason = { icon: string; text: string };

// Material-symbol names from the SQL function → Ionicons equivalents.
const ICON_MAP: Record<string, string> = {
  ads_click: "radio-button-on-outline",
  music_note: "musical-notes",
  dark_mode: "moon",
  forum: "chatbubbles-outline",
  translate: "language",
  auto_awesome: "sparkles",
};

// The app's core differentiator: an honest, specific explanation of why two
// people matched — built from data both people already answered (compat
// questionnaire, shared interests, semantic profile similarity). Never
// appearance. Shown on the match profile and in the match celebration.
export default function WhyMatchedCard({ otherId }: { otherId: string }) {
  const [reasons, setReasons] = useState<Reason[] | null>(null);

  useEffect(() => {
    let live = true;
    supabase.rpc("match_reasons", { other: otherId }).then(({ data }) => {
      if (live) setReasons((data as Reason[]) ?? []);
    });
    return () => { live = false; };
  }, [otherId]);

  if (!reasons || reasons.length === 0) return null;

  return (
    <View style={s.card}>
      <View style={s.heartCorner}><Heart3D size={72} /></View>
      <View style={s.head}>
        <Text style={s.title}>Why you two matched</Text>
        <Ionicons name="sparkles" size={16} color={theme.rose} />
      </View>
      <View style={{ gap: 14 }}>
        {reasons.map((r, i) => (
          <View key={i} style={s.row}>
            <View style={s.iconWrap}>
              <Ionicons name={(ICON_MAP[r.icon] ?? "checkmark-circle") as any} size={17} color={theme.gold} />
            </View>
            <Text style={s.text}>{r.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: theme.card, borderWidth: 1, borderColor: "rgba(255,122,46,.25)",
    borderRadius: theme.radii.lg, padding: 18, overflow: "hidden", ...theme.shadow.card },
  heartCorner: { position: "absolute", top: -6, right: -6, opacity: 0.85 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  title: { color: theme.ink, fontSize: 17, fontFamily: theme.font.displayMd, letterSpacing: -0.3 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.goldSoft,
    alignItems: "center", justifyContent: "center" },
  text: { color: theme.ink, fontSize: 13.5, flex: 1, lineHeight: 19, fontFamily: theme.font.medium },
});
