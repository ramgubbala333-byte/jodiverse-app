import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// What a push tap should open. Kept as a plain object so App.tsx can hand it
// to the navigation ref without this module importing navigation.
export type PushTarget = { matchId: string; name: string; otherId?: string };

function targetFrom(data: any): PushTarget | null {
  if (!data?.matchId) return null;
  return { matchId: String(data.matchId), name: String(data.name ?? "Chat"),
    otherId: data.otherId ? String(data.otherId) : undefined };
}

const isExpoGo = () =>
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Registers this device's Expo push token so notify-message can reach it.
// Remote push was removed from Expo Go in SDK 53, and merely IMPORTING
// expo-notifications there logs a red-box error — so the module is loaded
// dynamically and only outside Expo Go (EAS dev build / production).
export async function registerPush(userId: string): Promise<void> {
  try {
    if (isExpoGo()) return; // push comes alive automatically in the dev build
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

    // In a bare/EAS build getExpoPushTokenAsync THROWS unless it can resolve
    // the EAS project id. It reads app config in most cases, but that lookup
    // is unreliable in release builds, so pass it explicitly.
    const projectId =
      (Constants.expoConfig as any)?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;

    const token = (await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    )).data;
    await supabase.from("push_tokens").upsert({
      user_id: userId, token, updated_at: new Date().toISOString(),
    });
  } catch {
    // simulator / denied / no project id — silently skip, push is not critical
  }
}

// Foreground behaviour + tap routing. Returns a cleanup function.
//
// Two paths matter and both must be handled or taps silently do nothing:
//   • app was KILLED  → getLastNotificationResponseAsync() (fires once)
//   • app was alive   → addNotificationResponseReceivedListener
export function attachPushHandlers(open: (t: PushTarget) => void): () => void {
  if (isExpoGo()) return () => {};
  let cancelled = false;
  const subs: { remove: () => void }[] = [];

  (async () => {
    try {
      const Notifications = await import("expo-notifications");
      if (cancelled) return;

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });

      // Cold start from a tap.
      const last = await Notifications.getLastNotificationResponseAsync();
      const coldTarget = targetFrom(last?.notification?.request?.content?.data);
      if (coldTarget && !cancelled) open(coldTarget);

      subs.push(Notifications.addNotificationResponseReceivedListener((res) => {
        const t = targetFrom(res.notification.request.content.data);
        if (t) open(t);
      }));
    } catch {
      // module unavailable — nothing to attach
    }
  })();

  return () => { cancelled = true; subs.forEach((s) => s.remove()); };
}

// Called on sign-out. A token left behind keeps delivering the previous
// account's messages to this device — a real privacy leak on a shared phone.
export async function unregisterPush(userId: string): Promise<void> {
  try {
    await supabase.from("push_tokens").delete().eq("user_id", userId);
  } catch {
    /* best effort */
  }
}
