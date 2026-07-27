// Voice transport — the ONLY file that knows how audio actually moves.
//
// Today it runs in "simulated" mode so the entire product (queue, matching,
// call flow, feedback, reveal) is testable in Expo Go. Live audio needs
// react-native-webrtc, which needs a dev build; when that lands, implement
// WebRtcTransport below and flip TRANSPORT. Nothing else in the app changes.
//
// Signaling rides Supabase Realtime broadcast on `call:<room>` — no third
// party, no per-minute bill. STUN is Google's public server; ~10-15% of
// mobile-to-mobile connections behind symmetric NAT will also need TURN.

import { supabase } from "./supabase";

export type CallState = "connecting" | "ringing" | "active" | "ended";

export type VoiceEvents = {
  onState: (s: CallState) => void;
  onRemoteJoined?: () => void;
  onRemoteLeft?: () => void;
  /** 0..1 loudness of the remote speaker, for the speaking orb. */
  onLevel?: (level: number) => void;
};

export interface VoiceTransport {
  join(room: string, isCaller: boolean, ev: VoiceEvents): Promise<void>;
  setMuted(muted: boolean): void;
  setSpeaker(on: boolean): void;
  leave(): Promise<void>;
}

// ── Signaling (shared by every transport) ─────────────────────────────────
// Presence tells us when the other side arrives/leaves; broadcast carries
// SDP offers/answers and ICE candidates once WebRTC is wired.
export function signalChannel(room: string) {
  return supabase.channel(`call:${room}`, {
    config: { broadcast: { self: false }, presence: { key: "" } },
  });
}

// ── Simulated transport (Expo Go) ─────────────────────────────────────────
// Real presence and real signaling — only the audio stream is absent. Both
// devices genuinely see each other connect, so the whole flow is testable.
class SimulatedTransport implements VoiceTransport {
  private ch: ReturnType<typeof signalChannel> | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private ev: VoiceEvents | null = null;

  async join(room: string, _isCaller: boolean, ev: VoiceEvents) {
    this.ev = ev;
    ev.onState("connecting");
    const { data: { user } } = await supabase.auth.getUser();
    const ch = signalChannel(room);
    this.ch = ch;

    ch.on("presence", { event: "sync" }, () => {
      const n = Object.keys(ch.presenceState()).length;
      if (n >= 2) { ev.onRemoteJoined?.(); ev.onState("active"); this.startLevels(); }
    });
    ch.on("presence", { event: "leave" }, () => {
      ev.onRemoteLeft?.();
      ev.onState("ended");
    });

    await ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ uid: user?.id, at: Date.now() });
        ev.onState("ringing");
      }
    });
  }

  // Fake speaking levels so the orb animates during testing.
  private startLevels() {
    if (this.levelTimer) return;
    this.levelTimer = setInterval(() => {
      this.ev?.onLevel?.(Math.random() * 0.7 + 0.15);
    }, 220);
  }

  setMuted(_muted: boolean) { /* no stream to mute in simulation */ }
  setSpeaker(_on: boolean) { /* no audio route in simulation */ }

  async leave() {
    if (this.levelTimer) { clearInterval(this.levelTimer); this.levelTimer = null; }
    if (this.ch) { await supabase.removeChannel(this.ch); this.ch = null; }
    this.ev?.onState("ended");
    this.ev = null;
  }
}

// ── WebRTC transport (after `npx expo run:android`) ───────────────────────
// Implementation sketch — uncomment the import and body once
// react-native-webrtc is installed in a dev build.
//
// import { RTCPeerConnection, mediaDevices } from "react-native-webrtc";
//
// const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
//
// class WebRtcTransport implements VoiceTransport {
//   private pc: RTCPeerConnection | null = null;
//   private stream: any = null;
//   private ch: ReturnType<typeof signalChannel> | null = null;
//
//   async join(room: string, isCaller: boolean, ev: VoiceEvents) {
//     ev.onState("connecting");
//     this.stream = await mediaDevices.getUserMedia({ audio: true, video: false });
//     this.pc = new RTCPeerConnection(ICE);
//     this.stream.getTracks().forEach((t: any) => this.pc!.addTrack(t, this.stream));
//     const ch = signalChannel(room);
//     this.ch = ch;
//     this.pc.addEventListener("icecandidate", (e: any) => {
//       if (e.candidate) ch.send({ type: "broadcast", event: "ice", payload: e.candidate });
//     });
//     this.pc.addEventListener("connectionstatechange", () => {
//       if (this.pc?.connectionState === "connected") ev.onState("active");
//       if (this.pc?.connectionState === "disconnected") ev.onState("ended");
//     });
//     ch.on("broadcast", { event: "offer" }, async ({ payload }) => {
//       await this.pc!.setRemoteDescription(payload);
//       const ans = await this.pc!.createAnswer();
//       await this.pc!.setLocalDescription(ans);
//       ch.send({ type: "broadcast", event: "answer", payload: ans });
//     });
//     ch.on("broadcast", { event: "answer" }, async ({ payload }) =>
//       this.pc!.setRemoteDescription(payload));
//     ch.on("broadcast", { event: "ice" }, async ({ payload }) =>
//       this.pc!.addIceCandidate(payload));
//     await ch.subscribe(async (s) => {
//       if (s !== "SUBSCRIBED") return;
//       ev.onState("ringing");
//       if (isCaller) {
//         const offer = await this.pc!.createOffer({});
//         await this.pc!.setLocalDescription(offer);
//         ch.send({ type: "broadcast", event: "offer", payload: offer });
//       }
//     });
//   }
//   setMuted(m: boolean) {
//     this.stream?.getAudioTracks().forEach((t: any) => { t.enabled = !m; });
//   }
//   setSpeaker(_on: boolean) { /* InCallManager.setSpeakerphoneOn(on) */ }
//   async leave() {
//     this.stream?.getTracks().forEach((t: any) => t.stop());
//     this.pc?.close(); this.pc = null;
//     if (this.ch) { await supabase.removeChannel(this.ch); this.ch = null; }
//   }
// }

/** Flip to WebRtcTransport once react-native-webrtc is in a dev build. */
export const VOICE_MODE: "simulated" | "webrtc" = "simulated";
export const createTransport = (): VoiceTransport => new SimulatedTransport();
