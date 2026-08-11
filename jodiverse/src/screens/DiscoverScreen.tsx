import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Alert,
  Modal, TextInput, ScrollView,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { deckAllPhotoUrls, listOwnPhotos } from "../lib/photos";
import { withEmoji } from "../lib/interests";
import { theme } from "../theme";

const WORDMARK = "Dosti Connect"; // TODO: swap when the final app name is locked

type P = { id: string; display_name: string; age: number; city: string | null;
  bio: string | null; relationship_goal: string | null; is_verified: boolean;
  faith: string | null; languages: string[] | null; diet: string | null;
  distance_band: string | null; recently_active: boolean;
  interests: string[] | null; new_here: boolean; occupation: string | null };

// Which element the pending like is attached to — the comment becomes the
// opening line in chat, same as Hinge's "like a specific thing" mechanic.
type LikeTarget = { kind: "profile" | "photo" | "bio" | "interest"; label: string } | null;

// Curated deck: one profile at a time, full profile visible up front (photos,
// bio, facts). You like a specific photo/bio/interest — or the profile as a
// whole — optionally with a comment, which becomes the match's opening line.
export default function DiscoverScreen() {
  const nav = useNavigation<any>();
  const [deck, setDeck] = useState<P[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string[]>>({});
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [likeTarget, setLikeTarget] = useState<LikeTarget>(null);
  const [comment, setComment] = useState("");
  const myPhoto = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // get_deck is a SECURITY DEFINER RPC — the only path to strangers' profiles.
    const { data, error } = await supabase.rpc("get_deck", { limit_n: 20 });
    if (!error && data) {
      const urls = await deckAllPhotoUrls((data as P[]).map((p) => p.id));
      setDeck(data as P[]);
      setPhotoUrls(urls);
      setIdx(0);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const mine = await listOwnPhotos(user.id);
      myPhoto.current = mine[0]?.url ?? null;
    })();
  }, []);

  const current = deck[idx];

  const openLike = (target: LikeTarget) => { setComment(""); setLikeTarget(target); };

  const confirmLike = async () => {
    if (!current) return;
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    setBusy(false);
    if (!user) return;
    const note = comment.trim() || null;
    setLikeTarget(null);
    await sendSwipe(current, "like", note);
  };

  const pass = async () => {
    if (!current) return;
    await sendSwipe(current, "pass", null);
  };

  const sendSwipe = async (target: P, direction: "like" | "pass", note: string | null) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("swipes")
      .insert({ swiper: user.id, swipee: target.id, direction, note });
    if (error?.message?.includes("LIKE_LIMIT_REACHED")) {
      Alert.alert("Out of likes for now",
        "Free members get 50 likes every 12 hours. Go unlimited with Plus.",
        [{ text: "Later", style: "cancel" }, { text: "See plans", onPress: () => nav.navigate("Paywall") }]);
      return;
    }
    if (direction === "like") {
      const [a, b] = [user.id, target.id].sort();
      const { data: match } = await supabase.from("matches")
        .select("id").eq("a", a).eq("b", b).maybeSingle();
      if (match) {
        nav.navigate("Matched", {
          matchId: match.id, name: target.display_name,
          theirPhoto: photoUrls[target.id]?.[0] ?? null, myPhoto: myPhoto.current,
        });
        return;
      }
    }
    next();
  };

  const next = () => {
    if (idx + 1 < deck.length) setIdx(idx + 1);
    else load(); // deck exhausted — pull a fresh batch
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={theme.gold} /></View>;

  if (!current) return (
    <View style={s.center}>
      <LinearGradient colors={[...theme.grad]} style={s.emptyBadge}>
        <Ionicons name="people" size={30} color="#fff" />
      </LinearGradient>
      <Text style={s.emptyTitle}>No new profiles right now</Text>
      <Text style={s.emptySub}>Widen your preferences in Settings or check back soon.</Text>
      <TouchableOpacity onPress={load}><Text style={s.link}>Refresh</Text></TouchableOpacity>
    </View>
  );

  const urls = photoUrls[current.id] ?? [];
  const facts = [current.relationship_goal, current.faith, current.diet,
    ...(current.languages ?? []).slice(0, 2)].filter(Boolean) as string[];

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Text style={s.brand}>{WORDMARK}</Text>
        <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => nav.navigate("Paywall")}>
          <Ionicons name="options-outline" size={22} color={theme.gold} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        {/* main photo */}
        <View style={s.photoCard}>
          {urls[0] ? (
            <Image source={{ uri: urls[0] }} style={s.photo} resizeMode="cover" />
          ) : (
            <LinearGradient colors={[...theme.grad]} style={s.photo}>
              <Text style={s.initial}>{current.display_name?.[0]?.toUpperCase() ?? "?"}</Text>
            </LinearGradient>
          )}
          {current.new_here && (
            <View style={s.newHere}><Text style={s.newHereText}>New here</Text></View>
          )}
          <TouchableOpacity style={s.photoLike} onPress={() =>
            openLike({ kind: "photo", label: "your photo" })}>
            <Ionicons name="heart" size={22} color="#fff" />
          </TouchableOpacity>
          <LinearGradient colors={["transparent", "rgba(8,10,18,.85)"]} style={s.scrim}>
            <View style={s.nameRow}>
              <Text style={s.name}>{current.display_name}</Text>
              <Text style={s.age}> {current.age}</Text>
              {current.is_verified && (
                <Ionicons name="checkmark-circle" size={20} color="#6FA8C9" style={{ marginLeft: 6 }} />
              )}
            </View>
            {current.occupation ? (
              <Text style={s.scrimMeta}>💼 {current.occupation}</Text>
            ) : null}
            {(current.city || current.distance_band) ? (
              <Text style={s.scrimMeta}>
                📍 {[current.city, current.distance_band].filter(Boolean).join(" · ")}
              </Text>
            ) : null}
            {current.recently_active && <Text style={s.scrimMeta}>🟢 Recently active</Text>}
          </LinearGradient>
        </View>

        {/* facts strip */}
        {facts.length > 0 && (
          <View style={s.factsRow}>
            {facts.map((f) => (
              <View key={f} style={s.factChip}><Text style={s.factText}>{f}</Text></View>
            ))}
          </View>
        )}

        {/* bio — tap the heart to like their answer specifically */}
        {current.bio ? (
          <View style={s.promptCard}>
            <View style={s.promptHead}>
              <Text style={s.promptLabel}>ABOUT</Text>
              <TouchableOpacity onPress={() => openLike({ kind: "bio", label: "your bio" })}>
                <Ionicons name="heart-outline" size={20} color={theme.gold} />
              </TouchableOpacity>
            </View>
            <Text style={s.promptText}>{current.bio}</Text>
          </View>
        ) : null}

        {/* interests */}
        {current.interests?.length ? (
          <View style={s.promptCard}>
            <View style={s.promptHead}>
              <Text style={s.promptLabel}>INTERESTS</Text>
              <TouchableOpacity onPress={() => openLike({ kind: "interest", label: "your interests" })}>
                <Ionicons name="heart-outline" size={20} color={theme.gold} />
              </TouchableOpacity>
            </View>
            <View style={s.chipWrap}>
              {current.interests.map((i) => (
                <View key={i} style={s.chip}><Text style={s.chipText}>{withEmoji(i)}</Text></View>
              ))}
            </View>
          </View>
        ) : null}

        {/* second photo, if any */}
        {urls[1] ? (
          <View style={[s.photoCard, s.photoCardTall]}>
            <Image source={{ uri: urls[1] }} style={s.photo} resizeMode="cover" />
            <TouchableOpacity style={s.photoLike} onPress={() =>
              openLike({ kind: "photo", label: "your photo" })}>
              <Ionicons name="heart" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>

      {/* action bar — pass / like the whole profile */}
      <View style={s.actions}>
        <TouchableOpacity style={s.passBtn} onPress={pass}>
          <Ionicons name="close" size={30} color={theme.danger} />
        </TouchableOpacity>
        <TouchableOpacity style={s.likeBtn}
          onPress={() => openLike({ kind: "profile", label: current.display_name })}>
          <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill} />
          <Ionicons name="heart" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* like + optional comment */}
      <Modal visible={likeTarget !== null} transparent animationType="fade"
        onRequestClose={() => setLikeTarget(null)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Like {likeTarget?.label}</Text>
            <Text style={s.modalSub}>
              Add a comment and it becomes your opening line if you match.
            </Text>
            <TextInput style={s.modalInput} value={comment} onChangeText={setComment}
              placeholder="Say something (optional)…" placeholderTextColor={theme.muted}
              maxLength={280} multiline autoFocus />
            <View style={s.modalRow}>
              <TouchableOpacity style={s.modalGhost} onPress={() => setLikeTarget(null)}>
                <Text style={s.modalGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1 }} onPress={confirmLike} disabled={busy}>
                <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={s.modalSend}>
                  {busy ? <ActivityIndicator color="#fff" /> : (
                    <Text style={s.modalSendText}>{comment.trim() ? "Send like" : "Like"}</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: 30 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 58, paddingBottom: 10 },
  brand: { color: theme.gold, fontSize: 20, fontFamily: theme.font.displayMd, letterSpacing: -0.4 },

  emptyBadge: { width: 64, height: 64, borderRadius: 24, alignItems: "center",
    justifyContent: "center", marginBottom: 18 },
  emptyTitle: { color: theme.ink, fontSize: 18, fontFamily: theme.font.bold, marginBottom: 6 },
  emptySub: { color: theme.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  link: { color: theme.gold, marginTop: 14, fontFamily: theme.font.bold },

  photoCard: { marginHorizontal: 16, borderRadius: theme.radii.xl, overflow: "hidden",
    aspectRatio: 4 / 5, backgroundColor: theme.card, ...theme.shadow.card },
  photoCardTall: { marginTop: 16 },
  photo: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  initial: { color: "rgba(255,255,255,.3)", fontSize: 110, fontFamily: theme.font.black },
  newHere: { position: "absolute", top: 14, left: 14, backgroundColor: theme.ink, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 6 },
  newHereText: { color: theme.bg, fontSize: 12, fontFamily: theme.font.bold },
  photoLike: { position: "absolute", right: 14, bottom: 14, width: 44, height: 44, borderRadius: 22,
    backgroundColor: "rgba(8,10,18,.55)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,.25)" },
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 18,
    paddingBottom: 18, paddingTop: 60 },
  nameRow: { flexDirection: "row", alignItems: "flex-end" },
  name: { color: "#fff", fontSize: 26, fontFamily: theme.font.display, letterSpacing: -0.6 },
  age: { color: "#fff", fontSize: 21, fontFamily: theme.font.medium },
  scrimMeta: { color: "rgba(255,255,255,.9)", fontSize: 13, marginTop: 4, fontFamily: theme.font.semibold },

  factsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, marginTop: 14 },
  factChip: { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card,
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  factText: { color: theme.ink, fontSize: 12.5, fontFamily: theme.font.semibold },

  promptCard: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.lg, padding: 16, marginHorizontal: 16, marginTop: 14, ...theme.shadow.card },
  promptHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 10 },
  promptLabel: { color: theme.muted, fontSize: 10.5, fontFamily: theme.font.black, letterSpacing: 1.5 },
  promptText: { color: theme.ink, fontSize: 15, lineHeight: 22, fontFamily: theme.font.medium },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "rgba(255,122,46,.5)", backgroundColor: theme.goldSoft,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: theme.gold, fontSize: 12, fontFamily: theme.font.semibold },

  actions: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 20, paddingBottom: 26, paddingTop: 14,
    backgroundColor: theme.bg },
  passBtn: { width: 62, height: 62, borderRadius: 31, backgroundColor: theme.card,
    borderWidth: 1.5, borderColor: theme.line, alignItems: "center", justifyContent: "center",
    ...theme.shadow.card },
  likeBtn: { width: 66, height: 66, borderRadius: 33, alignItems: "center", justifyContent: "center",
    overflow: "hidden", ...theme.shadow.cta },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,.6)", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: theme.card, borderRadius: theme.radii.xl, padding: 20,
    borderWidth: 1, borderColor: theme.line, ...theme.shadow.floating },
  modalTitle: { color: theme.ink, fontSize: 18, fontFamily: theme.font.displayMd },
  modalSub: { color: theme.muted, fontSize: 12.5, marginTop: 6, marginBottom: 14, lineHeight: 18 },
  modalInput: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, padding: 13, color: theme.ink, minHeight: 70, textAlignVertical: "top" },
  modalRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  modalGhost: { paddingHorizontal: 14, paddingVertical: 13 },
  modalGhostText: { color: theme.muted, fontFamily: theme.font.bold },
  modalSend: { borderRadius: 999, padding: 14, alignItems: "center" },
  modalSendText: { color: "#fff", fontFamily: theme.font.black, fontSize: 14.5 },
});
