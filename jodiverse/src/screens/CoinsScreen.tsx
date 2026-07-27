import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

// Payments aren't live yet — RevenueCat wires in later. Until then, tapping a
// pack credits the wallet instantly so the whole flow is testable.
const DEV_INSTANT_CREDIT = true;

type Pack = { coins: number; price: number; bonus?: string; best?: boolean };
const PACKS: Pack[] = [
  { coins: 500, price: 49 },
  { coins: 1100, price: 99, bonus: "+10% bonus", best: true },
  { coins: 2400, price: 199, bonus: "+20% bonus" },
  { coins: 6500, price: 499, bonus: "+30% bonus" },
];

// Coins are COSMETIC ONLY — gifts, boosts, themes, decorations. They can
// never buy call time, messaging, safety, or matching. Talking stays free.
export default function CoinsScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const refresh = () =>
    supabase.rpc("my_coin_balance").then(({ data }) => setBalance(data ?? 0));
  useEffect(() => { refresh(); }, []);

  const buy = async (p: Pack) => {
    if (!DEV_INSTANT_CREDIT) {
      Alert.alert("Almost there", "Coin packs go on sale when payments launch (RevenueCat + UPI).");
      return;
    }
    setBusy(p.coins);
    const { data, error } = await supabase.rpc("grant_coins", { amount: p.coins });
    setBusy(null);
    if (error) { Alert.alert("Couldn't add coins", error.message); return; }
    setBalance(data ?? null);
    Alert.alert("Coins added 🪙", `${p.coins.toLocaleString()} coins added — you have ${(data ?? 0).toLocaleString()}.`,
      [{ text: "Nice", onPress: () => nav.goBack() }]);
  };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 22, paddingBottom: 40 + insets.bottom }}>
      <View style={s.balanceCard}>
        <Ionicons name="logo-bitcoin" size={26} color={theme.gold} />
        <View>
          <Text style={s.balanceLabel}>You have</Text>
          <Text style={s.balanceVal}>
            {balance == null ? "…" : balance.toLocaleString()} <Text style={s.balanceSub}>coins</Text>
          </Text>
        </View>
      </View>

      <Text style={s.h1}>Get coins</Text>
      <Text style={s.sub}>
        Coins are just for fun — gifts, boosts, and profile extras. They never buy
        call time, messages, or matching: talking on Dosti Connect is always free.
      </Text>

      {PACKS.map((p) => (
        <TouchableOpacity key={p.coins} style={[s.pack, p.best && s.packBest]}
          onPress={() => buy(p)} disabled={busy !== null}>
          <View style={s.packLeft}>
            <Text style={s.packCoins}>{p.coins.toLocaleString()} coins</Text>
            {p.bonus && <Text style={s.packBonus}>{p.bonus}</Text>}
          </View>
          {p.best && <View style={s.bestTag}><Text style={s.bestTagText}>BEST VALUE</Text></View>}
          <View style={s.packRight}>
            {busy === p.coins
              ? <ActivityIndicator color={theme.onGold} />
              : <Text style={s.packPrice}>₹{p.price}</Text>}
          </View>
        </TouchableOpacity>
      ))}

      <View style={s.spendCard}>
        <Text style={s.spendLabel}>WHAT COINS ARE FOR</Text>
        {[
          ["gift", "Send gifts in chat — a little spark for someone you're talking to"],
          ["flash", "Boost your profile in the queue for 30 minutes"],
          ["color-palette", "Unlock profile themes and decorations"],
          ["ticket", "Grab tickets to exclusive Lounge events"],
        ].map(([icon, label]) => (
          <View key={label} style={s.spendRow}>
            <Ionicons name={icon as any} size={16} color={theme.gold} />
            <Text style={s.spendText}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={s.neverCard}>
        <Ionicons name="shield-checkmark" size={16} color={theme.emerald} />
        <Text style={s.neverText}>
          Coins can never buy call time, messages, verification, or matching —
          those are free for everyone, forever.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  balanceCard: { flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, padding: 18, marginTop: 8, ...theme.shadow.card },
  balanceLabel: { color: theme.muted, fontSize: 12, fontFamily: theme.font.semibold },
  balanceVal: { color: theme.ink, fontSize: 26, fontFamily: theme.font.black, marginTop: 2 },
  balanceSub: { color: theme.muted, fontSize: 13, fontFamily: theme.font.medium },
  h1: { color: theme.ink, fontSize: 27, fontFamily: theme.font.display, marginTop: 28,
    letterSpacing: -0.8 },
  sub: { color: theme.muted, fontSize: 14, marginTop: 10, lineHeight: 20, marginBottom: 18 },
  pack: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card,
    borderWidth: 1.5, borderColor: theme.line, borderRadius: theme.radii.lg, padding: 18,
    marginBottom: 12, ...theme.shadow.card },
  packBest: { borderColor: theme.gold },
  packLeft: { flex: 1 },
  packCoins: { color: theme.ink, fontSize: 18, fontFamily: theme.font.black },
  packBonus: { color: theme.emerald, fontSize: 12, marginTop: 3, fontFamily: theme.font.bold },
  bestTag: { backgroundColor: theme.goldSoft, borderRadius: 6, paddingHorizontal: 8,
    paddingVertical: 3, marginRight: 12 },
  bestTagText: { color: theme.gold, fontSize: 9, fontFamily: theme.font.black, letterSpacing: 0.5 },
  packRight: { minWidth: 64, alignItems: "flex-end" },
  packPrice: { color: theme.gold, fontSize: 20, fontFamily: theme.font.black },
  spendCard: { backgroundColor: theme.card2, borderRadius: theme.radii.md, padding: 16, marginTop: 10 },
  spendLabel: { color: theme.gold, fontSize: 10, fontFamily: theme.font.black, letterSpacing: 1.2,
    marginBottom: 10 },
  spendRow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 8 },
  spendText: { color: theme.ink, fontSize: 13, flex: 1, lineHeight: 18 },
  neverCard: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14,
    padding: 14 },
  neverText: { color: theme.muted, fontSize: 11.5, flex: 1, lineHeight: 17 },
});
