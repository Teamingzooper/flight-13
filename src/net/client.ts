import type { Intent, IntentResult, Look } from '../engine';
import { PROTOCOL_VERSION, type ClientMessage, type ClientState, type HostCommand, type HostMessage, type Pose } from './protocol';
import type { Transport } from './transport';

export type ClientStatus = 'searching' | 'joining' | 'joined' | 'refused' | 'lost';

export interface ClientSnapshot {
  status: ClientStatus;
  state: ClientState | null;
  /** Local time when `state` arrived; countdowns run from here. */
  receivedAt: number;
  reason: string | null;
}

export interface ClientOptions {
  transport: Transport;
  code: string;
  token: string;
  name: string;
  look: Look;
  tower?: boolean;
  now?: () => number;
  timeoutMs?: number;
}

export class ClientSession {
  snapshot: ClientSnapshot = { status: 'searching', state: null, receivedAt: 0, reason: null };
  /** Everyone's latest pose (read every frame by the 3D view; never triggers re-renders). */
  readonly poses = new Map<string, Pose>();
  private hostPeer: string | null = null;
  private seq = 0;
  private readonly pending = new Map<number, (result: IntentResult) => void>();
  private readonly listeners = new Set<(snapshot: ClientSnapshot) => void>();
  private readonly offs: (() => void)[] = [];
  private profile: { name: string; look: Look };
  private readonly now: () => number;

  constructor(private readonly opts: ClientOptions) {
    this.now = opts.now ?? Date.now;
    this.profile = { name: opts.name, look: opts.look };
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

  /** Share where you are looking (fire and forget; the caller throttles). */
  sendPose(pose: Pose): void {
    if (this.hostPeer && this.snapshot.status === 'joined') this.opts.transport.send(this.hostPeer, { t: 'pose', ...pose } satisfies ClientMessage);
  }

  /** Change your name or look while boarding. */
  updateProfile(name: string, look: Look): void {
    this.profile = { name, look };
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
        this.update({ status: 'joined', state: msg.state, receivedAt: this.now(), reason: null });
        break;
      case 'ack': {
        const resolve = this.pending.get(msg.seq);
        this.pending.delete(msg.seq);
        resolve?.(msg.ok ? { ok: true } : { ok: false, error: msg.error ?? 'Something went wrong.' });
        break;
      }
      case 'refused':
        this.update({ status: 'refused', reason: msg.reason });
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
      tower: this.opts.tower ?? false,
    };
    this.opts.transport.send(this.hostPeer, join);
  }

  private request(build: (seq: number) => ClientMessage): Promise<IntentResult> {
    const host = this.hostPeer;
    if (!host) return Promise.resolve({ ok: false, error: 'Not connected to the flight right now.' });
    const seq = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(seq)) resolve({ ok: false, error: 'The host did not answer. Try again.' });
      }, this.opts.timeoutMs ?? 8000);
      this.pending.set(seq, (result) => {
        clearTimeout(timer);
        resolve(result);
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
  return Math.max(0, game.phase.endsInMs - (now - snapshot.receivedAt));
}
