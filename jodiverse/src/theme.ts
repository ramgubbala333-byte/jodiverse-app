import { Platform } from "react-native";

// "Aurora" dark theme, orange-forward (matched to the Google Stitch designs).
// Near-black night-time canvas with a warm signature gradient
// (orange → coral → red-pink) used for every CTA, the hero mic, badges and
// glow. Pink and violet remain as secondary accents for variety.
//
// Token NAMES are unchanged from the amber theme on purpose — `gold` is
// still THE accent, `purple` is still the secondary accent — so every
// existing screen re-skins for free just by this file changing.
//
// Teal (`emerald`) stays reserved EXCLUSIVELY for the live/on-air call
// state — it must never compete with the new gradient for attention, or
// "someone is speaking" stops reading as a distinct signal.
export const theme = {
  bg: "#0B0D14",          // near-black, blue bias
  card: "#12151E",        // surface: cards, sheets, tab bar
  card2: "#1A1E2A",       // raised: chips, inputs
  ink: "#E9E7E2",         // warm off-white
  muted: "#8B90A3",       // blue-grey secondary
  line: "#232838",        // hairlines
  gold: "#FF7A2E",        // ACCENT: warm orange (Stitch primary). CTAs, active states, badges
  goldSoft: "rgba(255,122,46,.15)",
  onGold: "#FFFFFF",      // text/icons on accent fills (accent is dark-saturated, needs white)
  emerald: "#2EE6D6",     // LIVE / on-air only — do not reuse decoratively
  danger: "#F1453A",      // end call, destructive — kept clearly apart from the orange gradient stop
  info: "#7C93FF",        // verification / info — periwinkle, distinct from the warm accent
  // Aliases kept for screens written against older palettes — all resolve
  // into the new warm family so nothing needs touching per-screen.
  saffron: "#FF7A2E",
  purple: "#8A3FFC",      // secondary accent: violet — variety on avatars/chips
  rose: "#FF4B89",        // secondary accent: pink (Stitch secondary)
  // THE brand gradient — orange → coral → red-pink, matching the Stitch hero
  // mic (linear-gradient #FF9500 → #FF2D55). Every `[...theme.grad]` CTA/orb/
  // badge across the app picks this up automatically.
  grad: ["#FF9F1C", "#FF5E3A", "#FF2D55"] as const,
  // Violet-only gradient for secondary buttons / accents that want the cool end only.
  gradViolet: ["#8A3FFC", "#5B21B6"] as const,
  // Live gradient — used only by the call screen's active/on-air state.
  gradLive: ["#2EE6D6", "#14B8AE"] as const,
  // Soft ambient glow colors for the GlowBackdrop component (blurred blobs
  // behind hero screens — Talk, Call, Matched, Paywall).
  glowA: "rgba(255,138,61,.32)",   // orange
  glowB: "rgba(138,63,252,.30)",   // violet

  // ── Typography ──────────────────────────────────────────────────────────
  // Loaded once in App.tsx via expo-font. Display = Unbounded (geometric,
  // expressive — headlines & hero moments only). Body/UI = Plus Jakarta Sans.
  // On Android custom fonts DON'T synthesise weight, so each weight is its own
  // face and MUST be referenced by name — never rely on fontWeight alone once
  // a fontFamily is set. Use these tokens instead of raw fontWeight strings.
  font: {
    display: "Unbounded_800ExtraBold",   // hero headlines
    displayMd: "Unbounded_700Bold",       // section titles
    black: "PlusJakartaSans_800ExtraBold",// heavy UI (buttons, big numbers)
    bold: "PlusJakartaSans_700Bold",
    semibold: "PlusJakartaSans_600SemiBold",
    medium: "PlusJakartaSans_500Medium",  // default body
    regular: "PlusJakartaSans_400Regular",
  },

  // ── Depth ───────────────────────────────────────────────────────────────
  // Soft, layered elevation — the single biggest "flat prototype → real
  // product" lever after type. iOS reads shadow*, Android reads elevation.
  shadow: {
    card: {
      shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 }, elevation: 6,
    },
    cta: {
      // coloured glow under gradient buttons — feels premium & alive
      shadowColor: "#FF5E3A", shadowOpacity: 0.45, shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 }, elevation: 10,
    },
    floating: {
      shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 24,
      shadowOffset: { width: 0, height: 14 }, elevation: 14,
    },
  },

  // ── Geometry ────────────────────────────────────────────────────────────
  radius: 24,
  radii: { sm: 12, md: 18, lg: 24, xl: 30, pill: 999 },
  space: { xs: 6, sm: 10, md: 16, lg: 22, xl: 32 },

  serif: Platform.OS === "ios" ? "Georgia" : "serif",
};
