import type { PlayerSummary, PlayerView } from '../engine';
import { eyePosition, rowZ } from '../world/layout';
import type { ClientSession } from './client';
import type { MediaChannel } from './transport';
import { micOpen, proximityGain, sendsTo, voiceRoute } from './voiceRules';

export type Vec3 = [number, number, number];

/** Where you hear from: your eyes in the cabin, which way you face, and which way is up. */
export interface ListenerPose {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
}

/** 'on' with a microphone, 'listening' when the microphone was refused (you still hear everyone). */
export type VoiceStatus = 'off' | 'starting' | 'on' | 'listening';

interface Remote {
  stream: MediaStream;
  /** Chrome only feeds a remote WebRTC stream into Web Audio while a media element is playing it. */
  element: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  gain: GainNode;
  panner: PannerNode;
  /** The PA path: the same voice through the cabin speakers (a thin band, a little grit, no direction). */
  paBand: BiquadFilterNode;
  paGrit: WaveShaperNode;
  paGain: GainNode;
  playerId: string | null;
}

const TICK_MS = 100;
const SPEAKING_LEVEL = 0.035;
/** The PA band loses a lot of the voice's energy; this brings it back up to talking level. */
const PA_GAIN = 1.6;
/** A soft clip for the PA's cheap speakers. */
const PA_CURVE = (() => {
  const curve = new Float32Array(1024);
  const drive = 2.5;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return curve;
})();

/** Your head in the cabin when the 3D view is not telling us: your seat, or the rear galley once restrained. */
function seatPosition(p: PlayerSummary, rows: number): Vec3 {
  if (p.seat) {
    const e = eyePosition(p.seat);
    return [e.x, e.y, e.z];
  }
  return [0, 1.58, rowZ(rows) + 1.1];
}

/**
 * Proximity voice chat for one flight: your microphone goes to everyone who may hear it (peer to peer,
 * never through the host), and every voice you receive plays from where that person sits, louder the
 * closer they are, following the chat rules (see voiceRules).
 */
export class VoiceChat {
  status: VoiceStatus = 'off';
  muted = false;
  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private readonly remotes = new Map<string, Remote>();
  private readonly sentTo = new Set<string>();
  private listener: ListenerPose | null = null;
  private positionOf: ((playerId: string) => Vec3 | null) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private offStream: (() => void) | null = null;
  private announcedAt = -Infinity;
  private readonly changes = new Set<() => void>();
  private readonly buffer = new Float32Array(512);

  constructor(
    private readonly client: ClientSession,
    private readonly media: { channel: MediaChannel; selfId: string },
  ) {}

  /** Hear when the status or mute changes (for buttons). */
  subscribe(fn: () => void): () => void {
    this.changes.add(fn);
    return () => void this.changes.delete(fn);
  }

  /** Turn voice on (call from a click: browsers only allow sound and microphones after one). */
  async start(): Promise<void> {
    if (this.status !== 'off') return;
    this.setStatus('starting');
    const ctx = new AudioContext();
    this.ctx = ctx;
    await ctx.resume().catch(() => {});
    try {
      // (Development builds can stand in a test tone for the microphone.)
      const fake = import.meta.env.DEV ? (globalThis as { __fakeMic?: (ctx: AudioContext) => MediaStream }).__fakeMic?.(ctx) : undefined;
      this.mic =
        fake ?? (await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }));
      this.micAnalyser = ctx.createAnalyser();
      this.micAnalyser.fftSize = 512;
      ctx.createMediaStreamSource(this.mic).connect(this.micAnalyser);
    } catch {
      this.mic = null;
    }
    if (this.ctx !== ctx) return; // Stopped while the browser was asking about the microphone.
    this.offStream = this.media.channel.onPeerStream((stream, peerId) => this.attach(stream, peerId));
    this.client.sendVoice(true);
    this.announcedAt = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.setStatus(this.mic ? 'on' : 'listening');
    this.tick();
  }

  /** Turn voice off: stop sending, stop listening, release the microphone. */
  stop(): void {
    if (this.status === 'off') return;
    this.client.sendVoice(false);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.offStream?.();
    this.offStream = null;
    if (this.mic) for (const peerId of this.sentTo) this.media.channel.removeStream(this.mic, peerId);
    this.sentTo.clear();
    for (const track of this.mic?.getTracks() ?? []) track.stop();
    this.mic = null;
    this.micAnalyser = null;
    for (const remote of this.remotes.values()) this.detach(remote);
    this.remotes.clear();
    void this.ctx?.close();
    this.ctx = null;
    this.setStatus('off');
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.tick();
    this.emit();
  }

  /** Where you are listening from (the 3D camera, every frame). */
  setListener(pose: ListenerPose | null): void {
    this.listener = pose;
  }

  /** Where each person's head is (the 3D view knows exactly; otherwise their seat is used). */
  setPositionSource(fn: ((playerId: string) => Vec3 | null) | null): void {
    this.positionOf = fn;
  }

  /** Who is talking right now (you included, by your microphone), for speaking badges. */
  speaking(): Set<string> {
    const out = new Set<string>();
    if (!this.ctx) return out;
    for (const remote of this.remotes.values()) {
      const heard = remote.gain.gain.value > 0.02 || remote.paGain.gain.value > 0.02;
      if (remote.playerId && heard && this.level(remote.analyser) > SPEAKING_LEVEL) out.add(remote.playerId);
    }
    const you = this.client.playerId;
    if (you && this.micAnalyser && this.mic?.getAudioTracks()[0]?.enabled && this.level(this.micAnalyser) > SPEAKING_LEVEL) out.add(you);
    return out;
  }

  private level(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (const v of this.buffer) sum += v * v;
    return Math.sqrt(sum / this.buffer.length);
  }

  private attach(stream: MediaStream, peerId: string): void {
    const ctx = this.ctx;
    if (!ctx || stream.getAudioTracks().length === 0) return;
    const old = this.remotes.get(peerId);
    if (old?.stream === stream) return;
    if (old) this.detach(old);
    const element = new Audio();
    element.srcObject = stream;
    element.muted = true;
    void element.play().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    // Direction only: loudness by distance is ours (see proximityGain).
    const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'linear', rolloffFactor: 0 });
    source.connect(analyser);
    source.connect(gain).connect(panner).connect(ctx.destination);
    const paBand = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1700, Q: 0.8 });
    const paGrit = new WaveShaperNode(ctx, { curve: PA_CURVE, oversample: '2x' });
    const paGain = new GainNode(ctx, { gain: 0 });
    source.connect(paBand).connect(paGrit).connect(paGain).connect(ctx.destination);
    const remote: Remote = { stream, element, source, analyser, gain, panner, paBand, paGrit, paGain, playerId: null };
    this.remotes.set(peerId, remote);
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (this.remotes.get(peerId) !== remote) return;
        this.detach(remote);
        this.remotes.delete(peerId);
      });
    }
    this.tick();
  }

  private detach(remote: Remote): void {
    remote.source.disconnect();
    remote.gain.disconnect();
    remote.panner.disconnect();
    remote.paBand.disconnect();
    remote.paGrit.disconnect();
    remote.paGain.disconnect();
    remote.element.srcObject = null;
  }

  /** Apply the rules: who gets your voice, whether your microphone is open, and how loud everyone is. */
  private tick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const state = this.client.snapshot.state;
    const voice = state?.voice ?? {};
    const game = state?.game ?? null;
    const selfId = this.media.selfId;
    // The host forgets you if you reconnect: say again that your voice is on.
    if (!(selfId in voice) && performance.now() - this.announcedAt > 2000 && this.client.snapshot.status === 'joined') {
      this.client.sendVoice(true);
      this.announcedAt = performance.now();
    }
    const you = game?.you ?? null;
    const youAlive = you?.status === 'alive';
    const byId = new Map((game?.players ?? []).map((p) => [p.id, p]));

    // Your microphone: open only while the rules let you talk.
    const track = this.mic?.getAudioTracks()[0];
    if (track) track.enabled = !this.muted && !!game && !!you && micOpen(game.phase.kind, youAlive);

    // Who gets your voice (the living never receive a ghost's).
    if (this.mic) {
      const wanted = new Set<string>();
      if (game && you) {
        for (const [peerId, playerId] of Object.entries(voice)) {
          const them = byId.get(playerId);
          if (peerId !== selfId && them && sendsTo(game.phase.kind, youAlive, them.status === 'alive')) wanted.add(peerId);
        }
      }
      for (const peerId of this.sentTo) {
        // A dropped connection loses the stream: send it again once they are back.
        if (!this.media.channel.isConnected(peerId)) this.sentTo.delete(peerId);
        else if (!wanted.has(peerId)) {
          this.media.channel.removeStream(this.mic, peerId);
          this.sentTo.delete(peerId);
        }
      }
      // (No direct connection to someone yet: try again next time round.)
      for (const peerId of wanted) if (!this.sentTo.has(peerId) && this.media.channel.addStream(this.mic, peerId)) this.sentTo.add(peerId);
    }

    // Where you hear from.
    const listener = this.listener ?? (you ? this.seatListener(game!, you.id) : null);
    const l = ctx.listener;
    if (listener) {
      const [px, py, pz] = listener.position;
      const [fx, fy, fz] = listener.forward;
      const [ux, uy, uz] = listener.up;
      if (l.positionX) {
        l.positionX.value = px;
        l.positionY.value = py;
        l.positionZ.value = pz;
        l.forwardX.value = fx;
        l.forwardY.value = fy;
        l.forwardZ.value = fz;
        l.upX.value = ux;
        l.upY.value = uy;
        l.upZ.value = uz;
      } else {
        l.setPosition(px, py, pz);
        l.setOrientation(fx, fy, fz, ux, uy, uz);
      }
    }

    // How loud, and from where, each voice plays.
    for (const [peerId, remote] of this.remotes) {
      const playerId = voice[peerId] ?? null;
      remote.playerId = playerId;
      const speaker = playerId ? byId.get(playerId) : undefined;
      let gain = 0;
      let at: Vec3 | null = null;
      // The Pilot on the PA: everyone on board hears him the same, through the cabin speakers.
      const onAir = !!game && !!speaker && state?.pa === speaker.id;
      if (game && speaker && !onAir) {
        // The control tower listens in on the cabin as if it were everywhere at once.
        const route = you ? voiceRoute(game.phase.kind, speaker.status === 'alive', youAlive) : voiceRoute(game.phase.kind, speaker.status === 'alive', true);
        if (route === 'ghosts' || route === 'everyone' || (route === 'cabin' && !you)) {
          gain = 1;
        } else if (route === 'cabin' && listener) {
          at = this.positionOf?.(speaker.id) ?? seatPosition(speaker, game.cabin.rows);
          const [x, y, z] = listener.position;
          gain = proximityGain(Math.hypot(at[0] - x, at[1] - y, at[2] - z));
        }
      }
      remote.gain.gain.setTargetAtTime(gain, ctx.currentTime, 0.08);
      remote.paGain.gain.setTargetAtTime(onAir ? PA_GAIN : 0, ctx.currentTime, 0.05);
      // Voices without a place in the cabin sound from right where you are.
      const [x, y, z] = at ?? listener?.position ?? [0, 0, 0];
      remote.panner.positionX.setTargetAtTime(x, ctx.currentTime, 0.05);
      remote.panner.positionY.setTargetAtTime(y, ctx.currentTime, 0.05);
      remote.panner.positionZ.setTargetAtTime(z, ctx.currentTime, 0.05);
    }
  }

  /** Listening from your seat, facing forward (when there is no 3D view). */
  private seatListener(game: PlayerView, youId: string): ListenerPose | null {
    const you = game.players.find((p) => p.id === youId);
    if (!you) return null;
    return { position: seatPosition(you, game.cabin.rows), forward: [0, 0, -1], up: [0, 1, 0] };
  }

  private setStatus(status: VoiceStatus): void {
    this.status = status;
    this.emit();
  }

  private emit(): void {
    for (const fn of [...this.changes]) fn();
  }
}

const chats = new Map<string, VoiceChat>();

/** The voice chat for a flight (created on first use; one per flight, whichever screen you are on). */
export function voiceFor(code: string, client: ClientSession, media: { channel: MediaChannel; selfId: string } | null): VoiceChat | null {
  if (!media) return null;
  let chat = chats.get(code);
  if (!chat) {
    chat = new VoiceChat(client, media);
    chats.set(code, chat);
    if (import.meta.env.DEV) (globalThis as { f13voice?: VoiceChat }).f13voice = chat;
  }
  return chat;
}

/** Leaving a flight ends its voice chat. */
export function stopVoice(code: string): void {
  chats.get(code)?.stop();
  chats.delete(code);
}
