import {
  CHAT_MAX_LENGTH,
  applyIntent,
  botIntents,
  isNightPhase,
  checkTakeoff,
  createGame,
  submitDefaults,
  tick,
  validateSettings,
  viewFor,
  type GameState,
  type Intent,
  type IntentResult,
  type Look,
  type Settings,
} from '../engine';
import {
  NAME_MAX_LENGTH,
  PROTOCOL_VERSION,
  cleanSettings,
  parseClientMessage,
  randomLook,
  type ClientMessage,
  type ClientState,
  type HostCommand,
  type HostMessage,
  type LobbyMessage,
  type Pose,
} from './protocol';
import type { Transport } from './transport';

export interface HostPlayer {
  id: string;
  /** Secret per-browser token used to reconnect; empty for bots. */
  token: string;
  name: string;
  look: Look;
  bot: boolean;
}

/** Everything the host needs to resume a flight after a reload. */
export interface HostSnapshot {
  v: 1;
  code: string;
  hostToken: string;
  controlTower: boolean;
  settings: Settings;
  players: HostPlayer[];
  game: GameState | null;
  lobbyChat: LobbyMessage[];
  nextId: number;
}

export function newHostSnapshot(code: string, hostToken: string, settings: Settings, controlTower: boolean): HostSnapshot {
  return { v: 1, code, hostToken, controlTower, settings: structuredClone(settings), players: [], game: null, lobbyChat: [], nextId: 1 };
}

export interface HostOptions {
  /** Remote passengers (Trystero in the browser). */
  network: Transport;
  /** The host's own client, connected in-page. Only it may send host commands. */
  local: Transport;
  snapshot: HostSnapshot;
  now?: () => number;
  random?: () => number;
  persist?: (snapshot: HostSnapshot) => void;
  /** Deferral used to batch outgoing state (setTimeout by default). */
  defer?: (fn: () => void, ms: number) => void;
}

interface Peer {
  transport: Transport;
  trusted: boolean;
  playerId: string | null;
  tower: boolean;
  lastSent: string;
}

interface BotPlan {
  key: string;
  at: number;
  done: boolean;
}

const LOBBY_GRACE_MS = 20_000;
const LOBBY_CHAT_KEEP = 100;
const LOBBY_CHAT_COOLDOWN_MS = 1000;
const POSE_INTERVAL_MS = 120;
const BOT_NAMES = ['Ada', 'Bea', 'Cal', 'Dex', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lou', 'Max', 'Nia', 'Oz', 'Pip'];
const OK: IntentResult = { ok: true };
const fail = (error: string): IntentResult => ({ ok: false, error });

export class HostSession {
  readonly snapshot: HostSnapshot;
  private readonly network: Transport;
  private readonly local: Transport;
  private readonly peers = new Map<string, Peer>();
  private readonly disconnectedAt = new Map<string, number>();
  private readonly botPlans = new Map<string, BotPlan>();
  private readonly lobbyChatAt = new Map<string, number>();
  private readonly poses = new Map<string, Pose>();
  private posesChanged = false;
  private posesSentAt = -Infinity;
  private readonly botRng = { rng: 1 };
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly persist?: (snapshot: HostSnapshot) => void;
  private readonly defer: (fn: () => void, ms: number) => void;
  private readonly offs: (() => void)[] = [];
  private flushQueued = false;
  private rev = 0;
  private closed = false;

  constructor(opts: HostOptions) {
    this.snapshot = opts.snapshot;
    this.network = opts.network;
    this.local = opts.local;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.persist = opts.persist;
    this.defer = opts.defer ?? ((fn, ms) => void setTimeout(fn, ms));
    this.botRng.rng = Math.floor(this.random() * 2 ** 31);
    this.listen(opts.network, false);
    this.listen(opts.local, true);
  }

  /** Drive timers, bots and lobby clean-up. Call every ~250 ms. */
  tickNow(): void {
    if (this.closed) return;
    const now = this.now();
    const s = this.snapshot;
    let dirty = false;
    if (s.game) {
      if (tick(s.game, now)) {
        this.phaseStarted(now);
        // Night hides who is using their screen, so resend poses at every phase change.
        this.posesChanged = true;
        dirty = true;
      }
      if (this.runBots(s.game, now)) dirty = true;
    } else {
      for (const [id, at] of this.disconnectedAt) {
        if (now - at < LOBBY_GRACE_MS) continue;
        this.disconnectedAt.delete(id);
        const p = this.player(id);
        if (p && p.token !== s.hostToken) {
          s.players = s.players.filter((x) => x.id !== id);
          dirty = true;
        }
      }
    }
    if (dirty) this.changed();
    this.broadcastPoses(now);
  }

  /** Tell everyone the flight is over, then shut down. */
  endFlight(): void {
    for (const peerId of this.peers.keys()) this.refuse(peerId, 'The captain ended this flight.');
    this.defer(() => this.close(), 300);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const off of this.offs) off();
    this.network.close();
    this.local.close();
  }

  /** Send every joined peer its own state, if it changed. */
  flush(): void {
    if (this.closed) return;
    const now = this.now();
    for (const [peerId, peer] of this.peers) {
      if (!peer.playerId && !peer.tower) continue;
      const state = this.stateFor(peer, now);
      const key = JSON.stringify(state.game ? { ...state, game: { ...state.game, phase: { ...state.game.phase, endsInMs: 0 } } } : state);
      if (key === peer.lastSent) continue;
      peer.lastSent = key;
      state.rev = ++this.rev;
      this.sendTo(peerId, { t: 'state', state });
    }
    this.persist?.(this.snapshot);
  }

  private listen(transport: Transport, trusted: boolean): void {
    this.offs.push(
      transport.onPeerJoin((peerId) => this.peerJoined(peerId, transport, trusted)),
      transport.onPeerLeave((peerId) => this.peerLeft(peerId)),
      transport.onMessage((msg, peerId) => this.received(peerId, transport, trusted, msg)),
    );
  }

  private peerJoined(peerId: string, transport: Transport, trusted: boolean): void {
    if (!this.peers.has(peerId)) this.peers.set(peerId, { transport, trusted, playerId: null, tower: false, lastSent: '' });
    this.sendTo(peerId, { t: 'hello', v: PROTOCOL_VERSION, code: this.snapshot.code });
  }

  private peerLeft(peerId: string): void {
    const peer = this.peers.get(peerId);
    this.peers.delete(peerId);
    if (!peer?.playerId || this.isConnected(peer.playerId)) return;
    const now = this.now();
    this.disconnectedAt.set(peer.playerId, now);
    if (this.poses.delete(peer.playerId)) this.posesChanged = true;
    if (this.snapshot.game) submitDefaults(this.snapshot.game, peer.playerId, now);
    this.changed();
  }

  private received(peerId: string, transport: Transport, trusted: boolean, raw: unknown): void {
    if (this.closed) return;
    let peer = this.peers.get(peerId);
    if (!peer) {
      peer = { transport, trusted, playerId: null, tower: false, lastSent: '' };
      this.peers.set(peerId, peer);
    }
    const msg = parseClientMessage(raw);
    if (!msg) return;
    switch (msg.t) {
      case 'join':
        this.join(peerId, peer, msg);
        break;
      case 'intent':
        this.ack(peerId, msg.seq, this.intent(peer, msg.intent));
        break;
      case 'lobbyChat':
        this.ack(peerId, msg.seq, this.lobbyChat(peer, msg.text));
        break;
      case 'command':
        this.ack(peerId, msg.seq, peer.trusted ? this.command(msg.command) : fail('Only the host can do that.'));
        break;
      case 'pose':
        if (peer.playerId) {
          this.poses.set(peer.playerId, { yaw: msg.yaw, pitch: msg.pitch, lean: msg.lean });
          this.posesChanged = true;
        }
        break;
    }
  }

  private broadcastPoses(now: number): void {
    if (!this.posesChanged || now - this.posesSentAt < POSE_INTERVAL_MS) return;
    const night = this.snapshot.game ? isNightPhase(this.snapshot.game.phase.kind) : false;
    const poses: Record<string, [number, number, number]> = {};
    for (const [id, pose] of this.poses) {
      poses[id] = [Math.round(pose.yaw * 1000) / 1000, Math.round(pose.pitch * 1000) / 1000, pose.lean && !night ? 1 : 0];
    }
    for (const [peerId, peer] of this.peers) if (peer.playerId || peer.tower) this.sendTo(peerId, { t: 'poses', poses });
    this.posesSentAt = now;
    this.posesChanged = false;
  }

  private join(peerId: string, peer: Peer, msg: Extract<ClientMessage, { t: 'join' }>): void {
    const s = this.snapshot;
    if (msg.v !== PROTOCOL_VERSION) {
      this.refuse(peerId, 'This flight is running a different version of Flight 13. Reload the page.');
      return;
    }
    if (msg.tower) {
      if (!peer.trusted) {
        this.refuse(peerId, 'Only the host can run the control tower.');
        return;
      }
      peer.tower = true;
      peer.playerId = null;
      peer.lastSent = '';
      this.changed();
      return;
    }
    let player = s.players.find((p) => !p.bot && p.token === msg.token);
    if (!player) {
      if (s.game) return this.refuse(peerId, 'The doors are closed. This flight has already taken off.');
      if (s.players.length >= s.settings.maxPassengers) return this.refuse(peerId, 'This flight is full.');
      player = { id: `p${s.nextId++}`, token: msg.token, name: this.uniqueName(msg.name, null), look: msg.look, bot: false };
      s.players.push(player);
    } else if (!s.game) {
      player.name = this.uniqueName(msg.name, player.id);
      player.look = msg.look;
    }
    for (const [otherId, other] of this.peers) {
      if (otherId !== peerId && other.playerId === player.id) {
        other.playerId = null;
        this.refuse(otherId, 'You joined this flight from another tab.');
      }
    }
    peer.playerId = player.id;
    peer.lastSent = '';
    this.disconnectedAt.delete(player.id);
    this.changed();
  }

  private intent(peer: Peer, intent: Intent): IntentResult {
    const game = this.snapshot.game;
    if (!peer.playerId) return fail('Join the flight first.');
    if (!game) return fail('The flight has not taken off yet.');
    const result = applyIntent(game, peer.playerId, intent, this.now());
    if (result.ok) this.changed();
    return result;
  }

  private lobbyChat(peer: Peer, text: string): IntentResult {
    const player = peer.playerId ? this.player(peer.playerId) : undefined;
    if (!player) return fail('Join the flight first.');
    if (this.snapshot.game) return fail('Use the seatback chat during the flight.');
    const clean = text.trim();
    if (!clean) return fail('Say something first.');
    if (clean.length > CHAT_MAX_LENGTH) return fail(`Keep it under ${CHAT_MAX_LENGTH} characters.`);
    const now = this.now();
    if (now - (this.lobbyChatAt.get(player.id) ?? -Infinity) < LOBBY_CHAT_COOLDOWN_MS) return fail('Slow down a little.');
    this.lobbyChatAt.set(player.id, now);
    const chat = this.snapshot.lobbyChat;
    chat.push({ id: this.snapshot.nextId++, t: now, from: player.id, name: player.name, text: clean });
    if (chat.length > LOBBY_CHAT_KEEP) chat.splice(0, chat.length - LOBBY_CHAT_KEEP);
    this.changed();
    return OK;
  }

  private command(cmd: HostCommand): IntentResult {
    const s = this.snapshot;
    switch (cmd.kind) {
      case 'settings': {
        if (s.game) return fail('Settings are locked once the flight takes off.');
        const settings = cleanSettings(cmd.settings);
        if (!settings) return fail('Those settings are not valid.');
        const error = validateSettings(settings);
        if (error) return fail(error);
        if (settings.maxPassengers < s.players.length) return fail(`There are already ${s.players.length} passengers aboard.`);
        s.settings = settings;
        break;
      }
      case 'takeoff': {
        if (s.game) return fail('Already in the air.');
        const roster = s.players.map(({ id, name, look }) => ({ id, name, look }));
        const error = checkTakeoff(s.settings, roster);
        if (error) return fail(error);
        const now = this.now();
        s.game = createGame({ settings: s.settings, players: roster, seed: Math.floor(this.random() * 2 ** 31), now });
        this.botPlans.clear();
        this.phaseStarted(now);
        break;
      }
      case 'kick': {
        if (s.game) return fail('You cannot remove passengers mid-flight.');
        const target = this.player(cmd.playerId);
        if (!target) return fail('No such passenger.');
        if (!target.bot && target.token === s.hostToken) return fail('You cannot remove yourself.');
        s.players = s.players.filter((p) => p.id !== target.id);
        for (const [peerId, peer] of this.peers) {
          if (peer.playerId !== target.id) continue;
          peer.playerId = null;
          this.refuse(peerId, 'The host removed you from this flight.');
        }
        break;
      }
      case 'addBot': {
        if (s.game) return fail('The doors are closed.');
        if (s.players.length >= s.settings.maxPassengers) return fail('The flight is full.');
        const base = BOT_NAMES[Math.floor(this.random() * BOT_NAMES.length)];
        s.players.push({ id: `p${s.nextId++}`, token: '', name: this.uniqueName(`${base} (bot)`, null), look: randomLook(this.random), bot: true });
        break;
      }
      case 'boardAgain': {
        if (!s.game || s.game.phase.kind !== 'ended') return fail('The flight has not landed yet.');
        s.game = null;
        s.players = s.players.filter((p) => p.bot || this.isConnected(p.id));
        break;
      }
      default:
        return fail('Unknown command.');
    }
    this.changed();
    return OK;
  }

  private phaseStarted(now: number): void {
    const game = this.snapshot.game;
    if (!game) return;
    for (const p of this.snapshot.players) {
      if (!p.bot && !this.isConnected(p.id)) submitDefaults(game, p.id, now);
    }
  }

  private runBots(game: GameState, now: number): boolean {
    const key = `${game.phase.kind}:${game.phase.night}`;
    let acted = false;
    for (const p of this.snapshot.players) {
      if (!p.bot) continue;
      let plan = this.botPlans.get(p.id);
      if (!plan || plan.key !== key) {
        const spread = Math.max(0, Math.min(6000, game.phase.endsAt - now - 1500));
        plan = { key, at: now + 800 + this.random() * spread, done: false };
        this.botPlans.set(p.id, plan);
      }
      if (plan.done || now < plan.at) continue;
      plan.done = true;
      for (const intent of botIntents(game, p.id, this.botRng)) {
        if (applyIntent(game, p.id, intent, now).ok) acted = true;
      }
    }
    return acted;
  }

  private stateFor(peer: Peer, now: number): ClientState {
    const s = this.snapshot;
    return {
      code: s.code,
      you: peer.playerId,
      isHost: peer.trusted,
      controlTower: s.controlTower,
      settings: s.settings,
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        look: p.look,
        bot: p.bot,
        connected: p.bot || this.isConnected(p.id),
        host: !p.bot && p.token === s.hostToken,
      })),
      lobbyChat: s.lobbyChat,
      game: s.game ? viewFor(s.game, peer.tower ? null : peer.playerId, now) : null,
      rev: 0,
    };
  }

  private uniqueName(wanted: string, selfId: string | null): string {
    const taken = new Set(this.snapshot.players.filter((p) => p.id !== selfId).map((p) => p.name.toLowerCase()));
    if (!taken.has(wanted.toLowerCase())) return wanted;
    for (let i = 2; ; i++) {
      const suffix = ` ${i}`;
      const candidate = wanted.slice(0, NAME_MAX_LENGTH - suffix.length) + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private changed(): void {
    if (this.closed || this.flushQueued) return;
    this.flushQueued = true;
    this.defer(() => {
      this.flushQueued = false;
      this.flush();
    }, 16);
  }

  private player(id: string) {
    return this.snapshot.players.find((p) => p.id === id);
  }

  private isConnected(playerId: string): boolean {
    for (const peer of this.peers.values()) if (peer.playerId === playerId) return true;
    return false;
  }

  private ack(peerId: string, seq: number, result: IntentResult): void {
    this.sendTo(peerId, result.ok ? { t: 'ack', seq, ok: true } : { t: 'ack', seq, ok: false, error: result.error });
  }

  private refuse(peerId: string, reason: string): void {
    this.sendTo(peerId, { t: 'refused', reason });
  }

  private sendTo(peerId: string, msg: HostMessage): void {
    this.peers.get(peerId)?.transport.send(peerId, msg);
  }
}
