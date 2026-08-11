import React, { useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing, Image, ScrollView,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import AuroraShaderBackdrop from "../components/AuroraShaderBackdrop";
import WhyMatchedCard from "../components/WhyMatchedCard";
import { haptic } from "../lib/haptics";
import { theme } from "../theme";

type Params = { matchId: string; name: string; otherId?: string;
  theirPhoto?: string | null; myPhoto?: string | null };

// Mutual like. Photos are already known to both sides — they saw them in
// the deck before liking — so the celebration shows the real photos.
export default function MatchedScreen() {
  const { matchId, name, otherId, theirPhoto, myPhoto } = useRoute().params as Params;
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
    <View style={[s.wrap, { paddingTop: 20 + insets.top }]}>
      <AuroraShaderBackdrop />
      <ScrollView contentContainerStyle={[s.scrollBody, { paddingBottom: 20 + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <View style={s.cardsRow}>
          <Animated.View style={[s.card, s.cardBack, cardStyle(popL, -10)]}>
            {myPhoto ? <Image source={{ uri: myPhoto }} style={StyleSheet.absoluteFill} /> : (
              <LinearGradient colors={[...theme.gradViolet]} style={StyleSheet.absoluteFill} />
            )}
          </Animated.View>
          <Animated.View style={[s.card, s.cardFront, cardStyle(popR, 8)]}>
            {theirPhoto ? <Image source={{ uri: theirPhoto }} style={StyleSheet.absoluteFill} /> : (
              <>
                <LinearGradient colors={[...theme.grad]} style={StyleSheet.absoluteFill} />
                <Text style={s.cardInitial}>{name?.[0]?.toUpperCase() ?? "?"}</Text>
              </>
            )}
          </Animated.View>
        </View>

        <Animated.View style={{ transform: [{ translateY: rise }], alignItems: "center" }}>
          <Text style={s.eyebrow}>CONGRATULATIONS</Text>
          <Text style={s.title}>It's a match!</Text>
          <Text style={s.sub}>You and {name} liked each other.</Text>
        </Animated.View>

        {otherId && (
          <View style={{ width: "100%", marginTop: 26 }}>
            <WhyMatchedCard otherId={otherId} />
          </View>
        )}

        <View style={{ flex: 1, minHeight: 30 }} />

        <TouchableOpacity style={{ width: "100%" }} onPress={() => nav.replace("Chat", { matchId, name })}>
          <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={s.cta}>
            <Text style={s.ctaText}>Send a message</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => nav.navigate("Tabs", { screen: "Discover" })}>
          <Text style={s.later}>Keep exploring</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, overflow: "hidden" },
  scrollBody: { paddingHorizontal: 26, alignItems: "center", flexGrow: 1 },
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
  cta: { borderRadius: theme.radii.pill, paddingVertical: 18,
    alignItems: "center", ...theme.shadow.cta },
  ctaText: { color: theme.onGold, fontFamily: theme.font.black, fontSize: 16, letterSpacing: 0.2 },
  later: { color: theme.muted, fontFamily: theme.font.bold, marginTop: 20, fontSize: 14 },
});
