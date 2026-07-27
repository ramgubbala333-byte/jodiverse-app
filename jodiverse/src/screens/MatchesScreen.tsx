import React, { useCallback, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image, Alert,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { deckPhotoUrls } from "../lib/photos";
import { theme } from "../theme";

type Match = {
  id: string; other: string; name: string; age: number | null;
  photo: string | null; revealed: boolean; matchedAt: string;
};

const REPORT_REASONS = ["Fake profile / scam", "Inappropriate messages",
  "Inappropriate photos", "Underage", "Harassment", "Other"];

// Everyone you've mutually connected with — via a voice call ("talk again"
// from both sides). Photos stay locked until the reveal ladder unlocks them,
// same as MatchProfileScreen. This replaces the old swipe-era "who liked
// me" screen, which no longer has any data to show in a voice-first app.
export default function MatchesScreen() {
  const nav = useNavigation<any>();
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("matches")
        .select("id, a, b, created_at").eq("unmatched", false)
        .order("created_at", { ascending: false });
      if (!data) { setLoading(false); return; }

      const rows = data.map((m) => ({
        id: m.id, other: m.a === user.id ? m.b : m.a, matchedAt: m.created_at,
      }));
      const ids = rows.map((r) => r.other);
      const [{ data: profs }, { data: reveals }] = await Promise.all([
        supabase.from("public_profiles").select("id, display_name, age").in("id", ids),
        supabase.from("reveal_state").select("match_id, level").in("match_id", rows.map((r) => r.id)),
      ]);
      const revealedIds = new Set(
        rows.filter((r) => reveals?.find((rv) => rv.match_id === r.id)?.level === "full")
          .map((r) => r.other));
      // Only sign photo URLs for people who've actually mutually revealed —
      // no point fetching (or exposing) a signed URL that stays locked.
      const urls = revealedIds.size ? await deckPhotoUrls([...revealedIds]) : {};

      setMatches(rows.map((r) => ({
        id: r.id, other: r.other,
        name: profs?.find((p) => p.id === r.other)?.display_name ?? "Match",
        age: profs?.find((p) => p.id === r.other)?.age ?? null,
        photo: urls[r.other] ?? null,
        revealed: revealedIds.has(r.other),
        matchedAt: r.matchedAt,
      })));
      setLoading(false);
    })();
  }, []));

  const onLongPress = (m: Match) => {
    Alert.alert(m.name, "Manage this match", [
      { text: "Cancel", style: "cancel" },
      { text: "Unmatch", style: "destructive", onPress: async () => {
        await supabase.rpc("unmatch", { m: m.id });
        setMatches((ms) => ms.filter((x) => x.id !== m.id));
      }},
      { text: "Report", style: "destructive", onPress: () => {
        Alert.alert("Report " + m.name, "Why are you reporting them?",
          [...REPORT_REASONS.map((r) => ({
            text: r, onPress: async () => {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) return;
              await supabase.from("reports").insert({ reporter: user.id, reported: m.other, reason: r });
              await supabase.from("blocks").insert({ blocker: user.id, blocked: m.other });
              setMatches((ms) => ms.filter((x) => x.id !== m.id));
              Alert.alert("Thank you", "Report received. You won't see each other again.");
            },
          })), { text: "Cancel", style: "cancel" as const }]);
      }},
    ]);
  };

  const openChat = (m: Match) =>
    nav.navigate("Chat", { matchId: m.id, name: m.name, otherId: m.other });
  const openProfile = (m: Match) =>
    nav.navigate("MatchProfile", { otherId: m.other, name: m.name, matchId: m.id });

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Matches</Text>
      <Text style={s.sub}>People you both wanted to keep talking to.</Text>

      <FlatList
        data={matches}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshing={loading}
        onRefresh={() => {}}
        ListEmptyComponent={!loading ? (
          <View style={s.empty}>
            <Ionicons name="heart-outline" size={34} color={theme.muted} />
            <Text style={s.emptyText}>
              No matches yet. Talk to someone new — if you both want to talk again, they'll show up here.
            </Text>
          </View>
        ) : null}
        renderItem={({ item }) => (
          // Sibling touchables (never nested): photo → profile, name → chat.
          <View style={s.row}>
            <TouchableOpacity onPress={() => openProfile(item)} onLongPress={() => onLongPress(item)}>
              {item.revealed && item.photo ? (
                <Image source={{ uri: item.photo }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, s.avatarLocked]}>
                  <Ionicons name={item.revealed ? "person" : "lock-closed"} size={20} color={theme.muted} />
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => openChat(item)}
              onLongPress={() => onLongPress(item)}>
              <Text style={s.name}>{item.name}{item.age ? `, ${item.age}` : ""}</Text>
              <Text style={s.meta}>
                {item.revealed ? "Photos revealed" : "Photos locked — reveal to unlock"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.chatBtn} onPress={() => openChat(item)}>
              <Ionicons name="chatbubble" size={17} color={theme.gold} />
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, padding: 20, paddingTop: 64 },
  title: { fontSize: 30, fontFamily: theme.font.display, letterSpacing: -0.8, color: theme.ink },
  sub: { color: theme.muted, fontSize: 13.5, marginTop: 8, marginBottom: 18 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12,
    borderBottomWidth: 1, borderBottomColor: theme.line },
  avatar: { width: 54, height: 54, borderRadius: 27 },
  avatarLocked: { backgroundColor: theme.card2, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: theme.line },
  name: { fontSize: 16, fontFamily: theme.font.bold, color: theme.ink },
  meta: { fontSize: 12.5, color: theme.muted, marginTop: 3 },
  chatBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.goldSoft,
    alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", marginTop: 60, paddingHorizontal: 30, gap: 12 },
  emptyText: { color: theme.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
