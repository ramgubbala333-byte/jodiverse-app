import React, { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

type Entry = { delta: number; reason: string; balance_after: number; created_at: string };

// Friendly label + icon for each ledger reason code.
function describe(reason: string): { label: string; icon: any } {
  if (reason === "purchase") return { label: "Coins added", icon: "add-circle-outline" };
  if (reason === "referral_joined") return { label: "Joined with a friend's code", icon: "gift-outline" };
  if (reason === "referral_invited") return { label: "A friend joined with your code", icon: "gift-outline" };
  if (reason.startsWith("promo:")) return { label: `Promo code ${reason.slice(6)}`, icon: "pricetag-outline" };
  if (reason.startsWith("gift:")) return { label: `Sent a ${reason.slice(5)}`, icon: "heart-outline" };
  return { label: reason, icon: "ellipse-outline" };
}

// A transparent coin ledger — the antidote to "my coins vanished with no record".
export default function TransactionsScreen() {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Entry[] | null>(null);

  useEffect(() => {
    supabase.rpc("my_coin_ledger").then(({ data }) => setRows((data as Entry[]) ?? []));
  }, []);

  if (!rows) return <View style={[s.wrap, s.center]}><ActivityIndicator color={theme.gold} /></View>;

  return (
    <FlatList
      style={s.wrap}
      data={rows}
      keyExtractor={(_, i) => String(i)}
      contentContainerStyle={{ padding: 20, paddingBottom: 30 + insets.bottom }}
      ListHeaderComponent={<Text style={s.sub}>Every coin in and out — nothing hidden.</Text>}
      ListEmptyComponent={<Text style={s.empty}>No coin activity yet. Redeem a promo code or invite a friend to get started.</Text>}
      renderItem={({ item }) => {
        const d = describe(item.reason);
        const credit = item.delta >= 0;
        return (
          <View style={s.row}>
            <View style={s.icon}>
              <Ionicons name={d.icon} size={18} color={credit ? theme.emerald : theme.muted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{d.label}</Text>
              <Text style={s.date}>{new Date(item.created_at).toLocaleString()}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[s.delta, { color: credit ? theme.emerald : theme.ink }]}>
                {credit ? "+" : ""}{item.delta} 🪙
              </Text>
              <Text style={s.bal}>{item.balance_after.toLocaleString()} left</Text>
            </View>
          </View>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { alignItems: "center", justifyContent: "center" },
  sub: { color: theme.muted, fontSize: 13, marginBottom: 14 },
  empty: { color: theme.muted, fontSize: 14, textAlign: "center", marginTop: 60,
    paddingHorizontal: 30, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.card2,
    alignItems: "center", justifyContent: "center" },
  label: { color: theme.ink, fontSize: 14.5, fontFamily: theme.font.semibold },
  date: { color: theme.muted, fontSize: 11.5, marginTop: 2 },
  delta: { fontSize: 15, fontFamily: theme.font.black, fontVariant: ["tabular-nums"] },
  bal: { color: theme.muted, fontSize: 11, marginTop: 2 },
});
