import { getPrefs, personVolume, subscribePrefs } from '../app/prefs';
import type { PlayerSummary, PlayerView } from '../engine';
import { eyePosition, rowZ } from '../world/layout';
import type { ClientSession } from './client';
import type { MediaChannel } from './transport';
import { ZONES, roomImpulse, roomLevel, wallBetween, zoneAt, type Zone } from './acoustics';
import { micOpen, sendsTo, voiceCarry, voiceReach, voiceRoute } from './voiceRules';

export type Vec3 = [number, number, number];

/** Where you hear from: your eyes in the cabin, which way you face, and which way is up. */
export interface ListenerPose {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
}

/** 'on' with a microphone, 'listening' when the microphone was refused (you still hear everyone). */
export type VoiceStatus = 'off' | 'starting' | 'on' | 'listening';

/**
 * One person's voice, three ways to reach you:
 * - in the room: from where they are (panned), duller and quieter the farther off, through any wall between you, with
 *   the echo of the room they are in (`air` → `direct` → `panner`, and `air` → `wet` → that room's reverb);
 * - flat: from everywhere at once, for the lobby, ghosts, after landing, and (band-limited like a headset) a chat
 *   channel's screen (`flat` filters → `flatGain`);
 * - the PA: through the cabin speakers, squeezed and crackling (`pa…` → `paGain`, and into the cabin's echo).
 */
interface Remote {
  stream: MediaStream;
  /** Chrome only feeds a remote WebRTC stream into Web Audio while a media element is playing it. */
  element: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  air: BiquadFilterNode;
  direct: GainNode;
  panner: PannerNode;
  wet: GainNode;
  /** The room whose echo `wet` feeds. */
  room: Zone | null;
  flatLow: BiquadFilterNode;
  flatHigh: BiquadFilterNode;
  flatGain: GainNode;
  paIn: AudioNode;
  paGain: GainNode;
  paWet: GainNode;
  playerId: string | null;
  /** On the PA last tick (for the squelch as the key goes down and comes up). */
  onAir: boolean;
}

const TICK_MS = 100;
const SPEAKING_LEVEL = 0.035;
/** The PA band loses a lot of the voice's energy; this brings it back up to talking level. */
const PA_GAIN = 2.2;
/** The PA's cheap amplifier, driven hard. */
const PA_CURVE = (() => {
  const curve = new Float32Array(2048);
  const drive = 4.5;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    // Asymmetric, like a tired speaker cone.
    curve[i] = Math.tanh(drive * x + 0.12 * x * x) / Math.tanh(drive);
  }
  return curve;
})();

/** Noise for the PA's crackle: sparse pops and ticks over a faint hiss (looped). */
function crackleBuffer(ctx: BaseAudioContext): AudioBuffer {
  const seconds = 2;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < data.length; i++) {
    data[i] = (rand() * 2 - 1) * 0.05;
    // Pops: a sharp spike that rings for a moment.
    if (rand() < 0.0009) {
      const amp = 0.4 + rand() * 0.6;
      for (let k = 0; k < 40 && i + k < data.length; k++) data[i + k] += amp * Math.exp(-k / 6) * (k % 2 ? -1 : 1);
    }
  }
  return buffer;
}

/** The squelch as the PA key goes down or comes up: a click and a short burst of static. */
function squelchBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.12);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 987;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < length; i++) {
    const t = i / ctx.sampleRate;
    data[i] = (rand() * 2 - 1) * Math.exp(-t * 32) * 0.5 + (i < 30 ? (i % 2 ? -0.8 : 0.8) : 0);
  }
  return buffer;
}

/** Your head in the cabin when the 3D view is not telling us: your seat, or the rear galley once restrained. */
function seatPosition(p: PlayerSummary, rows: number): Vec3 {
  if (p.seat) {
    const e = eyePosition(p.seat);
    return [e.x, e.y, e.z];
  }
  return [0, 1.58, rowZ(rows) + 1.1];
}

/** Voice chat is on for this flight (the captain can turn it off). */
export function voiceAllowed(client: ClientSession): boolean {
  return client.snapshot.state?.settings.voiceMode !== 'off';
}

/**
 * Voice chat for one flight: your microphone goes to everyone who may hear it, and every voice you receive plays the
 * way the rules and the plane say (see voiceRules and acoustics): from where that person is, fading with distance
 * and muffled by walls, in the echo of the room they are in; or flat, for the lobby, ghosts, and chat channels.
 */
export class VoiceChat {
  status: VoiceStatus = 'off';
  muted = false;
  /** Holding the talk key or button (push to talk, in the settings). */
  talking = false;
  private micId = '';
  private offPrefs: (() => void) | null = null;
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
  /** Each room's echo, shared by every voice in it. */
  private rooms: Record<Zone, ConvolverNode> | null = null;
  /** The PA's crackle and squelch (one set: only one Pilot talks at a time). */
  private crackle: GainNode | null = null;
  private squelch: AudioBuffer | null = null;

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
    if (this.status !== 'off' || !voiceAllowed(this.client)) return;
    this.setStatus('starting');
    const ctx = new AudioContext();
    this.ctx = ctx;
    await ctx.resume().catch(() => {});
    this.buildRooms(ctx);
    try {
      // (Development builds can stand in a test tone for the microphone.)
      const fake = import.meta.env.DEV ? (globalThis as { __fakeMic?: (ctx: AudioContext) => MediaStream }).__fakeMic?.(ctx) : undefined;
      this.micId = getPrefs().mic;
      const device = this.micId ? { deviceId: { ideal: this.micId } } : {};
      this.mic =
        fake ??
        (await navigator.mediaDevices.getUserMedia({ audio: { ...device, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }));
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
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    addEventListener('blur', this.onBlur);
    // A different microphone picked in the settings: start again with it.
    this.offPrefs = subscribePrefs((prefs) => {
      if (prefs.mic !== this.micId && this.status !== 'off' && this.status !== 'starting') {
        this.stop();
        void this.start();
      } else this.tick();
    });
    this.setStatus(this.mic ? 'on' : 'listening');
    this.tick();
  }

  /** The rooms' echoes, and the PA's crackle (always running, silent until a Pilot is on the air). */
  private buildRooms(ctx: AudioContext): void {
    const rooms = {} as Record<Zone, ConvolverNode>;
    for (const zone of ZONES) {
      const convolver = new ConvolverNode(ctx, { buffer: roomImpulse(ctx, zone), disableNormalization: true });
      convolver.connect(new GainNode(ctx, { gain: roomLevel(zone) })).connect(ctx.destination);
      rooms[zone] = convolver;
    }
    this.rooms = rooms;
    const noise = new AudioBufferSourceNode(ctx, { buffer: crackleBuffer(ctx), loop: true });
    const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2400, Q: 0.9 });
    this.crackle = new GainNode(ctx, { gain: 0 });
    noise.connect(band).connect(this.crackle).connect(ctx.destination);
    this.crackle.connect(rooms.cabin);
    noise.start();
    this.squelch = squelchBuffer(ctx);
  }

  /** The PA key going down or coming up: a click and a burst of static through the speakers. */
  private playSquelch(volume: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.squelch || !this.rooms) return;
    const burst = new AudioBufferSourceNode(ctx, { buffer: this.squelch });
    const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1800, Q: 0.7 });
    const gain = new GainNode(ctx, { gain: 0.5 * volume });
    burst.connect(band).connect(gain).connect(ctx.destination);
    gain.connect(this.rooms.cabin);
    burst.start();
  }

  /** Push to talk: hold to speak (the V key, or the Talk button). */
  setTalking(on: boolean): void {
    if (this.talking === on) return;
    this.talking = on;
    this.tick();
    this.emit();
  }

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyV' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    this.setTalking(e.type === 'keydown');
  };

  private readonly onBlur = () => this.setTalking(false);

  /** Turn voice off: stop sending, stop listening, release the microphone. */
  stop(): void {
    if (this.status === 'off') return;
    this.client.sendVoice(false);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    removeEventListener('blur', this.onBlur);
    this.offPrefs?.();
    this.offPrefs = null;
    this.talking = false;
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
    this.rooms = null;
    this.crackle = null;
    this.squelch = null;
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
      const heard = remote.direct.gain.value > 0.02 || remote.flatGain.gain.value > 0.02 || remote.paGain.gain.value > 0.02;
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
    source.connect(analyser);
    // In the room: dulled by distance and walls, placed by the panner (direction only: loudness is ours), and echoing.
    const air = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 16000, Q: 0.5 });
    const direct = new GainNode(ctx, { gain: 0 });
    const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'linear', rolloffFactor: 0 });
    const wet = new GainNode(ctx, { gain: 0 });
    source.connect(air);
    air.connect(direct).connect(panner).connect(ctx.destination);
    air.connect(wet);
    // Flat: everywhere at once (band-limited like a headset when it is a chat channel).
    const flatHigh = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 20, Q: 0.5 });
    const flatLow = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    const flatGain = new GainNode(ctx, { gain: 0 });
    source.connect(flatHigh).connect(flatLow).connect(flatGain).connect(ctx.destination);
    // The PA: a narrow, honky band squeezed flat and driven into the amplifier, out of the cabin speakers.
    const paHigh = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 380, Q: 0.7 });
    const paLow = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3300, Q: 0.9 });
    const paPeak = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1900, Q: 1.2, gain: 7 });
    const paSqueeze = new DynamicsCompressorNode(ctx, { threshold: -34, knee: 6, ratio: 12, attack: 0.002, release: 0.12 });
    const paGrit = new WaveShaperNode(ctx, { curve: PA_CURVE, oversample: '2x' });
    const paGain = new GainNode(ctx, { gain: 0 });
    const paWet = new GainNode(ctx, { gain: 0.35 });
    source.connect(paHigh).connect(paLow).connect(paPeak).connect(paSqueeze).connect(paGrit).connect(paGain).connect(ctx.destination);
    paGain.connect(paWet);
    if (this.rooms) paWet.connect(this.rooms.cabin);
    const remote: Remote = {
      stream,
      element,
      source,
      analyser,
      air,
      direct,
      panner,
      wet,
      room: null,
      flatLow,
      flatHigh,
      flatGain,
      paIn: paHigh,
      paGain,
      paWet,
      playerId: null,
      onAir: false,
    };
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
    for (const node of [remote.air, remote.direct, remote.panner, remote.wet, remote.flatHigh, remote.flatLow, remote.flatGain, remote.paGain, remote.paWet]) {
      node.disconnect();
    }
    remote.element.srcObject = null;
  }

  /** Apply the rules: who gets your voice, whether your microphone is open, and how loud everyone is (and how). */
  private tick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const state = this.client.snapshot.state;
    // The captain turned voice chat off for this flight.
    if (state && state.settings.voiceMode === 'off') {
      this.stop();
      return;
    }
    const voice = state?.voice ?? {};
    const game = state?.game ?? null;
    const tuned = state?.tuned ?? {};
    const selfId = this.media.selfId;
    // The host forgets you if you reconnect: say again that your voice is on.
    if (!(selfId in voice) && performance.now() - this.announcedAt > 2000 && this.client.snapshot.status === 'joined') {
      this.client.sendVoice(true);
      this.announcedAt = performance.now();
    }
    // Still boarding (the lobby): one big call, everyone hears everyone.
    const lobby = !!state && !game;
    const youId = state?.you ?? null;
    const you = game?.you ?? null;
    const youAlive = you?.status === 'alive';
    const byId = new Map((game?.players ?? []).map((p) => [p.id, p]));
    const nightRange = state?.settings.nightVoiceRange ?? 1;
    // On a chat channel's screen: your voice goes to that channel, not the cabin.
    const myTune = youId ? (tuned[youId] ?? null) : null;

    // Your microphone: open only while the rules let you talk.
    const track = this.mic?.getAudioTracks()[0];
    const prefs = getPrefs();
    const mayTalk = lobby ? !!youId : !!game && !!you && micOpen(game.phase.kind, youAlive, nightRange);
    if (track) track.enabled = !this.muted && (!prefs.pushToTalk || this.talking) && mayTalk;

    // Who gets your voice: everyone in the lobby; on a channel, only the others on it; otherwise whoever may hear it
    // (the living never receive a ghost's).
    if (this.mic) {
      const wanted = new Set<string>();
      for (const [peerId, playerId] of Object.entries(voice)) {
        if (peerId === selfId) continue;
        if (lobby) {
          wanted.add(peerId);
          continue;
        }
        const them = byId.get(playerId);
        if (!game || !you || !them) continue;
        if (myTune) {
          if (tuned[playerId] === myTune) wanted.add(peerId);
        } else if (sendsTo(game.phase.kind, youAlive, them.status === 'alive')) wanted.add(peerId);
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

    // Where you hear from, and the room you are in.
    const listener = this.listener ?? (you && game ? this.seatListener(game, you.id) : null);
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
    const rows = game?.cabin.rows ?? 0;
    const here = listener && game ? zoneAt(listener.position[0], listener.position[2], rows) : 'cabin';

    // How each voice reaches you.
    const t = ctx.currentTime;
    let crackle = 0;
    for (const [peerId, remote] of this.remotes) {
      const playerId = voice[peerId] ?? null;
      remote.playerId = playerId;
      const speaker = playerId ? byId.get(playerId) : undefined;
      let direct = 0;
      let wet = 0;
      let flat = 0;
      let headset = false;
      let cutoff = 16000;
      let at: Vec3 | null = null;
      let room: Zone | null = null;
      // The Pilot on the PA: everyone on board hears him the same, through the cabin speakers.
      const onAir = !!game && !!speaker && state?.pa === speaker.id;
      const theirTune = playerId ? (tuned[playerId] ?? null) : null;
      if (lobby) {
        flat = 1;
      } else if (game && speaker && !onAir) {
        if (theirTune) {
          // Talking on a channel's screen: heard (like a headset) only by the others on it, and nobody around them.
          if (myTune === theirTune) {
            flat = 1;
            headset = true;
          }
        } else {
          const route = voiceRoute(game.phase.kind, speaker.status === 'alive', you ? youAlive : true, nightRange);
          if (route === 'ghosts' || route === 'everyone' || (route && !you)) {
            // (The control tower listens in everywhere at once.)
            flat = 1;
          } else if (route && listener && state) {
            at = this.positionOf?.(speaker.id) ?? seatPosition(speaker, rows);
            const [x, y, z] = listener.position;
            const carry = voiceCarry(at[0] - x, at[1] - y, at[2] - z, voiceReach(state.settings, route));
            room = zoneAt(at[0], at[2], rows);
            const wall = wallBetween(room, here);
            direct = carry.direct * wall.gain;
            wet = carry.wet * wall.gain;
            cutoff = Math.min(carry.cutoff, wall.cutoff);
          }
        }
      }
      // Your settings: everyone's volume, and each person's (0 for someone you muted).
      const volume = prefs.voice * (playerId && state ? personVolume(prefs, state.code, playerId) : 1);
      remote.direct.gain.setTargetAtTime(direct * volume, t, 0.08);
      remote.wet.gain.setTargetAtTime(wet * volume, t, 0.12);
      remote.air.frequency.setTargetAtTime(cutoff, t, 0.1);
      if (room !== remote.room) {
        remote.wet.disconnect();
        if (room && this.rooms) remote.wet.connect(this.rooms[room]);
        remote.room = room;
      }
      remote.flatGain.gain.setTargetAtTime(flat * volume, t, 0.06);
      remote.flatHigh.frequency.setTargetAtTime(headset ? 280 : 20, t, 0.05);
      remote.flatLow.frequency.setTargetAtTime(headset ? 5200 : 20000, t, 0.05);
      remote.paGain.gain.setTargetAtTime(onAir ? PA_GAIN * volume : 0, t, 0.05);
      if (onAir !== remote.onAir) {
        remote.onAir = onAir;
        this.playSquelch(volume);
      }
      // Crackle rides on the Pilot's voice: louder the louder he talks, a faint hiss between words.
      if (onAir) crackle = Math.max(crackle, (0.012 + this.level(remote.analyser) * 0.9) * volume);
      // Voices without a place in the cabin sound from right where you are.
      const [x, y, z] = at ?? listener?.position ?? [0, 0, 0];
      remote.panner.positionX.setTargetAtTime(x, t, 0.05);
      remote.panner.positionY.setTargetAtTime(y, t, 0.05);
      remote.panner.positionZ.setTargetAtTime(z, t, 0.05);
    }
    this.crackle?.gain.setTargetAtTime(crackle, t, 0.03);
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
