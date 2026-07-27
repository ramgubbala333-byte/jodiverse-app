import React from "react";
import { StyleSheet, View, ViewStyle, StyleProp } from "react-native";
import { BlurView } from "expo-blur";
import { theme } from "../theme";

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;   // padding / margins / radius overrides
  intensity?: number;             // blur strength
  radius?: number;
};

// Frosted-glass surface. On the dark Aurora canvas, a dark blur + a faint white
// top hairline + a low-opacity fill reads as premium, layered depth. Place it
// over the GlowBackdrop blobs so the colour bleeds through the frost.
// BlurView degrades gracefully to a translucent fill where GPU blur is absent.
export default function GlassCard({ children, style, intensity = 32, radius = theme.radii.lg }: Props) {
  return (
    <View style={[{ borderRadius: radius }, s.wrap, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, s.fill]} pointerEvents="none" />
      <View style={[s.hairline, { borderTopLeftRadius: radius, borderTopRightRadius: radius }]}
        pointerEvents="none" />
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  fill: { backgroundColor: "rgba(255,255,255,0.045)" },
  hairline: { position: "absolute", top: 0, left: 0, right: 0, height: 1,
    backgroundColor: "rgba(255,255,255,0.14)" },
});
