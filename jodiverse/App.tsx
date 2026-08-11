import React, { useCallback, useEffect, useState } from "react";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AppState, StatusBar, View, StyleSheet, Text, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { Unbounded_700Bold, Unbounded_800ExtraBold } from "@expo-google-fonts/unbounded";
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { supabase } from "./src/lib/supabase";
import { updateGeoCell } from "./src/lib/geo";
import { theme } from "./src/theme";
import AuthScreen from "./src/screens/AuthScreen";
import OnboardingScreen from "./src/screens/OnboardingScreen";
import DiscoverScreen from "./src/screens/DiscoverScreen";
import MatchedScreen from "./src/screens/MatchedScreen";
import CoinsScreen from "./src/screens/CoinsScreen";
import ReferralScreen from "./src/screens/ReferralScreen";
import TransactionsScreen from "./src/screens/TransactionsScreen";
import MatchesScreen from "./src/screens/MatchesScreen";
import ChatsScreen from "./src/screens/ChatsScreen";
import ChatScreen from "./src/screens/ChatScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import VerifyScreen from "./src/screens/VerifyScreen";
import PaywallScreen from "./src/screens/PaywallScreen";
import MatchProfileScreen from "./src/screens/MatchProfileScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import { registerPush } from "./src/lib/push";
import { haptic } from "./src/lib/haptics";
import type { Session } from "@supabase/supabase-js";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Retype the WHOLE app to the branded body face in one shot. Every screen's
// <Text>/<TextInput> inherits Plus Jakarta Sans (medium) as its base; hero
// screens then override key text with the display/heavy faces via theme.font.
//
// MUST run exactly once: this is called from render, and it WRAPS
// defaultProps.style — without the guard, every re-render would nest the style
// array one level deeper, and the ever-growing nesting eventually stack-overflows
// React Native's style flattening (crash on a re-render-heavy moment like OAuth).
let fontDefaultsApplied = false;
function applyGlobalFont() {
  if (fontDefaultsApplied) return;
  fontDefaultsApplied = true;
  const T = Text as any, TI = TextInput as any;
  T.defaultProps = T.defaultProps || {};
  T.defaultProps.style = [{ fontFamily: theme.font.medium, color: theme.ink }, T.defaultProps.style];
  T.defaultProps.allowFontScaling = false;
  TI.defaultProps = TI.defaultProps || {};
  TI.defaultProps.style = [{ fontFamily: theme.font.medium }, TI.defaultProps.style];
  TI.defaultProps.allowFontScaling = false;
}

const ICONS: Record<string, [string, string]> = {
  Discover: ["flame", "flame-outline"],
  Matches: ["heart", "heart-outline"],
  Chat: ["chatbubbles", "chatbubbles-outline"],
  Profile: ["person", "person-outline"],
};

// Standard 4-tab layout: Discover (the curated deck) is home.
function Tabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      initialRouteName="Discover"
      screenListeners={{ tabPress: () => haptic.select() }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.gold,
        tabBarInactiveTintColor: theme.muted,
        tabBarShowLabel: false,
        // Grow the bar by the device's bottom inset (gesture pill / nav bar)
        // so icons never sit under the system menu.
        tabBarStyle: {
          backgroundColor: theme.card, borderTopColor: theme.line,
          height: 60 + insets.bottom, paddingTop: 8, paddingBottom: insets.bottom,
          shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 16,
          shadowOffset: { width: 0, height: -6 }, elevation: 12,
        },
        tabBarIcon: ({ color, focused }) => (
          <Ionicons name={(focused ? ICONS[route.name][0] : ICONS[route.name][1]) as any}
            size={25} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Discover" component={DiscoverScreen} />
      <Tab.Screen name="Matches" component={MatchesScreen} />
      <Tab.Screen name="Chat" component={ChatsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: theme.bg, card: theme.card, text: theme.ink, border: theme.line, primary: theme.gold },
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  // null = unknown (loading), false = needs onboarding, true = has profile
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);

  const checkProfile = useCallback(async (s: Session | null) => {
    if (!s) { setHasProfile(null); return; }
    const { data } = await supabase.from("profiles").select("id").eq("id", s.user.id).maybeSingle();
    setHasProfile(!!data);
    if (data) {
      updateGeoCell(s.user.id); // fire-and-forget ~1km cell refresh
      registerPush(s.user.id);  // no-op in Expo Go; live in dev builds
      // Activity signal for the ranker — active users rank higher.
      supabase.from("profiles")
        .update({ last_seen: new Date().toISOString() }).eq("id", s.user.id)
        .then(() => {});
    }
  }, []);

  // Keep last_seen fresh on every foreground — powers "Online / Active today"
  // on profiles and the activity boost in the deck ranker.
  useEffect(() => {
    if (!session || !hasProfile) return;
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") {
        supabase.from("profiles")
          .update({ last_seen: new Date().toISOString() }).eq("id", session.user.id)
          .then(() => {});
      }
    });
    return () => sub.remove();
  }, [session, hasProfile]);

  const [fontsLoaded] = useFonts({
    Unbounded_700Bold, Unbounded_800ExtraBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  if (fontsLoaded) applyGlobalFont();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await checkProfile(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      checkProfile(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [checkProfile]);

  if (!fontsLoaded || !ready || (session && hasProfile === null)) return null;

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <Stack.Navigator screenOptions={{ headerShown: false,
        headerTitleStyle: { fontFamily: theme.font.bold, color: theme.ink },
        headerShadowVisible: false }}>
        {!session ? (
          <Stack.Screen name="Auth" component={AuthScreen} />
        ) : !hasProfile ? (
          <Stack.Screen name="Onboarding">
            {() => <OnboardingScreen onDone={() => setHasProfile(true)} />}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="Tabs" component={Tabs} />
            <Stack.Screen name="Chat" component={ChatScreen}
              options={{ headerShown: true, headerTintColor: theme.ink,
                headerStyle: { backgroundColor: theme.card } }} />
            <Stack.Screen name="MatchProfile" component={MatchProfileScreen}
              options={({ route }: any) => ({ headerShown: true,
                title: route.params?.name ?? "Profile", headerTintColor: theme.ink,
                headerStyle: { backgroundColor: theme.card } })} />
            <Stack.Screen name="Matched" component={MatchedScreen}
              options={{ gestureEnabled: false, animation: "fade" }} />
            <Stack.Screen name="Coins" component={CoinsScreen}
              options={{ headerShown: true, title: "Coins", headerTintColor: theme.ink,
                headerStyle: { backgroundColor: theme.card }, presentation: "modal" }} />
            <Stack.Screen name="Referral" component={ReferralScreen}
              options={{ headerShown: true, title: "Invite & earn", headerTintColor: theme.ink,
                headerStyle: { backgroundColor: theme.card } }} />
            <Stack.Screen name="Transactions" component={TransactionsScreen}
              options={{ headerShown: true, title: "Coin history", headerTintColor: theme.ink,
                headerStyle: { backgroundColor: theme.card } }} />
            <Stack.Screen name="Settings" component={SettingsScreen}
              options={{ headerShown: true, title: "Settings", headerTintColor: theme.ink,
                headerStyle: { backgroundColor: theme.card } }} />
            <Stack.Screen name="Verify" component={VerifyScreen}
              options={{ headerShown: true, title: "Verification", headerTintColor: theme.ink,
                headerStyle: { backgroundColor: theme.card } }} />
            <Stack.Screen name="Paywall" component={PaywallScreen}
              options={{ headerShown: true, title: "Upgrade", headerTintColor: theme.ink,
                headerStyle: { backgroundColor: theme.card }, presentation: "modal" }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
