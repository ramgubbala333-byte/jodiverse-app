import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image, Alert, Animated, Easing,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { deckPhotoUrls } from "../lib/photos";
import PressableScale from "../components/PressableScale";
import { haptic } from "../lib/haptics";
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
  const listIn = useRef(new Animated.Value(0)).current;   // P4 entrance

  useEffect(() => {
    Animated.timing(listIn, { toValue: 1, duration: 420,
      easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [listIn]);

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

  const openChat = (m: Match) => {
    haptic.light();
    nav.navigate("Chat", { matchId: m.id, name: m.name, otherId: m.other });
  };
  const openProfile = (m: Match) => {
    haptic.light();
    nav.navigate("MatchProfile", { otherId: m.other, name: m.name, matchId: m.id });
  };

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Your connections</Text>
      <Text style={s.sub}>Photos stay hidden until you both choose to reveal them.</Text>

      <Animated.View style={{ flex: 1, opacity: listIn,
        transform: [{ translateY: listIn.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
      <FlatList
        data={matches}
        keyExtractor={(m) => m.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 14 }}
        contentContainerStyle={{ paddingBottom: 24, gap: 14 }}
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
          <PressableScale style={s.card} haptics="light"
            onPress={() => openProfile(item)} onLongPress={() => onLongPress(item)}>
            <View style={s.cardMedia}>
              {item.revealed && item.photo ? (
                <>
                  <Image source={{ uri: item.photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  <View style={s.revealedPill}>
                    <Ionicons name="checkmark-circle" size={11} color={theme.emerald} />
                    <Text style={s.revealedText}>REVEALED</Text>
                  </View>
                </>
              ) : (
                <View style={s.lockCircle}>
                  <Ionicons name="lock-closed" size={22} color={theme.muted} />
                </View>
              )}
            </View>
            <Text style={s.name} numberOfLines={1}>{item.name}{item.age ? `, ${item.age}` : ""}</Text>
            <View style={s.metaRow}>
              <Ionicons name={item.revealed ? "chatbubble-outline" : "mic-outline"}
                size={12} color={theme.gold} />
              <Text style={s.meta} numberOfLines={1}>
                {item.revealed ? "Tap to chat" : "Tap to view"}
              </Text>
            </View>
          </PressableScale>
        )}
      />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, padding: 20, paddingTop: 64 },
  title: { fontSize: 30, fontFamily: theme.font.display, letterSpacing: -0.8, color: theme.ink },
  sub: { color: theme.muted, fontSize: 13.5, marginTop: 8, marginBottom: 18 },
  card: { flex: 1, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, padding: 10, ...theme.shadow.card },
  cardMedia: { aspectRatio: 3 / 4, borderRadius: theme.radii.md, backgroundColor: theme.card2,
    overflow: "hidden", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  lockCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center", justifyContent: "center" },
  revealedPill: { position: "absolute", top: 8, left: 8, flexDirection: "row", alignItems: "center",
    gap: 4, backgroundColor: "rgba(8,10,18,0.7)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  revealedText: { color: theme.emerald, fontSize: 8.5, fontFamily: theme.font.black, letterSpacing: 0.5 },
  name: { fontSize: 15.5, fontFamily: theme.font.bold, color: theme.ink, paddingHorizontal: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, paddingHorizontal: 2 },
  meta: { fontSize: 12, color: theme.muted, flex: 1 },
  empty: { alignItems: "center", marginTop: 60, paddingHorizontal: 30, gap: 12 },
  emptyText: { color: theme.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
