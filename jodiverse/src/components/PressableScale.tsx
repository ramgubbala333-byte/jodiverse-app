import React, { useRef } from "react";
import {
  Animated, Pressable, GestureResponderEvent, ViewStyle, StyleProp,
} from "react-native";
import { haptic } from "../lib/haptics";

// Animate the Pressable ITSELF (not a nested child) so any layout the caller
// passes — flex:1, aspectRatio, width — stays on the root element. This matters
// for grid/row items (lounge cards, paywall tabs) that must fill their column.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type HapticKind = keyof typeof haptic;

type Props = {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  onPressIn?: (e: GestureResponderEvent) => void;
  onPressOut?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;               // how far it dips on press
  haptics?: HapticKind | false;   // haptic fired on press-in ("light" default)
  hitSlop?: number;
};

// Drop-in replacement for a tappable View/TouchableOpacity that springs down on
// press and fires a subtle haptic — the cheapest way to make a UI feel "alive".
export default function PressableScale({
  children, onPress, onPressIn, onPressOut, onLongPress, disabled,
  style, scaleTo = 0.96, haptics = "light", hitSlop,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const spring = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, friction: 6, tension: 220 }).start();

  return (
    <AnimatedPressable
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={(e) => { spring(scaleTo); if (haptics && !disabled) haptic[haptics](); onPressIn?.(e); }}
      onPressOut={(e) => { spring(1); onPressOut?.(e); }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[style, { transform: [{ scale }] }, disabled ? { opacity: 0.5 } : null]}
    >
      {children}
    </AnimatedPressable>
  );
}
