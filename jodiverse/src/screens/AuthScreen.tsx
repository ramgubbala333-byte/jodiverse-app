import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Alert, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { signInWithGoogle, signInWithFacebook, sendPhoneOtp, verifyPhoneOtp } from "../lib/auth";
import GlowBackdrop from "../components/GlowBackdrop";
import { theme } from "../theme";

const GENDERS = ["Woman", "Man", "Non-binary"] as const;

const HIGHLIGHTS = [
  ["mic", "Voice First", "A real conversation tells you more than fifty photos ever could"],
  ["people", "Shared Interests", "Matched on what you actually love to talk about"],
] as const;

const HOW_IT_WORKS = [
  ["Set your vibe", "Pick what you're in the mood to talk about tonight"],
  ["Get connected", "We instantly match you with someone who's into it too"],
  ["Click? Become friends", "Hit it off in 10 minutes and chat anytime, free forever"],
] as const;

const STORIES = [
  ["Priya Sharma", 27, "Met someone amazing without a single awkward photo. We just clicked on the call."],
  ["Arjun Mehta", 31, "Ten minutes of real conversation beat months of swiping. We're still talking daily."],
  ["Meera Iyer", 26, "No more judging looks — I finally met people for who they actually are."],
] as const;

// LoveAI-style marketing landing + "Create Your Account" (Step 1 of 4).
// Steps 2-4 of the Smart Profile Builder live in OnboardingScreen; name,
// birthdate and gender collected here travel via auth user metadata.
export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<"landing" | "auth" | "otp" | "up" | "in">("landing");
  const [busy, setBusy] = useState(false);

  const [cc] = useState("+91");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dd, setDD] = useState(""); const [mm, setMM] = useState(""); const [yyyy, setYYYY] = useState("");
  const [gender, setGender] = useState<string | null>(null);

  const birthdate = `${yyyy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  const age = () => {
    const b = new Date(+yyyy, +mm - 1, +dd);
    if (isNaN(b.getTime())) return 0;
    const now = new Date();
    let a = now.getFullYear() - b.getFullYear();
    if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a--;
    return a;
  };

  const canSignUp = name.trim().length >= 1 && /\S+@\S+\.\S+/.test(email)
    && password.length >= 6 && age() >= 18 && age() < 100 && !!gender;

  const signUp = async () => {
    setBusy(true);
    // Metadata carries the Step-1 answers into the profile builder.
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { full_name: name.trim(), gender: gender!.toLowerCase(), birthdate } },
    });
    setBusy(false);
    if (error) { Alert.alert("Couldn't create account", error.message); return; }
    if (!data.session) {
      Alert.alert("Confirm your email", "We sent you a confirmation link — tap it, then sign in here.");
      setPage("in");
    }
    // With a session, onAuthStateChange in App.tsx routes to the builder.
  };

  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) Alert.alert("Sign-in problem", error.message);
  };

  const goGoogle = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      Alert.alert("Google sign-in problem", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const goFacebook = async () => {
    setBusy(true);
    try {
      await signInWithFacebook();
    } catch (e: any) {
      Alert.alert("Facebook sign-in",
        /not enabled|unsupported|provider/i.test(e.message ?? "")
          ? "Facebook login isn't switched on yet — use Google or phone for now."
          : e.message ?? String(e));
    } finally { setBusy(false); }
  };

  const digits = () => phone.replace(/[^0-9]/g, "");
  const fullPhone = () => `${cc}${digits()}`;

  const sendOtp = async () => {
    if (digits().length < 7) { Alert.alert("Enter a valid mobile number"); return; }
    setBusy(true);
    try {
      await sendPhoneOtp(fullPhone());
      setOtp("");
      setPage("otp");
    } catch (e: any) {
      Alert.alert("Couldn't send code",
        /provider|not enabled|not configured|unsupported|sms/i.test(e.message ?? "")
          ? "Phone login isn't switched on yet (it needs an SMS provider set up). Use Google for now."
          : e.message ?? String(e));
    } finally { setBusy(false); }
  };

  const doVerifyOtp = async () => {
    if (otp.trim().length < 4) return;
    setBusy(true);
    try {
      await verifyPhoneOtp(fullPhone(), otp.trim());
      // onAuthStateChange in App.tsx routes: new number → Onboarding, existing → app.
    } catch (e: any) {
      Alert.alert("Wrong or expired code", e.message ?? String(e));
    } finally { setBusy(false); }
  };

  // ── Log in / sign up hub — phone OTP · Google · Facebook · email ────────
  if (page === "auth" || page === "otp") {
    return (
      <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <GlowBackdrop />
        <View style={[s.topBar, { paddingTop: 14 + insets.top, backgroundColor: "transparent",
          borderBottomWidth: 0 }]}>
          <TouchableOpacity onPress={() => setPage(page === "otp" ? "auth" : "landing")}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={22} color={theme.ink} />
          </TouchableOpacity>
          <Text style={s.brandSmall}>Dosti Connect</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView contentContainerStyle={[s.formBody, { paddingBottom: 40 + insets.bottom }]}
          keyboardShouldPersistTaps="handled">
          <View style={s.heroIcon}><Ionicons name="chatbubbles" size={30} color="#fff" /></View>

          {page === "auth" ? (
            <>
              <Text style={s.formTitle}>Log in or sign up</Text>
              <Text style={s.formSub}>Talk first. Find your connection.</Text>

              <Text style={s.fieldLabel}>Mobile number</Text>
              <View style={s.phoneRow}>
                <View style={s.ccBox}><Text style={s.ccText}>{cc}</Text></View>
                <TextInput style={[s.input, { flex: 1 }]} placeholder="Enter mobile number"
                  keyboardType="phone-pad" value={phone} onChangeText={setPhone}
                  maxLength={12} placeholderTextColor={theme.muted} />
              </View>
              <Text style={s.hint}>We never share your number with anyone.</Text>

              <TouchableOpacity disabled={busy || digits().length < 7} onPress={sendOtp}
                style={{ opacity: busy || digits().length < 7 ? 0.5 : 1, marginTop: 16 }}>
                <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cta}>
                  <Text style={s.ctaText}>Get OTP</Text>
                </LinearGradient>
              </TouchableOpacity>

              <View style={s.orRow}>
                <View style={s.orLine} /><Text style={s.orText}>or</Text><View style={s.orLine} />
              </View>

              <TouchableOpacity style={s.socialBtn} onPress={goGoogle} disabled={busy}>
                <Ionicons name="logo-google" size={18} color={theme.ink} />
                <Text style={s.socialText}>Continue with Google</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.socialBtn} onPress={goFacebook} disabled={busy}>
                <Ionicons name="logo-facebook" size={18} color="#1877F2" />
                <Text style={s.socialText}>Continue with Facebook</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setPage("up")}>
                <Text style={s.switch}>Prefer email? Sign up with email</Text>
              </TouchableOpacity>

              <Text style={s.legal}>
                By proceeding you accept our Community Guidelines & Terms of Use. We never sell your data.
              </Text>
            </>
          ) : (
            <>
              <Text style={s.formTitle}>Enter the code</Text>
              <Text style={s.formSub}>We sent a 6-digit code to {cc} {phone}</Text>
              <TextInput style={[s.input, s.otpInput]} placeholder="––––––"
                keyboardType="number-pad" value={otp} onChangeText={setOtp} maxLength={6}
                placeholderTextColor={theme.muted} autoFocus />
              <TouchableOpacity disabled={busy || otp.trim().length < 4} onPress={doVerifyOtp}
                style={{ opacity: busy || otp.trim().length < 4 ? 0.5 : 1, marginTop: 16 }}>
                <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cta}>
                  <Text style={s.ctaText}>Verify &amp; continue</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity onPress={sendOtp} disabled={busy}>
                <Text style={s.switch}>Resend code</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPage("auth")}>
                <Text style={[s.switch, { color: theme.muted, marginTop: 8 }]}>Change number</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Step 1 of 4: Create Your Account (email) ────────────────────────────
  if (page === "up" || page === "in") {
    const up = page === "up";
    return (
      <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.topBar, { paddingTop: 14 + insets.top }]}>
          <TouchableOpacity onPress={() => setPage("landing")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={22} color={theme.gold} />
          </TouchableOpacity>
          <View style={s.brandRow}>
            <Ionicons name="heart" size={18} color={theme.gold} />
            <Text style={s.brandSmall}>Dosti Connect</Text>
          </View>
          <View style={{ width: 22 }} />
        </View>

        {up && (
          <View style={s.stepHead}>
            <View style={s.stepRow}>
              <Text style={s.stepLabel}>Step 1 of 4</Text>
              <Text style={s.stepPct}>25%</Text>
            </View>
            <View style={s.stepTrack}><View style={[s.stepFill, { width: "25%" }]} /></View>
          </View>
        )}

        <ScrollView contentContainerStyle={[s.formBody, { paddingBottom: 40 + insets.bottom }]} keyboardShouldPersistTaps="handled">
          <View style={s.heroIcon}>
            <Ionicons name={up ? "person-add" : "person"} size={30} color="#fff" />
          </View>
          <Text style={s.formTitle}>{up ? "Create Your Account" : "Welcome Back"}</Text>
          <Text style={s.formSub}>
            {up ? "Let's start your journey to finding love" : "Sign in to continue your journey"}
          </Text>

          {up && (
            <>
              <Text style={s.fieldLabel}>Full Name</Text>
              <TextInput style={s.input} placeholder="Enter your full name" value={name}
                onChangeText={setName} maxLength={40} placeholderTextColor={theme.muted} />
            </>
          )}

          <Text style={s.fieldLabel}>Email Address</Text>
          <TextInput style={s.input} placeholder="Enter your email" autoCapitalize="none"
            keyboardType="email-address" value={email} onChangeText={setEmail}
            placeholderTextColor={theme.muted} />

          <Text style={s.fieldLabel}>Password</Text>
          <TextInput style={s.input} placeholder={up ? "Create a secure password" : "Your password"}
            secureTextEntry value={password} onChangeText={setPassword}
            placeholderTextColor={theme.muted} />

          {up && (
            <>
              <Text style={s.fieldLabel}>Date of Birth</Text>
              <View style={s.dobRow}>
                <TextInput style={[s.input, s.dobInput]} value={dd} onChangeText={setDD} placeholder="DD"
                  keyboardType="number-pad" maxLength={2} placeholderTextColor={theme.muted} />
                <TextInput style={[s.input, s.dobInput]} value={mm} onChangeText={setMM} placeholder="MM"
                  keyboardType="number-pad" maxLength={2} placeholderTextColor={theme.muted} />
                <TextInput style={[s.input, s.dobInput, { flex: 1.6 }]} value={yyyy} onChangeText={setYYYY}
                  placeholder="YYYY" keyboardType="number-pad" maxLength={4} placeholderTextColor={theme.muted} />
              </View>
              {age() >= 18 && <Text style={s.hint}>You're {age()}. Your age will be public.</Text>}

              <Text style={s.fieldLabel}>Gender</Text>
              <View style={s.chipRow}>
                {GENDERS.map((g) => (
                  <TouchableOpacity key={g} style={[s.chip, gender === g && s.chipOn]}
                    onPress={() => setGender(g)}>
                    <Text style={[s.chipText, gender === g && s.chipTextOn]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <TouchableOpacity disabled={busy || (up ? !canSignUp : !email || !password)}
            onPress={up ? signUp : signIn}
            style={{ opacity: busy || (up ? !canSignUp : !email || !password) ? 0.5 : 1, marginTop: 22 }}>
            <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cta}>
              <Text style={s.ctaText}>{up ? "Continue" : "Sign In"}</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={s.googleBtn} onPress={goGoogle} disabled={busy}>
            <Text style={s.googleText}>G   Continue with Google</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setPage(up ? "in" : "up")}>
            <Text style={s.switch}>
              {up ? "Already have an account? Sign in" : "New here? Create an account"}
            </Text>
          </TouchableOpacity>

          <Text style={s.legal}>
            By continuing you agree to our Terms. Learn how we process your data in our
            Privacy Policy. We never sell your data — and never will.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Marketing landing ───────────────────────────────────────────────────
  return (
    <View style={s.wrap}>
      <GlowBackdrop />
      <View style={s.topBar}>
        <View style={s.brandRow}>
          <Ionicons name="heart" size={20} color={theme.gold} />
          <Text style={s.brand}>Dosti Connect</Text>
        </View>
        <TouchableOpacity style={s.signUpPill} onPress={() => setPage("auth")}>
          <Text style={s.signUpPillText}>Log in</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[s.landingBody, { paddingBottom: 40 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        {/* hero */}
        <Text style={s.heroTitle}>Talk first.{"\n"}Find your connection.</Text>
        <Text style={s.heroSub}>
          No photos, no swiping. Get instantly connected for a real voice conversation
          with someone who shares your interests — and let the chemistry lead.
        </Text>
        <TouchableOpacity onPress={() => setPage("auth")}>
          <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cta}>
            <Text style={s.ctaText}>Start Talking</Text>
          </LinearGradient>
        </TouchableOpacity>
        <Text style={s.heroNote}>20 free minutes a day · you're connected in seconds</Text>

        {/* key highlights */}
        <Text style={s.sectionTitle}>Why voice-first</Text>
        <View style={s.highlightRow}>
          {HIGHLIGHTS.map(([icon, title, sub]) => (
            <View key={title} style={s.highlightCard}>
              <View style={s.highlightIcon}>
                <Ionicons name={icon as any} size={20} color="#fff" />
              </View>
              <Text style={s.highlightTitle}>{title}</Text>
              <Text style={s.highlightSub}>{sub}</Text>
            </View>
          ))}
        </View>

        {/* how it works */}
        <Text style={s.sectionTitle}>How It Works</Text>
        {HOW_IT_WORKS.map(([title, sub], i) => (
          <View key={title} style={s.stepCard}>
            <View style={s.stepNum}><Text style={s.stepNumText}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.stepCardTitle}>{title}</Text>
              <Text style={s.stepCardSub}>{sub}</Text>
            </View>
          </View>
        ))}

        {/* success stories */}
        <Text style={s.sectionTitle}>Success Stories</Text>
        {STORIES.map(([who, yrs, quote]) => (
          <View key={who} style={s.storyCard}>
            <View style={s.storyHead}>
              <View style={s.storyAvatar}>
                <Text style={s.storyAvatarText}>{who[0]}</Text>
              </View>
              <Text style={s.storyName}>{who}</Text>
              <Text style={s.storyAge}>· {yrs}</Text>
            </View>
            <Text style={s.storyQuote}>"{quote}"</Text>
            <View style={s.storyStars}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Ionicons key={i} name="star" size={13} color={theme.gold} />
              ))}
            </View>
          </View>
        ))}

        {/* stats band */}
        <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.statsBand}>
          <Text style={s.statsTitle}>Join Thousands Finding Love</Text>
          <View style={s.statsRow}>
            {[["12k+", "Success\nStories"], ["89%", "Match\nRate"], ["4.9", "App\nRating"]].map(([v, l]) => (
              <View key={l} style={{ alignItems: "center" }}>
                <Text style={s.statVal}>{v}</Text>
                <Text style={s.statLabel}>{l}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        {/* final CTA */}
        <View style={s.finalCard}>
          <Text style={s.finalTitle}>Ready to Find Your{"\n"}Soulmate?</Text>
          <Text style={s.finalSub}>Start your journey to meaningful connections today</Text>
          <TouchableOpacity onPress={() => setPage("auth")}>
            <LinearGradient colors={[...theme.grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cta}>
              <Text style={s.ctaText}>Get Started – It's Free</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPage("auth")}>
            <Text style={s.switch}>Already a member? Log in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, overflow: "hidden" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingTop: 54, paddingBottom: 12,
    backgroundColor: theme.card, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  brand: { color: theme.ink, fontSize: 18, fontFamily: theme.font.display, letterSpacing: -0.5 },
  brandSmall: { color: theme.ink, fontSize: 15, fontFamily: theme.font.display, letterSpacing: -0.5 },
  signUpPill: { backgroundColor: theme.gold, borderRadius: theme.radii.pill, paddingHorizontal: 18,
    paddingVertical: 9, ...theme.shadow.cta },
  signUpPillText: { color: "#fff", fontFamily: theme.font.bold, fontSize: 14 },

  landingBody: { padding: 22, paddingBottom: 40 },
  heroTitle: { color: theme.ink, fontSize: 38, fontFamily: theme.font.display, textAlign: "center",
    marginTop: 30, lineHeight: 46, letterSpacing: -1 },
  heroSub: { color: theme.muted, fontSize: 15, textAlign: "center", marginTop: 16,
    lineHeight: 23, paddingHorizontal: 6 },
  cta: { borderRadius: theme.radii.pill, paddingVertical: 17, alignItems: "center", marginTop: 22,
    ...theme.shadow.cta },
  ctaText: { color: "#fff", fontFamily: theme.font.black, fontSize: 16, letterSpacing: 0.2 },
  heroNote: { color: theme.muted, fontSize: 12.5, textAlign: "center", marginTop: 12 },

  sectionTitle: { color: theme.ink, fontSize: 24, fontFamily: theme.font.displayMd, textAlign: "center",
    marginTop: 44, marginBottom: 18, letterSpacing: -0.5 },
  highlightRow: { flexDirection: "row", gap: 12 },
  highlightCard: { flex: 1, backgroundColor: theme.card, borderRadius: theme.radii.lg, padding: 18,
    alignItems: "center", borderWidth: 1, borderColor: theme.line, ...theme.shadow.card },
  highlightIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.gold,
    alignItems: "center", justifyContent: "center", marginBottom: 12, ...theme.shadow.cta },
  highlightTitle: { color: theme.ink, fontSize: 15, fontFamily: theme.font.bold, textAlign: "center" },
  highlightSub: { color: theme.muted, fontSize: 12, textAlign: "center", marginTop: 6,
    lineHeight: 17 },

  stepCard: { flexDirection: "row", gap: 14, backgroundColor: theme.card, borderRadius: theme.radii.lg,
    padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.line,
    alignItems: "flex-start", ...theme.shadow.card },
  stepNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.goldSoft,
    alignItems: "center", justifyContent: "center", marginTop: 2 },
  stepNumText: { color: theme.gold, fontFamily: theme.font.black, fontSize: 14 },
  stepCardTitle: { color: theme.ink, fontSize: 15.5, fontFamily: theme.font.bold },
  stepCardSub: { color: theme.muted, fontSize: 12.5, marginTop: 4, lineHeight: 18 },

  storyCard: { backgroundColor: theme.card, borderRadius: theme.radii.lg, padding: 18, marginBottom: 12,
    borderWidth: 1, borderColor: theme.line, ...theme.shadow.card },
  storyHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  storyAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.gold,
    alignItems: "center", justifyContent: "center", ...theme.shadow.cta },
  storyAvatarText: { color: "#fff", fontFamily: theme.font.black, fontSize: 15 },
  storyName: { color: theme.ink, fontFamily: theme.font.bold, fontSize: 14.5 },
  storyAge: { color: theme.muted, fontSize: 13 },
  storyQuote: { color: theme.ink, fontSize: 13.5, lineHeight: 21, marginTop: 12, opacity: 0.9 },
  storyStars: { flexDirection: "row", gap: 3, marginTop: 12 },

  statsBand: { borderRadius: theme.radii.xl, padding: 24, marginTop: 34, ...theme.shadow.floating },
  statsTitle: { color: "#fff", fontSize: 19, fontFamily: theme.font.displayMd, textAlign: "center" },
  statsRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 20 },
  statVal: { color: "#fff", fontSize: 28, fontFamily: theme.font.black },
  statLabel: { color: "rgba(255,255,255,.9)", fontSize: 11.5, textAlign: "center",
    marginTop: 4, lineHeight: 15, fontFamily: theme.font.semibold },

  finalCard: { backgroundColor: theme.card, borderRadius: theme.radii.xl, padding: 24, marginTop: 26,
    borderWidth: 1, borderColor: theme.line, alignItems: "center", ...theme.shadow.card },
  finalTitle: { color: theme.ink, fontSize: 26, fontFamily: theme.font.display, textAlign: "center",
    lineHeight: 33, letterSpacing: -0.8 },
  finalSub: { color: theme.muted, fontSize: 13, textAlign: "center", marginTop: 10 },

  // sign-up / sign-in form
  stepHead: { paddingHorizontal: 18, paddingTop: 14 },
  stepRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  stepLabel: { color: theme.gold, fontSize: 13, fontFamily: theme.font.bold },
  stepPct: { color: theme.muted, fontSize: 13 },
  stepTrack: { height: 6, borderRadius: 3, backgroundColor: theme.card2, overflow: "hidden" },
  stepFill: { height: 6, borderRadius: 3, backgroundColor: theme.gold },
  formBody: { padding: 22, paddingBottom: 40 },
  heroIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: theme.gold,
    alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 10,
    ...theme.shadow.cta },
  formTitle: { color: theme.ink, fontSize: 25, fontFamily: theme.font.display, textAlign: "center",
    marginTop: 16, letterSpacing: -0.6 },
  formSub: { color: theme.muted, fontSize: 13.5, textAlign: "center", marginTop: 8,
    marginBottom: 10 },
  fieldLabel: { color: theme.ink, fontSize: 14, fontFamily: theme.font.semibold, marginTop: 18,
    marginBottom: 8 },
  input: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, padding: 15, fontSize: 15, color: theme.ink },
  phoneRow: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  ccBox: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radii.md, paddingHorizontal: 14, justifyContent: "center" },
  ccText: { color: theme.ink, fontSize: 15, fontFamily: theme.font.bold },
  orRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 20 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
  orText: { color: theme.muted, fontSize: 12.5 },
  socialBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card2,
    borderRadius: theme.radii.pill, padding: 15, marginBottom: 12 },
  socialText: { color: theme.ink, fontFamily: theme.font.bold, fontSize: 14.5 },
  otpInput: { textAlign: "center", letterSpacing: 10, fontSize: 22, marginTop: 20 },
  dobRow: { flexDirection: "row", gap: 10 },
  dobInput: { flex: 1, textAlign: "center" },
  hint: { color: theme.muted, fontSize: 12, marginTop: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  chip: { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card,
    paddingHorizontal: 15, paddingVertical: 9, borderRadius: 999 },
  chipOn: { borderColor: theme.gold, backgroundColor: theme.goldSoft },
  chipText: { color: theme.muted, fontSize: 13, fontFamily: theme.font.semibold },
  chipTextOn: { color: theme.gold },
  googleBtn: { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card2,
    borderRadius: theme.radii.pill, padding: 15, alignItems: "center", marginTop: 12 },
  googleText: { color: theme.ink, fontFamily: theme.font.bold, fontSize: 14 },
  switch: { color: theme.gold, textAlign: "center", marginTop: 18, fontFamily: theme.font.bold },
  legal: { color: theme.muted, fontSize: 11, textAlign: "center", lineHeight: 16,
    marginTop: 22 },
});
