import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StyleSheet, Alert, Image, Modal,
  ActivityIndicator, Animated, Easing, ScrollView, Pressable } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { pickPhoto, uploadChatImage, signChatPaths, deckPhotoUrls } from "../lib/photos";
import { haptic } from "../lib/haptics";
import { theme } from "../theme";

type Msg = { id: string; sender: string; body: string; image_path: string | null;
  read_at: string | null; created_at: string };

// Grouped so the tray can be browsed rather than scanned — twelve emoji in a
// single row was the whole vocabulary before.
const EMOJI_GROUPS: { label: string; items: string[] }[] = [
  { label: "Smileys", items: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤗","🤭","🫢","🤔","🤫","🤐","😐","😑","😶","🙄","😏","😴","🤤","😪","😵","🥴","🤠","🥳","🥸","😎","🤓","🧐"] },
  { label: "Hearts",  items: ["❤️","🧡","💛","💚","💙","💜","🤎","🖤","🤍","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","♥️","💌","😻","🫶","💑","💏","👩‍❤️‍👨","🌹","🥀"] },
  { label: "Gestures",items: ["👋","🤚","✋","🖐️","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉","👆","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","🫱","🫲","🤝","🙏","💪","🫂"] },
  { label: "Fun",     items: ["🔥","✨","🎉","🎊","🥂","🍻","☕","🍕","🍔","🍰","🎂","🍫","🍿","🎬","🎧","🎵","🎸","⚽","🏏","🏸","🎮","✈️","🏖️","🌙","⭐","🌈","☀️","🌸","🐶","🐱","🎁","💯"] },
];

// Shown only on an empty thread. Deliberately open questions — "Hi" threads
// die, and a blank box with a stranger on the other end is the hardest moment
// in the whole product.
const STARTERS = [
  "What's the best thing that happened to you this week?",
  "Coffee or chai — and how do you take it?",
  "What are you watching right now?",
  "Ideal Sunday: out all day or nowhere at all?",
  "What's something you're weirdly good at?",
  "Where was your last trip, and where's the next one?",
];

const GIPHY_KEY = process.env.EXPO_PUBLIC_GIPHY_KEY;

const sameDay = (a: string, b: string) =>
  new Date(a).toDateString() === new Date(b).toDateString();

function dayLabel(iso: string) {
  const d = new Date(iso), now = new Date();
  const days = Math.round((+new Date(now.toDateString()) - +new Date(d.toDateString())) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// Bubbles animate in on arrival. Mounted-once guard: without it every list
// re-render would replay the entrance and the thread would visibly twitch.
function Bubble({ children, mine, animate }: {
  children: React.ReactNode; mine: boolean; animate: boolean;
}) {
  const v = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    Animated.timing(v, { toValue: 1, duration: 220,
      easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [animate, v]);
  return (
    <Animated.View style={{
      opacity: v,
      transform: [
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
        { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      ],
      alignSelf: mine ? "flex-end" : "flex-start",
      maxWidth: "82%",
    }}>
      {children}
    </Animated.View>
  );
}

// Three dots, staggered. Native driver so it costs nothing on the JS thread.
function TypingDots() {
  const dots = [useRef(new Animated.Value(0)).current,
                useRef(new Animated.Value(0)).current,
                useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anims = dots.map((d, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 140),
        Animated.timing(d, { toValue: 1, duration: 340, useNativeDriver: true }),
        Animated.timing(d, { toValue: 0, duration: 340, useNativeDriver: true }),
        Animated.delay((2 - i) * 140),
      ])));
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={[s.bubble, s.theirs, s.typingBubble]}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={[s.typingDot, {
          opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
          transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
        }]} />
      ))}
    </View>
  );
}

export default function ChatScreen() {
  const { matchId, name, otherId } = (useRoute().params as
    { matchId: string; name: string; otherId?: string });
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const nav = useNavigation<any>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [imgUrls, setImgUrls] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [me, setMe] = useState<string>("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiTab, setEmojiTab] = useState(0);
  const [gifOpen, setGifOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifs, setGifs] = useState<{ id: string; preview: string; full: string }[]>([]);
  const [gifBusy, setGifBusy] = useState(false);
  const [sendingImg, setSendingImg] = useState(false);
  const [theyreTyping, setTheyreTyping] = useState(false);
  const [verified, setVerified] = useState(true); // assume true until loaded, avoids a banner flash
  const list = useRef<FlatList>(null);
  const chanRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingSentAt = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ids present on first load must NOT animate — only genuinely new arrivals.
  const seenIds = useRef<Set<string>>(new Set());

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
      rows.forEach((r) => seenIds.current.add(r.id));
      setMsgs(rows);
      signAndMerge(rows.map((m) => m.image_path).filter(Boolean) as string[]);
      markRead(rows, user.id);

      // Realtime: RLS applies to the subscription too — you only
      // receive rows the "read own conversations" policy allows.
      channel = supabase.channel(`match:${matchId}`, {
        config: { broadcast: { self: false } },
      })
        .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "messages",
            filter: `match_id=eq.${matchId}` },
          (payload) => {
            const m = payload.new as Msg;
            setMsgs((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
            if (m.image_path) signAndMerge([m.image_path]);
            if (m.sender !== user.id) { setTheyreTyping(false); markRead([m], user.id); }
          })
        // Read receipts ride in on UPDATE — without this, "Seen" would only
        // appear after leaving and re-entering the thread.
        .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "messages",
            filter: `match_id=eq.${matchId}` },
          (payload) => {
            const m = payload.new as Msg;
            setMsgs((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
          })
        // Typing is ephemeral by nature — broadcast, never a table write.
        .on("broadcast", { event: "typing" }, ({ payload }) => {
          if (payload?.from === user.id) return;
          setTheyreTyping(true);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTheyreTyping(false), 3500);
        })
        .subscribe();
      chanRef.current = channel;
    })();
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (channel) supabase.removeChannel(channel);
      chanRef.current = null;
    };
  }, [matchId]);

  // Mark their messages read. Fire-and-forget: a failure here is cosmetic.
  const markRead = (rows: Msg[], myId: string) => {
    const ids = rows.filter((m) => m.sender !== myId && !m.read_at).map((m) => m.id);
    if (!ids.length) return;
    supabase.from("messages")
      .update({ read_at: new Date().toISOString() }).in("id", ids).then(() => {});
  };

  const onType = (t: string) => {
    setText(t);
    // Throttled to one ping per 2s — a broadcast per keystroke would be a
    // packet storm on a slow connection for a purely decorative signal.
    const now = Date.now();
    if (t && now - typingSentAt.current > 2000 && chanRef.current) {
      typingSentAt.current = now;
      chanRef.current.send({ type: "broadcast", event: "typing", payload: { from: me } });
    }
  };

  const send = async (override?: string) => {
    const body = (override ?? text).trim();
    if (!body || limited) return;
    haptic.light();
    if (!override) setText("");
    setShowEmoji(false);
    // Matches chat without limits — monetization lives on likes/boosts instead.
    const { error } = await supabase.from("messages")
      .insert({ match_id: matchId, sender: me, body });
    if (error) {
      if (!override) setText(body); // give their words back
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
    if (!GIPHY_KEY) return; // the sheet explains it; no alert on every open
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
    } catch {
      setGifs([]);
    } finally {
      setGifBusy(false);
    }
  };

  const sendGif = async (fullUrl: string) => {
    setGifOpen(false);
    await supabase.from("messages")
      .insert({ match_id: matchId, sender: me, body: "GIF", image_path: fullUrl });
  };

  // Precompute per-message layout: day separators, grouping, and which bubble
  // carries the timestamp. Doing this in renderItem would recompute on every
  // scroll frame.
  const rows = useMemo(() => msgs.map((m, i) => {
    const prev = msgs[i - 1], next = msgs[i + 1];
    return {
      m,
      daySep: !prev || !sameDay(prev.created_at, m.created_at),
      firstOfGroup: !prev || prev.sender !== m.sender
        || !sameDay(prev.created_at, m.created_at),
      lastOfGroup: !next || next.sender !== m.sender
        || !sameDay(next.created_at, m.created_at),
    };
  }), [msgs]);

  const lastMine = [...msgs].reverse().find((m) => m.sender === me);

  return (
    <KeyboardAvoidingView style={s.wrap}
      behavior="padding" keyboardVerticalOffset={headerHeight}>
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(r) => r.m.id}
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        keyboardDismissMode="interactive"
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={s.emptyWrap}>
            {headerPhoto ? (
              <Image source={{ uri: headerPhoto }} style={s.emptyAvatar} />
            ) : (
              <View style={[s.emptyAvatar, s.emptyAvatarFallback]}>
                <Text style={s.emptyAvatarText}>{name?.[0]?.toUpperCase() ?? "?"}</Text>
              </View>
            )}
            <Text style={s.emptyTitle}>You matched with {name}</Text>
            <Text style={s.emptySub}>
              Openers that ask something get replies. Pick one, or write your own.
            </Text>
          </View>
        }
        ListFooterComponent={theyreTyping ? (
          <View style={{ alignSelf: "flex-start" }}><TypingDots /></View>
        ) : null}
        renderItem={({ item: { m, daySep, firstOfGroup, lastOfGroup } }) => {
          const mine = m.sender === me;
          const url = m.image_path ? imgUrls[m.image_path] : null;
          const isNew = !seenIds.current.has(m.id);
          if (isNew) seenIds.current.add(m.id);

          const body = url ? (
            <View style={[s.bubble, s.imgBubble, mine ? s.mine : s.theirs]}>
              <Image source={{ uri: url }} style={s.msgImg} resizeMode="cover" />
            </View>
          ) : mine ? (
            <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={[s.bubble, s.mine,
                !lastOfGroup && { borderBottomRightRadius: 20 },
                !firstOfGroup && { borderTopRightRadius: 8 }]}>
              <Text style={s.mineText}>{m.body}</Text>
            </LinearGradient>
          ) : (
            <View style={[s.bubble, s.theirs,
              !lastOfGroup && { borderBottomLeftRadius: 20 },
              !firstOfGroup && { borderTopLeftRadius: 8 }]}>
              <Text style={s.theirsText}>{m.body}</Text>
            </View>
          );

          return (
            <>
              {daySep && (
                <View style={s.daySepRow}>
                  <View style={s.daySepLine} />
                  <Text style={s.daySepText}>{dayLabel(m.created_at)}</Text>
                  <View style={s.daySepLine} />
                </View>
              )}
              <Bubble mine={mine} animate={isNew}>
                {body}
                {lastOfGroup && (
                  <View style={[s.metaRow, mine ? { justifyContent: "flex-end" } : null]}>
                    <Text style={s.metaText}>{clock(m.created_at)}</Text>
                    {mine && m.id === lastMine?.id && (
                      <Text style={[s.metaText, m.read_at && { color: theme.gold }]}>
                        {m.read_at ? " · Seen" : " · Sent"}
                      </Text>
                    )}
                  </View>
                )}
              </Bubble>
            </>
          );
        }}
      />

      {/* Conversation starters — only on a thread with nothing in it yet. */}
      {msgs.length === 0 && !limited && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.starterRow}>
          {STARTERS.map((q) => (
            <TouchableOpacity key={q} style={s.starterChip} activeOpacity={0.85}
              onPress={() => { haptic.select(); send(q); }}>
              <Text style={s.starterText}>{q}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {showEmoji && (
        <View style={s.emojiPanel}>
          <View style={s.emojiTabs}>
            {EMOJI_GROUPS.map((g, i) => (
              <Pressable key={g.label} onPress={() => setEmojiTab(i)}
                style={[s.emojiTab, emojiTab === i && s.emojiTabOn]}>
                <Text style={[s.emojiTabText, emojiTab === i && s.emojiTabTextOn]}>
                  {g.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <ScrollView contentContainerStyle={s.emojiGrid} keyboardShouldPersistTaps="handled">
            {EMOJI_GROUPS[emojiTab].items.map((e, i) => (
              <TouchableOpacity key={`${e}-${i}`} style={s.emojiCell}
                onPress={() => { haptic.select(); setText((t) => t + e); }}>
                <Text style={{ fontSize: 26 }}>{e}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
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
          <Ionicons name={showEmoji ? "happy" : "happy-outline"} size={22}
            color={showEmoji ? theme.gold : theme.muted} />
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
          <TextInput style={s.input} value={text} onChangeText={onType}
            placeholder={`Message ${name}`} placeholderTextColor={theme.muted}
            onSubmitEditing={() => send()} returnKeyType="send" multiline
            onFocus={() => setShowEmoji(false)} />
        )}
        <TouchableOpacity style={[s.send, (limited || !text.trim()) && { opacity: 0.4 }]}
          onPress={() => send()} disabled={limited || !text.trim()}>
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
                editable={!!GIPHY_KEY}
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
                    {GIPHY_KEY
                      ? "Search for the perfect GIF"
                      : "GIF search needs a free Giphy API key. Add it as EXPO_PUBLIC_GIPHY_KEY and restart."}
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
  bubble: { paddingVertical: 11, paddingHorizontal: 14, borderRadius: 20 },
  mine: { backgroundColor: theme.purple, borderBottomRightRadius: 6, ...theme.shadow.card },
  theirs: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderBottomLeftRadius: 6 },
  imgBubble: { padding: 4, backgroundColor: "transparent", borderWidth: 0 },
  msgImg: { width: 210, height: 210, borderRadius: 16, backgroundColor: theme.card },
  mineText: { color: "#fff", fontSize: 14.5, fontFamily: theme.font.medium, lineHeight: 20 },
  theirsText: { color: theme.ink, fontSize: 14.5, fontFamily: theme.font.medium, lineHeight: 20 },

  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 3, marginBottom: 9,
    paddingHorizontal: 4 },
  metaText: { color: theme.muted, fontSize: 10.5 },

  daySepRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 14 },
  daySepLine: { flex: 1, height: 1, backgroundColor: theme.line },
  daySepText: { color: theme.muted, fontSize: 11, fontFamily: theme.font.semibold },

  typingBubble: { flexDirection: "row", gap: 5, alignItems: "center",
    paddingVertical: 14, marginBottom: 8 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.muted },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 26,
    gap: 10 },
  emptyAvatar: { width: 84, height: 84, borderRadius: 42, borderWidth: 2, borderColor: theme.gold },
  emptyAvatarFallback: { backgroundColor: theme.card2, alignItems: "center", justifyContent: "center" },
  emptyAvatarText: { color: theme.ink, fontFamily: theme.font.black, fontSize: 32 },
  emptyTitle: { color: theme.ink, fontFamily: theme.font.bold, fontSize: 17, marginTop: 6 },
  emptySub: { color: theme.muted, fontSize: 13.5, textAlign: "center", lineHeight: 19 },

  starterRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  starterChip: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line,
    borderRadius: 999, paddingHorizontal: 15, paddingVertical: 10, maxWidth: 260 },
  starterText: { color: theme.ink, fontSize: 13, fontFamily: theme.font.medium },

  emojiPanel: { height: 250, backgroundColor: theme.card, borderTopWidth: 1,
    borderTopColor: theme.line },
  emojiTabs: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingTop: 10 },
  emojiTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  emojiTabOn: { backgroundColor: theme.card2 },
  emojiTabText: { color: theme.muted, fontSize: 12, fontFamily: theme.font.semibold },
  emojiTabTextOn: { color: theme.gold },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", padding: 8 },
  emojiCell: { width: `${100 / 8}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center" },

  safetyBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: theme.card2,
    marginHorizontal: 12, marginTop: 8, padding: 10, borderRadius: theme.radii.md,
    borderWidth: 1, borderColor: theme.line },
  safetyBannerText: { color: theme.muted, fontSize: 12, flex: 1, lineHeight: 16.5 },
  inputDisabled: { justifyContent: "center" },
  inputDisabledText: { color: theme.muted, fontSize: 13.5, fontStyle: "italic" },
  inputRow: { flexDirection: "row", padding: 12, gap: 6, borderTopWidth: 1,
    borderTopColor: theme.line, backgroundColor: theme.bg, alignItems: "flex-end" },
  toolBtn: { width: 34, height: 40, alignItems: "center", justifyContent: "center" },
  gifText: { color: theme.muted, fontFamily: theme.font.black, fontSize: 12, borderWidth: 1.5,
    borderColor: theme.muted, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1 },
  input: { flex: 1, backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: 22, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    color: theme.ink, maxHeight: 120 },
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
