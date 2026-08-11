import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, TextInput,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import PressableScale from "../components/PressableScale";
import { haptic } from "../lib/haptics";
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
// never buy likes, matches, messaging, verification, or safety.
export default function CoinsScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [promo, setPromo] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);

  const refresh = () =>
    supabase.rpc("my_coin_balance").then(({ data }) => setBalance(data ?? 0));
  useEffect(() => { refresh(); }, []);

  const redeemPromo = async () => {
    const code = promo.trim();
    if (!code) return;
    setPromoBusy(true);
    const { data, error } = await supabase.rpc("redeem_promo", { p_code: code });
    setPromoBusy(false);
    if (error) {
      const map: Record<string, string> = {
        INVALID_CODE: "That code isn't valid.",
        CODE_EXPIRED: "That code has expired.",
        CODE_EXHAUSTED: "That code has been fully claimed.",
        ALREADY_USED: "You've already used that code.",
      };
      Alert.alert("Couldn't redeem", map[error.message] ?? error.message);
      return;
    }
    setPromo(""); setBalance(data?.balance ?? null); haptic.success();
    Alert.alert("Code redeemed 🎉", `${data?.coins ?? 0} coins added — you have ${(data?.balance ?? 0).toLocaleString()}.`);
  };

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
    haptic.success();
    Alert.alert("Coins added 🪙", `${p.coins.toLocaleString()} coins added — you have ${(data ?? 0).toLocaleString()}.`,
      [{ text: "Nice", onPress: () => nav.goBack() }]);
  };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 22, paddingBottom: 40 + insets.bottom }}>
      <View style={s.balanceCard}>
        <Text style={s.balanceLabel}>AVAILABLE BALANCE</Text>
        <View style={s.balanceValRow}>
          <Ionicons name="logo-bitcoin" size={28} color={theme.gold} />
          <Text style={s.balanceVal}>{balance == null ? "…" : balance.toLocaleString()}</Text>
        </View>
        <PressableScale style={s.histPill} onPress={() => nav.navigate("Transactions")}>
          <Text style={s.histLink}>View history</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.muted} />
        </PressableScale>
      </View>

      {/* what coins are (and aren't) — the fair-model reassurance */}
      <View style={s.infoBanner}>
        <Ionicons name="information-circle-outline" size={18} color={theme.rose} />
        <Text style={s.infoBannerText}>
          Coins are just for gifts and fun — they never buy likes, matches, or messages.
        </Text>
      </View>

      {/* redeem a promo / coupon code */}
      <View style={s.promoCard}>
        <TextInput style={s.promoInput} placeholder="Have a promo code?" autoCapitalize="characters"
          value={promo} onChangeText={setPromo} placeholderTextColor={theme.muted}
          onSubmitEditing={redeemPromo} returnKeyType="done" />
        <TouchableOpacity style={[s.promoBtn, (promoBusy || !promo.trim()) && { opacity: 0.5 }]}
          onPress={redeemPromo} disabled={promoBusy || !promo.trim()}>
          {promoBusy ? <ActivityIndicator color={theme.onGold} /> : <Text style={s.promoBtnText}>Redeem</Text>}
        </TouchableOpacity>
      </View>

      {/* invite & earn */}
      <PressableScale style={s.inviteRow} onPress={() => nav.navigate("Referral")}>
        <Ionicons name="gift" size={20} color={theme.gold} />
        <View style={{ flex: 1 }}>
          <Text style={s.inviteTitle}>Invite friends & earn coins</Text>
          <Text style={s.inviteSub}>You both get 100 coins for every friend who joins.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.muted} />
      </PressableScale>

      <Text style={s.h1}>Refill wallet</Text>
      <View style={s.packGrid}>
        {PACKS.map((p, i) => {
          const icon = (["server", "medal", "diamond", "ribbon"] as const)[i] ?? "server";
          return (
            <PressableScale key={p.coins} style={[s.pack, p.best && s.packBest]}
              onPress={() => buy(p)} disabled={busy !== null}>
              {p.best && <View style={s.bestTag}><Text style={s.bestTagText}>MOST POPULAR</Text></View>}
              <Ionicons name={icon} size={26} color={theme.gold} />
              <Text style={s.packCoins}>{p.coins.toLocaleString()}</Text>
              <Text style={s.packCoinsLabel}>Coins{p.bonus ? ` · ${p.bonus}` : ""}</Text>
              <View style={[s.pricePill, p.best && s.pricePillBest]}>
                {busy === p.coins
                  ? <ActivityIndicator color={p.best ? theme.onGold : theme.gold} />
                  : <Text style={[s.packPrice, p.best && { color: theme.onGold }]}>₹{p.price}</Text>}
              </View>
            </PressableScale>
          );
        })}
      </View>

      <View style={s.spendCard}>
        <Text style={s.spendLabel}>WHAT COINS ARE FOR</Text>
        {[
          ["gift", "Send gifts in chat — a little spark for a match you're talking to"],
          ["flash", "Boost your profile to the top of the deck for 30 minutes"],
          ["color-palette", "Unlock profile themes and decorations"],
          ["star", "Send a Super Like with a comment they see instantly"],
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
          Coins can never buy likes, messages, verification, or matching —
          those are free for everyone, forever.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  balanceCard: { alignItems: "center", backgroundColor: theme.card, borderWidth: 1,
    borderColor: theme.line, borderRadius: theme.radii.xl, paddingVertical: 26, paddingHorizontal: 18,
    marginTop: 8, ...theme.shadow.card },
  balanceLabel: { color: theme.muted, fontSize: 12, fontFamily: theme.font.bold, letterSpacing: 1.5 },
  balanceValRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  balanceVal: { color: theme.ink, fontSize: 44, fontFamily: theme.font.black, letterSpacing: -1 },
  histPill: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 14,
    backgroundColor: theme.card2, borderRadius: theme.radii.pill, paddingHorizontal: 14, paddingVertical: 7 },
  histLink: { color: theme.muted, fontSize: 12.5, fontFamily: theme.font.bold },
  infoBanner: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16,
    backgroundColor: "rgba(255,75,137,0.08)", borderWidth: 1, borderColor: "rgba(255,75,137,0.25)",
    borderRadius: theme.radii.md, padding: 13 },
  infoBannerText: { color: theme.ink, fontSize: 12.5, flex: 1, lineHeight: 18 },
  packGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 },
  packCoinsLabel: { color: theme.muted, fontSize: 12, fontFamily: theme.font.semibold, marginTop: 2 },
  pricePill: { backgroundColor: theme.card2, borderRadius: theme.radii.md, paddingVertical: 10,
    paddingHorizontal: 18, marginTop: 12, minWidth: 90, alignItems: "center" },
  pricePillBest: { backgroundColor: theme.gold },
  promoCard: { flexDirection: "row", gap: 10, marginTop: 16 },
  promoInput: { flex: 1, backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, paddingHorizontal: 14, paddingVertical: 13, color: theme.ink, fontSize: 15 },
  promoBtn: { backgroundColor: theme.gold, borderRadius: theme.radii.md, paddingHorizontal: 20,
    alignItems: "center", justifyContent: "center", ...theme.shadow.cta },
  promoBtnText: { color: theme.onGold, fontFamily: theme.font.black, fontSize: 14 },
  inviteRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: theme.radii.md,
    padding: 15, ...theme.shadow.card },
  inviteTitle: { color: theme.ink, fontSize: 14.5, fontFamily: theme.font.bold },
  inviteSub: { color: theme.muted, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  h1: { color: theme.ink, fontSize: 27, fontFamily: theme.font.display, marginTop: 28,
    letterSpacing: -0.8 },
  sub: { color: theme.muted, fontSize: 14, marginTop: 10, lineHeight: 20, marginBottom: 18 },
  pack: { width: "47.5%", alignItems: "center", backgroundColor: theme.card,
    borderWidth: 1.5, borderColor: theme.line, borderRadius: theme.radii.lg, paddingVertical: 22,
    paddingHorizontal: 10, marginBottom: 12, ...theme.shadow.card },
  packBest: { borderColor: theme.gold },
  packCoins: { color: theme.ink, fontSize: 20, fontFamily: theme.font.black, marginTop: 10 },
  bestTag: { position: "absolute", top: -9, backgroundColor: theme.gold, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 3 },
  bestTagText: { color: theme.onGold, fontSize: 8.5, fontFamily: theme.font.black, letterSpacing: 0.5 },
  packPrice: { color: theme.gold, fontSize: 17, fontFamily: theme.font.black },
  spendCard: { backgroundColor: theme.card2, borderRadius: theme.radii.md, padding: 16, marginTop: 10 },
  spendLabel: { color: theme.gold, fontSize: 10, fontFamily: theme.font.black, letterSpacing: 1.2,
    marginBottom: 10 },
  spendRow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 8 },
  spendText: { color: theme.ink, fontSize: 13, flex: 1, lineHeight: 18 },
  neverCard: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14,
    padding: 14 },
  neverText: { color: theme.muted, fontSize: 11.5, flex: 1, lineHeight: 17 },
});
