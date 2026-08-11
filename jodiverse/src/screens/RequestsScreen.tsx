import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

type Req = { id: string; sender: string; name: string; age: number | null;
  city: string | null; body: string; created_at: string };

// Requests: notes from people you haven't matched with yet. Accepting one
// creates the match instantly (their note becomes the first message);
// declining is silent — they're never told, same as an unmatch.
export default function RequestsScreen() {
  const nav = useNavigation<any>();
  const [rows, setRows] = useState<Req[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("my_requests");
    setRows((data as Req[]) ?? []);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const respond = async (r: Req, accept: boolean) => {
    setBusy(r.id);
    const { error } = await supabase.rpc("respond_request", { p_id: r.id, p_accept: accept });
    setBusy(null);
    if (error) { Alert.alert("Couldn't respond", error.message); return; }
    setRows((cur) => (cur ?? []).filter((x) => x.id !== r.id));
    if (accept) {
      Alert.alert("It's a match! 🎉", `You and ${r.name} are now connected.`, [
        { text: "Later", style: "cancel" },
        { text: "Say hi", onPress: () => nav.navigate("Tabs", { screen: "Chat" }) },
      ]);
    }
  };

  if (!rows) return (
    <View style={[s.wrap, s.center]}><ActivityIndicator color={theme.gold} /></View>
  );

  return (
    <View style={s.wrap}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        ListHeaderComponent={
          <Text style={s.sub}>
            People who reached out before matching. Accept to connect instantly —
            declining is private, they're never told.
          </Text>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="mail-open-outline" size={34} color={theme.muted} />
            <Text style={s.emptyText}>
              No Requests yet. When someone sends you a note, it'll land here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.card}>
            <TouchableOpacity style={s.head}
              onPress={() => nav.navigate("MatchProfile", { otherId: item.sender, name: item.name })}>
              <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={s.avatar}>
                <Text style={s.avatarText}>{item.name?.[0]?.toUpperCase() ?? "?"}</Text>
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{item.name}{item.age ? `, ${item.age}` : ""}</Text>
                {item.city ? <Text style={s.city}>{item.city}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.muted} />
            </TouchableOpacity>

            <View style={s.quote}>
              <Ionicons name="chatbox" size={14} color={theme.gold} />
              <Text style={s.quoteText}>{item.body}</Text>
            </View>

            <View style={s.actions}>
              <TouchableOpacity style={s.decline} onPress={() => respond(item, false)}
                disabled={busy === item.id}>
                <Text style={s.declineText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => respond(item, true)}
                disabled={busy === item.id}>
                <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={s.accept}>
                  {busy === item.id ? <ActivityIndicator color="#fff" />
                    : <Text style={s.acceptText}>Accept & match</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { alignItems: "center", justifyContent: "center" },
  sub: { color: theme.muted, fontSize: 13, lineHeight: 19, marginBottom: 18 },
  card: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, padding: 16, marginBottom: 14, ...theme.shadow.card },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontFamily: theme.font.black, fontSize: 18 },
  name: { color: theme.ink, fontSize: 16, fontFamily: theme.font.bold },
  city: { color: theme.muted, fontSize: 12.5, marginTop: 2 },
  quote: { flexDirection: "row", gap: 9, backgroundColor: theme.goldSoft,
    borderRadius: theme.radii.md, padding: 13, marginTop: 14 },
  quoteText: { color: theme.ink, fontSize: 14, lineHeight: 20, flex: 1 },
  actions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  decline: { paddingHorizontal: 18, paddingVertical: 13, borderRadius: 999,
    borderWidth: 1, borderColor: theme.line },
  declineText: { color: theme.muted, fontFamily: theme.font.bold, fontSize: 14 },
  accept: { borderRadius: 999, paddingVertical: 14, alignItems: "center", ...theme.shadow.cta },
  acceptText: { color: "#fff", fontFamily: theme.font.black, fontSize: 14.5 },
  empty: { alignItems: "center", marginTop: 60, paddingHorizontal: 30, gap: 12 },
  emptyText: { color: theme.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
