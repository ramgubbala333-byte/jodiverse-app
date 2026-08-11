import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Alert,
  Modal, TextInput, ScrollView, Animated,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { deckAllPhotoUrls, listOwnPhotos } from "../lib/photos";
import { withEmoji } from "../lib/interests";
import AuroraShaderBackdrop from "../components/AuroraShaderBackdrop";
import { theme } from "../theme";

const WORDMARK = "Dosti Connect"; // TODO: swap when the final app name is locked

type Prompt = { q: string; a: string };
type P = { id: string; display_name: string; age: number; city: string | null;
  bio: string | null; relationship_goal: string | null; is_verified: boolean;
  faith: string | null; languages: string[] | null; diet: string | null;
  distance_band: string | null; recently_active: boolean;
  interests: string[] | null; new_here: boolean; occupation: string | null;
  prompts: Prompt[] | null; love_language: string | null; workout: string | null;
  traits: string[] | null; education: string | null; height_cm: number | null;
  drinking: string | null; activity_status: string | null };

// Which element the pending like is attached to — the comment becomes the
// opening line in chat, same as Hinge's "like a specific thing" mechanic.
type LikeTarget = { kind: "profile" | "photo" | "bio" | "interest" | "prompt";
  label: string; superLike?: boolean } | null;

// Curated deck: one profile at a time, full profile visible up front (photos,
// prompts, bio, facts). You like a specific photo/prompt/bio/interest — or
// the profile as a whole — optionally with a comment that becomes the
// match's opening line. Rewind and Super Like are premium (server-gated).
export default function DiscoverScreen() {
  const nav = useNavigation<any>();
  const [deck, setDeck] = useState<P[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string[]>>({});
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [likeTarget, setLikeTarget] = useState<LikeTarget>(null);
  const [comment, setComment] = useState("");
  const [toast, setToast] = useState<{ icon: string; text: string } | null>(null);
  const [stats, setStats] = useState<{ response_rate: number | null } | null>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const [reqText, setReqText] = useState("");
  const [reqLeft, setReqLeft] = useState<number | null>(null);
  const myPhoto = useRef<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (icon: string, text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ icon, text });
    toastAnim.setValue(0);
    Animated.timing(toastAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastAnim, { toValue: 0, duration: 220, useNativeDriver: true })
        .start(() => setToast(null));
    }, 2400);
  };

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

  // Per-profile public stats (reply rate etc.) — refetched as you move through
  // the deck, since they're computed live rather than stored on the row.
  useEffect(() => {
    if (!current) { setStats(null); return; }
    let live = true;
    setStats(null);
    supabase.rpc("profile_stats", { other: current.id }).then(({ data }) => {
      if (live) setStats(data as any);
    });
    return () => { live = false; };
  }, [current?.id]);

  useEffect(() => {
    supabase.rpc("requests_remaining").then(({ data }) => setReqLeft(data ?? 0));
  }, []);

  const sendRequest = async () => {
    if (!current || !reqText.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc("send_request", {
      p_to: current.id, p_body: reqText.trim(),
    });
    setBusy(false);
    setReqOpen(false); setReqText("");
    if (error) {
      const map: Record<string, string> = {
        REQUEST_LIMIT_REACHED: "You're out of Requests for today. Plus members get 10 a day.",
        ALREADY_REQUESTED: "You've already sent them a Request.",
        BLOCKED: "You can't send a Request to this person.",
      };
      const key = Object.keys(map).find((k) => error.message?.includes(k));
      Alert.alert("Couldn't send Request", key ? map[key] : error.message,
        key === "REQUEST_LIMIT_REACHED"
          ? [{ text: "Later", style: "cancel" }, { text: "See plans", onPress: () => nav.navigate("Paywall") }]
          : [{ text: "OK" }]);
      return;
    }
    supabase.rpc("requests_remaining").then(({ data }) => setReqLeft(data ?? 0));
    showToast("mail", "Request sent — they'll see your note first");
    next();
  };

  const openLike = (target: LikeTarget) => { setComment(""); setLikeTarget(target); };

  const confirmLike = async () => {
    if (!current || !likeTarget) return;
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    setBusy(false);
    if (!user) return;
    const note = comment.trim() || null;
    const wasSuper = !!likeTarget.superLike;
    setLikeTarget(null);
    await sendSwipe(current, wasSuper ? "super" : "like", note);
    if (note) showToast("check_circle", "Message sent — they'll see your comment first");
  };

  const pass = async () => {
    if (!current) return;
    await sendSwipe(current, "pass", null);
  };

  const superLike = () => {
    if (!current) return;
    openLike({ kind: "profile", label: current.display_name, superLike: true });
  };

  const rewind = async () => {
    const { data, error } = await supabase.rpc("rewind_last_swipe");
    if (error?.message?.includes("REWIND_REQUIRES_PLUS")) {
      Alert.alert("Rewind is a Plus feature",
        "Undo your last swipe with Plus — never miss out on a good match.",
        [{ text: "Later", style: "cancel" }, { text: "See plans", onPress: () => nav.navigate("Paywall") }]);
      return;
    }
    if (data) { showToast("replay", "Rewound!"); load(); }
    else showToast("info", "Nothing to rewind");
  };

  const sendSwipe = async (target: P, direction: "like" | "pass" | "super", note: string | null) => {
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
    if (error?.message?.includes("SUPER_REQUIRES_PREMIUM")) {
      Alert.alert("Super Likes are premium",
        "Stand out from the crowd — you're 3× more likely to match with a Super Like.",
        [{ text: "Later", style: "cancel" }, { text: "See plans", onPress: () => nav.navigate("Paywall") }]);
      return;
    }
    if (direction !== "pass") {
      const [a, b] = [user.id, target.id].sort();
      const { data: match } = await supabase.from("matches")
        .select("id").eq("a", a).eq("b", b).maybeSingle();
      if (match) {
        nav.navigate("Matched", {
          matchId: match.id, name: target.display_name, otherId: target.id,
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
      <AuroraShaderBackdrop />
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
  const prompts = current.prompts ?? [];

  return (
    <View style={s.wrap}>
      <AuroraShaderBackdrop />

      {/* toasts */}
      {toast && (
        <Animated.View style={[s.toast, {
          opacity: toastAnim,
          transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
        }]}>
          <Ionicons name={toast.icon as any} size={16} color={theme.gold} />
          <Text style={s.toastText}>{toast.text}</Text>
        </Animated.View>
      )}

      <View style={s.header}>
        <Text style={s.brand}>{WORDMARK}</Text>
        <View style={s.headerActions}>
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => nav.navigate("Requests")}>
            <Ionicons name="mail-outline" size={22} color={theme.gold} />
          </TouchableOpacity>
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => nav.navigate("Filters")}>
            <Ionicons name="options-outline" size={22} color={theme.gold} />
          </TouchableOpacity>
        </View>
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

        {/* insight rows — what they care about, how responsive they are.
            Only rendered when we actually have the data (never faked). */}
        {(current.love_language || stats?.response_rate != null || current.activity_status) && (
          <View style={s.statList}>
            {current.love_language && (
              <View style={s.statRow}>
                <View style={s.statIcon}><Ionicons name="heart-half" size={17} color={theme.purple} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.statLabel}>{current.display_name} cares about</Text>
                  <Text style={s.statValue}>{current.love_language}</Text>
                </View>
              </View>
            )}
            {stats?.response_rate != null && (
              <View style={s.statRow}>
                <View style={s.statIcon}><Ionicons name="mail" size={17} color={theme.purple} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.statLabel}>Response rate</Text>
                  <Text style={s.statValue}>{stats.response_rate}% of the time</Text>
                </View>
              </View>
            )}
            {current.activity_status && (
              <View style={s.statRow}>
                <View style={s.statIcon}><Ionicons name="radio-button-on" size={17} color={theme.purple} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.statLabel}>Last active</Text>
                  <Text style={s.statValue}>{current.activity_status}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* personality traits */}
        {current.traits?.length ? (
          <View style={s.promptCard}>
            <Text style={s.promptLabel}>MY TRAITS</Text>
            <View style={[s.chipWrap, { marginTop: 10 }]}>
              {current.traits.map((t) => (
                <View key={t} style={s.traitChip}><Text style={s.traitChipText}>{t}</Text></View>
              ))}
            </View>
          </View>
        ) : null}

        {/* structured prompts — Hinge-style, each individually likeable */}
        {prompts.map((p, i) => (
          <View key={`${p.q}-${i}`} style={s.promptCard}>
            <Text style={s.promptQ}>{p.q}</Text>
            <Text style={s.promptText}>{p.a}</Text>
            <TouchableOpacity style={s.promptLikeBtn} onPress={() =>
              openLike({ kind: "prompt", label: `"${p.q}"` })}>
              <Ionicons name="heart" size={18} color={theme.gold} />
            </TouchableOpacity>
          </View>
        ))}

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

      {/* action bar — rewind / pass / super like / like / request */}
      <View style={s.actions}>
        <TouchableOpacity style={s.miniBtn} onPress={rewind}>
          <Ionicons name="refresh" size={20} color={theme.muted} />
        </TouchableOpacity>
        <TouchableOpacity style={s.passBtn} onPress={pass}>
          <Ionicons name="close" size={30} color={theme.danger} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.miniBtn, s.superBtn]} onPress={superLike}>
          <Ionicons name="star" size={20} color={theme.purple} />
        </TouchableOpacity>
        <TouchableOpacity style={s.likeBtn}
          onPress={() => openLike({ kind: "profile", label: current.display_name })}>
          <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill} />
          <Ionicons name="heart" size={28} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[s.miniBtn, s.reqBtn]}
          onPress={() => { setReqText(""); setReqOpen(true); }}>
          <Ionicons name="mail" size={20} color={theme.rose} />
        </TouchableOpacity>
      </View>

      {/* Request — message before matching (rate-limited server-side) */}
      <Modal visible={reqOpen} transparent animationType="fade"
        onRequestClose={() => setReqOpen(false)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <View style={s.reqHead}>
              <Text style={s.modalTitle}>Send a Request to {current.display_name}</Text>
              <Text style={s.reqLeft}>{reqLeft ?? "—"} left</Text>
            </View>
            <Text style={s.modalSub}>
              Skip the wait — send a note before you match. They'll see it in their Requests.
            </Text>
            <TextInput style={s.modalInput} value={reqText} onChangeText={setReqText}
              placeholder="Get their attention with something personal…"
              placeholderTextColor={theme.muted} maxLength={300} multiline autoFocus />
            <View style={s.modalRow}>
              <TouchableOpacity style={s.modalGhost} onPress={() => setReqOpen(false)}>
                <Text style={s.modalGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1 }} onPress={sendRequest}
                disabled={busy || !reqText.trim()}>
                <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={[s.modalSend, (busy || !reqText.trim()) && { opacity: 0.5 }]}>
                  {busy ? <ActivityIndicator color="#fff" />
                    : <Text style={s.modalSendText}>Send Request</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* like + optional comment */}
      <Modal visible={likeTarget !== null} transparent animationType="fade"
        onRequestClose={() => setLikeTarget(null)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>
              {likeTarget?.superLike ? "⭐ Super Like " : "Like "}{likeTarget?.label}
            </Text>
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
                    <Text style={s.modalSendText}>
                      {comment.trim() ? "Send like" : likeTarget?.superLike ? "Super Like" : "Like"}
                    </Text>
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: 18 },

  toast: { position: "absolute", top: 54, left: 16, right: 16, zIndex: 50,
    flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center",
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, ...theme.shadow.floating },
  toastText: { color: theme.ink, fontSize: 12.5, fontFamily: theme.font.semibold, flexShrink: 1 },

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
  promptQ: { color: theme.gold, fontSize: 10.5, fontFamily: theme.font.black, letterSpacing: 1.5,
    textTransform: "uppercase", marginBottom: 10, fontStyle: "italic" },
  promptText: { color: theme.ink, fontSize: 15, lineHeight: 22, fontFamily: theme.font.medium,
    paddingRight: 30 },
  promptLikeBtn: { position: "absolute", bottom: 14, right: 14, width: 34, height: 34, borderRadius: 17,
    backgroundColor: theme.card2, alignItems: "center", justifyContent: "center" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "rgba(255,122,46,.5)", backgroundColor: theme.goldSoft,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: theme.gold, fontSize: 12, fontFamily: theme.font.semibold },

  actions: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 16, paddingBottom: 26, paddingTop: 14,
    backgroundColor: theme.bg },
  miniBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.card,
    borderWidth: 1.5, borderColor: theme.line, alignItems: "center", justifyContent: "center" },
  superBtn: { borderColor: "rgba(138,63,252,.4)" },
  reqBtn: { borderColor: "rgba(255,75,137,.4)" },

  // insight rows (love language / response rate / last active)
  statList: { marginHorizontal: 16, marginTop: 14, gap: 10 },
  statRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, borderRadius: theme.radii.md, padding: 14 },
  statIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(138,63,252,.12)",
    alignItems: "center", justifyContent: "center" },
  statLabel: { color: theme.muted, fontSize: 11.5, fontFamily: theme.font.semibold },
  statValue: { color: theme.ink, fontSize: 15, fontFamily: theme.font.bold, marginTop: 2 },
  traitChip: { backgroundColor: theme.card2, borderWidth: 1, borderColor: "rgba(138,63,252,.35)",
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  traitChipText: { color: theme.ink, fontSize: 12.5, fontFamily: theme.font.semibold },
  reqHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  reqLeft: { color: theme.muted, fontSize: 12, fontFamily: theme.font.bold },
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
