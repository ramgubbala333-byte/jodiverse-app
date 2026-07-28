import * as WebBrowser from "expo-web-browser";
import * as QueryParams from "expo-auth-session/build/QueryParams";
import { makeRedirectUri } from "expo-auth-session";
import { supabase } from "./supabase";

// Finishes any pending auth session (no-op on native, required on web).
WebBrowser.maybeCompleteAuthSession();

// In Expo Go this resolves to exp://<host>:8081; in a standalone build it
// uses the "jodiverse" scheme from app.json. Both must be whitelisted in
// Supabase → Authentication → URL Configuration → Redirect URLs.
const redirectTo = makeRedirectUri();

/** Parse tokens out of the OAuth callback URL and store the session. */
async function createSessionFromUrl(url: string) {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);
  const { access_token, refresh_token } = params;
  if (!access_token) return null;
  const { data, error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (error) throw error;
  return data.session;
}

/**
 * Google sign-in via the system browser. Supabase redirects the browser
 * back to the app with tokens; onAuthStateChange in App.tsx picks up the
 * new session and navigates automatically.
 */
export async function signInWithGoogle() {
  console.log("[auth] redirectTo =", redirectTo);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  console.log("[auth] oauth url =", data.url);

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  console.log("[auth] browser result =", JSON.stringify(result));
  if (result.type === "success") {
    return createSessionFromUrl(result.url);
  }
  return null; // user closed the browser — not an error
}

/**
 * Facebook sign-in — same system-browser OAuth flow as Google.
 * Requires: Supabase → Auth → Providers → Facebook enabled, with a Facebook
 * app (App ID + secret) that has Facebook Login approved. Until then this
 * throws "provider is not enabled" and the UI shows a friendly message.
 */
export async function signInWithFacebook() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "facebook",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === "success") return createSessionFromUrl(result.url);
  return null;
}

/**
 * Phone OTP — step 1: text a 6-digit code to an E.164 number (e.g. +9198…).
 * Requires an SMS provider in Supabase → Auth → Providers → Phone (Twilio /
 * MSG91 for India + DLT). Until configured, this throws and the UI explains.
 */
export async function sendPhoneOtp(phone: string) {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) throw error;
}

/** Phone OTP — step 2: verify the code and create the session. */
export async function verifyPhoneOtp(phone: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) throw error;
  return data.session;
}
