import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
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
      numColumns={2}
      columnWrapperStyle={{ gap: 12 }}
      contentContainerStyle={{ padding: 16, paddingTop: 56, paddingBottom: 28 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.gold}
        onRefresh={() => { setRefreshing(true); load(); }} />}
      ListHeaderComponent={
        <View style={{ marginBottom: 8 }}>
          <Text style={s.title}>Lounges</Text>
          <Text style={s.sub}>Live rooms. Drop in, listen, join the conversation.</Text>
        </View>
      }
      renderItem={({ item: l }) => {
        const total = l.listeners + l.speakers;
        return (
          <TouchableOpacity style={s.card} activeOpacity={0.9}
            onPress={() => nav.navigate("LoungeRoom", { loungeId: l.id, topic: l.topic, title: l.title })}>
            <LinearGradient colors={[...(GRAD[l.topic] ?? theme.grad)]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Text style={s.emoji}>{EMOJI[l.topic] ?? "🎙️"}</Text>
            <View style={{ flex: 1 }} />
            <Text style={s.cardTitle}>{l.title}</Text>
            <View style={s.liveRow}>
              {total > 0 ? (
                <>
                  <View style={s.liveDot} />
                  <Text style={s.liveText}>{total} here · {l.speakers} talking</Text>
                </>
              ) : (
                <Text style={s.emptyText}>Start the room</Text>
              )}
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { alignItems: "center", justifyContent: "center" },
  title: { color: theme.ink, fontSize: 30, fontFamily: theme.font.display, letterSpacing: -0.8 },
  sub: { color: theme.muted, fontSize: 14, marginTop: 8 },
  card: { flex: 1, aspectRatio: 1, borderRadius: theme.radii.lg, overflow: "hidden", padding: 15,
    marginBottom: 12, ...theme.shadow.card },
  emoji: { fontSize: 30 },
  cardTitle: { color: "#fff", fontSize: 16, fontFamily: theme.font.black, lineHeight: 20 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#fff" },
  liveText: { color: "rgba(255,255,255,.95)", fontSize: 11.5, fontFamily: theme.font.bold },
  emptyText: { color: "rgba(255,255,255,.8)", fontSize: 11.5, fontFamily: theme.font.bold },
});
