import React, { useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import GlowBackdrop from "../components/GlowBackdrop";
import { haptic } from "../lib/haptics";
import { theme } from "../theme";

// Mutual "talk again". Photos are still hidden/blurred at this point (the
// reveal ladder starts at 'blurred', not 'full') — so the celebration uses
// two overlapping INITIAL cards, tilted like a stacked photo pair, rather
// than showing real photos. Same "voice first" rule holds even here.
export default function MatchedScreen() {
  const { matchId, name } = useRoute().params as { matchId: string; name: string };
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const popL = useRef(new Animated.Value(0)).current;
  const popR = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    haptic.success();
    Animated.stagger(90, [
      Animated.spring(popL, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
      Animated.spring(popR, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
    ]).start();
    Animated.timing(rise, { toValue: 0, duration: 500, delay: 120,
      easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [popL, popR, rise]);

  const cardStyle = (pop: Animated.Value, rotateDeg: number) => ({
    transform: [
      { scale: pop },
      { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${rotateDeg}deg`] }) },
    ],
  });

  return (
    <View style={[s.wrap, { paddingTop: 40 + insets.top, paddingBottom: 20 + insets.bottom }]}>
      <GlowBackdrop />

      <View style={s.cardsRow}>
        <Animated.View style={[s.card, s.cardBack, cardStyle(popL, -10)]}>
          <LinearGradient colors={[...theme.gradViolet]} style={StyleSheet.absoluteFill} />
          <Ionicons name="person" size={40} color="rgba(255,255,255,.85)" />
        </Animated.View>
        <Animated.View style={[s.card, s.cardFront, cardStyle(popR, 8)]}>
          <LinearGradient colors={[...theme.grad]} style={StyleSheet.absoluteFill} />
          <Text style={s.cardInitial}>{name?.[0]?.toUpperCase() ?? "?"}</Text>
        </Animated.View>
      </View>

      <Animated.View style={{ transform: [{ translateY: rise }], alignItems: "center" }}>
        <Text style={s.eyebrow}>CONGRATULATIONS</Text>
        <Text style={s.title}>It's a match!</Text>
        <Text style={s.sub}>
          You and {name} both want to keep talking. Their photo unlocks after
          your next call together.
        </Text>

        <View style={s.ladder}>
          {[["Hidden", true], ["Blurred", true], ["Full photo", false]].map(([label, done]: any, i) => (
            <View key={label} style={s.ladderStep}>
              <View style={[s.ladderDot, done && { backgroundColor: theme.gold,
                borderColor: theme.gold }]}>
                {done && <Ionicons name="checkmark" size={11} color={theme.onGold} />}
              </View>
              <Text style={[s.ladderLabel, done && { color: theme.ink }]}>{label}</Text>
              {i < 2 && <View style={[s.ladderLine, done && { backgroundColor: theme.gold }]} />}
            </View>
          ))}
        </View>
      </Animated.View>

      <View style={{ flex: 1 }} />

      <TouchableOpacity onPress={() => nav.replace("Chat", { matchId, name })}>
        <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={s.cta}>
          <Text style={s.ctaText}>Chat now</Text>
        </LinearGradient>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => nav.navigate("Tabs", { screen: "Talk" })}>
        <Text style={s.later}>Keep talking to new people</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, overflow: "hidden", paddingHorizontal: 26,
    alignItems: "center" },
  cardsRow: { width: 180, height: 140, marginBottom: 22 },
  card: { position: "absolute", width: 118, height: 140, borderRadius: 24, overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  cardBack: { left: 0, top: 6 },
  cardFront: { right: 0, top: 0 },
  cardInitial: { color: "#fff", fontSize: 46, fontFamily: theme.font.black },
  eyebrow: { color: theme.gold, fontSize: 12, fontFamily: theme.font.black, letterSpacing: 2.5 },
  title: { color: theme.ink, fontSize: 40, fontFamily: theme.font.display, marginTop: 10,
    letterSpacing: -1.2, textAlign: "center" },
  sub: { color: theme.muted, fontSize: 14.5, textAlign: "center", marginTop: 14,
    lineHeight: 21, paddingHorizontal: 10 },
  ladder: { flexDirection: "row", marginTop: 30, alignItems: "flex-start" },
  ladderStep: { alignItems: "center", flexDirection: "row" },
  ladderDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5,
    borderColor: theme.line, alignItems: "center", justifyContent: "center" },
  ladderLabel: { color: theme.muted, fontSize: 11.5, marginLeft: 6, fontFamily: theme.font.semibold },
  ladderLine: { width: 22, height: 1.5, backgroundColor: theme.line, marginHorizontal: 8 },
  cta: { borderRadius: theme.radii.pill, paddingVertical: 18, paddingHorizontal: 72,
    alignItems: "center", ...theme.shadow.cta },
  ctaText: { color: theme.onGold, fontFamily: theme.font.black, fontSize: 16, letterSpacing: 0.2 },
  later: { color: theme.muted, fontFamily: theme.font.bold, marginTop: 20, fontSize: 14 },
});
