import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Share, ActivityIndicator, TextInput, TouchableOpacity, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import PressableScale from "../components/PressableScale";
import { haptic } from "../lib/haptics";
import { theme } from "../theme";

type Stats = { code: string | null; invites: number; coins_earned: number; reward: number };

// "Share & Win" — invite a friend with your code, you both get coins.
export default function ReferralScreen() {
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<Stats | null>(null);
  const [friend, setFriend] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [wasReferred, setWasReferred] = useState(false);

  useEffect(() => {
    (async () => {
      await supabase.rpc("my_referral_code");      // lazily mint a code
      const { data } = await supabase.rpc("referral_stats");
      setStats(data as Stats);
    })();
  }, []);

  const redeemFriend = async () => {
    const code = friend.trim();
    if (!code) return;
    setRedeeming(true);
    const { data, error } = await supabase.rpc("redeem_referral", { p_code: code });
    setRedeeming(false);
    if (error) {
      const map: Record<string, string> = {
        ALREADY_REFERRED: "You've already used a friend's code.",
        INVALID_CODE: "That code isn't valid.",
        CANNOT_REFER_SELF: "You can't use your own code 🙂",
      };
      Alert.alert("Couldn't apply", map[error.message] ?? error.message);
      return;
    }
    setFriend(""); setWasReferred(true); haptic.success();
    Alert.alert("Nice! 🎉", `You both got ${data?.reward ?? 100} coins. You now have ${(data?.balance ?? 0).toLocaleString()}.`);
  };

  const share = async () => {
    if (!stats?.code) return;
    haptic.light();
    try {
      await Share.share({
        message:
          `Join me on Dosti Connect — talk first, then find your connection. ` +
          `Use my code ${stats.code} when you sign up and we BOTH get ${stats.reward} coins 🪙💜`,
      });
    } catch { /* cancelled */ }
  };

  if (!stats) return <View style={[s.wrap, s.center]}><ActivityIndicator color={theme.gold} /></View>;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 22, paddingBottom: 40 + insets.bottom }}>
      <View style={s.hero}>
        <View style={s.giftIcon}><Ionicons name="gift" size={30} color="#fff" /></View>
        <Text style={s.h1}>Invite & earn</Text>
        <Text style={s.sub}>Share your code. When a friend joins with it, you <Text style={{ color: theme.ink, fontFamily: theme.font.bold }}>both</Text> get {stats.reward} coins 🪙</Text>
      </View>

      <View style={s.statsRow}>
        <View style={s.stat}><Text style={s.statVal}>{stats.invites}</Text><Text style={s.statLbl}>Friends joined</Text></View>
        <View style={s.statDiv} />
        <View style={s.stat}><Text style={s.statVal}>{stats.coins_earned}</Text><Text style={s.statLbl}>Coins earned</Text></View>
      </View>

      <Text style={s.label}>YOUR INVITE CODE</Text>
      <View style={s.codeBox}><Text style={s.code}>{stats.code ?? "—"}</Text></View>

      <PressableScale onPress={share} haptics={false}>
        <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cta}>
          <Ionicons name="share-social" size={18} color="#fff" />
          <Text style={s.ctaText}>Share my code</Text>
        </LinearGradient>
      </PressableScale>

      <View style={s.steps}>
        {[["1", "Share your code with friends"],
          ["2", "They sign up and enter it"],
          ["3", `You both get ${stats.reward} coins 🪙`]].map(([n, t]) => (
          <View key={n} style={s.step}>
            <View style={s.stepNum}><Text style={s.stepNumT}>{n}</Text></View>
            <Text style={s.stepT}>{t}</Text>
          </View>
        ))}
      </View>

      {!wasReferred && (
        <View style={s.friendCard}>
          <Text style={s.friendLabel}>Have a friend's invite code?</Text>
          <View style={s.friendRow}>
            <TextInput style={s.friendInput} placeholder="Enter code" autoCapitalize="characters"
              value={friend} onChangeText={setFriend} placeholderTextColor={theme.muted}
              onSubmitEditing={redeemFriend} returnKeyType="done" />
            <TouchableOpacity style={[s.friendBtn, (redeeming || !friend.trim()) && { opacity: 0.5 }]}
              onPress={redeemFriend} disabled={redeeming || !friend.trim()}>
              {redeeming ? <ActivityIndicator color={theme.onGold} /> : <Text style={s.friendBtnText}>Apply</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={s.note}>Coins are for gifts, boosts and profile extras — they never buy call time, messages, or matching.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { alignItems: "center", justifyContent: "center" },
  hero: { alignItems: "center", marginTop: 10, marginBottom: 22 },
  giftIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: theme.gold,
    alignItems: "center", justifyContent: "center", marginBottom: 14, ...theme.shadow.cta },
  h1: { color: theme.ink, fontSize: 26, fontFamily: theme.font.display, letterSpacing: -0.8 },
  sub: { color: theme.muted, fontSize: 14, textAlign: "center", marginTop: 10, lineHeight: 20, paddingHorizontal: 6 },
  statsRow: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, borderRadius: theme.radii.lg, padding: 18, ...theme.shadow.card },
  stat: { flex: 1, alignItems: "center" },
  statDiv: { width: 1, height: 34, backgroundColor: theme.line },
  statVal: { color: theme.ink, fontSize: 26, fontFamily: theme.font.black },
  statLbl: { color: theme.muted, fontSize: 12, marginTop: 3 },
  label: { color: theme.muted, fontSize: 11, fontFamily: theme.font.black, letterSpacing: 1.2,
    marginTop: 26, marginBottom: 10 },
  codeBox: { borderWidth: 1.5, borderColor: theme.gold, borderStyle: "dashed", borderRadius: theme.radii.lg,
    backgroundColor: theme.goldSoft, alignItems: "center", paddingVertical: 18 },
  code: { color: theme.gold, fontSize: 30, fontFamily: theme.font.black, letterSpacing: 4 },
  cta: { borderRadius: theme.radii.pill, paddingVertical: 17, marginTop: 16, alignItems: "center",
    flexDirection: "row", justifyContent: "center", gap: 9, ...theme.shadow.cta },
  ctaText: { color: "#fff", fontFamily: theme.font.black, fontSize: 16, letterSpacing: 0.2 },
  steps: { marginTop: 28, gap: 14 },
  step: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.goldSoft,
    alignItems: "center", justifyContent: "center" },
  stepNumT: { color: theme.gold, fontFamily: theme.font.black, fontSize: 14 },
  stepT: { color: theme.ink, fontSize: 14.5, fontFamily: theme.font.medium, flex: 1 },
  note: { color: theme.muted, fontSize: 11.5, textAlign: "center", marginTop: 28, lineHeight: 17 },
  friendCard: { marginTop: 28, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, padding: 16 },
  friendLabel: { color: theme.ink, fontSize: 13.5, fontFamily: theme.font.bold, marginBottom: 10 },
  friendRow: { flexDirection: "row", gap: 10 },
  friendInput: { flex: 1, backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, paddingHorizontal: 14, paddingVertical: 12, color: theme.ink, fontSize: 15 },
  friendBtn: { backgroundColor: theme.gold, borderRadius: theme.radii.md, paddingHorizontal: 18,
    alignItems: "center", justifyContent: "center" },
  friendBtnText: { color: theme.onGold, fontFamily: theme.font.black, fontSize: 14 },
});
