import React from "react";
import { StyleSheet, View } from "react-native";
import { theme } from "../theme";

// Ambient aurora glow for hero screens — two large soft-edged colour blobs
// (orange top-left, violet bottom-right) behind the content, echoing the
// warm-to-violet gradient used everywhere else. RN has no CSS blur filter,
// so the "soft" look comes from low opacity + oversized radius rather than
// an actual blur; cheap, no extra native deps, reads as a glow at normal
// viewing distance.
export default function GlowBackdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[s.blob, s.orange]} />
      <View style={[s.blob, s.violet]} />
    </View>
  );
}

const SIZE = 340;
const s = StyleSheet.create({
  blob: { position: "absolute", width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  orange: { top: -SIZE * 0.35, left: -SIZE * 0.35, backgroundColor: theme.glowA },
  violet: { bottom: -SIZE * 0.4, right: -SIZE * 0.3, backgroundColor: theme.glowB },
});
