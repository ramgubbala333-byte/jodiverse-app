import React, { useEffect, useState, useRef } from "react";
import {
  View, Text, ScrollView, Image, StyleSheet, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator, Platform, Animated, Easing,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { useAudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { supabase } from "../lib/supabase";
import { listUserPhotos } from "../lib/photos";
import { signMediaPath } from "../lib/media";
import WhyMatchedCard from "../components/WhyMatchedCard";
import { theme } from "../theme";

type Params = { otherId: string; name: string; matchId?: string; self?: boolean };
type Prof = {
  display_name: string; age: number; city: string | null; bio: string | null;
  faith: string | null; languages: string[] | null; diet: string | null;
  relationship_goal: string | null; is_verified: boolean;
  interests: string[] | null; new_here: boolean;
  drinking: string | null; smoking: string | null; height_cm: number | null;
  occupation: string | null; education?: string | null; distance_band?: string | null;
  video_path: string | null; audio_path: string | null;
  love_language?: string | null; workout?: string | null; traits?: string[] | null;
  prompts?: { q: string; a: string }[] | null;
};

const fmtHeight = (cm: number) =>
  `${Math.floor(cm / 30.48)}'${Math.round((cm % 30.48) / 2.54)}" (${cm}cm)`;

const SERIF = Platform.OS === "ios" ? "Georgia" : "serif";

// 16 animated waveform bars for realistic dynamic audio visualization
const WAVE_BARS = [12, 20, 16, 26, 14, 28, 22, 18, 26, 15, 24, 18, 28, 16, 22, 14];

export default function MatchProfileScreen() {
  const { otherId, name, matchId, self } = useRoute().params as Params;
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [prof, setProf] = useState<Prof | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentOn, setCommentOn] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [voicePlaying, setVoicePlaying] = useState(false);

  // Animation values
  const likeScale = useRef(new Animated.Value(1)).current;
  const passScale = useRef(new Animated.Value(1)).current;
  const soundRot = useRef(new Animated.Value(0)).current;
  const waveformAnim = useRef(WAVE_BARS.map(() => new Animated.Value(1))).current;
  const screenFade = useRef(new Animated.Value(0)).current;

  const videoPlayer = useVideoPlayer(null, (p) => { p.loop = true; p.muted = true; });
  const voicePlayer = useAudioPlayer();

  // Screen entrance fade
  useEffect(() => {
    Animated.timing(screenFade, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [screenFade]);

  // Dancing waveform bars animation when playing audio
  useEffect(() => {
    if (voicePlaying) {
      const anims = waveformAnim.map((val, i) => {
        return Animated.loop(
          Animated.sequence([
            Animated.timing(val, {
              toValue: 0.3 + Math.random() * 0.9,
              duration: 180 + (i % 5) * 60,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(val, {
              toValue: 0.8 + Math.random() * 0.6,
              duration: 180 + (i % 5) * 60,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ])
        );
      });
      anims.forEach((a) => a.start());
      return () => anims.forEach((a) => a.stop());
    } else {
      waveformAnim.forEach((val) => {
        Animated.spring(val, { toValue: 1, friction: 6, useNativeDriver: true }).start();
      });
    }
  }, [voicePlaying, waveformAnim]);

  // Configure custom luxury header
  useEffect(() => {
    nav.setOptions({
      headerShown: true,
      headerTitle: () => (
        <Text style={s.navTitle}>{name ? `${name}'s Profile` : "Profile"}</Text>
      ),
      headerStyle: { backgroundColor: "#0B0D14" },
      headerTintColor: "#FF7A2E",
      headerShadowVisible: false,
      headerRight: () => (
        <TouchableOpacity
          onPress={() => {
            Haptics.selectionAsync();
            Alert.alert(name || "Profile", "Options", [
              { text: "Share Profile", onPress: () => {} },
              { text: "Report or Block", style: "destructive", onPress: () => {} },
              { text: "Cancel", style: "cancel" },
            ]);
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="ellipsis-vertical" size={20} color="#FF7A2E" />
        </TouchableOpacity>
      ),
    });
  }, [nav, name]);

  useEffect(() => {
    if (!videoUrl) return;
    videoPlayer.replaceAsync(videoUrl).then(() => videoPlayer.play()).catch(() => {});
  }, [videoUrl]);

  const toggleMute = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.sequence([
      Animated.timing(soundRot, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(soundRot, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]).start();
    videoPlayer.muted = !muted;
    setMuted(!muted);
  };

  const toggleVoice = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!audioUrl) return; // no recording — the card isn't rendered anyway
    if (voicePlaying) {
      voicePlayer.pause();
      setVoicePlaying(false);
      return;
    }
    voicePlayer.replace({ uri: audioUrl });
    voicePlayer.play();
    setVoicePlaying(true);
  };

  const onPressLike = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.sequence([
      Animated.spring(likeScale, { toValue: 0.8, friction: 4, useNativeDriver: true }),
      Animated.spring(likeScale, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }),
    ]).start(() => {
      if (matchId) {
        nav.navigate("Tabs", { screen: "Chat" });
      } else {
        Alert.alert("Liked ❤️", `You liked ${prof?.display_name || "this profile"}!`);
      }
    });
  };

  const onPressPass = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Animated.sequence([
      Animated.spring(passScale, { toValue: 0.8, friction: 4, useNativeDriver: true }),
      Animated.spring(passScale, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }),
    ]).start(() => {
      nav.goBack();
    });
  };

  useEffect(() => {
    (async () => {
      if (self) {
        const [{ data }, urls] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", otherId).maybeSingle(),
          listUserPhotos(otherId),
        ]);
        if (data) {
          const b = new Date(data.birthdate); const now = new Date();
          let a = now.getFullYear() - b.getFullYear();
          if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a--;
          const newHere = Date.now() - new Date(data.created_at).getTime() < 14 * 24 * 60 * 60 * 1000;
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
      body: `📷 On your photo: ${text}`,
    });
    setComment(""); setCommentOn(null);
    if (!error) Alert.alert("Sent 💬", "Your comment was sent to chat.");
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={theme.gold} /></View>;
  if (!prof) return <View style={s.center}><Text style={{ color: theme.muted }}>Profile unavailable.</Text></View>;

  // Never invent profile content. Everything below renders only what this
  // person actually entered — an empty section is honest, a plausible-looking
  // default is not. Someone decides whether to meet a stranger based on this
  // screen, so a fabricated faith, job, or face is a real harm, not a polish
  // problem. (These defaults arrived with the Stitch design port.)
  const activePrompts = prof.prompts?.length ? prof.prompts : [];
  const mainPhoto = photos[0] ?? null;
  const gallery = photos.slice(1, 3);

  const basics = [
    prof.height_cm ? { icon: "resize-outline", text: fmtHeight(prof.height_cm) } : null,
    prof.faith ? { icon: "planet-outline", text: prof.faith } : null,
    prof.occupation ? { icon: "briefcase-outline", text: prof.occupation } : null,
    prof.education ? { icon: "school-outline", text: prof.education } : null,
  ].filter(Boolean) as { icon: string; text: string }[];

  const lifestyle = [
    prof.diet ? { icon: "restaurant-outline", text: prof.diet } : null,
    prof.drinking ? { icon: "wine-outline", text: prof.drinking } : null,
    prof.smoking ? { icon: "ban-outline", text: prof.smoking } : null,
    prof.workout ? { icon: "fitness-outline", text: prof.workout } : null,
  ].filter(Boolean) as { icon: string; text: string }[];

  return (
    <Animated.View style={[s.wrap, { opacity: screenFade }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 44 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. Hero Main Card (Stitch Exact Layout) ── */}
        <View style={s.heroCardContainer}>
          {mainPhoto ? (
            <Image source={{ uri: mainPhoto }} style={s.heroImage} resizeMode="cover" />
          ) : (
            <View style={[s.heroImage, s.heroNoPhoto]}>
              <Text style={s.heroNoPhotoText}>
                {prof.display_name?.[0]?.toUpperCase() ?? "?"}
              </Text>
            </View>
          )}

          {/* Top-Right Sound/Mute Toggle */}
          <TouchableOpacity activeOpacity={0.8} style={s.soundToggle} onPress={toggleMute}>
            <Animated.View
              style={{
                transform: [
                  {
                    rotate: soundRot.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0deg", "45deg"],
                    }),
                  },
                ],
              }}
            >
              <Ionicons name={muted ? "volume-mute" : "volume-high"} size={18} color="#FFF" />
            </Animated.View>
          </TouchableOpacity>

          {/* Bottom Scrim & Content */}
          <LinearGradient
            colors={["transparent", "rgba(11, 13, 20, 0.4)", "rgba(11, 13, 20, 0.95)"]}
            style={s.heroGradientScrim}
          >
            <View style={s.heroInfoRow}>
              <View style={s.heroTextCol}>
                <Text style={s.heroName}>
                  {prof.display_name}{prof.age ? `, ${prof.age}` : ""}
                </Text>
                {(prof.city || prof.distance_band) && (
                  <View style={s.heroLocRow}>
                    <Ionicons name="location-outline" size={14} color="#8B90A3" />
                    <Text style={s.heroLocText}>
                      {[prof.city, prof.distance_band].filter(Boolean).join(" • ")}
                    </Text>
                  </View>
                )}
              </View>

              {/* Overlaid Action Buttons with Spring Animation (Pass & Like) */}
              {!self && (
                <View style={s.heroActionGroup}>
                  <TouchableOpacity activeOpacity={0.8} onPress={onPressPass}>
                    <Animated.View style={[s.heroPassBtn, { transform: [{ scale: passScale }] }]}>
                      <Ionicons name="close" size={22} color="#FFF" />
                    </Animated.View>
                  </TouchableOpacity>

                  <TouchableOpacity activeOpacity={0.8} onPress={onPressLike}>
                    <Animated.View style={[s.heroLikeBtn, { transform: [{ scale: likeScale }] }]}>
                      <Ionicons name="heart" size={24} color="#0B0D14" />
                    </Animated.View>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </LinearGradient>
        </View>

        {/* ── 2. Why You Matched Section (Stitch Gauge Card with Animations) ── */}
        <WhyMatchedCard otherId={otherId} />

        {/* ── 3. Hinge-Style Prompt Cards ── */}
        {activePrompts.map((p, idx) => (
          <View key={idx} style={s.promptCard}>
            <Text style={s.promptHeader}>{p.q}</Text>
            <Text style={s.promptBody}>{p.a}</Text>
          </View>
        ))}

        {/* ── 4. Voice Note player — only when they actually recorded one.
               Previously this rendered for everyone and fake-played on tap,
               advertising a voice note that didn't exist. ── */}
        {audioUrl && (
          <TouchableOpacity activeOpacity={0.85} style={s.voiceNoteCard} onPress={toggleVoice}>
            <View style={s.voicePlayCircle}>
              <Ionicons name={voicePlaying ? "pause" : "play"} size={18} color="#0B0D14" />
            </View>
            <View style={s.voiceInfoCol}>
              <Text style={s.voiceLabel}>{voicePlaying ? "PLAYING AUDIO..." : "VOICE NOTE"}</Text>
              <View style={s.waveformRow}>
                {WAVE_BARS.map((height, i) => (
                  <Animated.View
                    key={i}
                    style={[
                      s.waveformBar,
                      {
                        height,
                        backgroundColor: voicePlaying ? theme.gold : "#8B90A3",
                        transform: [{ scaleY: waveformAnim[i] }],
                      },
                    ]}
                  />
                ))}
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* ── 5. Basics Section ── */}
        {basics.length > 0 && (
          <View style={s.sectionCard}>
            <Text style={s.sectionHeading}>Basics</Text>
            <View style={s.basicsGrid}>
              {basics.map((b) => (
                <View key={b.text} style={s.basicItem}>
                  <Ionicons name={b.icon as any} size={16} color="#8B90A3" />
                  <Text style={s.basicText}>{b.text}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── 6. Lifestyle Section ── */}
        {lifestyle.length > 0 && (
          <View style={s.sectionCard}>
            <Text style={s.sectionHeading}>Lifestyle</Text>
            <View style={s.lifestylePillRow}>
              {lifestyle.map((l) => (
                <View key={l.text} style={s.lifestylePill}>
                  <Ionicons name={l.icon as any} size={14} color="#8B90A3" />
                  <Text style={s.lifestylePillText}>{l.text}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── 7. Love Language Section ── */}
        {!!prof.love_language && (
          <View style={s.sectionCard}>
            <Text style={s.sectionHeading}>Love Language</Text>
            <View style={s.loveLangRow}>
              <View style={s.loveLangIconCircle}>
                <Ionicons name="heart-half-outline" size={20} color="#FF7A2E" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.loveLangTitle}>{prof.love_language}</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── 8. 2-Column Photo Gallery ── */}
        {gallery.length > 0 && (
          <View style={s.galleryContainer}>
            {gallery.map((uri) => (
              <View key={uri} style={s.galleryCol}>
                <Image source={{ uri }} style={s.galleryImg} resizeMode="cover" />
              </View>
            ))}
          </View>
        )}

        {/* Comment Modal */}
        <Modal visible={commentOn !== null} transparent animationType="fade" onRequestClose={() => setCommentOn(null)}>
          <View style={s.modalBg}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>Send a comment</Text>
              <TextInput
                style={s.modalInput}
                value={comment}
                onChangeText={setComment}
                placeholder="What made you smile?"
                placeholderTextColor="#8B90A3"
                autoFocus
                maxLength={280}
                multiline
              />
              <View style={s.modalRow}>
                <TouchableOpacity style={s.modalGhost} onPress={() => { setCommentOn(null); setComment(""); }}>
                  <Text style={{ color: "#8B90A3", fontWeight: "700" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={sendComment} disabled={!comment.trim()} style={{ flex: 1 }}>
                  <LinearGradient colors={[...theme.grad]} style={s.modalSend}>
                    <Text style={{ color: "#FFF", fontWeight: "800" }}>Send</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#0B0D14",
  },
  center: {
    flex: 1,
    backgroundColor: "#0B0D14",
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: {
    fontFamily: SERIF,
    fontSize: 18,
    fontWeight: "700",
    color: "#E9E7E2",
  },

  // 1. Hero Card
  heroCardContainer: {
    marginHorizontal: 14,
    marginTop: 8,
    borderRadius: 24,
    overflow: "hidden",
    height: 480,
    backgroundColor: "#13161F",
    position: "relative",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  heroNoPhoto: { alignItems: "center", justifyContent: "center",
    backgroundColor: theme.card2 },
  heroNoPhotoText: { color: theme.muted, fontFamily: theme.font.black, fontSize: 64 },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  soundToggle: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(11, 13, 20, 0.65)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  heroGradientScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 60,
    justifyContent: "flex-end",
  },
  heroInfoRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  heroTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  heroName: {
    fontFamily: SERIF,
    fontSize: 28,
    fontWeight: "700",
    color: "#E9E7E2",
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  heroLocRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  heroLocText: {
    color: "#8B90A3",
    fontSize: 13,
    fontFamily: theme.font.regular,
  },
  heroActionGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  heroPassBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(26, 30, 42, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroLikeBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FF7A2E",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#FF7A2E",
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },

  // 3. Prompt Cards
  promptCard: {
    backgroundColor: "#13161F",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#202534",
    padding: 20,
    marginHorizontal: 14,
    marginTop: 14,
  },
  promptHeader: {
    color: "#FF9F1C",
    fontSize: 14,
    fontWeight: "700",
    fontFamily: theme.font.bold,
    marginBottom: 10,
  },
  promptBody: {
    color: "#E9E7E2",
    fontFamily: SERIF,
    fontStyle: "italic",
    fontSize: 15.5,
    lineHeight: 23,
  },

  // 4. Voice Note Card with Waveform
  voiceNoteCard: {
    backgroundColor: "#13161F",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#202534",
    padding: 16,
    marginHorizontal: 14,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  voicePlayCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FF7A2E",
    alignItems: "center",
    justifyContent: "center",
  },
  voiceInfoCol: {
    flex: 1,
  },
  voiceLabel: {
    color: "#FF7A2E",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 6,
  },
  waveformRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 30,
  },
  waveformBar: {
    width: 3,
    borderRadius: 2,
  },
  voiceDuration: {
    color: "#8B90A3",
    fontSize: 12,
    fontWeight: "600",
  },

  // 5, 6, 7. Section Cards
  sectionCard: {
    backgroundColor: "#13161F",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#202534",
    padding: 20,
    marginHorizontal: 14,
    marginTop: 14,
  },
  sectionHeading: {
    color: "#E9E7E2",
    fontFamily: SERIF,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 14,
  },
  basicsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 14,
  },
  basicItem: {
    width: "50%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  basicText: {
    color: "#E9E7E2",
    fontSize: 13.5,
    fontFamily: theme.font.medium,
  },
  lifestylePillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  lifestylePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1B202D",
    borderWidth: 1,
    borderColor: "#293044",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  lifestylePillText: {
    color: "#E9E7E2",
    fontSize: 12.5,
    fontWeight: "600",
  },
  loveLangRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  loveLangIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255, 122, 46, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  loveLangTitle: {
    color: "#E9E7E2",
    fontSize: 14.5,
    fontWeight: "700",
    marginBottom: 2,
  },
  loveLangDesc: {
    color: "#8B90A3",
    fontSize: 12,
  },

  // 8. 2-Column Photo Gallery
  galleryContainer: {
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 14,
    marginTop: 14,
  },
  galleryCol: {
    flex: 1,
    height: 190,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#13161F",
  },
  galleryImg: {
    width: "100%",
    height: "100%",
  },

  // Modal
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,.6)", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: "#13161F", borderRadius: 24, padding: 20, borderWidth: 1, borderColor: "#202534" },
  modalTitle: { color: "#E9E7E2", fontSize: 17, fontFamily: SERIF, fontWeight: "700", marginBottom: 12 },
  modalInput: { backgroundColor: "#1B202D", borderWidth: 1, borderColor: "#293044", borderRadius: 14, padding: 12, color: "#E9E7E2", minHeight: 70, textAlignVertical: "top" },
  modalRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  modalGhost: { paddingHorizontal: 14, paddingVertical: 12 },
  modalSend: { borderRadius: 999, padding: 14, alignItems: "center" },
});
