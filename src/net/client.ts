import type { Intent, IntentResult, Look } from '../engine';
import { isEmoteId, type EmoteId } from './emotes';
import { PROTOCOL_VERSION, type ClientMessage, type ClientState, type HostCommand, type HostMessage, type Pose } from './protocol';
import type { Transport } from './transport';
import type { VoiceChannel } from './voiceRules';

/** The host's answer to a request. */
interface Ack {
  ok: boolean;
  error?: string;
  ticket?: string;
}

export type ClientStatus = 'searching' | 'joining' | 'joined' | 'refused' | 'lost';

export interface ClientSnapshot {
  status: ClientStatus;
  state: ClientState | null;
  /** Local time when `state` arrived; countdowns run from here. */
  receivedAt: number;
  reason: string | null;
  /** Bumped when painted faces arrive, so portraits redraw. */
  facesAt?: number;
}

export interface ClientOptions {
  transport: Transport;
  code: string;
  token: string;
  name: string;
  look: Look;
  /** Your painted face ('' for none). */
  face?: string;
  tower?: boolean;
  /** A ticket from your other device: take over its seat (used once, for the first join). */
  move?: string;
  now?: () => number;
  timeoutMs?: number;
}

export class ClientSession {
  snapshot: ClientSnapshot = { status: 'searching', state: null, receivedAt: 0, reason: null };
  /** Everyone's latest pose (read every frame by the 3D view; never triggers re-renders). */
  readonly poses = new Map<string, Pose>();
  /** Everyone's painted face by player id (missing = plain face). */
  readonly faces = new Map<string, string>();
  /** Everyone's latest gesture, numbered so each one plays once (read every frame by the 3D view). */
  readonly emotes = new Map<string, { emote: EmoteId; seq: number }>();
  private emoteSeq = 0;
  private hostPeer: string | null = null;
  private seq = 0;
  private readonly pending = new Map<number, (ack: Ack) => void>();
  private move: string | null;
  /** The chat channel whose screen you have open (sent again whenever you rejoin). */
  private tuned: VoiceChannel | null = null;
  private readonly listeners = new Set<(snapshot: ClientSnapshot) => void>();
  private readonly offs: (() => void)[] = [];
  private profile: { name: string; look: Look; face: string };
  private readonly now: () => number;

  constructor(private readonly opts: ClientOptions) {
    this.now = opts.now ?? Date.now;
    this.profile = { name: opts.name, look: opts.look, face: opts.face ?? '' };
    this.move = opts.move ?? null;
    this.offs.push(
      opts.transport.onMessage((msg, peerId) => this.received(msg, peerId)),
      opts.transport.onPeerLeave((peerId) => {
        if (peerId !== this.hostPeer) return;
        this.hostPeer = null;
        this.failPending('Lost contact with the host.');
        if (this.snapshot.status !== 'refused') this.update({ status: 'lost' });
      }),
    );
  }

  get playerId(): string | null {
    return this.snapshot.state?.you ?? null;
  }

  subscribe(fn: (snapshot: ClientSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  sendIntent(intent: Intent): Promise<IntentResult> {
    return this.request((seq) => ({ t: 'intent', seq, intent }));
  }

  sendLobbyChat(text: string): Promise<IntentResult> {
    return this.request((seq) => ({ t: 'lobbyChat', seq, text }));
  }

  command(command: HostCommand): Promise<IntentResult> {
    return this.request((seq) => ({ t: 'command', seq, command }));
  }

  /** A ticket to move your seat to another device (it opens the flight's link with it and takes your place). */
  requestMove(): Promise<{ ok: true; ticket: string } | { ok: false; error: string }> {
    return this.ask((seq) => ({ t: 'move', seq })).then((ack) =>
      ack.ok && ack.ticket ? { ok: true, ticket: ack.ticket } : { ok: false, error: ack.error ?? 'Something went wrong.' },
    );
  }

  /** Share where you are looking (fire and forget; the caller throttles). */
  sendPose(pose: Pose): void {
    if (this.hostPeer && this.snapshot.status === 'joined') this.opts.transport.send(this.hostPeer, { t: 'pose', ...pose } satisfies ClientMessage);
  }

  /** The Pilot pressed or let go of the PA button. */
  sendPa(on: boolean): void {
    if (this.hostPeer && this.snapshot.status === 'joined') this.opts.transport.send(this.hostPeer, { t: 'pa', on } satisfies ClientMessage);
  }

  /** Tell the host you turned voice chat on or off (so others know to send you their voices). */
  sendVoice(on: boolean): void {
    if (this.hostPeer && this.snapshot.status === 'joined') this.opts.transport.send(this.hostPeer, { t: 'voice', on } satisfies ClientMessage);
  }

  /** Your seatback chat is open on a channel (or not): your voice goes to that channel instead of the cabin. */
  sendTune(channel: VoiceChannel | null): void {
    if (this.tuned === channel) return;
    this.tuned = channel;
    if (this.hostPeer && this.snapshot.status === 'joined') this.opts.transport.send(this.hostPeer, { t: 'tune', channel } satisfies ClientMessage);
  }

  /** Gesture (the host passes it on if you may). */
  sendEmote(emote: EmoteId): void {
    if (this.hostPeer && this.snapshot.status === 'joined') this.opts.transport.send(this.hostPeer, { t: 'emote', emote } satisfies ClientMessage);
  }

  /** Change your name, look or face while boarding. */
  updateProfile(name: string, look: Look, face = this.profile.face): void {
    this.profile = { name, look, face };
    if (this.snapshot.status === 'joined') this.sendJoin();
  }

  close(): void {
    for (const off of this.offs) off();
    this.failPending('You left the flight.');
    this.listeners.clear();
    this.opts.transport.close();
  }

  private received(raw: unknown, peerId: string): void {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as HostMessage;
    if (msg.t === 'hello') {
      if (msg.code !== this.opts.code || this.snapshot.status === 'refused') return;
      if (this.hostPeer && this.hostPeer !== peerId && this.snapshot.status === 'joined') return;
      if (msg.v !== PROTOCOL_VERSION) {
        this.update({ status: 'refused', reason: 'This flight is running a different version of Flight 13. Reload the page.' });
        return;
      }
      this.hostPeer = peerId;
      this.sendJoin();
      if (this.snapshot.status !== 'joined') this.update({ status: 'joining' });
      return;
    }
    if (peerId !== this.hostPeer) return;
    switch (msg.t) {
      case 'state':
        // (The seat is yours now: from here on your own token finds it.)
        this.move = null;
        this.update({ status: 'joined', state: msg.state, receivedAt: this.now(), reason: null });
        break;
      case 'ack': {
        const resolve = this.pending.get(msg.seq);
        this.pending.delete(msg.seq);
        resolve?.(msg);
        break;
      }
      case 'refused':
        this.move = null;
        this.update({ status: 'refused', reason: msg.reason });
        break;
      case 'faces':
        this.faces.clear();
        for (const [id, face] of Object.entries(msg.faces ?? {})) if (typeof face === 'string') this.faces.set(id, face);
        this.update({ facesAt: this.now() });
        break;
      case 'emote':
        if (typeof msg.from === 'string' && isEmoteId(msg.emote)) this.emotes.set(msg.from, { emote: msg.emote, seq: ++this.emoteSeq });
        break;
      case 'poses':
        // The host always sends everyone's pose, so anyone missing has left.
        for (const id of [...this.poses.keys()]) if (!(id in msg.poses)) this.poses.delete(id);
        for (const [id, [yaw, pitch, lean]] of Object.entries(msg.poses)) this.poses.set(id, { yaw, pitch, lean: lean === 1 });
        break;
    }
  }

  private sendJoin(): void {
    if (!this.hostPeer) return;
    const join: ClientMessage = {
      t: 'join',
      v: PROTOCOL_VERSION,
      token: this.opts.token,
      name: this.profile.name,
      look: this.profile.look,
      face: this.profile.face,
      tower: this.opts.tower ?? false,
      ...(this.move ? { move: this.move } : {}),
    };
    this.opts.transport.send(this.hostPeer, join);
    // (A fresh join is a fresh start for the host: tell it again which screen you have open.)
    if (this.tuned) this.opts.transport.send(this.hostPeer, { t: 'tune', channel: this.tuned } satisfies ClientMessage);
  }

  private request(build: (seq: number) => ClientMessage): Promise<IntentResult> {
    return this.ask(build).then((ack) => (ack.ok ? { ok: true } : { ok: false, error: ack.error ?? 'Something went wrong.' }));
  }

  private ask(build: (seq: number) => ClientMessage): Promise<Ack> {
    const host = this.hostPeer;
    if (!host) return Promise.resolve({ ok: false, error: 'Not connected to the flight right now.' });
    const seq = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(seq)) resolve({ ok: false, error: 'The host did not answer. Try again.' });
      }, this.opts.timeoutMs ?? 8000);
      this.pending.set(seq, (ack) => {
        clearTimeout(timer);
        resolve(ack);
      });
      this.opts.transport.send(host, build(seq));
    });
  }

  private failPending(error: string): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const resolve of waiting) resolve({ ok: false, error });
  }

  private update(patch: Partial<ClientSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const fn of [...this.listeners]) fn(this.snapshot);
  }
}

/** Milliseconds left in the current phase, counted down locally from the last state. */
export function msLeft(snapshot: ClientSnapshot, now: number): number {
  const game = snapshot.state?.game;
  if (!game) return 0;
  // Paused: the clock stands where the captain stopped it.
  if (snapshot.state?.paused) return game.phase.endsInMs;
  return Math.max(0, game.phase.endsInMs - (now - snapshot.receivedAt));
}
