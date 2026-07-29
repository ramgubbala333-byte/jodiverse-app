import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import GlowBackdrop from "../components/GlowBackdrop";
import GlassCard from "../components/GlassCard";
import PressableScale from "../components/PressableScale";
import { haptic } from "../lib/haptics";
import { theme } from "../theme";

// Fair pricing: subscriptions sell REACH and INSIGHT, never a person's time.
// Talking is free for everyone — 3 calls/day, unlimited (fair-use) here.
// Purchases arrive with RevenueCat — the webhook already writes subscriptions.
type Plan = { months: number; label: string; perMonth: number; save?: number };
type Tier = {
  key: string; name: string; color: string; popular?: boolean; tagline: string;
  perks: string[]; plans: Plan[];
};

const TIERS: Tier[] = [
  {
    key: "plus", name: "Plus", color: theme.gold, popular: true,
    tagline: "For meeting more people, faster",
    perks: [
      "Unlimited voice calls (fair-use, 30/day)",
      "Priority matching — front of the queue",
      "Advanced filters: intent, lifestyle, language",
      "Travel Mode — match in any city",
      "Weekly profile Boost",
      "Read receipts · Incognito mode",
      "Compatibility & Date Readiness insights",
      "Unlimited Lounge speaking · Premium badge",
    ],
    plans: [
      { months: 1, label: "Monthly", perMonth: 249 },
      { months: 3, label: "Quarterly", perMonth: 217, save: 13 },
      { months: 12, label: "Yearly", perMonth: 125, save: 50 },
    ],
  },
  {
    key: "premium", name: "Premium", color: theme.purple,
    tagline: "For serious daters who want an edge",
    perks: [
      "Everything in Plus",
      "Highest-priority queue placement",
      "Unlimited scheduled voice dates",
      "Advanced AI compatibility scoring",
      "Exclusive Lounges · higher visibility",
      "Profile optimization review",
      "Early access to new features",
    ],
    plans: [
      { months: 1, label: "Monthly", perMonth: 599 },
      { months: 3, label: "Quarterly", perMonth: 533, save: 11 },
      { months: 12, label: "Yearly", perMonth: 333, save: 44 },
    ],
  },
];

export default function PaywallScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [tierKey, setTierKey] = useState("plus");
  const [months, setMonths] = useState(1);
  const tier = TIERS.find((t) => t.key === tierKey)!;
  const plan = tier.plans.find((p) => p.months === months) ?? tier.plans[0];
  const total = plan.perMonth * plan.months;

  return (
    <View style={s.wrap}>
      <GlowBackdrop />
      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 40 + insets.bottom }}>
      <Text style={s.h1}>Deepen the{"\n"}connection</Text>
      <Text style={s.sub}>Premium tools built for high-intent, voice-first dating. Reach and insight — never a person's time.</Text>

      <View style={s.freePill}>
        <Ionicons name="mic" size={15} color={theme.gold} />
        <Text style={s.freePillText}>TALKING IS ALWAYS FREE</Text>
      </View>

      {/* tier selector — selected tab fills with the tier colour */}
      <View style={s.tierRow}>
        {TIERS.map((t) => {
          const on = tierKey === t.key;
          return (
            <PressableScale key={t.key} scaleTo={0.97} haptics="select"
              style={[s.tierTab, on
                ? { borderColor: t.color, backgroundColor: t.color }
                : { borderColor: theme.line }]}
              onPress={() => { setTierKey(t.key); setMonths(1); }}>
              <Text style={[s.tierName, { color: on ? theme.onGold : t.color }]}>{t.name}</Text>
              {t.popular && (
                <Text style={[s.popularMini, on && { color: theme.onGold }]}>MOST POPULAR</Text>
              )}
            </PressableScale>
          );
        })}
      </View>
      <Text style={s.tierTagline}>{tier.tagline}</Text>

      {/* duration cards — re-priced per selected tier */}
      <View style={s.planRow}>
        {tier.plans.map((p) => {
          const on = months === p.months;
          return (
            <PressableScale key={`${tier.key}-${p.months}`} scaleTo={0.97} haptics="select"
              style={[s.planCard, on && {
                borderColor: tier.color, borderWidth: 2,
                backgroundColor: `${tier.color}14`,
              }]}
              onPress={() => setMonths(p.months)}>
              {p.save ? (
                <View style={[s.saveBadge, { backgroundColor: tier.color }]}>
                  <Text style={s.saveText}>SAVE {p.save}%</Text>
                </View>
              ) : <View style={{ height: 16 }} />}
              <Text style={s.planLabel}>{p.label}</Text>
              <Text style={[s.planPrice, on && { color: tier.color }]}>
                ₹{p.perMonth}<Text style={s.planPer}>/mo</Text>
              </Text>
              {p.months > 1 && <Text style={s.planTotal}>₹{p.perMonth * p.months} billed {p.months === 3 ? "quarterly" : "yearly"}</Text>}
            </PressableScale>
          );
        })}
      </View>

      {/* perks — frosted glass panel over the aurora glow */}
      <GlassCard style={s.perksCard}>
        {tier.perks.map((p) => (
          <View key={p} style={s.perkRow}>
            <Ionicons name="checkmark" size={15} color={tier.color} />
            <Text style={s.perk}>{p}</Text>
          </View>
        ))}
      </GlassCard>

      {/* feature highlights */}
      <View style={s.tileRow}>
        {([["flash", "Priority"], ["airplane", "Travel"], ["pulse", "Insights"]] as const).map(([ic, l]) => (
          <View key={l} style={s.tile}>
            <View style={s.tileIcon}><Ionicons name={ic as any} size={18} color={theme.gold} /></View>
            <Text style={s.tileLabel}>{l}</Text>
          </View>
        ))}
      </View>

      <PressableScale haptics="medium" onPress={() =>
        Alert.alert("Almost there", "Subscriptions launch with the app — powered by RevenueCat + UPI.")}>
        <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cta}>
          <Text style={s.ctaText}>
            Upgrade to {tier.name} · ₹{total}
          </Text>
        </LinearGradient>
      </PressableScale>
      <Text style={s.fine}>
        {plan.months === 1 ? "Recurring monthly billing" : `One payment of ₹${total}, renews every ${plan.months} months`} · cancel anytime · prices include GST
      </Text>
      <TouchableOpacity onPress={() => nav.goBack()} style={s.laterBtn}>
        <Text style={s.laterText}>MAYBE LATER</Text>
      </TouchableOpacity>

      {/* coins are a separate, cosmetic-only purchase */}
      <PressableScale style={s.coinsCard} onPress={() => nav.navigate("Coins")}>
        <Ionicons name="logo-bitcoin" size={22} color={theme.gold} />
        <View style={{ flex: 1 }}>
          <Text style={s.coinsTitle}>Just want to send a gift?</Text>
          <Text style={s.coinsSub}>Coins are for gifts, boosts &amp; profile extras — no subscription needed.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.muted} />
      </PressableScale>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, overflow: "hidden" },
  h1: { color: theme.rose, fontSize: 32, fontFamily: theme.font.display, letterSpacing: -1,
    textAlign: "center", lineHeight: 38, marginTop: 6 },
  sub: { color: theme.muted, fontSize: 13.5, marginTop: 12, marginBottom: 18, lineHeight: 20,
    textAlign: "center", alignSelf: "center", maxWidth: 320 },
  freePill: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    alignSelf: "center", borderWidth: 1, borderColor: "rgba(255,122,46,0.4)",
    borderRadius: theme.radii.pill, paddingHorizontal: 18, paddingVertical: 12, marginBottom: 22,
    backgroundColor: theme.goldSoft },
  freePillText: { color: theme.gold, fontSize: 12.5, fontFamily: theme.font.black, letterSpacing: 1 },
  freeBanner: { flexDirection: "row", alignItems: "center", gap: 9,
    backgroundColor: theme.card2, borderRadius: theme.radii.md, padding: 13, marginBottom: 18 },
  freeBannerText: { color: theme.ink, fontSize: 12.5, flex: 1, lineHeight: 18 },
  tileRow: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 4 },
  tile: { flex: 1, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, alignItems: "center", paddingVertical: 16, gap: 8, ...theme.shadow.card },
  tileIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.goldSoft,
    alignItems: "center", justifyContent: "center" },
  tileLabel: { color: theme.ink, fontSize: 12.5, fontFamily: theme.font.bold },
  laterBtn: { alignItems: "center", paddingVertical: 16, marginTop: 4 },
  laterText: { color: theme.muted, fontSize: 13, fontFamily: theme.font.black, letterSpacing: 1.5 },
  tierRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  tierTab: { flex: 1, borderWidth: 2, borderColor: theme.line, borderRadius: theme.radii.md,
    paddingVertical: 13, alignItems: "center", backgroundColor: theme.card2 },
  tierName: { fontSize: 16, fontFamily: theme.font.black },
  popularMini: { color: theme.gold, fontSize: 8, fontFamily: theme.font.black, marginTop: 2, letterSpacing: 0.5 },
  tierTagline: { color: theme.muted, fontSize: 12.5, marginBottom: 14, fontFamily: theme.font.semibold },
  planRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  planCard: { flex: 1, borderWidth: 1, borderColor: theme.line, borderRadius: theme.radii.md,
    backgroundColor: theme.card, alignItems: "center", paddingVertical: 14, paddingHorizontal: 4,
    ...theme.shadow.card },
  saveBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 6 },
  saveText: { color: "#fff", fontSize: 9, fontFamily: theme.font.black },
  planLabel: { color: theme.muted, fontSize: 11, marginBottom: 8, fontFamily: theme.font.bold },
  planPrice: { color: theme.ink, fontSize: 18, fontFamily: theme.font.black },
  planPer: { color: theme.muted, fontSize: 11, fontFamily: theme.font.medium },
  planTotal: { color: theme.muted, fontSize: 9.5, marginTop: 4, textAlign: "center" },
  perksCard: { padding: 18, marginBottom: 18 },
  perkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 9 },
  perk: { color: theme.ink, fontSize: 13, flex: 1 },
  cta: { borderRadius: 999, padding: 17, alignItems: "center", ...theme.shadow.cta },
  ctaText: { color: theme.onGold, fontFamily: theme.font.black, fontSize: 15, letterSpacing: 0.2 },
  fine: { color: theme.muted, fontSize: 11, textAlign: "center", marginTop: 12 },
  coinsCard: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 26,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, padding: 15, ...theme.shadow.card },
  coinsTitle: { color: theme.ink, fontSize: 14, fontFamily: theme.font.bold },
  coinsSub: { color: theme.muted, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
});
