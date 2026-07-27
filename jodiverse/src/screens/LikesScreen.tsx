import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

// Served exclusively by the likes-you edge function. Free tier receives
// server-side pixelated thumbnails (identity destroyed before download);
// Gold receives real profiles. The client cannot get more than it's sent.
type Preview = { photo: string | null; super: boolean };
type Liker = { id: string; name: string; age: number | null; city: string | null;
  super: boolean; note: string | null; photo: string | null };

export default function LikesScreen() {
  const [loading, setLoading] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [count, setCount] = useState(0);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [likers, setLikers] = useState<Liker[]>([]);
  const [fnMissing, setFnMissing] = useState(false);
  const nav = useNavigation<any>();

  useFocusEffect(useCallback(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("likes-you");
      if (error || !data) {
        // Function not deployed yet — fall back to the count RPC.
        setFnMissing(true);
        const { data: c } = await supabase.rpc("likes_you_count");
        setCount(c ?? 0);
      } else {
        setFnMissing(false);
        setSubscribed(!!data.subscribed);
        setCount(data.count ?? 0);
        setPreviews(data.previews ?? []);
        setLikers(data.likers ?? []);
      }
      setLoading(false);
    })();
  }, []));

  if (loading) return <View style={s.center}><ActivityIndicator color={theme.rose} /></View>;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 22, paddingTop: 64, paddingBottom: 40 }}>
      <Text style={s.title}>{count > 0 ? `${count} like${count > 1 ? "s" : ""}` : "Likes You"}</Text>

      {subscribed ? (
        <View style={s.grid}>
          {likers.map((l) => (
            <View key={l.id} style={s.cell}>
              {l.photo
                ? <Image source={{ uri: l.photo }} style={s.cellImg} />
                : <View style={[s.cellImg, s.cellFallback]}><Text style={s.initial}>{l.name[0]}</Text></View>}
              <View style={s.cellMeta}>
                <Text style={s.cellName} numberOfLines={1}>
                  {l.name}{l.age ? `, ${l.age}` : ""} {l.super ? "★" : ""}
                </Text>
                {l.note ? <Text style={s.cellNote} numberOfLines={2}>"{l.note}"</Text> : null}
              </View>
            </View>
          ))}
          {!likers.length && <Text style={s.empty}>No pending likes right now.</Text>}
        </View>
      ) : (
        <View style={s.grid}>
          {(count > 0 ? (previews.length ? previews : Array.from({ length: Math.min(count, 9) })
              .map(() => ({ photo: null, super: false }))) : [])
            .map((p, i) => (
            <View key={i} style={[s.cell, s.cellBig, s.cellActive]}>
              {p.photo ? (
                // 24px pixelated source + light blur = Tinder-style tease
                <Image source={{ uri: p.photo }} style={s.cellImg} blurRadius={2} />
              ) : (
                <View style={[s.cellImg, s.cellFallback]}>
                  <Ionicons name="heart" size={26} color={theme.rose} />
                </View>
              )}
              {p.super && <Text style={s.superBadge}>★</Text>}
            </View>
          ))}
          {count === 0 && Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={s.cell}>
              <Ionicons name="heart" size={24} color="rgba(236,72,153,.35)" />
            </View>
          ))}
        </View>
      )}

      {!subscribed && (
        <View style={s.payCard}>
          <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.payIcon}>
            <Ionicons name="flash" size={22} color="#fff" />
          </LinearGradient>
          <Text style={s.payTitle}>
            {count > 0 ? `${count} ${count > 1 ? "people like" : "person likes"} you` : "See who likes you with Gold"}
          </Text>
          <Text style={s.payBody}>
            Match instantly with people who've already liked you — plus Top Picks, monthly Boost and advanced filters.
          </Text>
          <TouchableOpacity onPress={() => nav.navigate("Paywall")}>
            <LinearGradient colors={[theme.gold, "#D1367F"]} style={s.payBtn}>
              <Text style={{ color: "#1A1424", fontWeight: "800" }}>Get Dosti Connect Gold</Text>
            </LinearGradient>
          </TouchableOpacity>
          {fnMissing && (
            <Text style={s.devNote}>dev: likes-you function not deployed — showing count only</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 30, fontFamily: theme.serif, fontWeight: "600", color: theme.ink, marginBottom: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cell: { width: "31%", aspectRatio: 3 / 4, borderRadius: 12, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center",
    overflow: "hidden" },
  cellBig: { width: "47.5%" },
  cellActive: { borderColor: "rgba(236,72,153,.45)" },
  cellImg: { ...StyleSheet.absoluteFillObject },
  cellFallback: { alignItems: "center", justifyContent: "center", backgroundColor: theme.card2 },
  initial: { color: "rgba(255,255,255,.4)", fontSize: 34, fontWeight: "800" },
  cellMeta: { position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(10,18,16,.65)", paddingHorizontal: 8, paddingVertical: 5 },
  cellName: { color: "#fff", fontSize: 12, fontWeight: "700" },
  cellNote: { color: "#D8D2E6", fontSize: 10, fontStyle: "italic", marginTop: 2 },
  superBadge: { position: "absolute", top: 6, right: 8, color: "#6FA8C9", fontSize: 16 },
  empty: { color: theme.muted, fontSize: 14 },
  payCard: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: 20, padding: 20, marginTop: 22, alignItems: "center" },
  payIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center",
    justifyContent: "center", marginBottom: 12 },
  payTitle: { color: theme.ink, fontSize: 17, fontWeight: "800", marginBottom: 6 },
  payBody: { color: theme.muted, fontSize: 13, textAlign: "center", lineHeight: 19, marginBottom: 16 },
  payBtn: { borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
  devNote: { color: theme.muted, fontSize: 10, marginTop: 10 },
});
