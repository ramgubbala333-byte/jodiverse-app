import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// Registers this device's Expo push token so notify-message can reach it.
// Remote push was removed from Expo Go in SDK 53, and merely IMPORTING
// expo-notifications there logs a red-box error — so the module is loaded
// dynamically and only outside Expo Go (EAS dev build / production).
export async function registerPush(userId: string): Promise<void> {
  try {
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      return; // Expo Go — push comes alive automatically in the dev build
    }
    const Notifications = await import("expo-notifications");
    const Device = await import("expo-device");
    if (!Device.isDevice) return;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== "granted") {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== "granted") return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Messages",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await supabase.from("push_tokens").upsert({
      user_id: userId, token, updated_at: new Date().toISOString(),
    });
  } catch {
    // simulator / denied — silently skip
  }
}
