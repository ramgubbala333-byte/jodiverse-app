import React, { useCallback, useState, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, ActivityIndicator, Image, FlatList, Animated, Easing,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import AuroraShaderBackdrop from "../components/AuroraShaderBackdrop";
import PressableScale from "../components/PressableScale";
import { theme } from "../theme";

type Liker = { id?: string; name?: string; age?: number | null; photo: string | null;
  super?: boolean; free?: boolean };

export default function LikesScreen() {
  const nav = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [count, setCount] = useState(0);
  const [likers, setLikers] = useState<Liker[]>([]);
  const [daysToReveal, setDaysToReveal] = useState<number | null>(null);

  // Breathing pulse for free card & upgrade button
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const listFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Hold the handle so it can be stopped — an unstopped loop outlives the
    // screen and keeps ticking for as long as the app is open.
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("likes-you");
    if (!error && data) {
      setSubscribed(!!data.subscribed);
      setCount(data.count ?? 0);
      setLikers(data.subscribed ? (data.likers ?? []) : (data.previews ?? []));
      setDaysToReveal(data.daysToReveal ?? null);
    }
    setLoading(false);
    Animated.timing(listFade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [listFade]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return (
    <View style={s.center}><AuroraShaderBackdrop /><ActivityIndicator color={theme.gold} /></View>
  );

  return (
    <View style={s.wrap}>
      <AuroraShaderBackdrop />
      <View style={s.header}>
        <Text style={s.title}>{count} {count === 1 ? "person likes" : "people like"} you</Text>
        <Text style={s.sub}>
          {subscribed ? "You can see everyone unblurred." : "One full reveal a week, free — upgrade for all."}
        </Text>
      </View>

      <Animated.View style={{ flex: 1, opacity: listFade }}>
        <FlatList
          data={likers}
          keyExtractor={(_, i) => String(i)}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: subscribed ? 30 : 130, gap: 12 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="heart-outline" size={34} color={theme.muted} />
              <Text style={s.emptyText}>No likes yet. Keep exploring — they'll show up here.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const clear = subscribed || item.free;
            return (
              <PressableScale
                style={[s.card, item.free && !subscribed && s.freeCardBorder]}
                onPress={() => {
                  if (clear && item.id) {
                    nav.navigate("MatchProfile", { otherId: item.id, name: item.name || "Match" });
                  } else if (!subscribed) {
                    nav.navigate("Paywall");
                  }
                }}
                haptics={clear ? "light" : "medium"}
                scaleTo={0.97}
              >
                {clear && item.photo ? (
                  <Image source={{ uri: item.photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : item.photo ? (
                  <Image source={{ uri: item.photo }} style={[StyleSheet.absoluteFill, s.blurredImg]}
                    resizeMode="cover" blurRadius={18} />
                ) : (
                  <View style={[StyleSheet.absoluteFill, s.placeholder]} />
                )}
                <View style={StyleSheet.absoluteFill}>
                  <LinearGradient colors={["transparent", "rgba(8,10,18,.85)"]}
                    style={StyleSheet.absoluteFill} />
                </View>
                {item.super && (
                  <View style={s.superPill}>
                    <Ionicons name="star" size={11} color="#fff" />
                    <Text style={s.superText}>SUPER LIKE</Text>
                  </View>
                )}
                {item.free && !subscribed && (
                  <Animated.View style={[s.freePill, { transform: [{ scale: pulseAnim }] }]}>
                    <Ionicons name="star" size={11} color={theme.onGold} />
                    <Text style={s.freePillText}>FREE THIS WEEK</Text>
                  </Animated.View>
                )}
                {clear ? (
                  <View style={s.cardFooter}>
                    <Text style={s.cardName}>{item.name}{item.age ? `, ${item.age}` : ""}</Text>
                    {item.free && !subscribed && daysToReveal != null && (
                      <Text style={s.cardSub}>Next reveal in {daysToReveal}d</Text>
                    )}
                  </View>
                ) : (
                  <View style={s.lockWrap}>
                    <View style={s.lockCircle}><Ionicons name="lock-closed" size={20} color="#fff" /></View>
                  </View>
                )}
              </PressableScale>
            );
          }}
        />
      </Animated.View>

      {!subscribed && likers.length > 0 && (
        <View style={s.upgradeBanner}>
          <View style={s.upgradeInner}>
            <Text style={s.upgradeLabel}>
              <Ionicons name="ribbon" size={14} color={theme.gold} /> See everyone who likes you
            </Text>
            <PressableScale
              style={{ width: "100%" }}
              onPress={() => nav.navigate("Paywall")}
              haptics="success"
              scaleTo={0.96}
            >
              <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={s.upgradeBtn}>
                <Text style={s.upgradeBtnText}>UPGRADE TO PLUS</Text>
              </LinearGradient>
            </PressableScale>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 20, paddingTop: 58, paddingBottom: 16 },
  title: { color: theme.ink, fontSize: 24, fontFamily: theme.font.displayMd, letterSpacing: -0.5 },
  sub: { color: theme.muted, fontSize: 13, marginTop: 6 },
  empty: { alignItems: "center", marginTop: 60, paddingHorizontal: 30, gap: 12 },
  emptyText: { color: theme.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },

  card: { flex: 1, aspectRatio: 3 / 4, borderRadius: theme.radii.md, overflow: "hidden",
    backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line },
  freeCardBorder: { borderColor: theme.gold, borderWidth: 1.5 },
  blurredImg: { opacity: 0.6 },
  placeholder: { backgroundColor: theme.card2 },
  superPill: { position: "absolute", top: 8, right: 8, flexDirection: "row", alignItems: "center",
    gap: 3, backgroundColor: "rgba(138,63,252,0.85)", borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 3 },
  superText: { color: "#fff", fontSize: 8, fontFamily: theme.font.black, letterSpacing: 0.5 },
  freePill: { position: "absolute", top: 8, left: 8, flexDirection: "row", alignItems: "center",
    gap: 3, backgroundColor: theme.gold, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
    shadowColor: theme.gold, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  freePillText: { color: theme.onGold, fontSize: 8, fontFamily: theme.font.black, letterSpacing: 0.5 },
  cardFooter: { position: "absolute", left: 8, bottom: 8, right: 8 },
  cardName: { color: "#fff", fontSize: 15, fontFamily: theme.font.bold },
  cardSub: { color: "rgba(255,255,255,.75)", fontSize: 10.5, marginTop: 2 },
  lockWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  lockCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(8,10,18,.55)",
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,.25)" },

  upgradeBanner: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16,
    paddingBottom: 22, paddingTop: 14, backgroundColor: theme.bg },
  upgradeInner: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, padding: 16, alignItems: "center", gap: 10, ...theme.shadow.floating },
  upgradeLabel: { color: theme.ink, fontSize: 13, fontFamily: theme.font.semibold },
  upgradeBtn: { width: "100%", borderRadius: 999, paddingVertical: 13, alignItems: "center",
    ...theme.shadow.cta },
  upgradeBtnText: { color: "#fff", fontFamily: theme.font.black, fontSize: 12.5, letterSpacing: 1 },
});
