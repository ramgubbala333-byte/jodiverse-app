import React, { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, Platform, Animated, Easing } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

type Reason = { icon: string; text: string };

const ICON_MAP: Record<string, string> = {
  ads_click: "radio-button-on-outline",
  music_note: "musical-notes",
  dark_mode: "moon",
  forum: "chatbubbles-outline",
  translate: "language",
  auto_awesome: "sparkles",
  flame: "flame",
  time: "time",
  restaurant: "restaurant",
};

const SERIF = Platform.OS === "ios" ? "Georgia" : "serif";

export default function WhyMatchedCard({ otherId, score = 94 }: { otherId: string; score?: number }) {
  const [reasons, setReasons] = useState<Reason[]>([
    { icon: "flame", text: "Both love indie music" },
    { icon: "time", text: "Early risers" },
    { icon: "restaurant", text: "Culinary enthusiasts" },
  ]);

  // Animation values
  const gaugeScale = useRef(new Animated.Value(0.6)).current;
  const gaugeOpacity = useRef(new Animated.Value(0)).current;
  const pulseGlow = useRef(new Animated.Value(1)).current;
  const pillsAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 1. Gauge Entrance Animation (Spring pop)
    Animated.parallel([
      Animated.spring(gaugeScale, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(gaugeOpacity, {
        toValue: 1,
        duration: 450,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // 2. Continuous Subtle Breathing Glow Loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseGlow, {
          toValue: 1.06,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseGlow, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // 3. Staggered Pills Entrance
    Animated.timing(pillsAnim, {
      toValue: 1,
      duration: 600,
      delay: 250,
      easing: Easing.out(Easing.back(1.5)),
      useNativeDriver: true,
    }).start();

    let live = true;
    supabase.rpc("match_reasons", { other: otherId }).then(({ data }) => {
      if (live && data && data.length > 0) setReasons(data as Reason[]);
    }).catch(() => {});
    return () => { live = false; };
  }, [otherId, gaugeScale, gaugeOpacity, pulseGlow, pillsAnim]);

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.head}>
        <Ionicons name="sparkles" size={18} color={theme.gold} />
        <Text style={s.title}>Why You Matched</Text>
      </View>

      {/* Percentage Gauge & Potential Summary */}
      <View style={s.gaugeRow}>
        <Animated.View
          style={[
            s.gaugeCircle,
            {
              opacity: gaugeOpacity,
              transform: [
                { scale: Animated.multiply(gaugeScale, pulseGlow) },
              ],
            },
          ]}
        >
          <Text style={s.gaugeNumber}>{score}<Text style={s.percentSymbol}>%</Text></Text>
        </Animated.View>

        <View style={s.gaugeTextCol}>
          <Text style={s.gaugeHeading}>Deep Connect on Potential</Text>
          <Text style={s.gaugeDesc}>
            Our AI notes a strong alignment in your conversational rhythms and shared values regarding family and career ambition.
          </Text>
        </View>
      </View>

      {/* Trait & Interest Pills (Animated Slide Up) */}
      <Animated.View
        style={[
          s.pillsContainer,
          {
            opacity: pillsAnim,
            transform: [
              {
                translateY: pillsAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, 0],
                }),
              },
            ],
          },
        ]}
      >
        {reasons.map((r, i) => (
          <View key={i} style={s.pill}>
            <Ionicons
              name={(ICON_MAP[r.icon] ?? "sparkles") as any}
              size={13}
              color={theme.gold}
            />
            <Text style={s.pillText}>{r.text}</Text>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#13161F",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#202534",
    padding: 20,
    marginHorizontal: 14,
    marginTop: 14,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  title: {
    color: "#E9E7E2",
    fontSize: 19,
    fontFamily: SERIF,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  gaugeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 18,
  },
  gaugeCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 3.5,
    borderColor: "#FF7A2E",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 122, 46, 0.09)",
    shadowColor: "#FF7A2E",
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
    flexShrink: 0,
  },
  gaugeNumber: {
    color: "#E9E7E2",
    fontSize: 20,
    fontWeight: "800",
    fontFamily: theme.font.black,
  },
  percentSymbol: {
    fontSize: 12,
    color: theme.gold,
    fontWeight: "700",
  },
  gaugeTextCol: {
    flex: 1,
  },
  gaugeHeading: {
    color: "#E9E7E2",
    fontSize: 14.5,
    fontWeight: "700",
    fontFamily: theme.font.bold,
    marginBottom: 4,
  },
  gaugeDesc: {
    color: "#8B90A3",
    fontSize: 12,
    lineHeight: 17,
    fontFamily: theme.font.regular,
  },
  pillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.05)",
    paddingTop: 14,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1B202D",
    borderWidth: 1,
    borderColor: "#293044",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillText: {
    color: "#E9E7E2",
    fontSize: 12,
    fontWeight: "600",
    fontFamily: theme.font.medium,
  },
});
