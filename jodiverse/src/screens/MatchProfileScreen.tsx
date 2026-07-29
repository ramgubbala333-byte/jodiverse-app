import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, Image, StyleSheet, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator, Platform,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { useAudioPlayer } from "expo-audio";
import { supabase } from "../lib/supabase";
import { listUserPhotos } from "../lib/photos";
import { signMediaPath } from "../lib/media";
import { withEmoji } from "../lib/interests";
import { theme } from "../theme";

type Params = { otherId: string; name: string; matchId?: string; self?: boolean };
type Prof = { display_name: string; age: number; city: string | null; bio: string | null;
  faith: string | null; languages: string[] | null; diet: string | null;
  relationship_goal: string | null; is_verified: boolean;
  interests: string[] | null; new_here: boolean;
  drinking: string | null; smoking: string | null; height_cm: number | null;
  occupation: string | null; activity_status?: string | null; gender?: string | null;
  video_path: string | null; audio_path: string | null };

const fmtHeight = (cm: number) =>
  `${Math.floor(cm / 30.48)}'${Math.round((cm % 30.48) / 2.54)}" (${cm} cm)`;

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const SERIF = Platform.OS === "ios" ? "Georgia" : "serif";

const TRAIT_LABEL: Record<string, string> = {
  good_listener: "🎧 Good listener", funny: "😄 Funny", curious: "🔍 Curious",
  storyteller: "📖 Storyteller", calm: "🌿 Calm", warm: "💛 Warm",
  easy_going: "😌 Easy to talk to", talkative: "💬 Talkative",
  concise: "⚡ Concise", engaged: "✅ Engaged",
};
const BAND: Record<string, [string, string]> = {
  ready: ["Ready to meet", "You two are clicking — time to plan something in person."],
  warming_up: ["Warming up", "A couple more chats and you'll be there."],
  early: ["Just getting started", "Talk more to build a real connection first."],
};

// Full profile of a match: all photos, details, photo comments (sent into
// the chat), and a secure-calling stub (real calls need WebRTC infra — an
// in-app relay so phone numbers are never exchanged; roadmap).
export default function MatchProfileScreen() {
  const { otherId, name, matchId, self } = useRoute().params as Params;
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [prof, setProf] = useState<Prof | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentOn, setCommentOn] = useState<number | null>(null); // photo index
  const [comment, setComment] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [revealLevel, setRevealLevel] = useState<"locked" | "blurred" | "full">("locked");
  const [youOptedIn, setYouOptedIn] = useState(false);
  const [revealBusy, setRevealBusy] = useState(false);
  const [traits, setTraits] = useState<Record<string, number>>({});
  const [readiness, setReadiness] = useState<any>(null);
  const [subscribed, setSubscribed] = useState(false);

  // Intro video: autoplay muted loop, Bumble-style; tap the speaker for sound.
  const videoPlayer = useVideoPlayer(null, (p) => { p.loop = true; p.muted = true; });
  const voicePlayer = useAudioPlayer();

  useEffect(() => {
    if (!videoUrl) return;
    videoPlayer.replaceAsync(videoUrl).then(() => videoPlayer.play()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  const toggleMute = () => { videoPlayer.muted = !muted; setMuted(!muted); };

  const toggleVoice = () => {
    if (!audioUrl) return;
    if (voicePlaying) { voicePlayer.pause(); setVoicePlaying(false); return; }
    voicePlayer.replace({ uri: audioUrl });
    voicePlayer.play();
    setVoicePlaying(true);
  };

  useEffect(() => {
    (async () => {
      if (self) {
        // Own preview: read the base table (public_profiles hides inactive
        // profiles, incl. possibly our own) and compute age locally.
        const [{ data }, urls] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", otherId).maybeSingle(),
          listUserPhotos(otherId),
        ]);
        if (data) {
          const b = new Date(data.birthdate); const now = new Date();
          let a = now.getFullYear() - b.getFullYear();
          if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a--;
          // new_here mirrors the view's 14-day window
          const newHere = Date.now() - new Date(data.created_at).getTime()
            < 14 * 24 * 60 * 60 * 1000;
          setProf({ ...data, age: a, new_here: newHere } as Prof);
        }
        setPhotos(urls);
      } else {
        const [{ data }, urls] = await Promise.all([
          supabase.from("public_profiles").select("*").eq("id", otherId).maybeSingle(),
          listUserPhotos(otherId),
        ]);
        setProf(data as Prof | null);
        setPhotos(urls);
      }
      setLoading(false);
    })();
  }, [otherId, self]);

  // Sign intro media paths once the profile row is in.
  useEffect(() => {
    (async () => {
      if (prof?.video_path) setVideoUrl(await signMediaPath(prof.video_path));
      if (prof?.audio_path) setAudioUrl(await signMediaPath(prof.audio_path));
    })();
  }, [prof?.video_path, prof?.audio_path]);

  // Intelligence layer: conversation traits, reveal state, date readiness.
  useEffect(() => {
    if (self) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const [{ data: tr }, { data: sub }] = await Promise.all([
        supabase.rpc("get_traits", { uid: otherId }),
        user ? supabase.from("subscriptions").select("tier").eq("user_id", user.id)
          .gt("expires_at", new Date().toISOString()).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (tr && tr[0]?.traits) setTraits(tr[0].traits);
      setSubscribed(!!sub);
      if (matchId) {
        const { data: rv } = await supabase.rpc("get_reveal", { p_match: matchId });
        if (rv) { setRevealLevel(rv.level); setYouOptedIn(rv.you_opted_in); }
        const { data: rd } = await supabase.rpc("date_readiness", { other: otherId });
        setReadiness(rd);
      }
    })();
  }, [otherId, matchId, self]);

  const revealPhotos = async () => {
    if (!matchId) return;
    setRevealBusy(true);
    const { data, error } = await supabase.rpc("advance_reveal", { p_match: matchId });
    setRevealBusy(false);
    if (error || !data) { Alert.alert("Couldn't reveal", error?.message ?? "Try again."); return; }
    setRevealLevel(data.level); setYouOptedIn(data.you_opted_in);
    Alert.alert(data.level === "full" ? "Photos revealed 📸" : "Reveal sent",
      data.level === "full" ? "You can both see each other now."
        : "They'll see your photos once they reveal theirs too.");
  };

  const sendComment = async () => {
    const text = comment.trim();
    if (!text || commentOn === null) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("messages").insert({
      match_id: matchId, sender: user.id,
      body: `📷 On your photo ${commentOn + 1}: ${text}`,
    });
    setComment(""); setCommentOn(null);
    if (error?.message?.includes("MESSAGE_LIMIT_REACHED")) {
      Alert.alert("Message limit reached", "Upgrade to keep the conversation going.", [
        { text: "Later", style: "cancel" },
        { text: "See plans", onPress: () => nav.navigate("Paywall") },
      ]);
    } else if (!error) {
      Alert.alert("Sent 💬", "Your comment landed in the chat.");
    }
  };

  const call = () => {
    Alert.alert("Secure calling — coming soon",
      "Voice calls will run inside Dosti Connect so your phone number is never shared. " +
      "Until then, keep chatting here — never share your number with someone you haven't met.");
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={theme.rose} /></View>;
  if (!prof) return <View style={s.center}><Text style={{ color: theme.muted }}>Profile unavailable.</Text></View>;

  const interests = prof.interests ?? [];
  const showPhotos = self || revealLevel === "full";
  const topTraits = Object.entries(traits)
    .filter(([k]) => TRAIT_LABEL[k]).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const lockedPhotoCard = (
    <View style={[s.photoCard, s.lockedCard]}>
      <Ionicons name="lock-closed" size={30} color={theme.muted} />
      <Text style={s.lockedTitle}>Photos hidden</Text>
      <Text style={s.lockedSub}>
        {matchId
          ? youOptedIn ? "Waiting for them to reveal too…" : "Reveal yours to unlock theirs."
          : "Voice first — you'll see photos after you connect on a call."}
      </Text>
      {matchId && !youOptedIn && (
        <TouchableOpacity style={s.revealBtn} onPress={revealPhotos} disabled={revealBusy}>
          {revealBusy ? <ActivityIndicator color={theme.onGold} />
            : <Text style={s.revealBtnText}>Reveal my photos</Text>}
        </TouchableOpacity>
      )}
    </View>
  );

  const traitsCard = topTraits.length > 0 && (
    <View style={s.card}>
      <Text style={s.eyebrow}>Conversation style</Text>
      <View style={s.chipWrap}>
        {topTraits.map(([k]) => (
          <View key={k} style={s.traitChip}><Text style={s.traitChipText}>{TRAIT_LABEL[k]}</Text></View>
        ))}
      </View>
      <Text style={s.traitNote}>From what past call partners said — never from how they sound.</Text>
    </View>
  );

  const readinessCard = matchId && readiness && (
    subscribed ? (
      <View style={s.card}>
        <Text style={s.eyebrow}>Date readiness</Text>
        <Text style={s.bandTitle}>{BAND[readiness.band]?.[0]}</Text>
        <Text style={s.bandSub}>{BAND[readiness.band]?.[1]}</Text>
        <View style={s.factorRow}>
          <View style={s.factor}><Text style={s.factorNum}>{readiness.calls_together}</Text>
            <Text style={s.factorLbl}>calls</Text></View>
          <View style={s.factor}><Text style={s.factorNum}>{readiness.shared_interests}</Text>
            <Text style={s.factorLbl}>shared</Text></View>
          <View style={s.factor}><Text style={s.factorNum}>{readiness.avg_rating || "–"}</Text>
            <Text style={s.factorLbl}>avg ★</Text></View>
        </View>
      </View>
    ) : (
      <TouchableOpacity style={[s.card, s.lockedReadiness]} onPress={() => nav.navigate("Paywall")}>
        <Ionicons name="sparkles" size={18} color={theme.gold} />
        <View style={{ flex: 1 }}>
          <Text style={s.bandTitle}>Date readiness</Text>
          <Text style={s.bandSub}>See how compatible you two are becoming — with Premium.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.muted} />
      </TouchableOpacity>
    )
  );

  // Hinge-style facts strip: icon + value cells, horizontally scrollable.
  const facts = [
    prof.is_verified && "✅ Verified",
    `🎂 ${prof.age}`,
    prof.gender && `👤 ${cap(prof.gender)}`,
    prof.height_cm && `📏 ${fmtHeight(prof.height_cm)}`,
    prof.occupation && `💼 ${prof.occupation}`,
    prof.city && `📍 ${prof.city}`,
    prof.faith && `🛐 ${prof.faith}`,
    prof.diet && `🥗 ${prof.diet}`,
    prof.drinking && `🍷 ${prof.drinking}`,
    prof.smoking && `🚬 ${prof.smoking}`,
    prof.languages?.length ? `🗣 ${prof.languages.join(", ")}` : null,
  ].filter(Boolean) as string[];

  const photoCard = (i: number) => (
    <View key={`ph${i}`} style={s.photoCard}>
      <Image source={{ uri: photos[i] }} style={s.photo} resizeMode="cover" />
      {!self && !!matchId && (
        <TouchableOpacity style={s.commentBtn} onPress={() => setCommentOn(i)}>
          <Ionicons name="chatbubble-ellipses" size={20} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 44 + insets.bottom }}>
      {/* header: badge + status (name lives in the nav header) */}
      <View style={s.headerBlock}>
        {prof.new_here && (
          <View style={s.newHere}>
            <Text style={s.newHereText}>New here</Text>
          </View>
        )}
        {!self && prof.activity_status ? (
          <View style={s.metaRow}>
            <View style={s.greenDot} />
            <Text style={s.metaText}>  {prof.activity_status}</Text>
          </View>
        ) : null}
      </View>

      {/* facts strip card */}
      <View style={s.card}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={s.factsRow}>
            {facts.map((f, i) => (
              <View key={f} style={[s.factCell, i === 0 && { paddingLeft: 0 }]}>
                <Text style={s.factText}>{f}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
        {prof.relationship_goal ? (
          <View style={s.goalRow}>
            <Ionicons name="search" size={16} color={theme.muted} />
            <Text style={s.factText}>  {prof.relationship_goal}</Text>
          </View>
        ) : null}
      </View>

      {/* intro video — muted autoplay loop with a sound toggle */}
      {videoUrl && (
        <View style={s.photoCard}>
          <VideoView player={videoPlayer} style={s.photo} contentFit="cover"
            nativeControls={false} />
          <TouchableOpacity style={s.muteBtn} onPress={toggleMute}>
            <Ionicons name={muted ? "volume-mute" : "volume-high"} size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* photos gated by the reveal ladder; traits + readiness surface first */}
      {readinessCard}
      {traitsCard}

      {showPhotos ? (photos.length ? photoCard(0) : (
        <LinearGradient colors={[...theme.grad]} style={[s.photoCard, s.photoEmpty]}>
          <Text style={s.initial}>{prof.display_name[0]}</Text>
        </LinearGradient>
      )) : lockedPhotoCard}

      {prof.bio ? (
        <View style={s.card}>
          <Text style={s.eyebrow}>About me</Text>
          <Text style={s.bioSerif}>{prof.bio}</Text>
        </View>
      ) : null}

      {audioUrl && (
        <View style={s.card}>
          <Text style={s.eyebrow}>Voice intro</Text>
          <TouchableOpacity style={s.voicePill} onPress={toggleVoice}>
            <Ionicons name={voicePlaying ? "pause-circle" : "play-circle"} size={30} color={theme.rose} />
            <Text style={s.voiceText}>{voicePlaying ? "Playing…" : "Tap to listen"}</Text>
            <Ionicons name="pulse" size={18} color={theme.muted} />
          </TouchableOpacity>
        </View>
      )}

      {showPhotos && photos.length > 1 && photoCard(1)}

      {interests.length ? (
        <View style={s.card}>
          <Text style={s.eyebrow}>My interests</Text>
          <View style={s.chipWrap}>
            {interests.map((c) => (
              <View key={c} style={s.chip}><Text style={s.chipText}>{withEmoji(c)}</Text></View>
            ))}
          </View>
        </View>
      ) : null}

      {showPhotos && photos.slice(2).map((_, k) => photoCard(k + 2))}

      <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
        {self ? (
          <Text style={s.previewNote}>
            👁 This is how your profile appears to people you match with.
          </Text>
        ) : !matchId ? null : (
        <View style={s.actions}>
          <TouchableOpacity style={s.actGhost} onPress={() => nav.goBack()}>
            <Ionicons name="chatbubbles" size={18} color={theme.gold} />
            <Text style={s.actGhostText}>Chat</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actGold} onPress={call}>
            <Ionicons name="call" size={18} color={theme.onGold} />
            <Text style={s.actGoldText}>Call (soon)</Text>
          </TouchableOpacity>
        </View>
        )}
      </View>

      {/* comment composer */}
      <Modal visible={commentOn !== null} transparent animationType="fade"
        onRequestClose={() => setCommentOn(null)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Comment on photo {commentOn !== null ? commentOn + 1 : ""}</Text>
            <TextInput style={s.modalInput} value={comment} onChangeText={setComment}
              placeholder="Nice shot! Where was this?" placeholderTextColor={theme.muted}
              autoFocus maxLength={280} multiline />
            <View style={s.modalRow}>
              <TouchableOpacity style={s.modalGhost} onPress={() => { setCommentOn(null); setComment(""); }}>
                <Text style={{ color: theme.muted, fontWeight: "700" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={sendComment} disabled={!comment.trim()}
                style={{ opacity: comment.trim() ? 1 : 0.4, flex: 1 }}>
                <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.modalSend}>
                  <Text style={{ color: "#fff", fontWeight: "800" }}>Send to chat</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  headerBlock: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  card: { backgroundColor: theme.card, borderRadius: theme.radii.lg, borderWidth: 1, borderColor: theme.line,
    marginHorizontal: 14, marginTop: 14, padding: 18, ...theme.shadow.card },
  factsRow: { flexDirection: "row", alignItems: "center" },
  factCell: { paddingHorizontal: 14, borderRightWidth: 1, borderRightColor: theme.line,
    justifyContent: "center" },
  factText: { color: theme.ink, fontSize: 14, fontFamily: theme.font.semibold },
  goalRow: { flexDirection: "row", alignItems: "center", borderTopWidth: 1,
    borderTopColor: theme.line, marginTop: 14, paddingTop: 14 },
  eyebrow: { color: theme.muted, fontSize: 11, fontFamily: theme.font.bold, marginBottom: 10,
    textTransform: "uppercase", letterSpacing: 2 },
  bioSerif: { color: theme.ink, fontFamily: SERIF, fontSize: 24, lineHeight: 33 },
  photoCard: { marginHorizontal: 14, marginTop: 14, borderRadius: theme.radii.lg, overflow: "hidden",
    aspectRatio: 4 / 5, backgroundColor: theme.card, ...theme.shadow.card },
  photoEmpty: { alignItems: "center", justifyContent: "center" },
  photo: { ...StyleSheet.absoluteFillObject },
  initial: { color: "rgba(255,255,255,.25)", fontSize: 110, fontFamily: theme.font.black },
  muteBtn: { position: "absolute", right: 14, bottom: 14, width: 42, height: 42,
    borderRadius: 21, backgroundColor: "rgba(10,18,16,.6)", alignItems: "center",
    justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,.25)" },
  voicePill: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start",
    backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line, borderRadius: 999,
    paddingVertical: 8, paddingHorizontal: 14 },
  voiceText: { color: theme.ink, fontSize: 14, fontFamily: theme.font.bold },
  commentBtn: { position: "absolute", right: 14, bottom: 14, width: 42, height: 42,
    borderRadius: 21, backgroundColor: "rgba(10,18,16,.6)", alignItems: "center",
    justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,.25)" },
  newHere: { alignSelf: "flex-start", backgroundColor: theme.ink, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 6 },
  newHereText: { color: theme.bg, fontSize: 12, fontFamily: theme.font.bold },
  metaRow: { flexDirection: "row", alignItems: "center" },
  greenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#1E8E6E" },
  metaText: { color: theme.muted, fontSize: 13, fontFamily: theme.font.semibold },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "rgba(236,72,153,.5)", backgroundColor: theme.goldSoft,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: theme.gold, fontSize: 12, fontFamily: theme.font.semibold },
  lockedCard: { alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  lockedTitle: { color: theme.ink, fontSize: 18, fontFamily: theme.font.displayMd },
  lockedSub: { color: theme.muted, fontSize: 13, textAlign: "center", lineHeight: 19,
    paddingHorizontal: 20 },
  revealBtn: { backgroundColor: theme.gold, borderRadius: 999, paddingHorizontal: 22,
    paddingVertical: 13, marginTop: 8, minWidth: 160, alignItems: "center", ...theme.shadow.cta },
  revealBtnText: { color: theme.onGold, fontFamily: theme.font.black, fontSize: 14 },
  traitChip: { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card2,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  traitChipText: { color: theme.ink, fontSize: 12.5, fontFamily: theme.font.semibold },
  traitNote: { color: theme.muted, fontSize: 11, marginTop: 10, lineHeight: 15 },
  bandTitle: { color: theme.ink, fontSize: 18, fontFamily: theme.font.displayMd },
  bandSub: { color: theme.muted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  factorRow: { flexDirection: "row", gap: 24, marginTop: 14 },
  factor: { alignItems: "center" },
  factorNum: { color: theme.gold, fontSize: 20, fontFamily: theme.font.black },
  factorLbl: { color: theme.muted, fontSize: 11, marginTop: 2 },
  lockedReadiness: { flexDirection: "row", alignItems: "center", gap: 12 },
  previewNote: { color: theme.muted, fontSize: 13, textAlign: "center", marginTop: 24,
    lineHeight: 19 },
  actions: { flexDirection: "row", gap: 10, marginTop: 24 },
  actGhost: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderWidth: 1, borderColor: theme.gold, borderRadius: 999, paddingVertical: 15 },
  actGhostText: { color: theme.gold, fontFamily: theme.font.bold, fontSize: 14 },
  actGold: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: theme.gold, borderRadius: 999, paddingVertical: 15, ...theme.shadow.cta },
  actGoldText: { color: theme.onGold, fontFamily: theme.font.bold, fontSize: 14 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,.6)", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: theme.card, borderRadius: theme.radii.xl, padding: 20,
    borderWidth: 1, borderColor: theme.line, ...theme.shadow.floating },
  modalTitle: { color: theme.ink, fontSize: 17, fontFamily: theme.font.displayMd, marginBottom: 12 },
  modalInput: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, padding: 12, color: theme.ink, minHeight: 70, textAlignVertical: "top" },
  modalRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  modalGhost: { paddingHorizontal: 14, paddingVertical: 12 },
  modalSend: { borderRadius: 999, padding: 14, alignItems: "center", ...theme.shadow.cta },
});
