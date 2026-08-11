import React, { useCallback, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, FlatList,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import AuroraShaderBackdrop from "../components/AuroraShaderBackdrop";
import { theme } from "../theme";

type Liker = { name?: string; age?: number | null; photo: string | null;
  super?: boolean; free?: boolean };

// Who likes you — served entirely by the `likes-you` edge function (no RLS
// policy exposes incoming swipes, so this is the only path). Free members
// get ONE full reveal per week (stable pick, not re-rolled every load) plus
// a blurred-silhouette count for everyone else — deliberately more generous
// than the market norm of a hard paywall.
export default function LikesScreen() {
  const nav = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [count, setCount] = useState(0);
  const [likers, setLikers] = useState<Liker[]>([]);
  const [daysToReveal, setDaysToReveal] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("likes-you");
    if (!error && data) {
      setSubscribed(!!data.subscribed);
      setCount(data.count ?? 0);
      setLikers(data.subscribed ? (data.likers ?? []) : (data.previews ?? []));
      setDaysToReveal(data.daysToReveal ?? null);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return (
    <View style={s.center}><AuroraShaderBackdrop /><ActivityIndicator color={theme.gold} /></View>
  );

  return (
    <View style={s.wrap}>
      <AuroraShaderBackdrop />
      <View style={s.header}>
        <Text style={s.title}>{count} {count === 1 ? "person likes" : "people like"} you</Text>
        <Text style={s.sub}>
          {subscribed ? "You can see everyone." : "One full reveal a week, free — upgrade for all."}
        </Text>
      </View>

      <FlatList
        data={likers}
        keyExtractor={(_, i) => String(i)}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: subscribed ? 30 : 130, gap: 12 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="heart-outline" size={34} color={theme.muted} />
            <Text style={s.emptyText}>No likes yet. Keep exploring — they'll show up here.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const clear = subscribed || item.free;
          return (
            <View style={s.card}>
              {clear && item.photo ? (
                <Image source={{ uri: item.photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : item.photo ? (
                <Image source={{ uri: item.photo }} style={[StyleSheet.absoluteFill, s.blurredImg]}
                  resizeMode="cover" blurRadius={18} />
              ) : (
                <View style={[StyleSheet.absoluteFill, s.placeholder]} />
              )}
              <View style={StyleSheet.absoluteFill}>
                <LinearGradient colors={["transparent", "rgba(8,10,18,.85)"]}
                  style={StyleSheet.absoluteFill} />
              </View>
              {item.super && (
                <View style={s.superPill}>
                  <Ionicons name="star" size={11} color="#fff" />
                  <Text style={s.superText}>SUPER LIKE</Text>
                </View>
              )}
              {item.free && !subscribed && (
                <View style={s.freePill}>
                  <Ionicons name="star" size={11} color={theme.onGold} />
                  <Text style={s.freePillText}>FREE THIS WEEK</Text>
                </View>
              )}
              {clear ? (
                <View style={s.cardFooter}>
                  <Text style={s.cardName}>{item.name}{item.age ? `, ${item.age}` : ""}</Text>
                  {item.free && !subscribed && daysToReveal != null && (
                    <Text style={s.cardSub}>Next reveal in {daysToReveal}d</Text>
                  )}
                </View>
              ) : (
                <View style={s.lockWrap}>
                  <View style={s.lockCircle}><Ionicons name="lock-closed" size={20} color="#fff" /></View>
                </View>
              )}
            </View>
          );
        }}
      />

      {!subscribed && likers.length > 0 && (
        <View style={s.upgradeBanner}>
          <View style={s.upgradeInner}>
            <Text style={s.upgradeLabel}>
              <Ionicons name="ribbon" size={14} color={theme.purple} /> See everyone who likes you
            </Text>
            <TouchableOpacity onPress={() => nav.navigate("Paywall")}>
              <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={s.upgradeBtn}>
                <Text style={s.upgradeBtnText}>UPGRADE TO PLUS</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 20, paddingTop: 58, paddingBottom: 16 },
  title: { color: theme.ink, fontSize: 24, fontFamily: theme.font.displayMd, letterSpacing: -0.5 },
  sub: { color: theme.muted, fontSize: 13, marginTop: 6 },
  empty: { alignItems: "center", marginTop: 60, paddingHorizontal: 30, gap: 12 },
  emptyText: { color: theme.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },

  card: { flex: 1, aspectRatio: 3 / 4, borderRadius: theme.radii.md, overflow: "hidden",
    backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line },
  blurredImg: { opacity: 0.6 },
  placeholder: { backgroundColor: theme.card2 },
  superPill: { position: "absolute", top: 8, right: 8, flexDirection: "row", alignItems: "center",
    gap: 3, backgroundColor: "rgba(138,63,252,0.85)", borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 3 },
  superText: { color: "#fff", fontSize: 8, fontFamily: theme.font.black, letterSpacing: 0.5 },
  freePill: { position: "absolute", top: 8, left: 8, flexDirection: "row", alignItems: "center",
    gap: 3, backgroundColor: theme.gold, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  freePillText: { color: theme.onGold, fontSize: 8, fontFamily: theme.font.black, letterSpacing: 0.5 },
  cardFooter: { position: "absolute", left: 8, bottom: 8, right: 8 },
  cardName: { color: "#fff", fontSize: 15, fontFamily: theme.font.bold },
  cardSub: { color: "rgba(255,255,255,.75)", fontSize: 10.5, marginTop: 2 },
  lockWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  lockCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(8,10,18,.55)",
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,.25)" },

  upgradeBanner: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16,
    paddingBottom: 22, paddingTop: 14, backgroundColor: theme.bg },
  upgradeInner: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, padding: 16, alignItems: "center", gap: 10, ...theme.shadow.floating },
  upgradeLabel: { color: theme.ink, fontSize: 13, fontFamily: theme.font.semibold },
  upgradeBtn: { width: "100%", borderRadius: 999, paddingVertical: 13, alignItems: "center",
    ...theme.shadow.cta },
  upgradeBtnText: { color: "#fff", fontFamily: theme.font.black, fontSize: 12.5, letterSpacing: 1 },
});
