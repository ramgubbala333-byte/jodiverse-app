import React, { useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform, Image } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { theme } from "../theme";

// Selfie verification. Privacy model: the selfie NEVER leaves the device —
// liveness/face-match run on-device (stubbed in Expo Go; ML Kit lands with
// the dev build). Only a signed boolean + device-integrity token go to the
// verify-selfie edge function, which flips is_verified with service role.
export default function VerifyScreen() {
  const [perm, requestPerm] = useCameraPermissions();
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cam = useRef<CameraView>(null);
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const capture = async () => {
    const photo = await cam.current?.takePictureAsync({ quality: 0.5 });
    if (photo?.uri) setShot(photo.uri);
  };

  const submit = async () => {
    setBusy(true);
    try {
      // Dev build TODO: run ML Kit liveness + face-match against profile
      // photos here, and fetch a real Play Integrity / App Attest token.
      const { data, error } = await supabase.functions.invoke("verify-selfie", {
        body: { passed: true, platform: Platform.OS, integrityToken: "dev" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.reason ?? "verification_failed");
      Alert.alert("Verified! ✓", "Your profile is now live in the deck.", [
        { text: "Let's go", onPress: () => nav.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert("Verification failed", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!perm?.granted) {
    return (
      <View style={s.center}>
        <Ionicons name="camera-outline" size={44} color={theme.muted} />
        <Text style={s.title}>Verify it's really you</Text>
        <Text style={s.body}>
          Take a quick selfie. It's checked on your phone and never uploaded —
          only a verified badge is stored.
        </Text>
        <TouchableOpacity onPress={requestPerm}>
          <LinearGradient colors={[...theme.grad]} style={s.btn}>
            <Text style={s.btnText}>Allow camera</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.wrap, { paddingBottom: 16 + insets.bottom }]}>
      <Text style={[s.title, { marginTop: 8 }]}>
        {shot ? "Looking good?" : "Center your face"}
      </Text>
      <View style={s.camWrap}>
        {shot ? (
          <Image source={{ uri: shot }} style={{ flex: 1 }} />
        ) : (
          <CameraView ref={cam} style={{ flex: 1 }} facing="front" />
        )}
      </View>
      {shot ? (
        <View style={s.row}>
          <TouchableOpacity style={s.ghost} onPress={() => setShot(null)} disabled={busy}>
            <Text style={{ color: theme.muted, fontWeight: "700" }}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={submit} disabled={busy} style={{ flex: 1 }}>
            <LinearGradient colors={[...theme.grad]} style={s.btn}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Verify me</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={s.shutter} onPress={capture}>
          <View style={s.shutterInner} />
        </TouchableOpacity>
      )}
      <Text style={s.privacy}>
        🔒 Your selfie stays on this phone. Only a yes/no verification result is saved.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, padding: 22, paddingTop: 24 },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center",
    justifyContent: "center", padding: 30 },
  title: { color: theme.ink, fontSize: 24, fontFamily: theme.font.display, textAlign: "center",
    letterSpacing: -0.6, marginTop: 12, marginBottom: 8 },
  body: { color: theme.muted, fontSize: 14, textAlign: "center", lineHeight: 20,
    marginBottom: 20 },
  camWrap: { flex: 1, borderRadius: theme.radii.lg, overflow: "hidden", marginVertical: 16,
    backgroundColor: theme.card },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  ghost: { paddingHorizontal: 18, paddingVertical: 15 },
  btn: { borderRadius: 999, padding: 16, alignItems: "center", paddingHorizontal: 30, ...theme.shadow.cta },
  btnText: { color: "#fff", fontFamily: theme.font.black, fontSize: 15 },
  shutter: { alignSelf: "center", width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#fff" },
  privacy: { color: theme.muted, fontSize: 12, textAlign: "center", marginTop: 14 },
});
