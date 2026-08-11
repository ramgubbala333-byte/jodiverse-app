import React, { useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, Animated, Easing, Image, ScrollView,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import AuroraShaderBackdrop from "../components/AuroraShaderBackdrop";
import WhyMatchedCard from "../components/WhyMatchedCard";
import PressableScale from "../components/PressableScale";
import { haptic } from "../lib/haptics";
import { theme } from "../theme";

type Params = { matchId: string; name: string; otherId?: string;
  theirPhoto?: string | null; myPhoto?: string | null };

export default function MatchedScreen() {
  const { matchId, name, otherId, theirPhoto, myPhoto } = useRoute().params as Params;
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const popL = useRef(new Animated.Value(0)).current;
  const popR = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(30)).current;
  const ringScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    haptic.success();
    Animated.parallel([
      Animated.spring(ringScale, { toValue: 1, friction: 5, tension: 50, useNativeDriver: true }),
      Animated.stagger(120, [
        Animated.spring(popL, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
        Animated.spring(popR, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
      ]),
      Animated.timing(rise, {
        toValue: 0,
        duration: 500,
        delay: 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [popL, popR, rise, ringScale]);

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
        
        {/* Animated Rings & Cards */}
        <View style={s.cardsRow}>
          <Animated.View style={[s.glowRing, { transform: [{ scale: ringScale }] }]} />
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
          <View style={s.eyebrowPill}>
            <Ionicons name="sparkles" size={12} color={theme.gold} />
            <Text style={s.eyebrow}>IT'S A JODI!</Text>
          </View>
          <Text style={s.title}>You Matched!</Text>
          <Text style={s.sub}>You and {name} liked each other.</Text>
        </Animated.View>

        {otherId && (
          <View style={{ width: "100%", marginTop: 20 }}>
            <WhyMatchedCard otherId={otherId} />
          </View>
        )}

        <View style={{ flex: 1, minHeight: 28 }} />

        <PressableScale
          style={{ width: "100%" }}
          onPress={() => nav.replace("ChatRoom", { matchId, name })}
          haptics="success"
          scaleTo={0.96}
        >
          <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={s.cta}>
            <Ionicons name="chatbubbles" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={s.ctaText}>Send a message</Text>
          </LinearGradient>
        </PressableScale>

        <PressableScale onPress={() => nav.navigate("Tabs", { screen: "Discover" })} haptics="light">
          <Text style={s.later}>Keep exploring</Text>
        </PressableScale>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, overflow: "hidden" },
  scrollBody: { paddingHorizontal: 20, alignItems: "center", flexGrow: 1 },
  cardsRow: { width: 190, height: 150, marginBottom: 22, alignItems: "center", justifyContent: "center" },
  glowRing: { position: "absolute", width: 180, height: 180, borderRadius: 90,
    borderWidth: 2, borderColor: "rgba(255, 122, 46, 0.35)", backgroundColor: "rgba(255, 122, 46, 0.06)" },
  card: { position: "absolute", width: 120, height: 144, borderRadius: 24, overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 }, elevation: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  cardBack: { left: 8, top: 4 },
  cardFront: { right: 8, top: 0 },
  cardInitial: { color: "#fff", fontSize: 44, fontFamily: theme.font.black },
  eyebrowPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,122,46,0.12)",
    borderWidth: 1, borderColor: "rgba(255,122,46,0.3)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 10 },
  eyebrow: { color: theme.gold, fontSize: 11, fontFamily: theme.font.bold, letterSpacing: 1.5 },
  title: { color: theme.ink, fontSize: 32, fontFamily: theme.font.display, letterSpacing: -0.5 },
  sub: { color: theme.muted, fontSize: 14, marginTop: 4, fontFamily: theme.font.medium },
  cta: { borderRadius: 999, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center",
    ...theme.shadow.cta },
  ctaText: { color: "#fff", fontFamily: theme.font.black, fontSize: 15, letterSpacing: 0.3 },
  later: { color: theme.muted, fontSize: 13, fontFamily: theme.font.semibold, marginTop: 16, padding: 8 },
});
