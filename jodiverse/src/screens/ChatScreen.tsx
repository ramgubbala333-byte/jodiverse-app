import React, { useEffect, useRef, useState } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StyleSheet, Alert, Image, Modal,
  ActivityIndicator } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { pickPhoto, uploadChatImage, signChatPaths, deckPhotoUrls } from "../lib/photos";
import { haptic } from "../lib/haptics";
import { theme } from "../theme";

type Msg = { id: string; sender: string; body: string; image_path: string | null;
  created_at: string };

const EMOJI = ["😍", "😂", "🥰", "🔥", "😅", "🙈", "💜", "👋", "🤝", "😉", "🎉", "🙏"];
const GIPHY_KEY = process.env.EXPO_PUBLIC_GIPHY_KEY;

export default function ChatScreen() {
  const { matchId, name, otherId } = (useRoute().params as
    { matchId: string; name: string; otherId?: string });
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [imgUrls, setImgUrls] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [me, setMe] = useState<string>("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifs, setGifs] = useState<{ id: string; preview: string; full: string }[]>([]);
  const [gifBusy, setGifBusy] = useState(false);
  const [sendingImg, setSendingImg] = useState(false);
  const [verified, setVerified] = useState(true); // assume true until loaded, avoids a banner flash
  const list = useRef<FlatList>(null);

  // Anti-catfish: unverified accounts get ONE message until the other person
  // replies (server-enforced trigger — this just mirrors it in the UI).
  const myMsgCount = msgs.filter((m) => m.sender === me).length;
  const otherReplied = msgs.some((m) => m.sender !== me);
  const limited = !verified && myMsgCount >= 1 && !otherReplied;

  // Header: their photo top-right — tap it to open their profile.
  const [headerPhoto, setHeaderPhoto] = useState<string | null>(null);
  useEffect(() => {
    if (!otherId) return;
    deckPhotoUrls([otherId]).then((m) => setHeaderPhoto(m[otherId] ?? null)).catch(() => {});
  }, [otherId]);
  useEffect(() => {
    if (!otherId) return;
    nav.setOptions({
      title: name,
      headerRight: () => (
        <TouchableOpacity onPress={() =>
          nav.navigate("MatchProfile", { otherId, name, matchId })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          {headerPhoto ? (
            <Image source={{ uri: headerPhoto }}
              style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: theme.gold }} />
          ) : (
            <Ionicons name="person-circle" size={32} color={theme.gold} />
          )}
        </TouchableOpacity>
      ),
    });
  }, [nav, otherId, name, matchId, headerPhoto]);

  const signAndMerge = async (paths: string[]) => {
    if (!paths.length) return;
    const map = await signChatPaths(paths);
    setImgUrls((m) => ({ ...m, ...map }));
  };

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMe(user.id);
      supabase.from("profiles").select("is_verified").eq("id", user.id).maybeSingle()
        .then(({ data: p }) => setVerified(!!p?.is_verified));
      const { data } = await supabase.from("messages")
        .select("*").eq("match_id", matchId).order("created_at");
      const rows = (data as Msg[]) ?? [];
      setMsgs(rows);
      signAndMerge(rows.map((m) => m.image_path).filter(Boolean) as string[]);
      // Realtime: RLS applies to the subscription too — you only
      // receive rows the "read own conversations" policy allows.
      channel = supabase.channel(`match:${matchId}`)
        .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "messages",
            filter: `match_id=eq.${matchId}` },
          (payload) => {
            const m = payload.new as Msg;
            setMsgs((prev) => [...prev, m]);
            if (m.image_path) signAndMerge([m.image_path]);
          })
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [matchId]);

  const send = async () => {
    const body = text.trim();
    if (!body || limited) return;
    haptic.light();
    setText("");
    // Matches chat without limits — monetization lives on likes/boosts instead.
    const { error } = await supabase.from("messages")
      .insert({ match_id: matchId, sender: me, body });
    if (error) {
      setText(body); // give their words back
      // Surface the real reason instead of silently eating it — a swallowed
      // failure looks like "the app is locked and I can't do anything".
      Alert.alert("Message didn't send",
        error.message?.includes("UNVERIFIED_LIMIT")
          ? "You can send one message until they reply — this helps keep the community safe. Verify your profile to message freely."
          : error.message?.includes("row-level security")
          ? "You're not in this conversation anymore — the match may have been removed or blocked."
          : error.message ?? "Please try again.");
    }
  };

  const sendPhoto = async () => {
    const b64 = await pickPhoto({ crop: false });
    if (!b64) return;
    setSendingImg(true);
    try {
      const path = await uploadChatImage(matchId, b64);
      await supabase.from("messages")
        .insert({ match_id: matchId, sender: me, body: "📷 Photo", image_path: path });
    } catch (e: any) {
      Alert.alert("Couldn't send photo", e.message ?? String(e));
    } finally {
      setSendingImg(false);
    }
  };

  const searchGifs = async (q: string) => {
    if (!GIPHY_KEY) {
      Alert.alert("GIFs almost ready",
        "Add a free Giphy API key as EXPO_PUBLIC_GIPHY_KEY in .env (developers.giphy.com) to enable GIF search.");
      return;
    }
    setGifBusy(true);
    try {
      const url = q.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=24&rating=pg-13`;
      const res = await fetch(url);
      const json = await res.json();
      setGifs((json.data ?? []).map((g: any) => ({
        id: g.id,
        preview: g.images.fixed_width_small.url,
        full: g.images.fixed_width.url,
      })));
    } finally {
      setGifBusy(false);
    }
  };

  const sendGif = async (fullUrl: string) => {
    setGifOpen(false);
    await supabase.from("messages")
      .insert({ match_id: matchId, sender: me, body: "GIF", image_path: fullUrl });
  };

  return (
    <KeyboardAvoidingView style={s.wrap}
      behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={list}
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const mine = item.sender === me;
          const url = item.image_path ? imgUrls[item.image_path] : null;
          if (mine && !url) {
            // Outgoing text bubbles get the brand gradient fill.
            return (
              <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={[s.bubble, s.mine]}>
                <Text style={s.mineText}>{item.body}</Text>
              </LinearGradient>
            );
          }
          return (
            <View style={[s.bubble, mine ? s.mine : s.theirs, url ? s.imgBubble : null]}>
              {url ? (
                <Image source={{ uri: url }} style={s.msgImg} resizeMode="cover" />
              ) : (
                <Text style={mine ? s.mineText : s.theirsText}>{item.body}</Text>
              )}
            </View>
          );
        }}
      />

      {showEmoji && (
        <View style={s.emojiRow}>
          {EMOJI.map((e) => (
            <TouchableOpacity key={e} onPress={() => setText((t) => t + e)}>
              <Text style={{ fontSize: 24 }}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {limited && (
        <View style={s.safetyBanner}>
          <Ionicons name="shield-checkmark-outline" size={16} color={theme.muted} />
          <Text style={s.safetyBannerText}>
            You can send one message until they reply — this helps keep the community safe.
          </Text>
        </View>
      )}

      <View style={[s.inputRow, { paddingBottom: 12 + insets.bottom }]}>
        <TouchableOpacity style={s.toolBtn} onPress={() => setShowEmoji((v) => !v)} disabled={limited}>
          <Ionicons name="happy-outline" size={22} color={showEmoji ? theme.rose : theme.muted} />
        </TouchableOpacity>
        <TouchableOpacity style={s.toolBtn} onPress={sendPhoto} disabled={sendingImg || limited}>
          {sendingImg
            ? <ActivityIndicator size="small" color={theme.rose} />
            : <Ionicons name="image-outline" size={22} color={theme.muted} />}
        </TouchableOpacity>
        <TouchableOpacity style={s.toolBtn} disabled={limited}
          onPress={() => { setGifOpen(true); setGifs([]); setGifQuery(""); searchGifs(""); }}>
          <Text style={s.gifText}>GIF</Text>
        </TouchableOpacity>
        {limited ? (
          <View style={[s.input, s.inputDisabled]}>
            <Text style={s.inputDisabledText}>Message sent — waiting for a reply</Text>
          </View>
        ) : (
          <TextInput style={s.input} value={text} onChangeText={setText}
            placeholder="Message" placeholderTextColor={theme.muted}
            onSubmitEditing={send} returnKeyType="send" />
        )}
        <TouchableOpacity style={[s.send, limited && { opacity: 0.4 }]} onPress={send} disabled={limited}>
          <Ionicons name="arrow-up" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* GIF picker */}
      <Modal visible={gifOpen} animationType="slide" transparent
        onRequestClose={() => setGifOpen(false)}>
        <View style={s.gifBg}>
          <View style={s.gifSheet}>
            <View style={s.gifHeader}>
              <TextInput style={s.gifSearch} value={gifQuery}
                onChangeText={setGifQuery} placeholder="Search Giphy"
                placeholderTextColor={theme.muted} returnKeyType="search"
                onSubmitEditing={() => searchGifs(gifQuery)} />
              <TouchableOpacity onPress={() => setGifOpen(false)}>
                <Ionicons name="close" size={24} color={theme.muted} />
              </TouchableOpacity>
            </View>
            {gifBusy ? <ActivityIndicator color={theme.rose} style={{ marginTop: 30 }} /> : (
              <FlatList
                data={gifs}
                numColumns={3}
                keyExtractor={(g) => g.id}
                columnWrapperStyle={{ gap: 6 }}
                contentContainerStyle={{ gap: 6, paddingBottom: 20 }}
                ListEmptyComponent={
                  <Text style={s.gifEmpty}>
                    {GIPHY_KEY ? "Search for the perfect GIF" : "Add EXPO_PUBLIC_GIPHY_KEY to .env to enable GIFs"}
                  </Text>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity style={s.gifCell} onPress={() => sendGif(item.full)}>
                    <Image source={{ uri: item.preview }} style={{ flex: 1, borderRadius: 8 }} />
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  bubble: { maxWidth: "78%", paddingVertical: 11, paddingHorizontal: 14, borderRadius: 20,
    marginBottom: 8 },
  mine: { backgroundColor: theme.purple, alignSelf: "flex-end", borderBottomRightRadius: 6,
    ...theme.shadow.card },
  theirs: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    alignSelf: "flex-start", borderBottomLeftRadius: 6 },
  imgBubble: { padding: 4, backgroundColor: "transparent", borderWidth: 0 },
  msgImg: { width: 210, height: 210, borderRadius: 16, backgroundColor: theme.card },
  mineText: { color: "#fff", fontSize: 14.5, fontFamily: theme.font.medium, lineHeight: 20 },
  theirsText: { color: theme.ink, fontSize: 14.5, fontFamily: theme.font.medium, lineHeight: 20 },
  emojiRow: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.card },
  safetyBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: theme.card2,
    marginHorizontal: 12, marginTop: 8, padding: 10, borderRadius: theme.radii.md,
    borderWidth: 1, borderColor: theme.line },
  safetyBannerText: { color: theme.muted, fontSize: 12, flex: 1, lineHeight: 16.5 },
  inputDisabled: { justifyContent: "center" },
  inputDisabledText: { color: theme.muted, fontSize: 13.5, fontStyle: "italic" },
  inputRow: { flexDirection: "row", padding: 12, gap: 6, borderTopWidth: 1,
    borderTopColor: theme.line, backgroundColor: theme.bg, alignItems: "center" },
  toolBtn: { width: 34, height: 38, alignItems: "center", justifyContent: "center" },
  gifText: { color: theme.muted, fontFamily: theme.font.black, fontSize: 12, borderWidth: 1.5,
    borderColor: theme.muted, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1 },
  input: { flex: 1, backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, color: theme.ink },
  send: { backgroundColor: theme.gold, borderRadius: 999, width: 40, height: 40,
    alignItems: "center", justifyContent: "center", ...theme.shadow.cta },
  gifBg: { flex: 1, backgroundColor: "rgba(0,0,0,.5)", justifyContent: "flex-end" },
  gifSheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 16, height: "70%" },
  gifHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  gifSearch: { flex: 1, backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, color: theme.ink },
  gifCell: { flex: 1 / 3, aspectRatio: 1 },
  gifEmpty: { color: theme.muted, textAlign: "center", marginTop: 30, paddingHorizontal: 20 },
});
