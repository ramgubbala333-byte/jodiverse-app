import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Alert,
  Modal, TextInput,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Swiper from "react-native-deck-swiper";
import { supabase } from "../lib/supabase";
import { deckAllPhotoUrls, listOwnPhotos } from "../lib/photos";
import { withEmoji } from "../lib/interests";
import RingLogo from "../components/RingLogo";
import { theme } from "../theme";

type P = { id: string; display_name: string; age: number; city: string | null;
  bio: string | null; relationship_goal: string | null; is_verified: boolean;
  faith: string | null; languages: string[] | null; diet: string | null;
  distance_band: string | null; recently_active: boolean;
  interests: string[] | null; new_here: boolean; occupation: string | null };

type MatchInfo = { name: string; matchId: string | null; theirPhoto: string | null;
  myPhoto: string | null };

// ── Premium upsell popups ──────────────────────────────────────────────────
type UpsellKind = "likes" | "empty" | "promo" | "super" | "rewind";
const UPSELL: Record<UpsellKind, { icon: string; title: string; sub: string; perks: string[] }> = {
  super: {
    icon: "star", title: "Super Likes are premium",
    sub: "Stand out from the crowd — you're 3× more likely to match with a Super Like.",
    perks: ["5 Super Likes a week with Gold", "Add a comment they see instantly", "See who likes you"],
  },
  rewind: {
    icon: "refresh", title: "Rewind is a Plus feature",
    sub: "Went left when you meant right? Undo your last swipe with Plus.",
    perks: ["Rewind your last swipe", "Unlimited likes & messages", "Passport to any city"],
  },
  likes: {
    icon: "heart", title: "You're out of likes",
    sub: "Free members get 50 likes every 12 hours. Go unlimited and never wait again.",
    perks: ["Unlimited likes & messages", "See who likes you", "Rewind your last swipe"],
  },
  empty: {
    icon: "telescope", title: "You've seen everyone nearby",
    sub: "Don't wait for new faces — widen your reach and get seen first.",
    perks: ["Passport to any city", "Monthly Boost — 30 min at the top", "Priority likes (seen first)"],
  },
  promo: {
    icon: "diamond", title: "Find your Jodi faster",
    sub: "Gold members get seen first and match up to 3× more.",
    perks: ["See who likes you", "Unlimited likes & messages", "5 Super Likes a week"],
  },
};
let promoShownThisSession = false; // at most one surprise promo per app session

export default function DeckScreen() {
  const [deck, setDeck] = useState<P[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string[]>>({});
  const [photoIdx, setPhotoIdx] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [deckH, setDeckH] = useState(0);
  const [loadId, setLoadId] = useState(0); // bumps per reload → clean swiper remount
  const [superFor, setSuperFor] = useState<number | null>(null); // card index
  const [superNote, setSuperNote] = useState("");
  const [upsell, setUpsell] = useState<UpsellKind | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const swiperRef = useRef<Swiper<P>>(null);
  const nav = useNavigation<any>();
  const cardH = Math.max(deckH - 24, 200);

  const load = useCallback(async () => {
    setLoading(true);
    // get_deck is a SECURITY DEFINER RPC — the only path to strangers' profiles.
    const { data, error } = await supabase.rpc("get_deck", { limit_n: 20 });
    if (!error && data) {
      const urls = await deckAllPhotoUrls((data as P[]).map((p) => p.id));
      setDeck(data as P[]);
      setPhotoUrls(urls);
      setPhotoIdx({});
      setLoadId((x) => x + 1);
      if ((data as P[]).length === 0) {
        // Deck exhausted — pitch the features that surface more people.
        setUpsell("empty");
      } else if (!promoShownThisSession && Math.random() < 0.25) {
        // Occasional surprise premium pitch, boost-ad style (once per session).
        promoShownThisSession = true;
        setUpsell("promo");
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Premium gate for Super Like / Rewind — any active tier counts.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("subscriptions").select("tier")
        .eq("user_id", user.id).gt("expires_at", new Date().toISOString()).maybeSingle();
      setSubscribed(!!data);
    })();
  }, []);

  // Swipe inserts run async while cards keep moving; the deck refresh on
  // "swiped all" must wait for them or the just-swiped profile comes back.
  const pendingSwipes = useRef<Promise<unknown>[]>([]);
  const reloadAfterSwipes = useCallback(async () => {
    await Promise.allSettled(pendingSwipes.current);
    pendingSwipes.current = [];
    load();
  }, [load]);

  const swipe = (index: number, direction: "like" | "pass" | "super", note?: string) => {
    const p = doSwipe(index, direction, note);
    pendingSwipes.current.push(p);
    return p;
  };

  const doSwipe = async (index: number, direction: "like" | "pass" | "super", note?: string) => {
    const target = deck[index];
    if (!target) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error: swipeErr } = await supabase.from("swipes").insert({
      swiper: user.id, swipee: target.id, direction, note: note || null,
    });
    if (swipeErr?.message?.includes("LIKE_LIMIT_REACHED")) {
      setUpsell("likes");
      return;
    }
    if (swipeErr?.message?.includes("SUPER_REQUIRES_PREMIUM")) {
      setUpsell("super");
      return;
    }
    if (direction !== "pass") {
      // The DB trigger creates the match; check if it did.
      const [a, b] = [user.id, target.id].sort();
      const { data } = await supabase.from("matches")
        .select("id").eq("a", a).eq("b", b).maybeSingle();
      if (data) {
        const mine = await listOwnPhotos(user.id);
        setMatch({
          name: target.display_name, matchId: data.id,
          theirPhoto: photoUrls[target.id]?.[0] ?? null,
          myPhoto: mine[0]?.url ?? null,
        });
      }
    }
  };

  const boost = async () => {
    const { data, error } = await supabase.rpc("activate_boost");
    if (error) {
      if (error.message.includes("NO_BOOST_CREDITS")) {
        Alert.alert("No Boosts left", "Gold members get a free Boost every month.", [
          { text: "Later", style: "cancel" },
          { text: "Get Gold", onPress: () => nav.navigate("Paywall") },
        ]);
      }
      return;
    }
    const mins = Math.max(1, Math.round((new Date(data).getTime() - Date.now()) / 60000));
    Alert.alert("⚡ Boost activated!", `You're at the top of nearby decks for the next ${mins} minutes.`);
  };

  const rewind = async () => {
    if (!subscribed) { setUpsell("rewind"); return; } // server enforces too
    const { error } = await supabase.rpc("rewind_last_swipe");
    if (error) {
      if (error.message.includes("REWIND_REQUIRES_PLUS")) setUpsell("rewind");
      return;
    }
    load(); // bring the rewound profile back
  };

  const cyclePhoto = (p: P, dir: 1 | -1) => {
    const urls = photoUrls[p.id] ?? [];
    if (urls.length < 2) return;
    setPhotoIdx((m) => ({
      ...m,
      [p.id]: (((m[p.id] ?? 0) + dir) % urls.length + urls.length) % urls.length,
    }));
  };

  const u = upsell ? UPSELL[upsell] : null;
  const upsellModal = (
    <Modal visible={upsell !== null} transparent animationType="fade"
      onRequestClose={() => setUpsell(null)}>
      <View style={s.modalBg}>
        <View style={s.upsellCard}>
          <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={s.upsellHead}>
            <Ionicons name={(u?.icon ?? "diamond") as any} size={32} color="#fff" />
            <Text style={s.upsellTitle}>{u?.title}</Text>
            <Text style={s.upsellSub}>{u?.sub}</Text>
          </LinearGradient>
          <View style={{ padding: 18 }}>
            {u?.perks.map((p) => (
              <View key={p} style={s.upsellPerkRow}>
                <Ionicons name="checkmark-circle" size={16} color={theme.gold} />
                <Text style={s.upsellPerk}>{p}</Text>
              </View>
            ))}
            <TouchableOpacity onPress={() => { setUpsell(null); nav.navigate("Paywall"); }}>
              <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={s.upsellCta}>
                <Text style={s.upsellCtaText}>See plans</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setUpsell(null)}>
              <Text style={s.upsellLater}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (loading) return <View style={s.center}><ActivityIndicator color={theme.rose} /></View>;
  if (!deck.length) return (
    <View style={s.center}>
      <LinearGradient colors={[...theme.grad]} style={s.emptyBadge}>
        <Ionicons name="flame" size={30} color="#fff" />
      </LinearGradient>
      <Text style={s.emptyTitle}>No new profiles right now</Text>
      <Text style={s.empty}>Adjust your Discovery settings or check back soon.</Text>
      <TouchableOpacity onPress={load}><Text style={s.link}>Refresh</Text></TouchableOpacity>
      {upsellModal}
    </View>
  );

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <RingLogo size={20} />
        <Text style={s.logoText}>Dosti Connect</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => nav.navigate("Dashboard")}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="grid-outline" size={22} color={theme.gold} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }} onLayout={(e) => setDeckH(e.nativeEvent.layout.height)}>
      {deckH > 0 && (
      <Swiper
        key={`deck-${loadId}`}  /* deck-swiper caches cards; remount only on reload */
        ref={swiperRef}
        cards={deck}
        stackSize={3}
        stackSeparation={-12}
        backgroundColor="transparent"
        verticalSwipe={false}
        cardVerticalMargin={12}
        onSwipedLeft={(i) => swipe(i, "pass")}
        onSwipedRight={(i) => swipe(i, "like")}
        onSwipedAll={reloadAfterSwipes}
        renderCard={(p: P) => {
          if (!p) return <View />;
          const urls = photoUrls[p.id] ?? [];
          const idx = Math.min(photoIdx[p.id] ?? 0, Math.max(urls.length - 1, 0));
          return (
          <View style={[s.card, { height: cardH }]}>
            {urls[idx] ? (
              <Image source={{ uri: urls[idx] }} style={s.photo} resizeMode="cover" />
            ) : (
              <LinearGradient colors={["#FBD0E0", "#F5A8C4"]} style={s.photo}>
                <Text style={s.initial}>{p.display_name?.[0]?.toUpperCase() ?? "?"}</Text>
              </LinearGradient>
            )}

            {/* photo progress bars */}
            {urls.length > 1 && (
              <View style={s.barRow}>
                {urls.map((_, i) => (
                  <View key={i} style={[s.bar, i === idx && s.barOn]} />
                ))}
              </View>
            )}

            {/* tap left/right halves to cycle photos */}
            <TouchableOpacity style={s.tapLeft} activeOpacity={1}
              onPress={() => cyclePhoto(p, -1)} />
            <TouchableOpacity style={s.tapRight} activeOpacity={1}
              onPress={() => cyclePhoto(p, 1)} />

            {/* readability scrim + meta */}
            <LinearGradient colors={["transparent", "rgba(10,18,16,.55)", "rgba(10,18,16,.92)"]}
              style={s.scrim}>
              {p.new_here && (
                <View style={s.newHere}>
                  <Text style={s.newHereText}>New here</Text>
                </View>
              )}
              <View style={s.nameRow}>
                <Text style={s.name}>{p.display_name}</Text>
                <Text style={s.age}> {p.age}</Text>
                {p.is_verified && (
                  <Ionicons name="checkmark-circle" size={22} color="#D4AF6A" style={{ marginLeft: 6 }} />
                )}
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={s.infoBtn} onPress={() =>
                  nav.navigate("MatchProfile", { otherId: p.id, name: p.display_name })}>
                  <Ionicons name="information" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
              {p.occupation ? (
                <View style={s.metaRow}>
                  <Ionicons name="briefcase-outline" size={14} color="#D8D2E6" />
                  <Text style={s.city}> {p.occupation}</Text>
                </View>
              ) : null}
              {p.recently_active && (
                <View style={s.metaRow}>
                  <View style={s.greenDot} />
                  <Text style={s.city}> Recently active</Text>
                </View>
              )}
              {(p.city || p.distance_band) ? (
                <View style={s.metaRow}>
                  <Ionicons name="location-outline" size={14} color="#D8D2E6" />
                  <Text style={s.city}>
                    {" "}{[p.city && `Lives in ${p.city}`, p.distance_band].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              ) : null}
              <View style={s.chipRow}>
                {[p.relationship_goal, p.faith, p.diet, ...(p.languages ?? []).slice(0, 2),
                  ...(p.interests ?? []).slice(0, 3).map(withEmoji)]
                  .filter(Boolean).map((c) => (
                    <View key={c as string} style={s.goalChip}>
                      <Text style={s.goalText}>{c}</Text>
                    </View>
                  ))}
              </View>
              {p.bio ? <Text style={s.bio} numberOfLines={2}>{p.bio}</Text> : null}
            </LinearGradient>
          </View>
          );
        }}
      />
      )}
      </View>

      {/* action buttons: rewind · nope · super · like · boost */}
      <View style={s.actions}>
        <TouchableOpacity style={[s.actBtn, s.actMid]} onPress={rewind}>
          <Ionicons name="refresh" size={22} color={theme.gold} style={{ transform: [{ scaleX: -1 }] }} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.actBtn, s.actBig]} onPress={() => swiperRef.current?.swipeLeft()}>
          <Ionicons name="close" size={32} color="#C25349" />
        </TouchableOpacity>
        <TouchableOpacity style={[s.actBtn, s.actMid]} onPress={() => {
          if (!subscribed) { setUpsell("super"); return; } // premium-only
          const i = (swiperRef.current as any)?.state?.firstCardIndex ?? 0;
          setSuperFor(i);
        }}>
          <Ionicons name="star" size={22} color="#6FA8C9" />
        </TouchableOpacity>
        <TouchableOpacity style={[s.actBtn, s.actBig]} onPress={() => swiperRef.current?.swipeRight()}>
          <Ionicons name="heart" size={28} color={theme.emerald} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.actBtn, s.actMid]} onPress={boost}>
          <Ionicons name="flash" size={22} color={theme.purple} />
        </TouchableOpacity>
      </View>

      {/* super like + comment modal */}
      <Modal visible={superFor !== null} transparent animationType="fade"
        onRequestClose={() => setSuperFor(null)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>
              ★ Super Like {superFor !== null && deck[superFor] ? deck[superFor].display_name : ""}
            </Text>
            <Text style={s.modalSub}>Stand out — add a comment they'll see the moment you match.</Text>
            <TextInput style={s.modalInput} value={superNote} onChangeText={setSuperNote}
              placeholder="You had me at the third photo…" placeholderTextColor={theme.muted}
              maxLength={280} multiline />
            <View style={s.modalRow}>
              <TouchableOpacity style={s.modalGhost} onPress={() => { setSuperFor(null); setSuperNote(""); }}>
                <Text style={{ color: theme.muted, fontWeight: "700" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => {
                const i = superFor!;
                setSuperFor(null);
                swipe(i, "super", superNote.trim() || undefined);
                setSuperNote("");
                (swiperRef.current as any)?.jumpToCardIndex(i + 1);
              }}>
                <LinearGradient colors={["#6FA8C9", "#5A8FAF"]} style={s.modalSend}>
                  <Text style={{ color: "#fff", fontWeight: "800" }}>
                    {superNote.trim() ? "Super Like with comment" : "Super Like"}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {upsellModal}

      {/* It's a Jodi! overlay */}
      {match && (
        <View style={s.matchOverlay}>
          <Text style={s.matchTitle}>It's a Jodi! 🎉</Text>
          <Text style={s.matchSub}>You and {match.name} liked each other.</Text>
          <View style={s.avatarRow}>
            <View style={s.avatarWrap}>
              {match.myPhoto
                ? <Image source={{ uri: match.myPhoto }} style={s.avatar} />
                : <View style={[s.avatar, s.avatarEmpty]}><Ionicons name="person" size={30} color={theme.muted} /></View>}
            </View>
            <View style={s.matchStar}><RingLogo size={18} /></View>
            <View style={s.avatarWrap}>
              {match.theirPhoto
                ? <Image source={{ uri: match.theirPhoto }} style={s.avatar} />
                : <View style={[s.avatar, s.avatarEmpty]}><Ionicons name="person" size={30} color={theme.muted} /></View>}
            </View>
          </View>
          <TouchableOpacity style={{ alignSelf: "stretch" }} onPress={() => {
            const m = match; setMatch(null);
            if (m.matchId) nav.navigate("Chat", { matchId: m.matchId, name: m.name });
          }}>
            <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.matchBtn}>
              <Text style={{ color: "#fff", fontWeight: "800" }}>Send a message</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={s.matchGhost} onPress={() => setMatch(null)}>
            <Text style={{ color: "#D8CFE8", fontWeight: "700" }}>Keep swiping</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 8,
    paddingTop: 54, paddingHorizontal: 18, paddingBottom: 4 },
  logoText: { color: theme.ink, fontSize: 20, fontFamily: theme.serif, fontWeight: "600" },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: 30 },
  emptyBadge: { width: 64, height: 64, borderRadius: 24, alignItems: "center",
    justifyContent: "center", marginBottom: 18 },
  emptyTitle: { color: theme.ink, fontSize: 18, fontWeight: "800", marginBottom: 6 },
  empty: { color: theme.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  link: { color: theme.rose, marginTop: 14, fontWeight: "700" },
  card: { borderRadius: theme.radius, backgroundColor: theme.card, overflow: "hidden" },
  photo: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  initial: { color: "rgba(255,255,255,.25)", fontSize: 110, fontWeight: "800" },
  barRow: { position: "absolute", top: 10, left: 12, right: 12, flexDirection: "row", gap: 5 },
  bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,.35)" },
  barOn: { backgroundColor: "#fff" },
  tapLeft: { position: "absolute", left: 0, top: 0, bottom: 140, width: "50%" },
  tapRight: { position: "absolute", right: 0, top: 0, bottom: 140, width: "50%" },
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 18,
    paddingBottom: 20, paddingTop: 70 },
  newHere: { alignSelf: "flex-start", backgroundColor: theme.ink, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 10 },
  newHereText: { color: theme.bg, fontSize: 12, fontWeight: "700" },
  nameRow: { flexDirection: "row", alignItems: "flex-end" },
  name: { color: "#fff", fontFamily: theme.serif, fontSize: 30, fontWeight: "800" },
  age: { color: "#fff", fontFamily: theme.serif, fontSize: 26, fontWeight: "400" },
  infoBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,.22)",
    alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  greenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#1E8E6E" },
  city: { color: "#D8D2E6", fontSize: 13 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  goalChip: { borderWidth: 1, borderColor: "rgba(255,255,255,.35)",
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  goalText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  bio: { color: "#D8D2E6", fontSize: 13, marginTop: 8, lineHeight: 19 },
  actions: { flexDirection: "row", justifyContent: "center", alignItems: "center",
    gap: 14, paddingBottom: 16, paddingTop: 4 },
  actBtn: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 8, elevation: 4 },
  actBig: { width: 62, height: 62, borderRadius: 31 },
  actMid: { width: 48, height: 48, borderRadius: 24 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,.6)", justifyContent: "center", padding: 24 },
  upsellCard: { backgroundColor: theme.card, borderRadius: 22, overflow: "hidden" },
  upsellHead: { alignItems: "center", padding: 22, paddingBottom: 18 },
  upsellTitle: { color: "#fff", fontSize: 19, fontWeight: "800", marginTop: 10,
    textAlign: "center" },
  upsellSub: { color: "rgba(255,255,255,.92)", fontSize: 13, textAlign: "center",
    marginTop: 6, lineHeight: 19 },
  upsellPerkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  upsellPerk: { color: theme.ink, fontSize: 13.5, flex: 1 },
  upsellCta: { borderRadius: 999, padding: 14, alignItems: "center", marginTop: 10 },
  upsellCtaText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  upsellLater: { color: theme.muted, fontWeight: "700", textAlign: "center", marginTop: 14 },
  modalCard: { backgroundColor: theme.card, borderRadius: 20, padding: 18,
    borderWidth: 1, borderColor: theme.line },
  modalTitle: { color: theme.ink, fontSize: 17, fontWeight: "800" },
  modalSub: { color: theme.muted, fontSize: 12, marginTop: 4, marginBottom: 12 },
  modalInput: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: 12, padding: 12, color: theme.ink, minHeight: 64, textAlignVertical: "top" },
  modalRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  modalGhost: { paddingHorizontal: 14, paddingVertical: 12 },
  modalSend: { borderRadius: 999, padding: 13, alignItems: "center" },
  matchOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,18,16,.96)",
    alignItems: "center", justifyContent: "center", padding: 34 },
  matchTitle: { fontSize: 38, color: "#fff", fontFamily: theme.serif, fontWeight: "700" },
  matchSub: { fontSize: 15, color: "#D8CFE8", marginTop: 8 },
  avatarRow: { flexDirection: "row", alignItems: "center", marginVertical: 30 },
  avatarWrap: { width: 96, height: 96, borderRadius: 48, borderWidth: 3,
    borderColor: theme.rose, overflow: "hidden" },
  avatar: { width: "100%", height: "100%" },
  avatarEmpty: { backgroundColor: theme.card, alignItems: "center", justifyContent: "center" },
  matchStar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.bg,
    alignItems: "center", justifyContent: "center", marginHorizontal: -12, zIndex: 2,
    borderWidth: 1, borderColor: "rgba(236,72,153,.4)" },
  matchBtn: { borderRadius: 999, padding: 15, alignItems: "center" },
  matchGhost: { padding: 14, marginTop: 6 },
});
