import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Image, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { deckPhotoUrls } from "../lib/photos";
import { theme } from "../theme";

type P = {
  id: string; display_name: string; age: number; city: string | null;
  is_verified: boolean; distance_band: string | null; new_here: boolean;
  occupation: string | null; relationship_goal: string | null;
  recently_active: boolean;
};

// Tinder-Explore-style vibes: each card filters the ranked deck pool by
// intent (relationship_goal) or activity flags. Gradient art, no stock
// photos — everything ships in the bundle.
type Vibe = {
  key: string; title: string; tag: string; emoji: string;
  grad: readonly [string, string];
  filter: (p: P) => boolean;
};

const VIBES: Vibe[] = [
  { key: "love", title: "Looking\nfor love.", tag: "Sweep me off my feet", emoji: "💞",
    grad: ["#F97316", "#EC4899"], filter: (p) => p.relationship_goal === "Life partner" },
  { key: "serious", title: "Something\nserious.", tag: "Down for commitment", emoji: "💍",
    grad: ["#7C3AED", "#4F46E5"], filter: (p) => p.relationship_goal === "Long-term" },
  { key: "open", title: "Open to\nshort.", tag: "Let's see where it goes", emoji: "🌊",
    grad: ["#0EA5E9", "#14B8A6"], filter: (p) => p.relationship_goal === "Long-term, open to short" },
  { key: "vibes", title: "Just\nvibing.", tag: "No pressure, no labels", emoji: "🎈",
    grad: ["#F59E0B", "#EF4444"], filter: (p) => p.relationship_goal === "Still figuring it out" },
  { key: "new", title: "New\nhere.", tag: "Fresh faces this week", emoji: "✨",
    grad: ["#EC4899", "#A855F7"], filter: (p) => p.new_here },
  { key: "active", title: "Active\nnow.", tag: "Online and ready to chat", emoji: "⚡",
    grad: ["#10B981", "#059669"], filter: (p) => p.recently_active },
];

export default function DiscoverScreen() {
  const [people, setPeople] = useState<P[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const nav = useNavigation<any>();

  const load = useCallback(async () => {
    // get_deck is a SECURITY DEFINER RPC — the only path to strangers' profiles.
    const { data } = await supabase.rpc("get_deck", { limit_n: 50 });
    if (data) {
      setPeople(data as P[]);
      setPhotos(await deckPhotoUrls((data as P[]).map((p) => p.id)));
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={[s.wrap, s.center]}>
        <ActivityIndicator color={theme.gold} />
      </View>
    );
  }

  // ── profile grid for a selected vibe ────────────────────────────────────
  if (vibe) {
    const matched = people.filter(vibe.filter);
    return (
      <View style={s.wrap}>
        <View style={s.vibeHeader}>
          <TouchableOpacity onPress={() => setVibe(null)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={22} color={theme.gold} />
          </TouchableOpacity>
          <Text style={s.vibeHeaderTitle}>{vibe.emoji} {vibe.title.replace("\n", " ")}</Text>
          <View style={{ width: 22 }} />
        </View>
        <FlatList
          data={matched}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={s.gridRow}
          contentContainerStyle={s.grid}
          refreshControl={
            <RefreshControl refreshing={refreshing} tintColor={theme.gold}
              onRefresh={() => { setRefreshing(true); load(); }} />
          }
          ListEmptyComponent={
            <Text style={s.empty}>No one with this vibe right now. Pull to refresh.</Text>
          }
          renderItem={({ item: p }) => (
            <TouchableOpacity style={s.card} activeOpacity={0.85}
              onPress={() => nav.navigate("MatchProfile", { otherId: p.id, name: p.display_name })}>
              {photos[p.id] ? (
                <Image source={{ uri: photos[p.id] }} style={s.photo} />
              ) : (
                <View style={[s.photo, s.noPhoto]}>
                  <Ionicons name="person" size={40} color={theme.muted} />
                </View>
              )}
              <LinearGradient colors={["transparent", "rgba(0,0,0,0.75)"]} style={s.shade} />
              {p.new_here && (
                <View style={s.newBadge}><Text style={s.newBadgeText}>New here</Text></View>
              )}
              <View style={s.cardFooter}>
                <View style={s.nameRow}>
                  <Text style={s.name} numberOfLines={1}>{p.display_name}, {p.age}</Text>
                  {p.is_verified && <Ionicons name="shield-checkmark" size={14} color={theme.gold} />}
                </View>
                {p.distance_band ? <Text style={s.sub}>{p.distance_band}</Text>
                  : p.occupation ? <Text style={s.sub} numberOfLines={1}>{p.occupation}</Text> : null}
              </View>
            </TouchableOpacity>
          )}
        />
      </View>
    );
  }

  // ── vibe cards (Explore landing) ────────────────────────────────────────
  return (
    <FlatList
      style={s.wrap}
      data={VIBES}
      keyExtractor={(v) => v.key}
      numColumns={2}
      columnWrapperStyle={s.gridRow}
      contentContainerStyle={s.grid}
      refreshControl={
        <RefreshControl refreshing={refreshing} tintColor={theme.gold}
          onRefresh={() => { setRefreshing(true); load(); }} />
      }
      ListHeaderComponent={
        <View style={{ marginBottom: 6 }}>
          <Text style={s.title}>Welcome to Explore</Text>
          <Text style={s.subtitle}>My Vibe…</Text>
        </View>
      }
      renderItem={({ item: v }) => {
        const count = people.filter(v.filter).length;
        return (
          <TouchableOpacity style={s.vibeCard} activeOpacity={0.9} onPress={() => setVibe(v)}>
            <LinearGradient colors={[...v.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill} />
            <Text style={s.vibeEmoji}>{v.emoji}</Text>
            <View style={{ flex: 1 }} />
            <Text style={s.vibeTitle}>{v.title}</Text>
            <Text style={s.vibeTag}>{v.tag}</Text>
            <Text style={s.vibeDiscover}>
              Discover{count > 0 ? ` · ${count}` : ""}
            </Text>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { alignItems: "center", justifyContent: "center" },
  title: { color: theme.ink, fontSize: 24, fontWeight: "800",
    paddingTop: 56, paddingBottom: 2 },
  subtitle: { color: theme.muted, fontSize: 15, fontWeight: "700", paddingBottom: 8 },
  grid: { paddingHorizontal: 16, paddingBottom: 24 },
  gridRow: { gap: 12 },

  // vibe cards
  vibeCard: { flex: 1, aspectRatio: 3 / 4, borderRadius: 18, overflow: "hidden",
    marginBottom: 12, padding: 14 },
  vibeEmoji: { fontSize: 26 },
  vibeTitle: { color: "#fff", fontSize: 24, fontWeight: "900", lineHeight: 29 },
  vibeTag: { color: "rgba(255,255,255,.95)", fontSize: 12.5, fontWeight: "700", marginTop: 8 },
  vibeDiscover: { color: "rgba(255,255,255,.75)", fontSize: 11, fontWeight: "700",
    marginTop: 3, textTransform: "uppercase", letterSpacing: 0.5 },

  // vibe header (drill-in)
  vibeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingTop: 54, paddingBottom: 12,
    backgroundColor: theme.card, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line },
  vibeHeaderTitle: { color: theme.ink, fontSize: 16, fontWeight: "800" },

  // profile cards (same look as before)
  card: { flex: 1, aspectRatio: 3 / 4, borderRadius: 16, overflow: "hidden",
    marginBottom: 12, backgroundColor: theme.card, marginTop: 12 },
  photo: { ...StyleSheet.absoluteFillObject, width: undefined, height: undefined },
  noPhoto: { alignItems: "center", justifyContent: "center" },
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "45%" },
  newBadge: { position: "absolute", top: 8, left: 8, backgroundColor: theme.gold,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  newBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  cardFooter: { position: "absolute", left: 10, right: 10, bottom: 8 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { color: "#fff", fontSize: 15, fontWeight: "800", flexShrink: 1 },
  sub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 1 },
  empty: { color: theme.muted, textAlign: "center", marginTop: 60, fontSize: 14,
    paddingHorizontal: 30, lineHeight: 20 },
});
