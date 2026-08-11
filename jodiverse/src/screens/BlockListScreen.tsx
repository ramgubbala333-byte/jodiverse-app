import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

type Blocked = { blocked: string; name: string; city: string | null; created_at: string };

// Blocking was previously one-way and invisible: you could block someone but
// never see the list or undo it, so a mis-tap was permanent. Both stores also
// expect a reachable, reversible block list.
export default function BlockListScreen() {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Blocked[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("my_blocks");
    setRows((data as Blocked[]) ?? []);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const unblock = (b: Blocked) => {
    Alert.alert(`Unblock ${b.name}?`,
      "They'll be able to see you in Discover again. This does not restore any match you had before.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unblock",
          onPress: async () => {
            setBusy(b.blocked);
            const { error } = await supabase.rpc("unblock", { p_user: b.blocked });
            setBusy(null);
            if (error) { Alert.alert("Couldn't unblock", error.message); return; }
            setRows((cur) => (cur ?? []).filter((x) => x.blocked !== b.blocked));
          },
        },
      ]);
  };

  if (!rows) return (
    <View style={[s.wrap, s.center]}><ActivityIndicator color={theme.gold} /></View>
  );

  return (
    <View style={s.wrap}>
      <FlatList
        data={rows}
        keyExtractor={(b) => b.blocked}
        contentContainerStyle={{ padding: 20, paddingBottom: 30 + insets.bottom }}
        ListHeaderComponent={
          <Text style={s.sub}>
            Blocked people can't see you and you won't see them. They're never
            told they were blocked.
          </Text>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="shield-checkmark-outline" size={34} color={theme.muted} />
            <Text style={s.emptyText}>
              You haven't blocked anyone. You can block or report from any
              profile or chat.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.row}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{item.name?.[0]?.toUpperCase() ?? "?"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{item.name}</Text>
              <Text style={s.meta}>
                {item.city ? `${item.city} · ` : ""}
                blocked {new Date(item.created_at).toLocaleDateString()}
              </Text>
            </View>
            <TouchableOpacity style={s.btn} onPress={() => unblock(item)}
              disabled={busy === item.blocked}>
              {busy === item.blocked
                ? <ActivityIndicator size="small" color={theme.gold} />
                : <Text style={s.btnText}>Unblock</Text>}
            </TouchableOpacity>
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
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, borderRadius: theme.radii.md,
    padding: 14, marginBottom: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.card2,
    alignItems: "center", justifyContent: "center" },
  avatarText: { color: theme.ink, fontFamily: theme.font.black, fontSize: 16 },
  name: { color: theme.ink, fontSize: 15, fontFamily: theme.font.bold },
  meta: { color: theme.muted, fontSize: 12, marginTop: 2 },
  btn: { borderWidth: 1, borderColor: theme.line, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 9, minWidth: 84, alignItems: "center" },
  btnText: { color: theme.gold, fontSize: 13, fontFamily: theme.font.bold },
  empty: { alignItems: "center", marginTop: 60, paddingHorizontal: 30, gap: 12 },
  emptyText: { color: theme.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
