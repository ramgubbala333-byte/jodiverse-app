import React, { useCallback, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Image, Alert,
  TextInput, ScrollView } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { deckPhotoUrls } from "../lib/photos";
import { theme } from "../theme";

type M = { id: string; other: string; other_name: string; photo: string | null;
  revealed: boolean; last: string | null; matched_at: string };

const REPORT_REASONS = ["Fake profile / scam", "Inappropriate messages",
  "Inappropriate photos", "Underage", "Harassment", "Other"];

type Stale = { match_id: string; other_id: string; other_name: string;
  shared_interest: string | null; matched_at: string };

export default function ChatsScreen() {
  const [matches, setMatches] = useState<M[]>([]);
  const [stale, setStale] = useState<Stale[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const nav = useNavigation<any>();

  useFocusEffect(useCallback(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      supabase.rpc("stale_matches").then(({ data }) => setStale((data as Stale[]) ?? []));
      const { data } = await supabase.from("matches")
        .select("id, a, b, created_at").eq("unmatched", false)
        .order("created_at", { ascending: false });
      if (!data) return;
      const others = data.map((m) => ({
        id: m.id, other: m.a === user.id ? m.b : m.a, matched_at: m.created_at,
      }));
      const ids = others.map((o) => o.other);
      const [{ data: profs }, { data: reveals }] = await Promise.all([
        supabase.from("public_profiles").select("id, display_name").in("id", ids),
        supabase.from("reveal_state").select("match_id, level").in("match_id", others.map((o) => o.id)),
      ]);
      const revealedIds = new Set(
        others.filter((o) => reveals?.find((rv) => rv.match_id === o.id)?.level === "full")
          .map((o) => o.other));
      // Only sign photo URLs for people who've mutually revealed — locked
      // matches show initials instead, same rule as MatchProfileScreen.
      const urls = revealedIds.size ? await deckPhotoUrls([...revealedIds]) : {};
      // Last message per match — fine at this scale; page it later.
      const lasts = await Promise.all(others.map(async (o) => {
        const { data: msg } = await supabase.from("messages")
          .select("body").eq("match_id", o.id)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        return msg?.body ?? null;
      }));
      setMatches(others.map((o, i) => ({
        id: o.id,
        other: o.other,
        other_name: profs?.find((p) => p.id === o.other)?.display_name ?? "Match",
        photo: urls[o.other] ?? null,
        revealed: revealedIds.has(o.other),
        last: lasts[i],
        matched_at: o.matched_at,
      })));
    })();
  }, []));

  const report = async (m: M, reason: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("reports").insert({ reporter: user.id, reported: m.other, reason });
    // Reporting also blocks — kills the chat both ways, silently.
    await supabase.from("blocks").insert({ blocker: user.id, blocked: m.other });
    setMatches((ms) => ms.filter((x) => x.id !== m.id));
    Alert.alert("Thank you", "Report received. You won't see each other again.");
  };

  const onLongPress = (m: M) => {
    Alert.alert(m.other_name, "Manage this match", [
      { text: "Cancel", style: "cancel" },
      { text: "Unmatch", style: "destructive", onPress: async () => {
        await supabase.rpc("unmatch", { m: m.id });
        setMatches((ms) => ms.filter((x) => x.id !== m.id));
      }},
      { text: "Report", style: "destructive", onPress: () => {
        Alert.alert("Report " + m.other_name, "Why are you reporting them?",
          [...REPORT_REASONS.map((r) => ({ text: r, onPress: () => report(m, r) })),
           { text: "Cancel", style: "cancel" as const }]);
      }},
    ]);
  };

  const openerFor = (st: Stale) =>
    st.shared_interest
      ? `Hey ${st.other_name}! We both love ${st.shared_interest.toLowerCase()} — what got you into it?`
      : `Hey ${st.other_name}! Really enjoyed talking the other day — how's your week going?`;

  const sayHi = async (st: Stale) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("messages").insert({
      match_id: st.match_id, sender: user.id, body: openerFor(st),
    });
    setStale((xs) => xs.filter((x) => x.match_id !== st.match_id));
    nav.navigate("Chat", { matchId: st.match_id, name: st.other_name, otherId: st.other_id });
  };

  const nudge = stale.find((st) => !dismissed.has(st.match_id));

  const q = query.trim().toLowerCase();
  const filtered = q ? matches.filter((m) => m.other_name.toLowerCase().includes(q)) : matches;
  const newJodis = filtered.filter((m) => !m.last);       // matched, not yet chatting
  const convos = filtered.filter((m) => !!m.last);        // active conversations

  // Photo shown once mutually revealed; otherwise the person's initial — NOT a
  // padlock. A lock icon reads as "you're blocked", but chat is always open here;
  // photos are just hidden until you both reveal (a tiny badge hints at that).
  const Avatar = ({ m, size }: { m: M; size: number }) => m.revealed && m.photo ? (
    <Image source={{ uri: m.photo }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  ) : (
    <View>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.card2,
        alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.line }}>
        <Text style={{ color: theme.ink, fontWeight: "700", fontSize: size / 2.6 }}>
          {m.other_name[0]?.toUpperCase() ?? "?"}
        </Text>
      </View>
      {!m.revealed && (
        <View style={{ position: "absolute", right: -1, bottom: -1, width: size / 3, height: size / 3,
          borderRadius: size / 6, backgroundColor: theme.card, alignItems: "center", justifyContent: "center",
          borderWidth: 1.5, borderColor: theme.bg }}>
          <Ionicons name="lock-closed" size={size / 6} color={theme.muted} />
        </View>
      )}
    </View>
  );

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Chats</Text>
      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={theme.muted} />
        <TextInput style={s.search} value={query} onChangeText={setQuery}
          placeholder={`Search ${matches.length} match${matches.length === 1 ? "" : "es"}`}
          placeholderTextColor={theme.muted} />
      </View>

      {nudge && (
        <View style={s.nudge}>
          <View style={s.nudgeHead}>
            <Ionicons name="sparkles" size={15} color={theme.gold} />
            <Text style={s.nudgeTitle}>You both wanted to keep talking</Text>
            <TouchableOpacity onPress={() => setDismissed((d) => new Set(d).add(nudge.match_id))}>
              <Ionicons name="close" size={16} color={theme.muted} />
            </TouchableOpacity>
          </View>
          <Text style={s.nudgeBody}>
            You and {nudge.other_name} clicked but never messaged. Break the ice:
          </Text>
          <Text style={s.nudgeOpener}>"{openerFor(nudge)}"</Text>
          <View style={s.nudgeRow}>
            <TouchableOpacity style={s.nudgeSend} onPress={() => sayHi(nudge)}>
              <Text style={s.nudgeSendText}>Send this</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.nudgeGhost}
              onPress={() => nav.navigate("Chat",
                { matchId: nudge.match_id, name: nudge.other_name, otherId: nudge.other_id })}>
              <Text style={s.nudgeGhostText}>Write my own</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={s.section}>New friends</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 14, paddingRight: 10 }}>
        {newJodis.map((m) => (
          <TouchableOpacity key={m.id} style={s.newItem}
            onPress={() => nav.navigate("Chat", { matchId: m.id, name: m.other_name, otherId: m.other })}
            onLongPress={() => onLongPress(m)}>
            <View style={s.newRing}><Avatar m={m} size={62} /></View>
            <Text style={s.newName} numberOfLines={1}>{m.other_name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={s.section}>Messages</Text>
      <FlatList
        data={convos}
        keyExtractor={(m) => m.id}
        ListEmptyComponent={
          <Text style={s.empty}>
            {matches.length ? "Say hi to your new friends above 👆" : "Talk to someone to start chatting."}
          </Text>
        }
        renderItem={({ item }) => (
          // Sibling touchables (never nested): avatar → profile, rest of row → chat.
          <View style={s.row}>
            <TouchableOpacity onPress={() => nav.navigate("MatchProfile",
              { otherId: item.other, name: item.other_name, matchId: item.id })}>
              <Avatar m={item} size={54} />
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1 }}
              onPress={() => nav.navigate("Chat",
                { matchId: item.id, name: item.other_name, otherId: item.other })}
              onLongPress={() => onLongPress(item)}>
              <Text style={s.name}>{item.other_name}</Text>
              <Text style={s.preview} numberOfLines={1}>{item.last}</Text>
            </TouchableOpacity>
            <Ionicons name="chevron-forward" size={18} color={theme.muted} />
          </View>
        )}
      />
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, padding: 20, paddingTop: 64 },
  title: { fontSize: 30, fontFamily: theme.font.display, letterSpacing: -0.8, color: theme.ink, marginBottom: 12 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: 12, paddingHorizontal: 12, marginBottom: 6 },
  search: { flex: 1, paddingVertical: 9, color: theme.ink, fontSize: 14 },
  section: { color: theme.rose, fontSize: 13, fontWeight: "800", marginTop: 14, marginBottom: 10 },
  nudge: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.gold,
    borderRadius: 16, padding: 15, marginTop: 12 },
  nudgeHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  nudgeTitle: { color: theme.gold, fontSize: 13.5, fontWeight: "800", flex: 1 },
  nudgeBody: { color: theme.muted, fontSize: 13, marginTop: 8, lineHeight: 18 },
  nudgeOpener: { color: theme.ink, fontSize: 14, fontStyle: "italic", marginTop: 8,
    lineHeight: 20 },
  nudgeRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  nudgeSend: { flex: 1, backgroundColor: theme.gold, borderRadius: 999, paddingVertical: 11,
    alignItems: "center" },
  nudgeSendText: { color: theme.onGold, fontWeight: "800", fontSize: 13.5 },
  nudgeGhost: { flex: 1, borderWidth: 1, borderColor: theme.line, borderRadius: 999,
    paddingVertical: 11, alignItems: "center" },
  nudgeGhostText: { color: theme.ink, fontWeight: "700", fontSize: 13.5 },
  newItem: { alignItems: "center", width: 68 },
  newRing: { borderWidth: 2, borderColor: theme.rose, borderRadius: 35, padding: 2 },
  newName: { color: theme.ink, fontSize: 12, fontWeight: "600", marginTop: 5 },
  empty: { color: theme.muted, marginTop: 24, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12,
    borderBottomWidth: 1, borderBottomColor: theme.line },
  name: { fontSize: 16, fontWeight: "700", color: theme.ink },
  preview: { fontSize: 13, color: theme.muted, marginTop: 3 },
});
