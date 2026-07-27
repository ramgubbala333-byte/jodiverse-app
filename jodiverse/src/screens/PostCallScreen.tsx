import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Animated,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

const TRAITS = ["Good listener", "Funny", "Curious", "Great questions",
  "Storyteller", "Calm", "Warm", "Easy to talk to"];

const COMFORT = [
  ["great", "Great", "happy-outline"],
  ["good", "Good", "thumbs-up-outline"],
  ["okay", "Okay", "remove-outline"],
  ["bad", "Bad", "warning-outline"],
] as const;

// Three questions, under ten seconds. The comfort answer feeds safety only —
// it is never shown to the other person and never used for matching.
export default function PostCallScreen() {
  const { callId, name, duration } = useRoute().params as
    { callId: string; name: string; otherId?: string; duration: number };
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [stars, setStars] = useState(0);
  const [talkAgain, setTalkAgain] = useState<string | null>(null);
  const [comfort, setComfort] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const mins = Math.floor(duration / 60);
  const secs = duration % 60;

  const submit = async (finalComfort: string) => {
    setBusy(true);
    try {
      const { data: matchId } = await supabase.rpc("submit_call_feedback", {
        p_call: callId, p_stars: stars || null, p_talk_again: talkAgain,
        p_comfort: finalComfort, p_tags: tags,
      });
      setBusy(false);
      if (matchId) {
        nav.replace("Matched", { matchId, name });
      } else {
        nav.navigate("Tabs", { screen: "Talk" });
      }
    } catch (e: any) {
      setBusy(false);
      Alert.alert("Couldn't save", e.message ?? String(e));
      nav.navigate("Tabs", { screen: "Talk" });
    }
  };

  return (
    <View style={[s.wrap, { paddingTop: 24 + insets.top, paddingBottom: 12 + insets.bottom }]}>
      <View style={s.progress}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[s.pip, i <= step && { backgroundColor: theme.gold }]} />
        ))}
      </View>

      <Text style={s.callMeta}>
        {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`} with {name}
      </Text>

      {/* 1 — how did it feel */}
      {step === 0 && (
        <View style={s.body}>
          <Text style={s.q}>How did it feel?</Text>
          <View style={s.starRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <TouchableOpacity key={n} onPress={() => { setStars(n); setTimeout(() => setStep(1), 220); }}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <Ionicons name={n <= stars ? "star" : "star-outline"} size={40}
                  color={n <= stars ? theme.gold : theme.line} />
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={() => setStep(1)}>
            <Text style={s.skip}>Skip</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 2 — talk again */}
      {step === 1 && (
        <View style={s.body}>
          <Text style={s.q}>Would you talk to {name} again?</Text>
          <Text style={s.qSub}>They'll only find out if you both say yes.</Text>
          {[["yes", "Yes", theme.emerald], ["maybe", "Maybe", theme.gold],
            ["no", "No", theme.muted]].map(([v, label, color]: any) => (
            <TouchableOpacity key={v}
              style={[s.bigOption, talkAgain === v && { borderColor: color }]}
              onPress={() => { setTalkAgain(v); setTimeout(() => setStep(2), 200); }}>
              <Text style={[s.bigOptionText, talkAgain === v && { color }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* 3 — comfort + traits */}
      {step === 2 && (
        <View style={s.body}>
          <Text style={s.q}>How comfortable did you feel?</Text>
          <Text style={s.qSub}>This is private — only our safety team sees it.</Text>
          <View style={s.comfortRow}>
            {COMFORT.map(([v, label, icon]) => (
              <TouchableOpacity key={v} onPress={() => setComfort(v)}
                style={[s.comfortCard, comfort === v && s.comfortOn,
                  comfort === v && v === "bad" && { borderColor: theme.danger }]}>
                <Ionicons name={icon as any} size={22}
                  color={comfort === v ? (v === "bad" ? theme.danger : theme.gold) : theme.muted} />
                <Text style={[s.comfortLabel, comfort === v && { color: theme.ink }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {talkAgain !== "no" && (
            <>
              <Text style={s.tagLabel}>What were they like? (optional)</Text>
              <View style={s.tagWrap}>
                {TRAITS.map((t) => (
                  <TouchableOpacity key={t} onPress={() =>
                    setTags((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])}
                    style={[s.tag, tags.includes(t) && s.tagOn]}>
                    <Text style={[s.tagText, tags.includes(t) && { color: theme.gold }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <View style={{ flex: 1 }} />
          <TouchableOpacity disabled={!comfort || busy} onPress={() => submit(comfort!)}
            style={{ opacity: !comfort || busy ? 0.4 : 1 }}>
            <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={s.cta}>
              {busy ? <ActivityIndicator color={theme.onGold} />
                : <Text style={s.ctaText}>Done</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 22 },
  progress: { flexDirection: "row", gap: 6, justifyContent: "center" },
  pip: { width: 34, height: 4, borderRadius: 2, backgroundColor: theme.line },
  callMeta: { color: theme.muted, fontSize: 13, textAlign: "center", marginTop: 16 },
  body: { flex: 1, marginTop: 40 },
  q: { color: theme.ink, fontSize: 27, fontFamily: theme.font.display, textAlign: "center",
    letterSpacing: -0.8, lineHeight: 33 },
  qSub: { color: theme.muted, fontSize: 13.5, textAlign: "center", marginTop: 10,
    lineHeight: 19 },
  starRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 40 },
  skip: { color: theme.muted, textAlign: "center", marginTop: 34, fontFamily: theme.font.semibold,
    fontSize: 14 },
  bigOption: { borderWidth: 1.5, borderColor: theme.line, backgroundColor: theme.card,
    borderRadius: theme.radii.md, padding: 18, alignItems: "center", marginTop: 12,
    ...theme.shadow.card },
  bigOptionText: { color: theme.ink, fontSize: 17, fontFamily: theme.font.bold },
  comfortRow: { flexDirection: "row", gap: 8, marginTop: 26 },
  comfortCard: { flex: 1, borderWidth: 1.5, borderColor: theme.line,
    backgroundColor: theme.card, borderRadius: theme.radii.md, alignItems: "center", paddingVertical: 14,
    gap: 6 },
  comfortOn: { borderColor: theme.gold, backgroundColor: theme.goldSoft },
  comfortLabel: { color: theme.muted, fontSize: 12, fontFamily: theme.font.semibold },
  tagLabel: { color: theme.ink, fontSize: 14, fontFamily: theme.font.bold, marginTop: 32,
    marginBottom: 10 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card,
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  tagOn: { borderColor: theme.gold, backgroundColor: theme.goldSoft },
  tagText: { color: theme.muted, fontSize: 12.5, fontFamily: theme.font.semibold },
  cta: { borderRadius: theme.radii.pill, padding: 18, alignItems: "center", marginBottom: 10,
    ...theme.shadow.cta },
  ctaText: { color: theme.onGold, fontFamily: theme.font.black, fontSize: 16, letterSpacing: 0.2 },
});
