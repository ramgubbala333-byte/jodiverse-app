import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import AuroraShaderBackdrop from "../components/AuroraShaderBackdrop";
import { theme } from "../theme";

type Insights = {
  likes_received: number; pending_likes: number; requests_received: number;
  matches_total: number; avg_admirer_age: number | null;
  popularity_pct: number | null; response_rate: number | null;
};

// Your stats — the honest answer to Dil Mil's "Dil Details". Every number
// here is really computed from your data; anything we can't compute yet says
// so instead of showing a made-up figure. Nothing is paywalled.
export default function InsightsScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<Insights | null>(null);

  useFocusEffect(useCallback(() => {
    supabase.rpc("my_insights").then(({ data }) => setD(data as Insights));
  }, []));

  if (!d) return (
    <View style={[s.wrap, s.center]}><AuroraShaderBackdrop /><ActivityIndicator color={theme.gold} /></View>
  );

  return (
    <View style={s.wrap}>
      <AuroraShaderBackdrop />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 + insets.bottom }}
        showsVerticalScrollIndicator={false}>
        <Text style={s.sub}>Updated live from your real activity — no invented numbers.</Text>

        {/* headline: popularity */}
        <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={s.hero}>
          {d.popularity_pct != null ? (
            <>
              <Text style={s.heroLabel}>YOU'RE IN THE TOP</Text>
              <Text style={s.heroValue}>{Math.max(1, 100 - d.popularity_pct)}%</Text>
              <Text style={s.heroNote}>of profiles by likes received</Text>
            </>
          ) : (
            <>
              <Text style={s.heroLabel}>POPULARITY</Text>
              <Text style={s.heroValueSm}>Not enough data yet</Text>
              <Text style={s.heroNote}>We'll show this once more people are active near you</Text>
            </>
          )}
        </LinearGradient>

        {/* core counts */}
        <View style={s.grid}>
          <Stat icon="heart" label="Likes received" value={String(d.likes_received)} />
          <Stat icon="mail" label="Requests" value={String(d.requests_received)} />
          <Stat icon="sparkles" label="Matches" value={String(d.matches_total)} />
          <Stat icon="eye" label="Waiting on you" value={String(d.pending_likes)} />
        </View>

        {d.pending_likes > 0 && (
          <TouchableOpacity onPress={() => nav.navigate("Tabs", { screen: "Likes" })}>
            <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={s.cta}>
              <Text style={s.ctaText}>
                See the {d.pending_likes} {d.pending_likes === 1 ? "person" : "people"} who like you
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* detail rows */}
        <View style={s.card}>
          <Row label="Average age of people who like you"
            value={d.avg_admirer_age != null ? `${d.avg_admirer_age}` : "Needs 3+ likers"} />
          <View style={s.hair} />
          <Row label="Your reply rate"
            value={d.response_rate != null ? `${d.response_rate}%` : "No conversations yet"} />
        </View>

        {d.response_rate != null && d.response_rate < 50 && (
          <View style={s.tip}>
            <Ionicons name="bulb" size={16} color={theme.gold} />
            <Text style={s.tipText}>
              You reply to under half your matches. Replying more is the single
              biggest thing that gets you shown to more people.
            </Text>
          </View>
        )}

        <View style={s.privacy}>
          <Ionicons name="lock-closed" size={14} color={theme.muted} />
          <Text style={s.privacyText}>
            We don't track profile views or sell attention metrics. These stats are
            yours alone — nobody can buy a look at them.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={s.statCard}>
      <Ionicons name={icon} size={20} color={theme.gold} />
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { alignItems: "center", justifyContent: "center" },
  sub: { color: theme.muted, fontSize: 13, marginBottom: 16, lineHeight: 18 },
  hero: { borderRadius: theme.radii.xl, padding: 26, alignItems: "center", ...theme.shadow.floating },
  heroLabel: { color: "rgba(255,255,255,.9)", fontSize: 11, fontFamily: theme.font.black,
    letterSpacing: 2 },
  heroValue: { color: "#fff", fontSize: 56, fontFamily: theme.font.black, marginTop: 6,
    letterSpacing: -2 },
  heroValueSm: { color: "#fff", fontSize: 22, fontFamily: theme.font.bold, marginTop: 10,
    textAlign: "center" },
  heroNote: { color: "rgba(255,255,255,.9)", fontSize: 12.5, marginTop: 6, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16 },
  statCard: { width: "47.5%", backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, padding: 16, gap: 6, ...theme.shadow.card },
  statValue: { color: theme.ink, fontSize: 26, fontFamily: theme.font.black },
  statLabel: { color: theme.muted, fontSize: 12, fontFamily: theme.font.semibold },
  cta: { borderRadius: theme.radii.pill, paddingVertical: 16, alignItems: "center",
    marginTop: 16, ...theme.shadow.cta },
  ctaText: { color: "#fff", fontFamily: theme.font.black, fontSize: 15 },
  card: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, paddingHorizontal: 16, marginTop: 16, ...theme.shadow.card },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 15, gap: 12 },
  rowLabel: { color: theme.muted, fontSize: 13.5, flex: 1 },
  rowValue: { color: theme.ink, fontSize: 14.5, fontFamily: theme.font.bold },
  hair: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
  tip: { flexDirection: "row", gap: 10, backgroundColor: theme.goldSoft, borderRadius: theme.radii.md,
    padding: 14, marginTop: 16 },
  tipText: { color: theme.ink, fontSize: 12.5, flex: 1, lineHeight: 18 },
  privacy: { flexDirection: "row", gap: 9, marginTop: 22, paddingHorizontal: 4 },
  privacyText: { color: theme.muted, fontSize: 11.5, flex: 1, lineHeight: 17 },
});
