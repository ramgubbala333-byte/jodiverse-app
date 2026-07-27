import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Image, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import { pickPhoto, uploadPhoto } from "../lib/photos";
import { INTEREST_GROUPS, MAX_INTERESTS } from "../lib/interests";
import { theme } from "../theme";

const GENDERS = ["Woman", "Man", "Non-binary"];
const SEEKING = ["Women", "Men", "Everyone"];
const GOALS = ["Life partner", "Long-term", "Long-term, open to short", "Still figuring it out"];
const FAITHS = ["Hindu", "Muslim", "Sikh", "Christian", "Jain", "Buddhist", "Spiritual", "Prefer not to say"];
const DIETS = ["Vegetarian", "Non-vegetarian", "Vegan", "Jain", "Halal"];
const LANGS = ["Hindi", "Telugu", "Tamil", "Punjabi", "Bengali", "Marathi", "Gujarati", "Kannada", "Malayalam", "Urdu", "English"];
const DRINKS = ["Never", "Rarely", "Socially", "Regularly"];
const SMOKES = ["Never", "Socially", "Regularly", "Trying to quit"];
const LIFESTYLES = ["Active & Outdoorsy", "Social & Outgoing", "Quiet & Homebody", "Creative & Artistic", "Career-Focused"];

// ON HOLD: Claude bio generation via the generate-profile edge function.
// Flip to true after running `supabase secrets set ANTHROPIC_API_KEY=...`.
// While false, "Generate My Profile" composes the bio locally from the
// user's answers — no network call, no API cost.
const AI_BIO_ENABLED = false;

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Smart Profile Builder — LoveAI-style 4-step flow. Step 1 (account: name,
// DOB, gender) lives in AuthScreen; email signups arrive with those in auth
// metadata, Google signups collect them in an extra "about" page here.
// Pages: [about?] → best-self (photos) → more-about-you → interests →
// lifestyle → AI generation.
export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);

  const [name, setName] = useState("");
  const [dd, setDD] = useState(""); const [mm, setMM] = useState(""); const [yyyy, setYYYY] = useState("");
  const [gender, setGender] = useState<string | null>(null);
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [needsAbout, setNeedsAbout] = useState(false);

  const [photos, setPhotos] = useState<string[]>([]); // base64, uploaded on finish
  const [city, setCity] = useState("");
  const [seeking, setSeeking] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);

  const [occupation, setOccupation] = useState("");
  const [education, setEducation] = useState("");
  const [values, setValues] = useState("");
  const [funFacts, setFunFacts] = useState("");

  const [interests, setInterests] = useState<string[]>([]);

  const [lifestyle, setLifestyle] = useState<string | null>(null);
  const [faith, setFaith] = useState<string | null>(null);
  const [diet, setDiet] = useState<string | null>(null);
  const [langs, setLangs] = useState<string[]>([]);
  const [drinking, setDrinking] = useState<string | null>(null);
  const [smoking, setSmoking] = useState<string | null>(null);
  const [heightCm, setHeightCm] = useState("");

  const [bio, setBio] = useState("");
  const [generated, setGenerated] = useState(false);

  const [page, setPage] = useState(0);

  // Load auth metadata once — decides whether the "about you" page is needed.
  React.useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const md = user?.user_metadata ?? {};
      if (md.full_name) setName(md.full_name);
      if (md.gender) setGender(md.gender[0].toUpperCase() + md.gender.slice(1));
      if (md.birthdate && /^\d{4}-\d{2}-\d{2}$/.test(md.birthdate)) {
        const [y, m, d] = md.birthdate.split("-");
        setYYYY(y); setMM(m); setDD(d);
      }
      setNeedsAbout(!(md.full_name && md.gender && md.birthdate));
      setMetaLoaded(true);
    })();
  }, []);

  const birthdate = `${yyyy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  const age = () => {
    const b = new Date(+yyyy, +mm - 1, +dd);
    if (isNaN(b.getTime())) return 0;
    const now = new Date();
    let a = now.getFullYear() - b.getFullYear();
    if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a--;
    return a;
  };

  // Page list: about (google-only) + 5 fixed pages.
  const pages = [...(needsAbout ? ["about"] : []), "best", "more", "interests", "lifestyle", "generate"];
  const current = pages[page];
  // Display step (of 4): account was step 1; photos=2, more/interests=3, lifestyle/generate=4.
  const stepInfo: Record<string, [number, string]> = {
    about: [1, "25%"], best: [2, "50%"], more: [3, "75%"],
    interests: [3, "75%"], lifestyle: [4, "100%"], generate: [4, "100%"],
  };
  const [stepNo, pct] = stepInfo[current] ?? [2, "50%"];

  const canNext = () => {
    switch (current) {
      case "about": return name.trim().length >= 1 && age() >= 18 && age() < 100 && !!gender;
      case "best": return photos.length >= 1 && !!seeking && !!goal;
      case "more": return true; // all optional, but feeds the AI
      case "interests": return interests.length >= 3;
      case "lifestyle": return !!lifestyle;
      case "generate": return generated || bio.trim().length > 0;
      default: return false;
    }
  };

  const toggleInterest = (label: string) => {
    setInterests((cur) => {
      if (cur.includes(label)) return cur.filter((x) => x !== label);
      if (cur.length >= MAX_INTERESTS) {
        Alert.alert("That's plenty!", `Pick up to ${MAX_INTERESTS} interests.`);
        return cur;
      }
      return [...cur, label];
    });
  };

  const addPhoto = async () => {
    const b64 = await pickPhoto();
    if (b64) setPhotos((p) => [...p, b64]);
  };

  // Local fallback so onboarding never blocks if the edge function is down.
  const templateBio = () => {
    const bits: string[] = [];
    if (occupation) bits.push(`${occupation}`);
    if (lifestyle) bits.push(lifestyle.toLowerCase());
    const lead = bits.length ? `${bits.join(", ")} — ` : "";
    const ints = interests.slice(0, 3).join(", ");
    const v = values ? ` ${values.split(/[.\n]/)[0].trim()}.` : "";
    return `${lead}happiest around ${ints || "good people and better conversations"}.${v} Looking for ${
      (goal ?? "something real").toLowerCase()}.`.slice(0, 500);
  };

  const generate = async () => {
    setGenBusy(true);
    if (!AI_BIO_ENABLED) {
      setBio(templateBio());
      setGenerated(true);
      setGenBusy(false);
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("generate-profile", {
        body: {
          name: name.trim(), occupation, education, values, fun_facts: funFacts,
          lifestyle, relationship_goal: goal, interests,
        },
      });
      if (error || !data?.bio) throw new Error(error?.message ?? "no bio");
      setBio(data.bio);
    } catch {
      setBio(templateBio()); // dev fallback — function not deployed / no key
    }
    setGenerated(true);
    setGenBusy(false);
  };

  const finish = async () => {
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("profiles").upsert({
        id: user.id,
        display_name: name.trim(),
        birthdate,
        gender: gender!.toLowerCase(),
        seeking: [seeking!.toLowerCase()],
        relationship_goal: goal,
        faith: faith === "Prefer not to say" ? null : faith,
        diet,
        languages: langs,
        drinking, smoking,
        height_cm: +heightCm >= 100 && +heightCm <= 250 ? +heightCm : null,
        occupation: occupation.trim() || null,
        education: education.trim() || null,
        values_text: values.trim() || null,
        fun_facts: funFacts.trim() || null,
        lifestyle,
        interests,
        city: city.trim() || null,
        bio: bio.trim() || null,
      });
      if (error) throw error;
      for (let i = 0; i < photos.length; i++) await uploadPhoto(user.id, photos[i], i);
      onDone();
    } catch (e: any) {
      Alert.alert("Couldn't finish setup", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => (page === pages.length - 1 ? finish() : setPage(page + 1));

  if (!metaLoaded) {
    return (
      <View style={[s.wrap, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={theme.gold} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* header + progress */}
      <View style={s.header}>
        {page > 0 ? (
          <TouchableOpacity onPress={() => setPage(page - 1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={22} color={theme.gold} />
          </TouchableOpacity>
        ) : <View style={{ width: 22 }} />}
        <View style={s.brandRow}>
          <Ionicons name="sparkles" size={15} color={theme.gold} />
          <Text style={s.headerTitle}>Smart Profile Builder</Text>
        </View>
        <View style={{ width: 22 }} />
      </View>
      <View style={s.stepHead}>
        <View style={s.stepRow}>
          <Text style={s.stepLabel}>Step {stepNo} of 4</Text>
          <Text style={s.stepPct}>{pct}</Text>
        </View>
        <View style={s.stepTrack}><View style={[s.stepFill, { width: pct as any }]} /></View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {current === "about" && (
          <>
            <PageIcon name="person" />
            <Text style={s.h1}>About You</Text>
            <Text style={s.sub}>A few basics before we build your profile</Text>
            <Text style={s.label}>Full Name</Text>
            <TextInput style={s.input} value={name} onChangeText={setName}
              placeholder="Enter your full name" maxLength={40} placeholderTextColor={theme.muted} />
            <Text style={s.label}>Date of Birth</Text>
            <View style={s.dobRow}>
              <TextInput style={[s.input, s.dobInput]} value={dd} onChangeText={setDD} placeholder="DD"
                keyboardType="number-pad" maxLength={2} placeholderTextColor={theme.muted} />
              <TextInput style={[s.input, s.dobInput]} value={mm} onChangeText={setMM} placeholder="MM"
                keyboardType="number-pad" maxLength={2} placeholderTextColor={theme.muted} />
              <TextInput style={[s.input, s.dobInput, { flex: 1.6 }]} value={yyyy} onChangeText={setYYYY}
                placeholder="YYYY" keyboardType="number-pad" maxLength={4} placeholderTextColor={theme.muted} />
            </View>
            {age() >= 18 && <Text style={s.hint}>You're {age()}. Your age will be public.</Text>}
            <Text style={s.label}>Gender</Text>
            <View style={s.chipWrap}>
              {GENDERS.map((g) => <Chip key={g} label={g} on={gender === g} onPress={() => setGender(g)} />)}
            </View>
          </>
        )}

        {current === "best" && (
          <>
            <PageIcon name="camera" />
            <Text style={s.h1}>Show Your Best Self</Text>
            <Text style={s.sub}>Add at least 1 photo. Location data is stripped before upload.</Text>
            <View style={s.grid}>
              {Array.from({ length: 6 }).map((_, i) => (
                <TouchableOpacity key={i} style={s.cell} onPress={photos[i] ? undefined : addPhoto}
                  disabled={!!photos[i]}>
                  {photos[i] ? (
                    <>
                      <Image source={{ uri: `data:image/jpeg;base64,${photos[i]}` }} style={s.cellImg} />
                      <TouchableOpacity style={s.cellX}
                        onPress={() => setPhotos(photos.filter((_, j) => j !== i))}>
                        <Text style={{ color: "#fff", fontWeight: "700" }}>✕</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Ionicons name="add" size={28} color={theme.muted} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.label}>Show me</Text>
            <View style={s.chipWrap}>
              {SEEKING.map((v) => <Chip key={v} label={v} on={seeking === v} onPress={() => setSeeking(v)} />)}
            </View>
            <Text style={s.label}>I'm looking for…</Text>
            <View style={s.chipWrap}>
              {GOALS.map((g) => <Chip key={g} label={g} on={goal === g} onPress={() => setGoal(g)} />)}
            </View>
            <Text style={s.label}>City (optional)</Text>
            <TextInput style={s.input} value={city} onChangeText={setCity} placeholder="e.g. Hyderabad"
              placeholderTextColor={theme.muted} />
          </>
        )}

        {current === "more" && (
          <>
            <PageIcon name="sparkles" />
            <Text style={s.h1}>More About You</Text>
            <Text style={s.sub}>Help our AI understand what makes you special</Text>
            <Text style={s.label}>Occupation</Text>
            <TextInput style={s.input} value={occupation} onChangeText={setOccupation}
              placeholder="Marketing Manager, Teacher, Designer…" maxLength={60}
              placeholderTextColor={theme.muted} />
            <Text style={s.label}>Education</Text>
            <TextInput style={s.input} value={education} onChangeText={setEducation}
              placeholder="University of Hyderabad, Business Degree…" maxLength={120}
              placeholderTextColor={theme.muted} />
            <Text style={s.label}>Values that matter to you</Text>
            <TextInput style={[s.input, s.multi]} value={values} onChangeText={setValues} multiline
              placeholder="Family, honesty, personal growth, making a positive impact…"
              maxLength={500} placeholderTextColor={theme.muted} />
            <Text style={s.counter}>{values.length}/500 characters</Text>
            <Text style={s.label}>Fun facts or unique hobbies</Text>
            <TextInput style={[s.input, s.multi]} value={funFacts} onChangeText={setFunFacts} multiline
              placeholder="I can solve a Rubik's cube in under 2 minutes, I've visited 15 countries…"
              maxLength={500} placeholderTextColor={theme.muted} />
            <Text style={s.counter}>{funFacts.length}/500 characters</Text>
          </>
        )}

        {current === "interests" && (
          <>
            <PageIcon name="star" />
            <Text style={s.h1}>Your Interests</Text>
            <Text style={s.sub}>Select what you're passionate about (choose at least 3)</Text>
            {INTEREST_GROUPS.map((g) => (
              <View key={g.title}>
                <Text style={s.label}>{g.title}</Text>
                <View style={s.chipWrap}>
                  {g.items.map((it) => (
                    <Chip key={it.label} label={`${it.emoji} ${it.label}`}
                      on={interests.includes(it.label)}
                      onPress={() => toggleInterest(it.label)} />
                  ))}
                </View>
              </View>
            ))}
            <Text style={[s.counter, { textAlign: "center", marginTop: 18 }]}>
              Selected: {interests.length} interest{interests.length === 1 ? "" : "s"}
            </Text>
          </>
        )}

        {current === "lifestyle" && (
          <>
            <PageIcon name="heart" />
            <Text style={s.h1}>Almost Done!</Text>
            <Text style={s.sub}>Tell us about your lifestyle</Text>
            <Text style={s.label}>Lifestyle</Text>
            {LIFESTYLES.map((l) => (
              <TouchableOpacity key={l} style={[s.lifeRow, lifestyle === l && s.lifeRowOn]}
                onPress={() => setLifestyle(l)}>
                <Text style={[s.lifeRowText, lifestyle === l && s.lifeRowTextOn]}>{l}</Text>
              </TouchableOpacity>
            ))}
            <Text style={s.label}>Faith (optional)</Text>
            <View style={s.chipWrap}>
              {FAITHS.map((f) => <Chip key={f} label={f} on={faith === f} onPress={() => setFaith(faith === f ? null : f)} />)}
            </View>
            <Text style={s.label}>Diet (optional)</Text>
            <View style={s.chipWrap}>
              {DIETS.map((d) => <Chip key={d} label={d} on={diet === d} onPress={() => setDiet(diet === d ? null : d)} />)}
            </View>
            <Text style={s.label}>Languages (optional)</Text>
            <View style={s.chipWrap}>
              {LANGS.map((l) => (
                <Chip key={l} label={l} on={langs.includes(l)}
                  onPress={() => setLangs(langs.includes(l) ? langs.filter((x) => x !== l) : [...langs, l])} />
              ))}
            </View>
            <Text style={s.label}>🍷 Drinking (optional)</Text>
            <View style={s.chipWrap}>
              {DRINKS.map((d) => <Chip key={d} label={d} on={drinking === d}
                onPress={() => setDrinking(drinking === d ? null : d)} />)}
            </View>
            <Text style={s.label}>🚬 Smoking (optional)</Text>
            <View style={s.chipWrap}>
              {SMOKES.map((m) => <Chip key={m} label={m} on={smoking === m}
                onPress={() => setSmoking(smoking === m ? null : m)} />)}
            </View>
            <Text style={s.label}>📏 Height in cm (optional)</Text>
            <TextInput style={s.input} value={heightCm} onChangeText={setHeightCm}
              placeholder="e.g. 172" keyboardType="number-pad" maxLength={3}
              placeholderTextColor={theme.muted} />
          </>
        )}

        {current === "generate" && (
          <>
            <PageIcon name="sparkles" />
            <Text style={s.h1}>AI Profile Generation</Text>
            <Text style={s.sub}>Watch as our AI crafts your perfect profile</Text>
            {!generated ? (
              <View style={s.genCard}>
                <Text style={s.genTitle}>Ready to Generate Your Profile</Text>
                {["Photos uploaded", "Personal information collected", "Preferences and values noted"].map((t) => (
                  <View key={t} style={s.genRow}>
                    <Ionicons name="checkmark" size={15} color={theme.gold} />
                    <Text style={s.genRowText}>{t}</Text>
                  </View>
                ))}
                <TouchableOpacity onPress={generate} disabled={genBusy} style={{ marginTop: 16, opacity: genBusy ? 0.6 : 1 }}>
                  <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.genBtn}>
                    {genBusy ? <ActivityIndicator color="#fff" /> :
                      <Text style={s.genBtnText}>Generate My Profile</Text>}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={s.label}>Your bio — edit anything you like</Text>
                <TextInput style={[s.input, s.multi, { minHeight: 120 }]} value={bio}
                  onChangeText={setBio} multiline maxLength={500} placeholderTextColor={theme.muted} />
                <Text style={s.counter}>{bio.length}/500 characters</Text>
                <TouchableOpacity onPress={generate} disabled={genBusy}>
                  <Text style={s.regen}>{genBusy ? "Regenerating…" : "↻ Regenerate"}</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* footer buttons */}
      <View style={[s.footer, { paddingBottom: 16 + insets.bottom }]}>
        {page > 0 && (
          <TouchableOpacity style={s.prevBtn} onPress={() => setPage(page - 1)}>
            <Text style={s.prevText}>Previous</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={next} disabled={!canNext() || busy}
          style={[{ flex: 1, opacity: canNext() && !busy ? 1 : 0.4 }]}>
          <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cta}>
            {busy ? <ActivityIndicator color="#fff" /> : (
              <Text style={s.ctaText}>
                {current === "generate" ? "Start Matching!" : current === "lifestyle" ? "Continue" : "Continue"}
              </Text>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function PageIcon({ name }: { name: any }) {
  return (
    <View style={s.pageIcon}>
      <Ionicons name={name} size={28} color="#fff" />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingTop: 54, paddingBottom: 12,
    backgroundColor: theme.card, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerTitle: { color: theme.ink, fontSize: 15, fontFamily: theme.font.display, letterSpacing: -0.5 },
  stepHead: { paddingHorizontal: 18, paddingTop: 14 },
  stepRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  stepLabel: { color: theme.gold, fontSize: 13, fontFamily: theme.font.bold },
  stepPct: { color: theme.muted, fontSize: 13 },
  stepTrack: { height: 6, borderRadius: 3, backgroundColor: theme.card2, overflow: "hidden" },
  stepFill: { height: 6, borderRadius: 3, backgroundColor: theme.gold },
  body: { padding: 22, paddingBottom: 24 },
  pageIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: theme.gold,
    alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 14,
    ...theme.shadow.cta },
  h1: { color: theme.ink, fontSize: 25, fontFamily: theme.font.display, textAlign: "center",
    letterSpacing: -0.6 },
  sub: { color: theme.muted, fontSize: 13.5, textAlign: "center", marginTop: 8,
    marginBottom: 10, lineHeight: 19 },
  label: { color: theme.ink, fontSize: 14, fontFamily: theme.font.semibold, marginTop: 20, marginBottom: 8 },
  input: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, padding: 14, fontSize: 15, color: theme.ink },
  multi: { minHeight: 90, textAlignVertical: "top" },
  counter: { color: theme.muted, fontSize: 11.5, marginTop: 6 },
  hint: { color: theme.muted, fontSize: 12, marginTop: 8 },
  dobRow: { flexDirection: "row", gap: 10 },
  dobInput: { flex: 1, textAlign: "center" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  chip: { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card,
    paddingHorizontal: 15, paddingVertical: 10, borderRadius: 999 },
  chipOn: { borderColor: theme.gold, backgroundColor: theme.goldSoft },
  chipText: { color: theme.muted, fontSize: 13, fontFamily: theme.font.semibold },
  chipTextOn: { color: theme.gold },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
  cell: { width: "31%", aspectRatio: 3 / 4, borderRadius: theme.radii.md, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center",
    overflow: "hidden" },
  cellImg: { ...StyleSheet.absoluteFillObject },
  cellX: { position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(0,0,0,.55)", alignItems: "center", justifyContent: "center" },
  lifeRow: { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card,
    borderRadius: theme.radii.md, padding: 14, alignItems: "center", marginBottom: 10 },
  lifeRowOn: { borderColor: theme.gold, backgroundColor: theme.goldSoft },
  lifeRowText: { color: theme.ink, fontSize: 14.5, fontFamily: theme.font.semibold },
  lifeRowTextOn: { color: theme.gold },
  genCard: { backgroundColor: theme.card2, borderRadius: theme.radii.lg, padding: 18, marginTop: 8 },
  genTitle: { color: theme.gold, fontSize: 15.5, fontFamily: theme.font.displayMd, textAlign: "center",
    marginBottom: 12 },
  genRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6,
    alignSelf: "center" },
  genRowText: { color: theme.muted, fontSize: 13 },
  genBtn: { borderRadius: theme.radii.pill, padding: 14, alignItems: "center", alignSelf: "center",
    paddingHorizontal: 26, ...theme.shadow.cta },
  genBtnText: { color: "#fff", fontFamily: theme.font.black, fontSize: 14.5 },
  regen: { color: theme.gold, fontFamily: theme.font.bold, textAlign: "center", marginTop: 14 },
  footer: { flexDirection: "row", gap: 12, paddingHorizontal: 18, paddingBottom: 26,
    paddingTop: 10, backgroundColor: theme.card,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
  prevBtn: { borderRadius: theme.radii.pill, paddingVertical: 15, paddingHorizontal: 22,
    backgroundColor: theme.card2, alignItems: "center", justifyContent: "center" },
  prevText: { color: theme.ink, fontFamily: theme.font.bold, fontSize: 14.5 },
  cta: { borderRadius: theme.radii.pill, padding: 16, alignItems: "center", ...theme.shadow.cta },
  ctaText: { color: "#fff", fontFamily: theme.font.black, fontSize: 15.5, letterSpacing: 0.2 },
});
