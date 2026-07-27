import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import { signalChannel } from "../lib/voice";
import { theme } from "../theme";

type Member = { user_id: string; name: string; role: string;
  hand_raised: boolean; is_verified: boolean };

// A live audio room. Presence + roster are real; group audio is simulated
// until an SFU ships (1:1 invites use the same P2P path as the queue).
export default function LoungeRoomScreen() {
  const { loungeId, title } = useRoute().params as
    { loungeId: string; topic: string; title: string };
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [me, setMe] = useState<string>("");
  const [role, setRole] = useState<"host" | "speaker" | "listener">("listener");
  const [handUp, setHandUp] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const chanRef = useRef<ReturnType<typeof signalChannel> | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc("lounge_members", { p_lounge: loungeId });
    if (data) setMembers(data as Member[]);
  }, [loungeId]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { nav.goBack(); return; }
      setMe(user.id);
      const { data } = await supabase.rpc("join_lounge", { p_lounge: loungeId });
      if (data?.role) setRole(data.role);
      await refresh();
      setLoading(false);

      // Live room updates via presence on the lounge channel.
      const ch = signalChannel((data?.room as string) ?? `lounge_${loungeId}`);
      chanRef.current = ch;
      ch.on("broadcast", { event: "roster" }, refresh);
      await ch.subscribe(async (st) => {
        if (st === "SUBSCRIBED") await ch.track({ uid: user.id });
      });
    })();
    return () => {
      supabase.rpc("leave_lounge", { p_lounge: loungeId });
      if (chanRef.current) supabase.removeChannel(chanRef.current);
    };
  }, [loungeId]);

  const bump = () => chanRef.current?.send({ type: "broadcast", event: "roster", payload: {} });

  const toggleHand = async () => {
    const next = !handUp; setHandUp(next);
    await supabase.rpc("raise_hand", { p_lounge: loungeId, p_raised: next });
    await refresh(); bump();
  };

  const goOnStage = async () => {
    const { data } = await supabase.rpc("become_speaker", { p_lounge: loungeId });
    if (!data?.ok) { Alert.alert("Stage is full", "Max 8 speakers — try again when a spot opens."); return; }
    setRole("speaker"); setHandUp(false);
    await refresh(); bump();
  };

  const invite = (m: Member) => {
    if (m.user_id === me) return;
    Alert.alert(`Invite ${m.name} to a private call?`,
      "You'll both leave the lounge and start a 1:1 voice call (10 min max, free).",
      [{ text: "Cancel", style: "cancel" },
       { text: "Invite", onPress: async () => {
          const { data, error } = await supabase.rpc("invite_to_call", { other: m.user_id });
          if (error) {
            Alert.alert("Couldn't invite",
              error.message.includes("CALL_LIMIT_REACHED")
                ? "One of you is out of free calls for today."
                : error.message);
            return;
          }
          nav.replace("Call", { callId: data, isCaller: true });
       }}]);
  };

  if (loading) {
    return <View style={[s.wrap, s.center]}><ActivityIndicator color={theme.gold} /></View>;
  }

  const onStage = members.filter((m) => m.role === "host" || m.role === "speaker");
  const audience = members.filter((m) => m.role === "listener");
  const raisedCount = audience.filter((m) => m.hand_raised).length;

  const Avatar = ({ m }: { m: Member }) => (
    <TouchableOpacity style={s.person} onPress={() => invite(m)} disabled={m.user_id === me}>
      <LinearGradient colors={[...theme.grad]} style={s.avatar}>
        <Text style={s.avatarText}>{m.name?.[0]?.toUpperCase() ?? "?"}</Text>
        {m.hand_raised && <View style={s.handBadge}><Text style={{ fontSize: 11 }}>✋</Text></View>}
      </LinearGradient>
      <View style={s.nameRow}>
        <Text style={s.personName} numberOfLines={1}>{m.user_id === me ? "You" : m.name}</Text>
        {m.is_verified && <Ionicons name="shield-checkmark" size={11} color={theme.info} />}
      </View>
      {m.role === "host" && <Text style={s.roleTag}>HOST</Text>}
    </TouchableOpacity>
  );

  return (
    <View style={s.wrap}>
      <View style={[s.header, { paddingTop: 14 + insets.top }]}>
        <TouchableOpacity onPress={() => nav.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-down" size={26} color={theme.ink} />
        </TouchableOpacity>
        <View style={{ alignItems: "center" }}>
          <Text style={s.roomTitle}>{title}</Text>
          <View style={s.liveRow}>
            <View style={s.liveDot} />
            <Text style={s.liveText}>LIVE · {members.length} here</Text>
          </View>
        </View>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
        <Text style={s.sectionLabel}>ON STAGE · {onStage.length}</Text>
        <View style={s.grid}>{onStage.map((m) => <Avatar key={m.user_id} m={m} />)}</View>

        <Text style={[s.sectionLabel, { marginTop: 28 }]}>
          LISTENING · {audience.length}{raisedCount > 0 ? ` · ${raisedCount} ✋` : ""}
        </Text>
        <View style={s.grid}>{audience.map((m) => <Avatar key={m.user_id} m={m} />)}</View>

        <Text style={s.tapHint}>Tap anyone to invite them into a private voice call.</Text>
      </ScrollView>

      {/* bottom control bar */}
      <View style={[s.bar, { paddingBottom: 16 + insets.bottom }]}>
        {role === "listener" ? (
          <>
            <TouchableOpacity style={[s.barBtn, handUp && s.barBtnOn]} onPress={toggleHand}>
              <Text style={s.barBtnText}>{handUp ? "✋ Hand raised" : "✋ Raise hand"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.barBtn, s.barBtnGold]} onPress={goOnStage}>
              <Text style={[s.barBtnText, { color: theme.onGold }]}>Join the conversation</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={s.speakingNote}>
            <Ionicons name="mic" size={16} color={theme.emerald} />
            <Text style={s.speakingText}>
              You're {role === "host" ? "hosting" : "on stage"} · everyone can hear you
            </Text>
          </View>
        )}
        <TouchableOpacity style={s.leaveBtn} onPress={() => nav.goBack()}>
          <Text style={s.leaveText}>Leave</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingTop: 54, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  roomTitle: { color: theme.ink, fontSize: 18, fontFamily: theme.font.displayMd, letterSpacing: -0.3 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.emerald },
  liveText: { color: theme.emerald, fontSize: 11, fontFamily: theme.font.black, letterSpacing: 0.5 },
  sectionLabel: { color: theme.muted, fontSize: 11, fontFamily: theme.font.black, letterSpacing: 1,
    marginBottom: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  person: { width: "25%", alignItems: "center", marginBottom: 16 },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center",
    ...theme.shadow.card },
  avatarText: { color: theme.onGold, fontSize: 22, fontFamily: theme.font.black },
  handBadge: { position: "absolute", bottom: -2, right: -2, backgroundColor: theme.card,
    borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: theme.line },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 6 },
  personName: { color: theme.ink, fontSize: 12, fontFamily: theme.font.semibold, maxWidth: 64 },
  roleTag: { color: theme.gold, fontSize: 8.5, fontFamily: theme.font.black, letterSpacing: 0.5, marginTop: 2 },
  tapHint: { color: theme.muted, fontSize: 12, textAlign: "center", marginTop: 24, lineHeight: 17 },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row",
    gap: 10, padding: 18, paddingBottom: 30, backgroundColor: theme.card,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, alignItems: "center" },
  barBtn: { flex: 1, borderWidth: 1, borderColor: theme.line, borderRadius: 999,
    paddingVertical: 14, alignItems: "center", backgroundColor: theme.card2 },
  barBtnOn: { borderColor: theme.gold, backgroundColor: theme.goldSoft },
  barBtnGold: { backgroundColor: theme.gold, borderColor: theme.gold, ...theme.shadow.cta },
  barBtnText: { color: theme.ink, fontFamily: theme.font.black, fontSize: 13.5 },
  speakingNote: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  speakingText: { color: theme.muted, fontSize: 13, fontFamily: theme.font.semibold, flex: 1 },
  leaveBtn: { paddingHorizontal: 18, paddingVertical: 14, borderRadius: 999,
    backgroundColor: theme.card2 },
  leaveText: { color: theme.danger, fontFamily: theme.font.black, fontSize: 13.5 },
});
