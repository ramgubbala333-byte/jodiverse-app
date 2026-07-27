import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

// Payments aren't live yet — RevenueCat wires in later. Until then, tapping a
// pack credits the wallet instantly so the whole flow is testable.
const DEV_INSTANT_CREDIT = true;

type Pack = { minutes: number; price: number; per: string; best?: boolean };
const PACKS: Pack[] = [
  { minutes: 15, price: 39, per: "₹2.6/min" },
  { minutes: 40, price: 89, per: "₹2.2/min", best: true },
  { minutes: 100, price: 179, per: "₹1.8/min" },
];

export default function BuyTimeScreen() {
  const nav = useNavigation<any>();
  const [available, setAvailable] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const refresh = () =>
    supabase.rpc("my_talk_available").then(({ data }) => setAvailable(data ?? 0));
  useEffect(() => { refresh(); }, []);

  const buy = async (p: Pack) => {
    if (!DEV_INSTANT_CREDIT) {
      Alert.alert("Almost there", "Call-time packs go on sale when payments launch (RevenueCat + UPI).");
      return;
    }
    setBusy(p.minutes);
    const { data, error } = await supabase.rpc("grant_talk_time", { secs: p.minutes * 60 });
    setBusy(null);
    if (error) { Alert.alert("Couldn't add time", error.message); return; }
    setAvailable(data ?? null);
    Alert.alert("Time added ⏱️",
      `${p.minutes} minutes added. You now have ${Math.floor((data ?? 0) / 60)} minutes.`,
      [{ text: "Back to talking", onPress: () => nav.goBack() }]);
  };

  const mins = available == null ? null : Math.floor(available / 60);

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 22, paddingBottom: 40 }}>
      <View style={s.balanceCard}>
        <Ionicons name="time-outline" size={26} color={theme.gold} />
        <View>
          <Text style={s.balanceLabel}>You have</Text>
          <Text style={s.balanceVal}>
            {mins == null ? "…" : `${mins} min`} <Text style={s.balanceSub}>of talk time</Text>
          </Text>
        </View>
      </View>

      <Text style={s.h1}>Buy call time</Text>
      <Text style={s.sub}>
        Everyone gets 20 free minutes a day. Top up to keep meeting people once
        today's free minutes run out. Purchased minutes never expire.
      </Text>

      {PACKS.map((p) => (
        <TouchableOpacity key={p.minutes} style={[s.pack, p.best && s.packBest]}
          onPress={() => buy(p)} disabled={busy !== null}>
          <View style={s.packLeft}>
            <Text style={s.packMins}>{p.minutes} min</Text>
            <Text style={s.packPer}>{p.per}</Text>
          </View>
          {p.best && <View style={s.bestTag}><Text style={s.bestTagText}>BEST VALUE</Text></View>}
          <View style={s.packRight}>
            {busy === p.minutes
              ? <ActivityIndicator color={theme.onGold} />
              : <Text style={s.packPrice}>₹{p.price}</Text>}
          </View>
        </TouchableOpacity>
      ))}

      <View style={s.subHint}>
        <Ionicons name="sparkles" size={16} color={theme.gold} />
        <Text style={s.subHintText}>
          Subscribers get 60 free minutes a day instead of 20.{" "}
          <Text style={s.link} onPress={() => nav.navigate("Paywall")}>See plans →</Text>
        </Text>
      </View>

      <Text style={s.fine}>
        The 10-minute cap per conversation always applies — it's what keeps you
        meeting new people. Clicked with someone? Become friends and chat for free, forever.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  balanceCard: { flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: 16, padding: 18, marginTop: 8 },
  balanceLabel: { color: theme.muted, fontSize: 12, fontWeight: "600" },
  balanceVal: { color: theme.ink, fontSize: 24, fontWeight: "800", marginTop: 2 },
  balanceSub: { color: theme.muted, fontSize: 13, fontWeight: "500" },
  h1: { color: theme.ink, fontSize: 26, fontWeight: "800", marginTop: 28,
    letterSpacing: -0.5 },
  sub: { color: theme.muted, fontSize: 14, marginTop: 8, lineHeight: 20, marginBottom: 18 },
  pack: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card,
    borderWidth: 1.5, borderColor: theme.line, borderRadius: 16, padding: 18,
    marginBottom: 12 },
  packBest: { borderColor: theme.gold },
  packLeft: { flex: 1 },
  packMins: { color: theme.ink, fontSize: 20, fontWeight: "800" },
  packPer: { color: theme.muted, fontSize: 12.5, marginTop: 2 },
  bestTag: { backgroundColor: theme.goldSoft, borderRadius: 6, paddingHorizontal: 8,
    paddingVertical: 3, marginRight: 12 },
  bestTagText: { color: theme.gold, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  packRight: { minWidth: 64, alignItems: "flex-end" },
  packPrice: { color: theme.gold, fontSize: 20, fontWeight: "800" },
  subHint: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 8,
    backgroundColor: theme.card2, borderRadius: 12, padding: 14 },
  subHintText: { color: theme.ink, fontSize: 13, flex: 1, lineHeight: 19 },
  link: { color: theme.gold, fontWeight: "700" },
  fine: { color: theme.muted, fontSize: 11.5, textAlign: "center", marginTop: 20,
    lineHeight: 17 },
});
