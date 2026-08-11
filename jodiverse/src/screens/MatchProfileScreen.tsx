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

// Full profile of a match: all photos (already seen in the deck before you
// matched — no reveal gating needed), details, and photo comments sent
// straight into the chat.
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

  if (loading) return <View style={s.center}><ActivityIndicator color={theme.rose} /></View>;
  if (!prof) return <View style={s.center}><Text style={{ color: theme.muted }}>Profile unavailable.</Text></View>;

  const interests = prof.interests ?? [];

  // Facts strip: icon + value cells, horizontally scrollable.
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

      {photos.length ? photoCard(0) : (
        <LinearGradient colors={[...theme.grad]} style={[s.photoCard, s.photoEmpty]}>
          <Text style={s.initial}>{prof.display_name[0]}</Text>
        </LinearGradient>
      )}

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

      {photos.length > 1 && photoCard(1)}

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

      {photos.slice(2).map((_, k) => photoCard(k + 2))}

      <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
        {self ? (
          <Text style={s.previewNote}>
            👁 This is how your profile appears to people you match with.
          </Text>
        ) : !matchId ? null : (
        <TouchableOpacity onPress={() => nav.goBack()}>
          <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actGold}>
            <Ionicons name="chatbubbles" size={18} color="#fff" />
            <Text style={s.actGoldText}>Message</Text>
          </LinearGradient>
        </TouchableOpacity>
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
  previewNote: { color: theme.muted, fontSize: 13, textAlign: "center", marginTop: 24,
    lineHeight: 19 },
  actGold: { flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 999, paddingVertical: 16, marginTop: 24, ...theme.shadow.cta },
  actGoldText: { color: "#fff", fontFamily: theme.font.bold, fontSize: 15 },
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
