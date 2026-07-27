import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

// LoveAI-style home dashboard: welcome card, feature tiles, stat tiles.
// Reached from the deck header; the deck itself stays on the Home tab.
export default function DashboardScreen() {
  const [name, setName] = useState("");
  const [deckCount, setDeckCount] = useState<number | null>(null);
  const [likesCount, setLikesCount] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [chatCount, setChatCount] = useState(0);
  const nav = useNavigation<any>();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: prof }, { data: deck }, { data: likes }, { data: matches }] =
        await Promise.all([
          supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
          supabase.rpc("get_deck", { limit_n: 50 }),
          supabase.rpc("likes_you_count"),
          supabase.from("matches").select("id, last_message_at")
            .or(`a.eq.${user.id},b.eq.${user.id}`),
        ]);
      setName(prof?.display_name ?? "");
      setDeckCount(deck?.length ?? 0);
      setLikesCount(likes ?? 0);
      setMatchCount(matches?.length ?? 0);
      setChatCount((matches ?? []).filter((m: any) => m.last_message_at).length);
    })();
  }, []);

  const soon = (title: string) => () =>
    Alert.alert(title, "Coming soon — we're building this right now. 💜");

  const TILES = [
    ["sparkles", theme.purple, "Smart Profile Builder", "Let AI enhance your profile",
      () => nav.navigate("Tabs", { screen: "Profile" })],
    ["calendar", theme.gold, "AI Date Planner", "Plan the perfect date with AI", soon("AI Date Planner")],
    ["videocam", theme.info, "Voice & Video Dating", "Connect beyond text messages", soon("Voice & Video Dating")],
    ["trending-up", theme.emerald, "Relationship Insights", "Understand your connections", soon("Relationship Insights")],
  ] as const;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.body}>
      {/* welcome card */}
      <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.welcome}>
        <View style={s.welcomeIcon}><Ionicons name="heart" size={26} color={theme.gold} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.welcomeTitle}>Welcome{name ? ` back, ${name}` : " to Dosti Connect"}!</Text>
          <Text style={s.welcomeSub}>
            {deckCount === null ? "Your matchmaker is looking for compatible profiles…"
              : `Your matchmaker found ${deckCount} compatible profile${deckCount === 1 ? "" : "s"}`}
          </Text>
        </View>
      </LinearGradient>

      {/* feature tiles */}
      <View style={s.tileGrid}>
        {TILES.map(([icon, color, title, sub, onPress]) => (
          <TouchableOpacity key={title} style={[s.tile, { backgroundColor: color }]}
            activeOpacity={0.85} onPress={onPress}>
            <View style={s.tileIcon}><Ionicons name={icon as any} size={18} color={color} /></View>
            <Text style={s.tileTitle}>{title}</Text>
            <Text style={s.tileSub}>{sub}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* stat tiles */}
      <View style={s.statRow}>
        {[
          ["heart", matchCount, "Matches", () => nav.navigate("Tabs", { screen: "Matches" })],
          ["eye", likesCount, "Likes You", () => nav.navigate("Tabs", { screen: "Matches" })],
          ["chatbubble", chatCount, "Chats", () => nav.navigate("Tabs", { screen: "Chat" })],
        ].map(([icon, val, label, onPress]: any) => (
          <TouchableOpacity key={label} style={s.statTile} onPress={onPress}>
            <View style={s.statIcon}><Ionicons name={icon} size={16} color={theme.gold} /></View>
            <Text style={s.statVal}>{val}</Text>
            <Text style={s.statLabel}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  body: { padding: 18, paddingBottom: 32 },
  welcome: { borderRadius: 18, padding: 18, flexDirection: "row", alignItems: "center", gap: 14 },
  welcomeIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center" },
  welcomeTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  welcomeSub: { color: "rgba(255,255,255,.9)", fontSize: 13, marginTop: 4, lineHeight: 18 },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16 },
  tile: { width: "48%", flexGrow: 1, borderRadius: 16, padding: 16, minHeight: 130 },
  tileIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center", marginBottom: 10 },
  tileTitle: { color: "#fff", fontSize: 14.5, fontWeight: "800" },
  tileSub: { color: "rgba(255,255,255,.85)", fontSize: 11.5, marginTop: 4, lineHeight: 16 },
  statRow: { flexDirection: "row", gap: 12, marginTop: 16 },
  statTile: { flex: 1, backgroundColor: theme.card, borderRadius: 16, padding: 14,
    alignItems: "center", borderWidth: 1, borderColor: theme.line },
  statIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.goldSoft,
    alignItems: "center", justifyContent: "center", marginBottom: 6 },
  statVal: { color: theme.gold, fontSize: 19, fontWeight: "800" },
  statLabel: { color: theme.muted, fontSize: 11.5, marginTop: 2, fontWeight: "600" },
});
