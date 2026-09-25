import {
  CHAT_MAX_LENGTH,
  applyIntent,
  botIntents,
  isNightPhase,
  checkTakeoff,
  createGame,
  isRoleId,
  submitDefaults,
  tick,
  validateSettings,
  viewFor,
  type GameState,
  type Intent,
  type IntentResult,
  type Look,
  type RoleId,
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
import { EMOTES, EMOTE_COOLDOWN_MS, canEmote, type EmoteId } from './emotes';
import { FACE_TEMPLATES } from './face';
import { BotBrain, TalkLimiter } from '../bots';
import { canPa } from './voiceRules';
import type { Transport } from './transport';
import { TUTORIAL_BOMB_NIGHT, TUTORIAL_CAST, TUTORIAL_WAITS, TUTORIAL_YOU, botName, tutorialCues, type TutorialBot } from '../tutorial/script';

export interface HostPlayer {
  id: string;
  /** Secret per-browser token used to reconnect; empty for bots. */
  token: string;
  name: string;
  look: Look;
  /** Painted face ('' for none); older saves have no field. */
  face?: string;
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
  /** The tutorial flight: scripted bots, fixed roles and seats, and clocks that wait for you (tutorial/script.ts). */
  tutorial?: boolean;
  /** The role the host picked for themselves (kept here, never sent to anyone else). */
  hostRole?: RoleId | null;
}

export function newHostSnapshot(code: string, hostToken: string, settings: Settings, controlTower: boolean, tutorial = false): HostSnapshot {
  const s: HostSnapshot = { v: 1, code, hostToken, controlTower, settings: structuredClone(settings), players: [], game: null, lobbyChat: [], nextId: 1 };
  if (tutorial) {
    s.tutorial = true;
    // The cast boards first; you take the last seat.
    TUTORIAL_CAST.forEach((member, i) => {
      s.players.push({ id: `p${s.nextId++}`, token: '', name: botName(member.name), look: member.look, face: FACE_TEMPLATES[i % FACE_TEMPLATES.length].face, bot: true });
    });
  }
  return s;
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
  /** The faces this peer last received, so it only gets them again when one changes. */
  facesSent: string;
  /** Voice chat is on in this peer's browser. */
  voice?: boolean;
  /** Holding the PA button (only ever set for a living Pilot by day). */
  pa?: boolean;
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
/** Chance per tick (about 4 a second) that a bot gestures during the day: now and then, not constantly. */
const BOT_EMOTE_CHANCE = 0.004;
/** Phases in which bots think and talk (not while packing, boarding, taking off or after landing). */
const BOT_TALK_PHASES: ReadonlySet<string> = new Set(['night_move', 'night_act', 'dawn', 'day_discuss', 'day_vote', 'verdict']);
const BOT_NAMES = [
  'Ada', 'Bea', 'Cal', 'Dex', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lou', 'Max', 'Nia', 'Oz', 'Pip',
  'Ana', 'Ben', 'Dot', 'Gil', 'Kai', 'Liv', 'Moe', 'Ned', 'Ola', 'Rex', 'Sal', 'Tam', 'Uma', 'Vic', 'Wes', 'Zoe',
];
const OK: IntentResult = { ok: true };
const fail = (error: string): IntentResult => ({ ok: false, error });

export class HostSession {
  readonly snapshot: HostSnapshot;
  private readonly network: Transport;
  private readonly local: Transport;
  private readonly peers = new Map<string, Peer>();
  private readonly disconnectedAt = new Map<string, number>();
  private readonly botPlans = new Map<string, BotPlan>();
  /** Each bot's mind (for the current game), when it next thinks, and the limiter they all share. */
  private readonly brains = new Map<string, BotBrain>();
  private brainsFor = '';
  private readonly thinkAt = new Map<string, number>();
  private readonly botTalk = new TalkLimiter();
  /** The tutorial's cues already played this phase. */
  private cueKey = '';
  private readonly cuesPlayed = new Set<number>();
  private readonly lobbyChatAt = new Map<string, number>();
  private readonly poses = new Map<string, Pose>();
  private readonly emotedAt = new Map<string, number>();
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
      this.botEmotes(now);
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
    const faces: Record<string, string> = {};
    for (const p of this.snapshot.players) if (p.face) faces[p.id] = p.face;
    const facesKey = JSON.stringify(faces);
    for (const [peerId, peer] of this.peers) {
      if (!peer.playerId && !peer.tower) continue;
      // Faces first, so portraits have them by the time the state arrives.
      if (peer.facesSent !== facesKey) {
        peer.facesSent = facesKey;
        this.sendTo(peerId, { t: 'faces', faces });
      }
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
    if (!this.peers.has(peerId)) this.peers.set(peerId, { transport, trusted, playerId: null, tower: false, lastSent: '', facesSent: '' });
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
      peer = { transport, trusted, playerId: null, tower: false, lastSent: '', facesSent: '' };
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
      case 'emote':
        if (peer.playerId) this.emote(peer.playerId, msg.emote, this.now());
        break;
      case 'voice':
        if (peer.voice !== msg.on) {
          peer.voice = msg.on;
          this.changed();
        }
        break;
      case 'pa': {
        const on = msg.on && this.mayPa(peer);
        if (!!peer.pa !== on) {
          peer.pa = on;
          this.changed();
        }
        break;
      }
    }
  }

  /** Pass a gesture on to everyone, if it is daytime and the passenger is still in play (and not spamming). */
  private emote(playerId: string, emote: EmoteId, now: number): void {
    const game = this.snapshot.game;
    const p = game?.players.find((x) => x.id === playerId);
    if (!game || !p || !canEmote(game.phase.kind, p.status)) return;
    if (now - (this.emotedAt.get(playerId) ?? -Infinity) < EMOTE_COOLDOWN_MS) return;
    this.emotedAt.set(playerId, now);
    for (const [peerId, peer] of this.peers) if (peer.playerId || peer.tower) this.sendTo(peerId, { t: 'emote', from: playerId, emote });
  }

  /** Bots gesture now and then during the day, so the cabin feels alive. */
  private botEmotes(now: number): void {
    const game = this.snapshot.game;
    if (!game || !canEmote(game.phase.kind, 'alive')) return;
    for (const p of this.snapshot.players) {
      if (p.bot && this.random() < BOT_EMOTE_CHANCE) this.emote(p.id, EMOTES[Math.floor(this.random() * EMOTES.length)].id, now);
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
      peer.facesSent = '';
      this.changed();
      return;
    }
    let player = s.players.find((p) => !p.bot && p.token === msg.token);
    if (!player) {
      if (s.game) return this.refuse(peerId, 'The doors are closed. This flight has already taken off.');
      if (s.players.length >= s.settings.maxPassengers) return this.refuse(peerId, 'This flight is full.');
      player = { id: `p${s.nextId++}`, token: msg.token, name: this.uniqueName(msg.name, null), look: msg.look, face: msg.face, bot: false };
      s.players.push(player);
    } else if (!s.game) {
      player.name = this.uniqueName(msg.name, player.id);
      player.look = msg.look;
      player.face = msg.face;
    }
    for (const [otherId, other] of this.peers) {
      if (otherId !== peerId && other.playerId === player.id) {
        other.playerId = null;
        this.refuse(otherId, 'You joined this flight from another tab.');
      }
    }
    peer.playerId = player.id;
    peer.lastSent = '';
    peer.facesSent = '';
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
        // The host may have picked their own role (not in the tutorial, which casts everyone).
        const captain = s.players.find((p) => !p.bot && p.token === s.hostToken);
        const chosen = s.hostRole && captain && !s.tutorial ? { player: captain.id, role: s.hostRole } : undefined;
        s.game = createGame({ settings: s.settings, players: roster, seed: Math.floor(this.random() * 2 ** 31), now, chosen });
        if (s.tutorial) this.castTutorial(s.game);
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
        // A first name nobody aboard has (bots are talked to by name), while there are any left.
        const taken = new Set(s.players.map((p) => p.name.split(' ')[0].toLowerCase()));
        const free = BOT_NAMES.filter((n) => !taken.has(n.toLowerCase()));
        const names = free.length > 0 ? free : BOT_NAMES;
        const base = names[Math.floor(this.random() * names.length)];
        const face = FACE_TEMPLATES[Math.floor(this.random() * FACE_TEMPLATES.length)].face;
        s.players.push({ id: `p${s.nextId++}`, token: '', name: this.uniqueName(`${base} (bot)`, null), look: randomLook(this.random, true), face, bot: true });
        break;
      }
      case 'myRole': {
        if (s.game) return fail('Roles are dealt once the doors close.');
        if (cmd.role !== null && !isRoleId(cmd.role)) return fail('Unknown role.');
        s.hostRole = cmd.role;
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

  /**
   * The tutorial's cast: everyone gets their scripted role and seat (you: a Passenger, next to the Bomber), and the
   * Bomber boards with her bomb already under her seat, so your flashlight can find it on the first night.
   */
  private castTutorial(game: GameState): void {
    for (const p of game.players) {
      const member = TUTORIAL_CAST.find((m) => botName(m.name) === p.name);
      const bot = this.player(p.id)?.bot;
      const place = member ?? (bot ? null : TUTORIAL_YOU);
      if (!place) continue;
      p.role = place.role;
      p.seat = place.seat;
      if (p.role === 'bomber') {
        p.bombsPlanted = 1;
        game.bombs.push({
          id: 'bomb-tutorial',
          planterId: p.id,
          location: { kind: 'seat', seat: p.seat },
          plantedNight: 0,
          detonateNight: TUTORIAL_BOMB_NIGHT,
          exploded: false,
          explodedAt: null,
          defused: false,
        });
      }
    }
  }

  private phaseStarted(now: number): void {
    const game = this.snapshot.game;
    if (!game) return;
    // The tutorial waits for you: no clock runs out on a step you are still reading (you, and the bots' cues, end it).
    if (this.snapshot.tutorial && TUTORIAL_WAITS.has(game.phase.kind)) game.phase.endsAt = Math.max(game.phase.endsAt, now + 30 * 60_000);
    // A new phase ends any announcement: the Pilot presses the PA button again to speak.
    for (const peer of this.peers.values()) peer.pa = false;
    for (const p of this.snapshot.players) {
      if (!p.bot && !this.isConnected(p.id)) submitDefaults(game, p.id, now);
    }
  }

  private brain(game: GameState, id: string): BotBrain {
    if (this.brainsFor !== game.id) {
      this.brains.clear();
      this.thinkAt.clear();
      this.brainsFor = game.id;
    }
    let brain = this.brains.get(id);
    if (!brain) {
      brain = new BotBrain(id, Math.floor(this.random() * 2 ** 31));
      this.brains.set(id, brain);
    }
    return brain;
  }

  /** The tutorial's bots play their cues (tutorial/script.ts), each once, at its time into the phase. */
  private runTutorialBots(game: GameState, now: number): boolean {
    const key = `${game.id}:${game.phase.kind}:${game.phase.night}`;
    if (this.cueKey !== key) {
      this.cueKey = key;
      this.cuesPlayed.clear();
    }
    const ids = (who: TutorialBot | 'you') =>
      who === 'you' ? (this.snapshot.players.find((p) => !p.bot)?.id ?? '') : (this.snapshot.players.find((p) => p.name === botName(who))?.id ?? '');
    let acted = false;
    tutorialCues(game.phase.kind, game.phase.night).forEach((cue, i) => {
      if (this.cuesPlayed.has(i) || now < game.phase.startedAt + cue.after) return;
      this.cuesPlayed.add(i);
      const id = ids(cue.bot);
      if (!id) return;
      if (cue.intent && applyIntent(game, id, cue.intent(ids), now).ok) acted = true;
      if (cue.say && applyIntent(game, id, { kind: 'chat', channel: cue.say.channel, text: cue.say.text }, now).ok) acted = true;
    });
    return acted;
  }

  private runBots(game: GameState, now: number): boolean {
    if (this.snapshot.tutorial) return this.runTutorialBots(game, now);
    const key = `${game.phase.kind}:${game.phase.night}`;
    const talking = BOT_TALK_PHASES.has(game.phase.kind);
    let acted = false;
    const apply = (id: string, intent: Intent) => {
      if (applyIntent(game, id, intent, now).ok) acted = true;
    };
    for (const p of this.snapshot.players) {
      if (!p.bot) continue;
      let plan = this.botPlans.get(p.id);
      if (!plan || plan.key !== key) {
        const spread = Math.max(0, Math.min(6000, game.phase.endsAt - now - 1500));
        plan = { key, at: now + 800 + this.random() * spread, done: false };
        this.botPlans.set(p.id, plan);
      }
      // The phase's plan: random legal choices, made smarter by the bot's brain (its vote, its aim, orders).
      if (!plan.done && now >= plan.at) {
        plan.done = true;
        const planned = botIntents(game, p.id, this.botRng);
        for (const intent of talking ? this.brain(game, p.id).adjust(viewFor(game, p.id, now), planned, now) : planned) apply(p.id, intent);
      }
      // About once a second the bot thinks: follows orders, answers people, says what it has to say.
      if (!talking || now < (this.thinkAt.get(p.id) ?? 0)) continue;
      this.thinkAt.set(p.id, now + 900 + this.random() * 400);
      const turn = this.brain(game, p.id).think(viewFor(game, p.id, now), now, this.botTalk);
      for (const intent of turn.intents) apply(p.id, intent);
      for (const line of turn.chat) apply(p.id, { kind: 'chat', channel: line.channel, text: line.text });
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
      voice: this.voicePeers(),
      pa: this.paSpeaker(),
      ...(s.tutorial ? { tutorial: true } : {}),
      // The host's own pick goes to the host alone; everyone else only learns that there is one.
      ...(peer.trusted ? { myRole: s.hostRole ?? null } : {}),
      ...(s.hostRole && !s.tutorial ? { hostPicksRole: true } : {}),
    };
  }

  /** May this peer's passenger speak on the PA right now? */
  private mayPa(peer: Peer): boolean {
    const game = this.snapshot.game;
    const p = game?.players.find((x) => x.id === peer.playerId);
    return !!game && !!p && canPa(p.role, p.status, game.phase.kind);
  }

  /** Who is on the PA (the rules are checked again, in case he died or the day ended since he pressed it). */
  private paSpeaker(): string | null {
    for (const peer of this.peers.values()) if (peer.pa && this.mayPa(peer)) return peer.playerId;
    return null;
  }

  /** Everyone with voice on, by the id their browser has on the network (this browser's own seat included). */
  private voicePeers(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [peerId, peer] of this.peers) {
      if (!peer.voice || !peer.playerId) continue;
      map[peer.transport === this.network ? peerId : this.network.selfId] = peer.playerId;
    }
    return map;
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
