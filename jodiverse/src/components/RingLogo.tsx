import React from "react";
import { View } from "react-native";
import { theme } from "../theme";

// Brand mark from the Royal Emerald mock: two interlocking gold rings.
export default function RingLogo({ size = 22 }: { size?: number }) {
  const ring = {
    width: size, height: size, borderRadius: size / 2,
    borderWidth: Math.max(1.5, size * 0.07), borderColor: theme.gold,
  } as const;
  return (
    <View style={{ flexDirection: "row" }}>
      <View style={ring} />
      <View style={[ring, { marginLeft: -size * 0.35 }]} />
    </View>
  );
}
