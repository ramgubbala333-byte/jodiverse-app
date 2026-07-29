import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import PressableScale from "../components/PressableScale";
import { theme } from "../theme";

type Lounge = { id: string; topic: string; title: string; listeners: number; speakers: number };

const EMOJI: Record<string, string> = {
  travel: "✈️", music: "🎵", movies: "🎬", fitness: "🏋️", food: "🍜", books: "📚",
  gaming: "🎮", cricket: "🏏", startups: "🚀", anime: "🌸", finance: "📈", football: "⚽",
};
const GRAD: Record<string, readonly [string, string]> = {
  travel: ["#0EA5E9", "#14B8A6"], music: ["#EC4899", "#A855F7"], movies: ["#F59E0B", "#EF4444"],
  fitness: ["#10B981", "#059669"], food: ["#F97316", "#EC4899"], books: ["#6366F1", "#4F46E5"],
  gaming: ["#8B5CF6", "#6366F1"], cricket: ["#22C55E", "#16A34A"], startups: ["#F59E0B", "#D97706"],
  anime: ["#EC4899", "#DB2777"], finance: ["#14B8A6", "#0D9488"], football: ["#3B82F6", "#2563EB"],
};

// Live audio rooms per interest. Another way to meet naturally — listen in,
// raise a hand, then invite someone into a private call.
export default function LoungesScreen() {
  const nav = useNavigation<any>();
  const [lounges, setLounges] = useState<Lounge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("list_lounges");
    if (data) setLounges(data as Lounge[]);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return <View style={[s.wrap, s.center]}><ActivityIndicator color={theme.gold} /></View>;
  }

  return (
    <FlatList
      style={s.wrap}
      data={lounges}
      keyExtractor={(l) => l.id}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 56, paddingBottom: 28, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.gold}
        onRefresh={() => { setRefreshing(true); load(); }} />}
      ListHeaderComponent={
        <View style={{ marginBottom: 6 }}>
          <Text style={s.eyebrow}>HAPPENING NOW</Text>
          <Text style={s.title}>Voice Lounges</Text>
          <Text style={s.sub}>Live rooms. Drop in, listen, join the conversation.</Text>
        </View>
      }
      renderItem={({ item: l }) => {
        const total = l.listeners + l.speakers;
        const live = total > 0;
        return (
          <PressableScale style={s.card} scaleTo={0.98} haptics="light"
            onPress={() => nav.navigate("LoungeRoom", { loungeId: l.id, topic: l.topic, title: l.title })}>
            <LinearGradient colors={[...(GRAD[l.topic] ?? theme.grad)]}
              start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.accent} />
            <View style={s.cardTop}>
              {live ? (
                <View style={s.livePill}>
                  <View style={s.liveDot} /><Text style={s.liveText}>LIVE</Text>
                </View>
              ) : (
                <View style={s.quietPill}><Text style={s.quietText}>QUIET</Text></View>
              )}
              <View style={s.listenerRow}>
                <Ionicons name="people" size={14} color={theme.muted} />
                <Text style={s.listenerText}>{total}</Text>
              </View>
            </View>
            <Text style={s.cardTitle}>{EMOJI[l.topic] ?? "🎙️"}  {l.title}</Text>
            <Text style={s.cardSub}>
              {live ? `${l.speakers} talking now · ${l.listeners} listening` : "Be the first to start this room"}
            </Text>
          </PressableScale>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { alignItems: "center", justifyContent: "center" },
  eyebrow: { color: theme.gold, fontSize: 11, fontFamily: theme.font.black, letterSpacing: 2 },
  title: { color: theme.ink, fontSize: 28, fontFamily: theme.font.display, letterSpacing: -0.8, marginTop: 6 },
  sub: { color: theme.muted, fontSize: 14, marginTop: 8 },
  card: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, padding: 18, paddingLeft: 22, overflow: "hidden", ...theme.shadow.card },
  accent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(46,230,214,0.12)",
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.emerald },
  liveText: { color: theme.emerald, fontSize: 10.5, fontFamily: theme.font.black, letterSpacing: 1 },
  quietPill: { backgroundColor: theme.card2, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  quietText: { color: theme.muted, fontSize: 10.5, fontFamily: theme.font.black, letterSpacing: 1 },
  listenerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  listenerText: { color: theme.muted, fontSize: 13, fontFamily: theme.font.bold },
  cardTitle: { color: theme.ink, fontSize: 17, fontFamily: theme.font.bold, lineHeight: 23 },
  cardSub: { color: theme.muted, fontSize: 13, marginTop: 6, lineHeight: 18 },
});
