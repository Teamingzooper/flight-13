# Flight 13 — Milestone 2: Online Play in 2D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Friends can book, board and play a complete Flight 13 game in their browsers through the seatback-TV interface (2D), hosted on GitHub Pages with peer-to-peer networking.

**Architecture:** `src/net/` adds a host-authoritative session layer on top of the Milestone 1 engine: the host's browser runs `HostSession` (owns the `GameState`, validates intents, runs timers and bots, persists to `localStorage`) and every player — including the host, through an in-page link — runs a `ClientSession` that receives only its own redacted `ClientState`. Transports are abstracted: `MemoryHub` for tests and the host's local link, Trystero (WebRTC + Nostr signaling) in production. `src/app/` (routing, booking, boarding) and `src/tv/` (the seatback TV) are Preact components; the TV is written so Milestone 3 can mount it inside the 3D seatback screen.

**Tech Stack:** TypeScript 7, Vite 8 + `@preact/preset-vite`, Preact 10, Trystero 0.25 (Nostr), Vitest 5, `@fontsource` (Barlow Condensed, Inter), GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-09-23-flight-13-design.md`

**Code blocks:** every block tagged `file=<path>` is the complete content of that file.

---

## File map

| File | Responsibility |
|---|---|
| `src/net/code.ts` | Flight numbers: generate, normalise, format |
| `src/net/protocol.ts` | Wire messages, `ClientState`, input sanitising (names, looks, settings) |
| `src/net/transport.ts` | `Transport` interface, `Emitter`, in-memory hub |
| `src/net/host.ts` | `HostSession`: lobby, game, timers, bots, redacted broadcasts, persistence hook |
| `src/net/client.ts` | `ClientSession`: find the host, join, send intents, track state |
| `src/net/trystero.ts` | Trystero-backed `Transport` (browser only) |
| `src/net/ticker.ts` | Worker-driven interval that survives background tabs |
| `src/app/*` | Routing, profile, host persistence and lock, session wiring, pages |
| `src/tv/*` | Seatback TV: header, seat map, tabs, overlays |
| `src/styles/*` | Base, page and TV styles |
| `.github/workflows/deploy.yml` | Test, build and deploy to GitHub Pages |

---

### Task 1: Flight numbers and the wire protocol

**Files:**
- Create: `src/net/code.ts`, `src/net/protocol.ts`
- Test: `src/net/code.test.ts`, `src/net/protocol.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts file=src/net/code.test.ts
import { describe, expect, it } from 'vitest';
import { formatCode, newFlightCode, normalizeCode } from './code';

describe('flight codes', () => {
  it('generates four unambiguous characters', () => {
    for (let i = 0; i < 200; i++) expect(newFlightCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  });

  it('accepts the ways people type flight numbers', () => {
    expect(normalizeCode('7k2q')).toBe('7K2Q');
    expect(normalizeCode('FT-7K2Q')).toBe('7K2Q');
    expect(normalizeCode(' ft 7k2q ')).toBe('7K2Q');
    expect(normalizeCode('FTAB')).toBe('FTAB');
    expect(normalizeCode('7K2')).toBeNull();
    expect(normalizeCode('7K2O')).toBeNull();
    expect(formatCode('7K2Q')).toBe('FT-7K2Q');
  });
});
```

```ts file=src/net/protocol.test.ts
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../engine';
import { cleanLook, cleanName, cleanSettings, parseClientMessage } from './protocol';

describe('protocol sanitising', () => {
  it('cleans names', () => {
    expect(cleanName('  Ann   Marie  ')).toBe('Ann Marie');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
    expect(cleanName('')).toBe('Passenger');
    expect(cleanName(42)).toBe('Passenger');
  });

  it('clamps looks to the known palettes', () => {
    expect(cleanLook({ body: 2, skin: 99, hair: -1, hairColor: 1.5, top: 3 })).toEqual({
      body: 2,
      skin: 0,
      hair: 0,
      hairColor: 0,
      top: 3,
      bottom: 0,
    });
  });

  it('rebuilds valid settings and rejects junk', () => {
    const s = defaultSettings();
    expect(cleanSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(cleanSettings({ ...s, extra: 'ignored' })).toEqual(s);
    expect(cleanSettings({ ...s, destination: 'XXX' })).toBeNull();
    expect(cleanSettings({ ...s, cards: { ...s.cards, bomber: 'lots' } })).toBeNull();
  });

  it('parses client messages defensively', () => {
    expect(parseClientMessage({ t: 'join', v: 1, token: 'abcdefgh12', name: ' Ann ', look: {}, tower: 'yes' })).toEqual({
      t: 'join',
      v: 1,
      token: 'abcdefgh12',
      name: 'Ann',
      look: { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, bottom: 0 },
      tower: false,
    });
    expect(parseClientMessage({ t: 'join', v: 1, token: 'short' })).toBeNull();
    expect(parseClientMessage({ t: 'intent', seq: 3, intent: { kind: 'ready' } })).toEqual({ t: 'intent', seq: 3, intent: { kind: 'ready' } });
    expect(parseClientMessage({ t: 'intent', seq: 'x', intent: {} })).toBeNull();
    expect(parseClientMessage('hello')).toBeNull();
    expect(parseClientMessage({ t: 'nope' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/net`
Expected: FAIL — cannot resolve `./code` and `./protocol`.

- [ ] **Step 3: Implement**

```ts file=src/net/code.ts
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random 4-character flight number (no I, O, 0 or 1). */
export function newFlightCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return code;
}

/** Accepts "7k2q", "FT-7K2Q" or " ft 7k2q " and returns "7K2Q"; null if it is not a flight number. */
export function normalizeCode(input: string): string | null {
  let cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length === 6 && cleaned.startsWith('FT')) cleaned = cleaned.slice(2);
  if (cleaned.length !== 4) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return cleaned;
}

export function formatCode(code: string): string {
  return `FT-${code}`;
}
```

```ts file=src/net/protocol.ts
import {
  DESTINATIONS,
  SPECIAL_CARDS,
  TIMERS,
  type Cards,
  type Intent,
  type Look,
  type PlayerView,
  type Settings,
} from '../engine';

export const PROTOCOL_VERSION = 1;
export const NAME_MAX_LENGTH = 16;

/** Options per look slot; the avatar and 3D palettes are sized to match. */
export const LOOK_LIMITS: Readonly<Record<keyof Look, number>> = { body: 3, skin: 6, hair: 8, hairColor: 6, top: 8, bottom: 5 };

export interface LobbyPlayer {
  id: string;
  name: string;
  look: Look;
  bot: boolean;
  connected: boolean;
  host: boolean;
}

export interface LobbyMessage {
  id: number;
  t: number;
  from: string;
  name: string;
  text: string;
}

/** Everything one client may know. Built by the host for each connection. */
export interface ClientState {
  code: string;
  /** Your player id, or null for the control tower. */
  you: string | null;
  isHost: boolean;
  controlTower: boolean;
  settings: Settings;
  players: LobbyPlayer[];
  lobbyChat: LobbyMessage[];
  game: PlayerView | null;
  rev: number;
}

export type HostCommand =
  | { kind: 'settings'; settings: Settings }
  | { kind: 'takeoff' }
  | { kind: 'kick'; playerId: string }
  | { kind: 'addBot' }
  | { kind: 'boardAgain' };

export type ClientMessage =
  | { t: 'join'; v: number; token: string; name: string; look: Look; tower: boolean }
  | { t: 'intent'; seq: number; intent: Intent }
  | { t: 'lobbyChat'; seq: number; text: string }
  | { t: 'command'; seq: number; command: HostCommand };

export type HostMessage =
  | { t: 'hello'; v: number; code: string }
  | { t: 'state'; state: ClientState }
  | { t: 'ack'; seq: number; ok: boolean; error?: string }
  | { t: 'refused'; reason: string };

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => Number.isInteger(x);

export function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH).trim() : '';
  return name || 'Passenger';
}

export function cleanLook(raw: unknown): Look {
  const src = isObj(raw) ? raw : {};
  const slot = (key: keyof Look) => {
    const v = src[key];
    return isInt(v) && v >= 0 && v < LOOK_LIMITS[key] ? v : 0;
  };
  return { body: slot('body'), skin: slot('skin'), hair: slot('hair'), hairColor: slot('hairColor'), top: slot('top'), bottom: slot('bottom') };
}

export function randomLook(random: () => number): Look {
  const r = (key: keyof Look) => Math.floor(random() * LOOK_LIMITS[key]);
  return { body: r('body'), skin: r('skin'), hair: r('hair'), hairColor: r('hairColor'), top: r('top'), bottom: r('bottom') };
}

/** Rebuild Settings from untrusted input, keeping only known fields (validate separately). */
export function cleanSettings(raw: unknown): Settings | null {
  if (!isObj(raw) || !isObj(raw.cards)) return null;
  const cards = {} as Cards;
  for (const card of SPECIAL_CARDS) {
    const v = raw.cards[card];
    if (!isInt(v) || v < 0 || v > 16) return null;
    cards[card] = v;
  }
  const { destination, maxPassengers, rolesMode, stewardessRogueChance, timers, revealRoles, voteMode, anonymousVotes, whispers } = raw;
  if (typeof destination !== 'string' || !(destination in DESTINATIONS)) return null;
  if (!isInt(maxPassengers)) return null;
  if (rolesMode !== 'auto' && rolesMode !== 'custom') return null;
  if (typeof stewardessRogueChance !== 'number') return null;
  if (typeof timers !== 'string' || !(timers in TIMERS)) return null;
  if (voteMode !== 'daily' && voteMode !== 'afterIncident') return null;
  if (typeof revealRoles !== 'boolean' || typeof anonymousVotes !== 'boolean' || typeof whispers !== 'boolean') return null;
  return {
    destination: destination as Settings['destination'],
    maxPassengers,
    rolesMode,
    cards,
    stewardessRogueChance,
    timers: timers as Settings['timers'],
    revealRoles,
    voteMode,
    anonymousVotes,
    whispers,
  };
}

/** Shape-check an incoming client message. The engine validates intent contents. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isObj(raw)) return null;
  switch (raw.t) {
    case 'join':
      if (typeof raw.token !== 'string' || raw.token.length < 8 || raw.token.length > 64) return null;
      return {
        t: 'join',
        v: isInt(raw.v) ? raw.v : 0,
        token: raw.token,
        name: cleanName(raw.name),
        look: cleanLook(raw.look),
        tower: raw.tower === true,
      };
    case 'intent':
      if (!isInt(raw.seq) || !isObj(raw.intent) || typeof raw.intent.kind !== 'string') return null;
      return { t: 'intent', seq: raw.seq, intent: raw.intent as unknown as Intent };
    case 'lobbyChat':
      if (!isInt(raw.seq) || typeof raw.text !== 'string') return null;
      return { t: 'lobbyChat', seq: raw.seq, text: raw.text };
    case 'command':
      if (!isInt(raw.seq) || !isObj(raw.command) || typeof raw.command.kind !== 'string') return null;
      return { t: 'command', seq: raw.seq, command: raw.command as unknown as HostCommand };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/net`
Expected: 2 files, 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/net
git commit -m "feat(net): flight numbers and wire protocol"
```

---

### Task 2: Transports, host session and client session

**Files:**
- Create: `src/net/transport.ts`, `src/net/host.ts`, `src/net/client.ts`
- Test: `src/net/net.test.ts`

- [ ] **Step 1: Write the failing test**

```ts file=src/net/net.test.ts
import { describe, expect, it } from 'vitest';
import { defaultSettings, type Look } from '../engine';
import { ClientSession } from './client';
import { HostSession, newHostSnapshot } from './host';
import { MemoryHub } from './transport';

const LOOK: Look = { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, bottom: 0 };
const HOST_TOKEN = 'host-token-0001';

/** Let queued microtasks and zero-delay timers run. */
async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function flight(opts: { controlTower?: boolean; maxPassengers?: number } = {}) {
  let now = 1_000;
  let seed = 0.37;
  const network = new MemoryHub();
  const local = new MemoryHub();
  const settings = { ...defaultSettings(), maxPassengers: opts.maxPassengers ?? 8 };
  const host = new HostSession({
    network: network.join('host'),
    local: local.join('host-local'),
    snapshot: newHostSnapshot('TEST', HOST_TOKEN, settings, opts.controlTower ?? false),
    now: () => now,
    random: () => (seed = (seed * 997 + 0.123) % 1),
    defer: (fn) => void setTimeout(fn, 0),
  });
  const captain = new ClientSession({
    transport: local.join('local'),
    code: 'TEST',
    token: HOST_TOKEN,
    name: 'Captain',
    look: LOOK,
    tower: opts.controlTower,
    now: () => now,
  });
  const board = (name: string, token = `${name.toLowerCase()}-token-0001`) =>
    new ClientSession({ transport: network.join(), code: 'TEST', token, name, look: LOOK, now: () => now });
  return { host, captain, board, advance: (ms: number) => void (now += ms) };
}

/** Press through the current phase the way an idle human would. */
async function passTurn(c: ClientSession): Promise<void> {
  const game = c.snapshot.state?.game;
  if (!game?.you || game.you.status !== 'alive' || !game.mine) return;
  const { kind } = game.phase;
  if (kind === 'night_move' && !game.you.buckled) {
    if (game.mine.move === null) await c.sendIntent({ kind: 'move', to: 'stay' });
    if (game.you.role === 'pilot' && game.mine.seatbelt === null) await c.sendIntent({ kind: 'seatbelt', target: 'none' });
  } else if (kind === 'night_act' && !game.you.buckled && !game.mine.acted) {
    await c.sendIntent({ kind: 'act', action: null });
  } else if (kind === 'day_discuss' && !game.mine.ready) {
    await c.sendIntent({ kind: 'ready' });
  } else if (kind === 'day_vote' && game.mine.vote === null) {
    await c.sendIntent({ kind: 'vote', target: 'skip' });
  }
}

describe('boarding', () => {
  it('passengers join and share a manifest; only the in-page client is the host', async () => {
    const { captain, board } = flight();
    const ann = board('Ann');
    const bob = board('Bob');
    await settle();
    for (const c of [captain, ann, bob]) {
      expect(c.snapshot.status).toBe('joined');
      expect(c.snapshot.state!.players.map((p) => p.name)).toEqual(['Captain', 'Ann', 'Bob']);
    }
    expect(captain.snapshot.state!.isHost).toBe(true);
    expect(ann.snapshot.state!.isHost).toBe(false);
    expect(ann.snapshot.state!.players[0].host).toBe(true);
  });

  it('only the host may issue commands', async () => {
    const { captain, board } = flight();
    const ann = board('Ann');
    await settle();
    expect(await ann.command({ kind: 'addBot' })).toEqual({ ok: false, error: 'Only the host can do that.' });
    expect(await captain.command({ kind: 'addBot' })).toEqual({ ok: true });
    await settle();
    expect(ann.snapshot.state!.players.filter((p) => p.bot)).toHaveLength(1);
  });

  it('gives duplicate names a number', async () => {
    const { board } = flight();
    board('Sam', 'sam-token-0001');
    const second = board('Sam', 'sam-token-0002');
    await settle();
    expect(second.snapshot.state!.players.map((p) => p.name)).toEqual(['Captain', 'Sam', 'Sam 2']);
  });

  it('lobby chat reaches everyone and the host can remove a passenger', async () => {
    const { captain, board } = flight();
    const ann = board('Ann');
    const bob = board('Bob');
    await settle();
    expect(await ann.sendLobbyChat('hi all')).toEqual({ ok: true });
    await settle();
    expect(bob.snapshot.state!.lobbyChat.map((m) => `${m.name}: ${m.text}`)).toEqual(['Ann: hi all']);
    expect(await captain.command({ kind: 'kick', playerId: bob.playerId! })).toEqual({ ok: true });
    await settle();
    expect(bob.snapshot.status).toBe('refused');
    expect(ann.snapshot.state!.players.map((p) => p.name)).toEqual(['Captain', 'Ann']);
  });

  it('the host can change settings until takeoff', async () => {
    const { captain, board } = flight();
    board('Ann');
    await settle();
    const settings = { ...captain.snapshot.state!.settings, destination: 'HND' as const };
    expect(await captain.command({ kind: 'settings', settings })).toEqual({ ok: true });
    expect((await captain.command({ kind: 'settings', settings: { ...settings, maxPassengers: 2 } })).ok).toBe(false);
    await settle();
    expect(captain.snapshot.state!.settings.destination).toBe('HND');
  });

  it('refuses boarding when the flight is full', async () => {
    const { board } = flight({ maxPassengers: 4 });
    for (const name of ['Ann', 'Bob', 'Cat']) board(name);
    await settle();
    const late = board('Dan');
    await settle();
    expect(late.snapshot).toMatchObject({ status: 'refused', reason: 'This flight is full.' });
  });

  it('tells the older tab when a passenger connects twice', async () => {
    const { board } = flight();
    const first = board('Ann');
    await settle();
    const second = board('Ann');
    await settle();
    expect(first.snapshot.status).toBe('refused');
    expect(second.snapshot.status).toBe('joined');
  });

  it('ending the flight sends everyone home', async () => {
    const { host, board } = flight();
    const ann = board('Ann');
    await settle();
    host.endFlight();
    await settle();
    expect(ann.snapshot).toMatchObject({ status: 'refused', reason: 'The captain ended this flight.' });
  });
});

describe('in flight', () => {
  it('plays a whole flight over the network with bots, then boards again', async () => {
    const { host, captain, board, advance } = flight();
    const ann = board('Ann');
    await settle();
    for (let i = 0; i < 3; i++) expect(await captain.command({ kind: 'addBot' })).toEqual({ ok: true });
    expect(await captain.command({ kind: 'takeoff' })).toEqual({ ok: true });
    await settle();
    expect(ann.snapshot.state!.game!.phase.kind).toBe('takeoff');

    for (let step = 0; step < 3000 && captain.snapshot.state!.game?.phase.kind !== 'ended'; step++) {
      await passTurn(captain);
      await passTurn(ann);
      advance(1000);
      host.tickNow();
      await settle(2);
    }
    for (const c of [captain, ann]) {
      const game = c.snapshot.state!.game!;
      expect(game.phase.kind).toBe('ended');
      expect(game.result).not.toBeNull();
      expect(game.players.every((p) => p.role !== null)).toBe(true);
    }

    expect(await captain.command({ kind: 'boardAgain' })).toEqual({ ok: true });
    await settle();
    expect(ann.snapshot.state!.game).toBeNull();
    expect(ann.snapshot.state!.players).toHaveLength(5);
  });

  it('each passenger only receives their own secrets', async () => {
    const { captain, board } = flight();
    const ann = board('Ann');
    await settle();
    for (let i = 0; i < 4; i++) await captain.command({ kind: 'addBot' });
    await captain.command({ kind: 'takeoff' });
    await settle();
    for (const c of [captain, ann]) {
      const view = c.snapshot.state!.game!;
      expect(view.you?.role).toBeTruthy();
      for (const p of view.players) {
        if (p.id === view.you!.id) continue;
        expect(p.role === null || (view.you!.team === 'saboteurs' && p.team === 'saboteurs')).toBe(true);
      }
    }
  });

  it('a passenger who reloads mid-flight gets their seat back; late arrivals are refused', async () => {
    const { captain, board } = flight();
    const ann = board('Ann');
    await settle();
    for (let i = 0; i < 3; i++) await captain.command({ kind: 'addBot' });
    await captain.command({ kind: 'takeoff' });
    await settle();
    const id = ann.playerId;
    const seat = ann.snapshot.state!.game!.you!.seat;
    ann.close();
    await settle();
    expect(captain.snapshot.state!.players.find((p) => p.id === id)!.connected).toBe(false);
    const again = board('Ann');
    await settle();
    expect(again.playerId).toBe(id);
    expect(again.snapshot.state!.game!.you!.seat).toBe(seat);
    expect(captain.snapshot.state!.players.find((p) => p.id === id)!.connected).toBe(true);
    const late = board('Zed');
    await settle();
    expect(late.snapshot.status).toBe('refused');
  });

  it('the control tower runs the flight without playing', async () => {
    const { captain, board } = flight({ controlTower: true });
    for (const name of ['Ann', 'Bob', 'Cat', 'Dan']) board(name);
    await settle();
    expect(captain.snapshot.state!.you).toBeNull();
    expect(captain.snapshot.state!.players).toHaveLength(4);
    expect(await captain.command({ kind: 'takeoff' })).toEqual({ ok: true });
    await settle();
    const tower = captain.snapshot.state!.game!;
    expect(tower.you).toBeNull();
    expect(tower.players.every((p) => p.role === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/net/net.test.ts`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Implement transports**

```ts file=src/net/transport.ts
export type Unsubscribe = () => void;
export type MessageHandler = (msg: unknown, peerId: string) => void;
export type PeerHandler = (peerId: string) => void;

/** A room of peers that exchange JSON messages (Trystero in the browser, MemoryHub in tests). */
export interface Transport {
  readonly selfId: string;
  send(peerId: string, msg: unknown): void;
  onMessage(fn: MessageHandler): Unsubscribe;
  onPeerJoin(fn: PeerHandler): Unsubscribe;
  onPeerLeave(fn: PeerHandler): Unsubscribe;
  close(): void;
}

export class Emitter<T extends unknown[]> {
  private readonly fns = new Set<(...args: T) => void>();

  on(fn: (...args: T) => void): Unsubscribe {
    this.fns.add(fn);
    return () => void this.fns.delete(fn);
  }

  emit(...args: T): void {
    for (const fn of [...this.fns]) fn(...args);
  }

  clear(): void {
    this.fns.clear();
  }
}

/** An in-memory room: every member sees every other member, like a Trystero room. Delivery is async and JSON-cloned. */
export class MemoryHub {
  private readonly members = new Map<string, MemoryTransport>();
  private counter = 0;

  join(id?: string): MemoryTransport {
    const selfId = id ?? `peer${++this.counter}`;
    if (this.members.has(selfId)) throw new Error(`Duplicate peer ${selfId}`);
    const transport = new MemoryTransport(selfId, this);
    const existing = [...this.members.values()];
    this.members.set(selfId, transport);
    queueMicrotask(() => {
      for (const other of existing) {
        if (!this.members.has(other.selfId) || !this.members.has(selfId)) continue;
        other.peerJoined(selfId);
        transport.peerJoined(other.selfId);
      }
    });
    return transport;
  }

  /** @internal */
  deliver(from: string, to: string, msg: unknown): void {
    if (!this.members.has(from)) return;
    const payload: unknown = JSON.parse(JSON.stringify(msg));
    queueMicrotask(() => this.members.get(to)?.receive(payload, from));
  }

  /** @internal */
  leave(id: string): void {
    if (!this.members.delete(id)) return;
    const rest = [...this.members.values()];
    queueMicrotask(() => {
      for (const other of rest) other.peerLeft(id);
    });
  }
}

export class MemoryTransport implements Transport {
  private readonly messages = new Emitter<[unknown, string]>();
  private readonly joins = new Emitter<[string]>();
  private readonly leaves = new Emitter<[string]>();
  private closed = false;

  constructor(
    readonly selfId: string,
    private readonly hub: MemoryHub,
  ) {}

  send(peerId: string, msg: unknown): void {
    if (!this.closed) this.hub.deliver(this.selfId, peerId, msg);
  }

  onMessage(fn: MessageHandler): Unsubscribe {
    return this.messages.on(fn);
  }

  onPeerJoin(fn: PeerHandler): Unsubscribe {
    return this.joins.on(fn);
  }

  onPeerLeave(fn: PeerHandler): Unsubscribe {
    return this.leaves.on(fn);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.hub.leave(this.selfId);
  }

  /** @internal */
  receive(msg: unknown, from: string): void {
    if (!this.closed) this.messages.emit(msg, from);
  }

  /** @internal */
  peerJoined(id: string): void {
    if (!this.closed) this.joins.emit(id);
  }

  /** @internal */
  peerLeft(id: string): void {
    if (!this.closed) this.leaves.emit(id);
  }
}
```

- [ ] **Step 4: Implement the host session**

```ts file=src/net/host.ts
import {
  CHAT_MAX_LENGTH,
  applyIntent,
  botIntents,
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
    }
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
```

- [ ] **Step 5: Implement the client session**

```ts file=src/net/client.ts
import type { Intent, IntentResult, Look } from '../engine';
import { PROTOCOL_VERSION, type ClientMessage, type ClientState, type HostCommand, type HostMessage } from './protocol';
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
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run src/net`
Expected: 3 files pass (code, protocol, net).

- [ ] **Step 7: Type-check and commit**

```bash
npx tsc --noEmit
git add src/net
git commit -m "feat(net): host and client sessions over pluggable transports"
```

---

### Task 3: Browser transport and background-safe ticker

> **Deviation found in browser testing (Task 8):** Trystero's default Nostr relays for this app id were
> partly offline, and big relays rate-limit or reject this traffic (relay.damus.io bans it, offchain.pub
> requires a web of trust). The transport now joins through WebTorrent trackers *and* a curated Nostr list
> at once, merging peers and dropping duplicate messages (`@trystero-p2p/torrent` added). The session
> module also reloads the page on hot updates, and a Ready-to-vote chip was added to the Chat tab.

No unit tests (they need WebRTC and Workers); verified in the browser in Task 7.

**Files:**
- Create: `src/net/trystero.ts`, `src/net/ticker.ts`

- [ ] **Step 1: Trystero transport**

```ts file=src/net/trystero.ts
import { joinRoom as joinTorrentRoom } from '@trystero-p2p/torrent';
import { joinRoom as joinNostrRoom, selfId, type JsonValue, type MessageAction, type Room } from 'trystero';
import { Emitter, type MessageHandler, type PeerHandler, type Transport } from './transport';

const APP_ID = 'flight13-teamingzooper-v1';

/** WebTorrent trackers: built for exactly this kind of WebRTC offer exchange. */
const TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev', 'wss://open.ftorrent.com'];

/**
 * Public Nostr relays as a second, independent way to find each other. Relays that rate-limit or
 * require a web of trust (relay.damus.io, offchain.pub) reject this traffic, so they are left out.
 */
const RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://relay.snort.social', 'wss://nostr-pub.wellorder.net'];

const SEEN_PER_PEER = 256;

/** A type alias (not an interface) so it satisfies Trystero's JSON payload index signature. */
type Envelope = { i: number; m: JsonValue };

interface Route {
  room: Room;
  action: MessageAction<Envelope>;
}

/**
 * One flight's room, joined through two signaling networks at once. A peer counts as connected while
 * either route reaches it; each message goes out once over the first live route and duplicates are dropped.
 */
export function trysteroTransport(code: string): Transport {
  const config = { appId: APP_ID, password: `flight13:${code}` };
  const roomId = `flight-${code}`;
  const routes: Route[] = [
    joinTorrentRoom({ ...config, relayConfig: { urls: TRACKERS } }, roomId),
    joinNostrRoom({ ...config, relayConfig: { urls: RELAYS } }, roomId),
  ].map((room) => ({ room, action: room.makeAction<Envelope>('m') }));

  const messages = new Emitter<[unknown, string]>();
  const joins = new Emitter<[string]>();
  const leaves = new Emitter<[string]>();
  const live = new Map<string, Set<number>>();
  const seen = new Map<string, { order: number[]; ids: Set<number> }>();
  let nextId = 1;
  let closed = false;

  const firstSight = (peerId: string, id: number): boolean => {
    let record = seen.get(peerId);
    if (!record) {
      record = { order: [], ids: new Set() };
      seen.set(peerId, record);
    }
    if (record.ids.has(id)) return false;
    record.ids.add(id);
    record.order.push(id);
    if (record.order.length > SEEN_PER_PEER) record.ids.delete(record.order.shift()!);
    return true;
  };

  routes.forEach((route, index) => {
    route.room.onPeerJoin = (peerId) => {
      const via = live.get(peerId) ?? new Set<number>();
      const isNew = via.size === 0;
      via.add(index);
      live.set(peerId, via);
      if (isNew) joins.emit(peerId);
    };
    route.room.onPeerLeave = (peerId) => {
      const via = live.get(peerId);
      if (!via) return;
      via.delete(index);
      if (via.size > 0) return;
      live.delete(peerId);
      seen.delete(peerId);
      leaves.emit(peerId);
    };
    route.action.onMessage = (data, { peerId }) => {
      if (data && typeof data === 'object' && typeof data.i === 'number' && firstSight(peerId, data.i)) messages.emit(data.m, peerId);
    };
  });

  return {
    selfId,
    send(peerId, msg) {
      const via = live.get(peerId);
      if (closed || !via || via.size === 0) return;
      const route = routes[Math.min(...via)];
      route.action.send({ i: nextId++, m: msg as JsonValue }, { target: peerId }).catch(() => {
        // The peer dropped mid-send; the leave event handles clean-up.
      });
    },
    onMessage: (fn: MessageHandler) => messages.on(fn),
    onPeerJoin: (fn: PeerHandler) => joins.on(fn),
    onPeerLeave: (fn: PeerHandler) => leaves.on(fn),
    close() {
      if (closed) return;
      closed = true;
      messages.clear();
      joins.clear();
      leaves.clear();
      for (const route of routes) void route.room.leave();
    },
  };
}
```

- [ ] **Step 2: Worker-driven ticker**

```ts file=src/net/ticker.ts
/** A steady interval that keeps running in background tabs (worker timers are not throttled like page timers). */
export function startTicker(fn: () => void, ms: number): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
    const worker = new Worker(url);
    let revoked = false;
    worker.onmessage = () => {
      if (!revoked) {
        revoked = true;
        URL.revokeObjectURL(url);
      }
      fn();
    };
    return () => worker.terminate();
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}
```

- [ ] **Step 3: Type-check and commit**

```bash
npx tsc --noEmit
git add src/net/trystero.ts src/net/ticker.ts
git commit -m "feat(net): Trystero transport and background-safe ticker"
```


---

### Task 4: App shell, profile, host persistence and the home page

**Files:**
- Modify: `tsconfig.json`, `vite.config.ts`
- Create: `index.html`, `src/vite-env.d.ts`, `src/main.tsx`, `src/styles/base.css`, `src/styles/pages.css`, `src/app/router.ts`, `src/app/profile.ts`, `src/app/hosting.ts`, `src/app/sessions.ts`, `src/app/hooks.ts`, `src/app/Avatar.tsx`, `src/app/ProfileEditor.tsx`, `src/app/Notice.tsx`, `src/app/App.tsx`, `src/app/pages/Home.tsx`

- [ ] **Step 1: Enable Preact JSX**

```json file=tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src", "vite.config.ts"]
}
```

```ts file=vite.config.ts
import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/flight-13/',
  plugins: [preact()],
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

```ts file=src/vite-env.d.ts
/// <reference types="vite/client" />
```

```html file=index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#05080f" />
    <meta name="description" content="Flight 13: a social-deduction game at 35,000 feet. Find the saboteurs before the plane lands." />
    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath fill='%23ffb547' d='M32 4c2 0 4 3 4 8v14l22 12v6l-22-6v12l6 5v5l-10-3-10 3v-5l6-5V38L6 44v-6l22-12V12c0-5 2-8 4-8z'/%3E%3C/svg%3E"
    />
    <title>Flight 13</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx file=src/main.tsx
import { render } from 'preact';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './styles/base.css';
import './styles/pages.css';
import './styles/tv.css';
import { App } from './app/App';

render(<App />, document.getElementById('app')!);
```

- [ ] **Step 2: Base and page styles**

```css file=src/styles/base.css
:root {
  --bg: #05080f;
  --ink: #e8eefb;
  --dim: #93a4c4;
  --faint: #5a6b8c;
  --line: #1e2e4b;
  --panel: #0e182b;
  --panel-2: #132139;
  --amber: #ffb547;
  --amber-ink: #231602;
  --cyan: #4fd1c5;
  --red: #ff5e62;
  --green: #5be38b;
  --violet: #b9a4ff;
  --paper: #f4efe3;
  --paper-ink: #1b2130;
  --display: 'Barlow Condensed', 'Arial Narrow', 'Helvetica Neue', sans-serif;
  --body: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color-scheme: dark;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body {
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.5 var(--body);
  -webkit-font-smoothing: antialiased;
}

#app {
  min-height: 100dvh;
}

h1,
h2,
h3 {
  margin: 0;
  font-family: var(--display);
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.1;
}

p {
  margin: 0;
}

button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}

button {
  cursor: pointer;
}

:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 2px;
}

.label {
  font: 600 12px/1.2 var(--display);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--dim);
}

.muted {
  color: var(--dim);
}

.hint {
  color: var(--dim);
  font-size: 13px;
}

.error-text {
  color: var(--red);
  font-size: 14px;
}

.row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stack.tight {
  gap: 6px;
}

.grow {
  flex: 1;
  min-width: 160px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  font-weight: 600;
  white-space: nowrap;
  transition: transform 0.08s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.btn:hover:not(:disabled) {
  border-color: #36507c;
  background: #182a48;
}

.btn:active:not(:disabled) {
  transform: translateY(1px);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn.primary {
  background: var(--amber);
  border-color: var(--amber);
  color: var(--amber-ink);
}

.btn.primary:hover:not(:disabled) {
  background: #ffc466;
  border-color: #ffc466;
  box-shadow: 0 6px 20px rgba(255, 181, 71, 0.25);
}

.btn.danger {
  background: #3a1419;
  border-color: #6b2029;
  color: #ffc9cb;
}

.btn.danger:hover:not(:disabled) {
  background: #4c1920;
  border-color: var(--red);
}

.btn.ghost {
  background: transparent;
}

.btn.big {
  min-height: 50px;
  padding: 12px 22px;
  font-size: 17px;
  border-radius: 12px;
}

.btn.small {
  min-height: 32px;
  padding: 4px 12px;
  font-size: 13px;
}

.btn.tiny {
  min-height: 26px;
  padding: 2px 10px;
  font-size: 12px;
  border-radius: 8px;
}

.input {
  width: 100%;
  min-height: 42px;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #0a1324;
  color: var(--ink);
}

.input::placeholder {
  color: var(--faint);
}

.input:focus {
  border-color: var(--amber);
  outline: none;
  box-shadow: 0 0 0 3px rgba(255, 181, 71, 0.18);
}

.input:disabled {
  opacity: 0.55;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font: 600 11px/18px var(--display);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: #1a2a45;
  color: var(--dim);
}

.badge.amber {
  background: rgba(255, 181, 71, 0.16);
  color: var(--amber);
}

.badge.cyan {
  background: rgba(79, 209, 197, 0.14);
  color: var(--cyan);
}

.badge.red {
  background: rgba(255, 94, 98, 0.14);
  color: var(--red);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: #0f1b31;
  font-size: 14px;
}

.chip:hover:not(:disabled) {
  border-color: #3a5686;
}

.chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.chip.on {
  background: var(--amber);
  border-color: var(--amber);
  color: var(--amber-ink);
  font-weight: 600;
}

.chip.small {
  min-height: 28px;
  font-size: 13px;
}

.segmented {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: #0a1324;
  border: 1px solid var(--line);
}

.segmented button {
  border: 0;
  background: transparent;
  padding: 7px 14px;
  border-radius: 9px;
  color: var(--dim);
  font-weight: 600;
}

.segmented button.on {
  background: #1d3050;
  color: var(--ink);
  box-shadow: inset 0 0 0 1px #34507e;
}

.segmented button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.toggle {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 8px 0;
  cursor: pointer;
}

.toggle input {
  width: 20px;
  height: 20px;
  margin-top: 1px;
  flex: none;
  accent-color: var(--amber);
}

.toggle small {
  display: block;
  color: var(--dim);
  font-size: 13px;
}

input[type='range'] {
  width: 100%;
  accent-color: var(--amber);
}

.avatar {
  display: block;
  flex: none;
}

.avatar.dim {
  opacity: 0.45;
  filter: grayscale(0.8);
}

.spinner {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid #1f3152;
  border-top-color: var(--amber);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.chat-log {
  list-style: none;
  margin: 0;
  padding: 4px 2px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 120px;
}

.msg {
  font-size: 14px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.msg b {
  font-weight: 600;
  margin-right: 4px;
}

.msg .dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: 1px;
}

.msg.notice {
  color: var(--dim);
  font-style: italic;
}

.msg.whisper {
  color: var(--violet);
}

.msg.saboteurs {
  color: #ffc9cb;
}

.msg.ghosts {
  color: #b8c6de;
  font-style: italic;
}

.chat-input {
  display: flex;
  gap: 8px;
}

.empty {
  padding: 10px 0;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 50;
  max-width: min(90vw, 520px);
  padding: 10px 16px;
  border-radius: 12px;
  background: #2a1419;
  border: 1px solid #6b2029;
  color: #ffd4d6;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.lost-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 60;
  padding: 8px;
  text-align: center;
  background: #5a3a08;
  color: #ffe2b0;
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

```css file=src/styles/pages.css
/* ---------- Home ---------- */
.home {
  position: relative;
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  align-items: center;
  gap: 4vw;
  padding: clamp(20px, 5vw, 64px);
  overflow: hidden;
  isolation: isolate;
}

.home-sky {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(1.2px 1.2px at 40px 60px, rgba(255, 255, 255, 0.75), transparent 60%),
    radial-gradient(1px 1px at 130px 20px, rgba(255, 255, 255, 0.5), transparent 60%),
    radial-gradient(1.5px 1.5px at 180px 150px, rgba(255, 255, 255, 0.6), transparent 60%),
    radial-gradient(90% 60% at 50% 115%, rgba(255, 150, 60, 0.22), transparent 65%),
    linear-gradient(180deg, #02050b 0%, #06101f 55%, #0c1830 100%);
  background-size: 210px 210px, 170px 170px, 260px 260px, 100% 100%, 100% 100%;
}

.logo {
  font: 700 clamp(56px, 9vw, 118px) / 0.9 var(--display);
  letter-spacing: 0.04em;
}

.logo span {
  color: var(--amber);
  text-shadow: 0 0 30px rgba(255, 181, 71, 0.45);
}

.tagline {
  margin: 14px 0 28px;
  max-width: 36ch;
  font-size: clamp(16px, 1.6vw, 20px);
  color: #c6d3ec;
}

.ticket {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  max-width: 740px;
  border-radius: 18px;
  background: var(--paper);
  color: var(--paper-ink);
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.55);
}

.ticket::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 8px;
  border-radius: 18px 18px 0 0;
  background: repeating-linear-gradient(90deg, var(--amber) 0 26px, #e39a2c 26px 52px);
}

.ticket-main {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 28px 24px 22px;
  border-right: 2px dashed #c8bfad;
}

.ticket-main::before,
.ticket-main::after {
  content: '';
  position: absolute;
  right: -11px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #06101f;
}

.ticket-main::before {
  top: -10px;
}

.ticket-main::after {
  bottom: -10px;
}

.ticket-stub {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  padding: 28px 22px 22px;
}

.ticket .label {
  color: #7a6f5c;
}

.ticket .input {
  background: #fffaf0;
  border-color: #d8ccb6;
  color: var(--paper-ink);
}

.ticket .input::placeholder {
  color: #a39884;
}

.ticket .btn:not(.primary) {
  background: #efe6d4;
  border-color: #d3c5ab;
  color: var(--paper-ink);
}

.ticket .error-text {
  color: #b83227;
}

.board-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.board-form .row {
  flex-wrap: nowrap;
}

.code-input {
  max-width: 160px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font: 600 20px var(--display);
}

.rejoin {
  font-size: 14px;
}

.ticket .rejoin a {
  color: #1d6fb8;
  font-weight: 600;
}

.how {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  max-width: 740px;
  margin: 26px 0 0;
  padding: 0;
  counter-reset: step;
}

.how li {
  list-style: none;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: rgba(14, 24, 43, 0.7);
  color: #c6d3ec;
  font-size: 14px;
}

.how li::before {
  counter-increment: step;
  content: counter(step);
  display: block;
  font: 700 22px var(--display);
  color: var(--amber);
}

.home-window {
  justify-self: center;
  width: min(32vw, 360px);
  aspect-ratio: 5 / 7;
  padding: 18px;
  border-radius: 46% / 36%;
  background: linear-gradient(145deg, #d9dde4, #8d949f 40%, #c9ced6 70%, #7b828e);
  box-shadow: 0 40px 80px rgba(0, 0, 0, 0.6), inset 0 2px 6px rgba(255, 255, 255, 0.6), inset 0 -6px 12px rgba(0, 0, 0, 0.35);
}

.window-glass {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 44% / 34%;
  background: linear-gradient(180deg, #0b1a3a 0%, #1b3566 55%, #3a5c8f 78%, #d99a5b 100%);
  box-shadow: inset 0 0 0 6px #1a1f27, inset 0 10px 30px rgba(0, 0, 0, 0.6);
}

.window-glass::before {
  content: '';
  position: absolute;
  top: 16%;
  right: 22%;
  width: 18%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 40%, #fffbe8, #f1e2b0 60%, #d8c58c);
  box-shadow: 0 0 40px 10px rgba(255, 244, 200, 0.35);
}

.window-glass::after {
  content: '';
  position: absolute;
  left: -30%;
  right: -30%;
  bottom: 8%;
  height: 34%;
  background:
    radial-gradient(40% 60% at 20% 60%, rgba(220, 230, 255, 0.55), transparent 70%),
    radial-gradient(35% 55% at 55% 70%, rgba(200, 215, 245, 0.5), transparent 70%),
    radial-gradient(40% 60% at 85% 55%, rgba(230, 236, 255, 0.5), transparent 70%);
  filter: blur(6px);
  animation: drift 26s linear infinite alternate;
}

@keyframes drift {
  from {
    transform: translateX(-12%);
  }
  to {
    transform: translateX(12%);
  }
}

.profile-editor {
  display: flex;
  gap: 14px;
  align-items: center;
}

.profile-editor .stack {
  flex: 1;
  min-width: 0;
}

.name-input {
  font-size: 18px;
  font-weight: 600;
}

@media (max-width: 860px) {
  .home {
    grid-template-columns: 1fr;
  }

  .home-window {
    display: none;
  }

  .ticket {
    grid-template-columns: 1fr;
  }

  .ticket-main {
    border-right: 0;
    border-bottom: 2px dashed #c8bfad;
  }

  .ticket-main::before,
  .ticket-main::after {
    display: none;
  }
}

/* ---------- Notices ---------- */
.notice-page {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: radial-gradient(80% 60% at 50% 0%, #13213d, #05080f 70%);
}

.notice {
  width: min(540px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 28px;
  border-radius: 18px;
  border: 1px solid var(--line);
  background: var(--panel);
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5);
}

.notice h1 {
  font-size: 34px;
}

.notice-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: #c6d3ec;
}

/* ---------- Pages (book, boarding) ---------- */
.page {
  max-width: 1180px;
  min-height: 100dvh;
  margin: 0 auto;
  padding: clamp(16px, 3vw, 36px);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.page-head h1 {
  font-size: clamp(34px, 4vw, 48px);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: var(--panel);
}

.panel h2 {
  font-size: 22px;
}

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

/* ---------- Settings form ---------- */
.settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: var(--panel);
}

.settings-section.two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
}

.settings-section h2 {
  font-size: 22px;
  margin-bottom: 4px;
}

.destinations {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}

.dest {
  display: grid;
  gap: 2px;
  padding: 14px;
  text-align: left;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: #0b1428;
  transition: border-color 0.15s ease;
}

.dest:hover {
  border-color: #36507c;
}

.dest.on {
  border-color: var(--amber);
  background: linear-gradient(180deg, rgba(255, 181, 71, 0.12), rgba(255, 181, 71, 0.02));
  box-shadow: 0 0 0 1px var(--amber) inset;
}

.dest-code {
  font: 700 30px/1 var(--display);
  letter-spacing: 0.06em;
  color: var(--amber);
}

.dest-city {
  font-weight: 600;
}

.dest-nights {
  font: 600 12px var(--display);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--cyan);
}

.dest-blurb {
  font-size: 13px;
  color: var(--dim);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
}

.card-count {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: #0b1428;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stepper button {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: #13213a;
  font-size: 18px;
  line-height: 1;
}

.stepper b {
  min-width: 18px;
  text-align: center;
  font: 700 20px var(--display);
}

.settings-submit {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 0;
  background: linear-gradient(180deg, transparent, var(--bg) 40%);
}

/* ---------- Boarding ---------- */
.gate {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 20px;
  padding: 22px;
  border-radius: 18px;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, #0c1528, #0a1222);
}

.gate-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.flight-no {
  font: 700 clamp(48px, 7vw, 84px) / 1 var(--display);
  letter-spacing: 0.06em;
  color: var(--amber);
  text-shadow: 0 0 24px rgba(255, 181, 71, 0.3);
}

.route {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  font-size: 18px;
}

.route > span:first-child {
  font: 600 12px var(--display);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--dim);
}

.share {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 440px;
}

.share-link {
  display: flex;
  gap: 8px;
}

.boarding-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  align-items: start;
  gap: 18px;
}

.manifest {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.manifest li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid #16233d;
  background: #0b1428;
}

.manifest li.offline {
  opacity: 0.6;
}

.manifest .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.manifest .tags {
  display: flex;
  gap: 6px;
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
  font-size: 14px;
  color: #c6d3ec;
}

.lobby-chat .chat-log {
  max-height: 240px;
}

.boarding-bar {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: auto;
  padding: 14px 18px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: rgba(10, 18, 34, 0.92);
  backdrop-filter: blur(10px);
}

@media (max-width: 860px) {
  .boarding-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Routing, profile, persistence and session wiring**

```ts file=src/app/router.ts
import { useEffect, useState } from 'preact/hooks';

export type Route = { name: 'home' } | { name: 'book' } | { name: 'flight'; code: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const flight = /^\/f\/([A-Za-z0-9-]+)$/.exec(path);
  if (flight) return { name: 'flight', code: flight[1].toUpperCase() };
  if (path === '/book') return { name: 'book' };
  return { name: 'home' };
}

export function navigate(path: string): void {
  location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** The link friends open to board a flight. */
export function flightLink(code: string): string {
  return `${location.origin}${location.pathname}#/f/${code}`;
}
```

```ts file=src/app/profile.ts
import type { Look } from '../engine';
import { cleanLook, randomLook } from '../net/protocol';

export interface Profile {
  token: string;
  name: string;
  look: Look;
}

/** `?p=2` gives a tab its own identity, so one browser can test several passengers. */
const SLOT = new URLSearchParams(location.search).get('p') ?? '';
const PROFILE_KEY = `flight13.profile${SLOT ? `.${SLOT}` : ''}`;
const LAST_KEY = `flight13.last${SLOT ? `.${SLOT}` : ''}`;

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function loadProfile(): Profile {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Partial<Profile> | null;
    if (raw && typeof raw.token === 'string' && raw.token.length >= 16) {
      return { token: raw.token, name: typeof raw.name === 'string' ? raw.name : '', look: cleanLook(raw.look) };
    }
  } catch {
    // Corrupt or blocked storage: start fresh.
  }
  const fresh: Profile = { token: randomToken(), name: '', look: randomLook(Math.random) };
  saveProfile(fresh);
  return fresh;
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Storage unavailable: the profile lives for this page only.
  }
}

export function rememberFlight(code: string): void {
  try {
    localStorage.setItem(LAST_KEY, code);
  } catch {
    // Not important enough to surface.
  }
}

export function lastFlight(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
```

```ts file=src/app/hosting.ts
import type { HostSnapshot } from '../net/host';
import { randomToken } from './profile';

const snapshotKey = (code: string) => `flight13.host.${code}`;
const lockKey = (code: string) => `flight13.lock.${code}`;
const LOCK_STALE_MS = 6000;
const LOCK_BEAT_MS = 2000;

/** Stable across reloads of the same tab, different for every other tab. */
const TAB_ID = (() => {
  try {
    const existing = sessionStorage.getItem('flight13.tab');
    if (existing) return existing;
    const id = randomToken().slice(0, 12);
    sessionStorage.setItem('flight13.tab', id);
    return id;
  } catch {
    return randomToken().slice(0, 12);
  }
})();

const pending = new Map<string, { snapshot: HostSnapshot; timer: ReturnType<typeof setTimeout> }>();

function write(snapshot: HostSnapshot): void {
  try {
    localStorage.setItem(snapshotKey(snapshot.code), JSON.stringify(snapshot));
  } catch {
    // Storage full or blocked: the flight still runs, it just cannot survive a reload.
  }
}

/** Save the host's flight (debounced unless `immediate`). */
export function saveHostSnapshot(snapshot: HostSnapshot, immediate = false): void {
  const previous = pending.get(snapshot.code);
  if (previous) clearTimeout(previous.timer);
  if (immediate) {
    pending.delete(snapshot.code);
    write(snapshot);
    return;
  }
  const timer = setTimeout(() => {
    pending.delete(snapshot.code);
    write(snapshot);
  }, 1000);
  pending.set(snapshot.code, { snapshot, timer });
}

export function flushHostSnapshots(): void {
  for (const { snapshot, timer } of pending.values()) {
    clearTimeout(timer);
    write(snapshot);
  }
  pending.clear();
}

export function loadHostSnapshot(code: string): HostSnapshot | null {
  try {
    const raw = localStorage.getItem(snapshotKey(code));
    const snapshot = raw ? (JSON.parse(raw) as HostSnapshot) : null;
    return snapshot && snapshot.v === 1 && snapshot.code === code ? snapshot : null;
  } catch {
    return null;
  }
}

export function deleteHostSnapshot(code: string): void {
  const previous = pending.get(code);
  if (previous) {
    clearTimeout(previous.timer);
    pending.delete(code);
  }
  try {
    localStorage.removeItem(snapshotKey(code));
  } catch {
    // Nothing else to do.
  }
}

export interface HostLock {
  /** Refresh the lock; call regularly (it throttles itself). */
  beat(): void;
  release(): void;
}

/** Only one tab may host a flight. Returns null when another live tab holds it. */
export function acquireHostLock(code: string): HostLock | null {
  const key = lockKey(code);
  const read = (): { tab: string; at: number } | null => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  };
  const current = read();
  if (current && current.tab !== TAB_ID && Date.now() - current.at < LOCK_STALE_MS) return null;
  let last = 0;
  const beat = () => {
    const now = Date.now();
    if (now - last < LOCK_BEAT_MS) return;
    last = now;
    try {
      localStorage.setItem(key, JSON.stringify({ tab: TAB_ID, at: now }));
    } catch {
      // Ignore: worst case another tab could also host.
    }
  };
  beat();
  return {
    beat,
    release() {
      try {
        if (read()?.tab === TAB_ID) localStorage.removeItem(key);
      } catch {
        // Ignore.
      }
    },
  };
}

addEventListener('pagehide', flushHostSnapshots);
```

```ts file=src/app/sessions.ts
import type { Settings } from '../engine';
import { ClientSession } from '../net/client';
import { newFlightCode } from '../net/code';
import { HostSession, newHostSnapshot } from '../net/host';
import { startTicker } from '../net/ticker';
import { MemoryHub } from '../net/transport';
import { trysteroTransport } from '../net/trystero';
import { acquireHostLock, deleteHostSnapshot, loadHostSnapshot, saveHostSnapshot } from './hosting';
import { loadProfile, rememberFlight } from './profile';

export interface OpenFlight {
  kind: 'ok';
  code: string;
  client: ClientSession;
  /** Present when this tab is the host. */
  host: HostSession | null;
}

export type ActiveFlight = OpenFlight | { kind: 'blocked'; code: string };

let active: { flight: ActiveFlight; stop: () => void } | null = null;

// Live sessions hold WebRTC connections that hot updates cannot migrate: reload the page instead.
import.meta.hot?.accept(() => location.reload());

/** Create a new flight hosted by this browser and return its flight number. */
export function bookFlight(settings: Settings, controlTower: boolean): string {
  const profile = loadProfile();
  let code = newFlightCode();
  while (loadHostSnapshot(code)) code = newFlightCode();
  saveHostSnapshot(newHostSnapshot(code, profile.token, settings, controlTower), true);
  return code;
}

/** Connect to a flight: as its host if this browser booked it, otherwise as a passenger. */
export function openFlight(code: string): ActiveFlight {
  if (active?.flight.code === code) return active.flight;
  if (active) closeFlight(active.flight.code);
  rememberFlight(code);
  const profile = loadProfile();
  const saved = loadHostSnapshot(code);

  if (saved && saved.hostToken === profile.token) {
    const lock = acquireHostLock(code);
    if (!lock) {
      active = { flight: { kind: 'blocked', code }, stop: () => {} };
      return active.flight;
    }
    const hub = new MemoryHub();
    const host = new HostSession({
      network: trysteroTransport(code),
      local: hub.join('host'),
      snapshot: saved,
      persist: (snapshot) => saveHostSnapshot(snapshot),
    });
    const stopTicker = startTicker(() => {
      host.tickNow();
      lock.beat();
    }, 250);
    const client = new ClientSession({
      transport: hub.join('local'),
      code,
      token: profile.token,
      name: profile.name,
      look: profile.look,
      tower: saved.controlTower,
    });
    const flight: OpenFlight = { kind: 'ok', code, client, host };
    exposeForDev(flight);
    active = {
      flight,
      stop: () => {
        stopTicker();
        client.close();
        host.close();
        lock.release();
      },
    };
    return flight;
  }

  const client = new ClientSession({ transport: trysteroTransport(code), code, token: profile.token, name: profile.name, look: profile.look });
  const flight: OpenFlight = { kind: 'ok', code, client, host: null };
  exposeForDev(flight);
  active = { flight, stop: () => client.close() };
  return flight;
}

/** Development only: expose the open flight so tests in the browser can drive it. */
function exposeForDev(flight: ActiveFlight): void {
  if (import.meta.env.DEV) (globalThis as { f13?: ActiveFlight }).f13 = flight;
}

export function closeFlight(code: string): void {
  if (!active || active.flight.code !== code) return;
  const { stop } = active;
  active = null;
  stop();
}

/** Host only: send everyone home and forget the flight. */
export function endFlight(code: string): void {
  const flight = active?.flight;
  if (flight?.kind === 'ok' && flight.code === code && flight.host) {
    flight.host.endFlight();
    deleteHostSnapshot(code);
    const current = active;
    active = null;
    setTimeout(() => current?.stop(), 400);
    return;
  }
  closeFlight(code);
}
```

```ts file=src/app/hooks.ts
import { useEffect, useState } from 'preact/hooks';
import type { ClientSession, ClientSnapshot } from '../net/client';

export function useClientSnapshot(client: ClientSession): ClientSnapshot {
  const [snapshot, setSnapshot] = useState(client.snapshot);
  useEffect(() => {
    setSnapshot(client.snapshot);
    return client.subscribe(setSnapshot);
  }, [client]);
  return snapshot;
}

export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    onChange();
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** A message that clears itself after a few seconds. */
export function useToast(ms = 3500): [string | null, (message: string | null) => void] {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), ms);
    return () => clearTimeout(id);
  }, [message, ms]);
  return [message, setMessage];
}
```

- [ ] **Step 4: Shared components, the app and the home page**

```tsx file=src/app/Avatar.tsx
import type { Look } from '../engine';

export const SKIN = ['#f6d3b8', '#e9b48c', '#cf9165', '#a86b43', '#7c4a2b', '#4d2e1c'];
export const HAIR_COLOR = ['#1c1714', '#4b2f1d', '#8b5a2b', '#d4a95f', '#b9b9b9', '#a8362a'];
export const TOP = ['#e5534b', '#3f8ddb', '#3fb27f', '#f2b134', '#9b5cc6', '#5f7390', '#e57a2e', '#e9eef5'];
export const BOTTOM = ['#23282e', '#34495e', '#5b4032', '#1e3a5f', '#6c6576'];

const HAIR_PATHS = [
  'M12 16c0-6 4-9 8-9s8 3 8 9c-2-3-5-4-8-4s-6 1-8 4z',
  'M11 18c0-7 4-11 9-11s9 4 9 11v7c-1-5-2-9-3-10-2 1-4 2-6 2s-4-1-6-2c-1 1-2 5-3 10z',
  'M12 15c0-5 4-8 8-8s8 3 8 8c-3-2-5-3-8-3s-5 1-8 3zM17 5a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  '',
  'M12 14c1-5 4-7 8-7s7 2 8 7l-2-1-2 2-2-2-2 2-2-2-2 2-2-2z',
  'M11 17c0-7 4-10 9-10s9 3 9 10c-3-2-3-5-9-5s-6 3-9 5z',
  'M10 20c0-8 4-13 10-13s10 5 10 13c0 2-1 4-2 5 0-4-1-8-3-10-2 1-3 1-5 1s-3 0-5-1c-2 2-3 6-3 10-1-1-2-3-2-5z',
  'M12 15c0-5 4-8 8-8s8 3 8 8z',
];

export function Avatar({ look, size = 40, dim = false }: { look: Look; size?: number; dim?: boolean }) {
  return (
    <svg class={`avatar${dim ? ' dim' : ''}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#0d1628" />
      <path d="M6 40c1-8 7-12 14-12s13 4 14 12z" fill={TOP[look.top] ?? TOP[0]} />
      <circle cx="20" cy="17" r="8" fill={SKIN[look.skin] ?? SKIN[0]} />
      {HAIR_PATHS[look.hair] ? <path d={HAIR_PATHS[look.hair]} fill={HAIR_COLOR[look.hairColor] ?? HAIR_COLOR[0]} /> : null}
    </svg>
  );
}
```

```tsx file=src/app/ProfileEditor.tsx
import { NAME_MAX_LENGTH, randomLook } from '../net/protocol';
import { Avatar } from './Avatar';
import type { Profile } from './profile';

export function ProfileEditor({ profile, onChange }: { profile: Profile; onChange: (profile: Profile) => void }) {
  return (
    <div class="profile-editor">
      <Avatar look={profile.look} size={64} />
      <div class="stack tight">
        <input
          class="input name-input"
          placeholder="Your name"
          value={profile.name}
          maxLength={NAME_MAX_LENGTH}
          autocomplete="nickname"
          aria-label="Your name"
          onInput={(e) => onChange({ ...profile, name: e.currentTarget.value })}
        />
        <button type="button" class="btn ghost small" onClick={() => onChange({ ...profile, look: randomLook(Math.random) })}>
          New look
        </button>
      </div>
    </div>
  );
}
```

```tsx file=src/app/Notice.tsx
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { formatCode } from '../net/code';
import type { ClientStatus } from '../net/client';
import { navigate } from './router';

export function Notice({ title, children, action }: { title: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="notice-page">
      <div class="notice">
        <div class="label">Flight 13</div>
        <h1>{title}</h1>
        {children && <div class="notice-body">{children}</div>}
        <div class="row">
          {action}
          <button class="btn ghost" onClick={() => navigate('/')}>
            Back to the terminal
          </button>
        </div>
      </div>
    </div>
  );
}

export function Searching({ code, status, hosting }: { code: string; status: ClientStatus; hosting: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 12_000);
    return () => clearTimeout(id);
  }, []);
  const title = status === 'joining' ? 'Boarding…' : hosting ? 'Opening the gate…' : `Looking for ${formatCode(code)}…`;
  return (
    <Notice title={title}>
      <div class="spinner" aria-hidden="true" />
      {status === 'lost' && <p>Lost contact with the captain. Trying to reconnect…</p>}
      {slow && !hosting && (
        <p class="muted">
          Still looking. Make sure the host has the flight open. Some school or work networks block peer-to-peer connections; a phone
          hotspot usually works.
        </p>
      )}
    </Notice>
  );
}
```

```tsx file=src/app/App.tsx
import { Book } from './pages/Book';
import { Flight } from './pages/Flight';
import { Home } from './pages/Home';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  if (route.name === 'book') return <Book />;
  if (route.name === 'flight') return <Flight code={route.code} />;
  return <Home />;
}
```

```tsx file=src/app/pages/Home.tsx
import { useState } from 'preact/hooks';
import { formatCode, normalizeCode } from '../../net/code';
import { lastFlight, loadProfile, saveProfile, type Profile } from '../profile';
import { ProfileEditor } from '../ProfileEditor';
import { navigate } from '../router';

export function Home() {
  const [profile, setProfile] = useState(loadProfile);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const previous = lastFlight();

  const update = (next: Profile) => {
    setProfile(next);
    saveProfile(next);
    setError(null);
  };
  const named = () => {
    if (profile.name.trim()) return true;
    setError('Write your name on the boarding pass first.');
    return false;
  };
  const board = (e: Event) => {
    e.preventDefault();
    if (!named()) return;
    const normalized = normalizeCode(code);
    if (!normalized) {
      setError('Flight numbers look like FT-7K2Q.');
      return;
    }
    navigate(`/f/${normalized}`);
  };

  return (
    <div class="home">
      <div class="home-sky" aria-hidden="true" />
      <section>
        <h1 class="logo">
          FLIGHT <span>13</span>
        </h1>
        <p class="tagline">Someone on this plane wants it to go down. Find them before you land.</p>
        <div class="ticket">
          <div class="ticket-main">
            <div class="label">Boarding pass · Passenger</div>
            <ProfileEditor profile={profile} onChange={update} />
          </div>
          <div class="ticket-stub">
            <button class="btn primary big" onClick={() => named() && navigate('/book')}>
              Book a flight
            </button>
            <form class="board-form" onSubmit={board}>
              <label class="label" for="code">
                Have a flight number?
              </label>
              <div class="row">
                <input
                  id="code"
                  class="input code-input"
                  placeholder="FT-7K2Q"
                  value={code}
                  maxLength={8}
                  autocomplete="off"
                  spellcheck={false}
                  onInput={(e) => setCode(e.currentTarget.value)}
                />
                <button class="btn" type="submit">
                  Board
                </button>
              </div>
            </form>
            {previous && (
              <p class="rejoin">
                Last flight: <a href={`#/f/${previous}`}>{formatCode(previous)}</a>
              </p>
            )}
            {error && <p class="error-text">{error}</p>}
          </div>
        </div>
        <ol class="how">
          <li>Book a flight and share the flight number with friends.</li>
          <li>Everyone gets a secret role and a random seat.</li>
          <li>At night, change seats and use your abilities in the dark.</li>
          <li>By day, talk it out and vote to restrain a suspect.</li>
          <li>Passengers win if every saboteur is caught before landing.</li>
        </ol>
      </section>
      <div class="home-window" aria-hidden="true">
        <div class="window-glass" />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Type-check and commit** (the app runs after Tasks 5–6 add the remaining pages)

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(app): shell, profile, host persistence, session wiring and home page"
```

---

### Task 5: Booking and flight settings

**Files:**
- Create: `src/app/SettingsForm.tsx`, `src/app/pages/Book.tsx`

- [ ] **Step 1: The settings form (shared by booking and the gate)**

```tsx file=src/app/SettingsForm.tsx
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import {
  DESTINATIONS,
  DESTINATION_ORDER,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SPECIAL_CARDS,
  TIMERS,
  countSpecials,
  presetCards,
  validateCards,
  validateSettings,
  type Cards,
  type Settings,
  type SpecialCard,
  type TimerPreset,
} from '../engine';

const CARD_NAME: Record<SpecialCard, [string, string]> = {
  bomber: ['Bomber', 'Bombers'],
  mastermind: ['Mastermind', 'Masterminds'],
  stewardess: ['Stewardess', 'Stewardesses'],
  pilot: ['Pilot', 'Pilots'],
  nurse: ['Nurse', 'Nurses'],
  investigator: ['Investigator', 'Investigators'],
};

const CARD_NOTE: Record<SpecialCard, string> = {
  bomber: 'Saboteur. One bomb per game.',
  mastermind: 'Saboteur. A bomber who looks innocent.',
  stewardess: 'Team decided at takeoff (odds below).',
  pilot: 'Passenger. Buckles someone in each night.',
  nurse: 'Passenger. Saves the person next to them.',
  investigator: 'Passenger. Finds bombs nearby.',
};

export function describeCards(cards: Cards): string {
  const parts = SPECIAL_CARDS.filter((c) => cards[c] > 0).map((c) => `${cards[c]} ${CARD_NAME[c][cards[c] > 1 ? 1 : 0]}`);
  return parts.length ? parts.join(', ') : 'no special roles';
}

/** Smallest passenger count these settings can take off with, or null if never. */
export function minPlayersFor(settings: Settings): number | null {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const cards = settings.rolesMode === 'auto' ? presetCards(n) : settings.cards;
    if (validateCards(cards, n, settings.stewardessRogueChance) === null) return n;
  }
  return null;
}

export function describeRules(s: Settings): string[] {
  const d = DESTINATIONS[s.destination];
  const t = TIMERS[s.timers];
  const discuss = Math.round(t.day_discuss * (d.twist === 'redeye' ? 0.6 : 1));
  return [
    `${d.city} (${d.id}): ${d.nights} nights. ${d.blurb}`,
    s.rolesMode === 'auto'
      ? 'Roles are balanced automatically for however many passengers board.'
      : `Roles: ${describeCards(s.cards)}. Everyone else is a Passenger.`,
    `The Stewardess turns rogue ${Math.round(s.stewardessRogueChance * 100)}% of the time.`,
    `Pace: nights ${t.night_move + t.night_act}s, discussion ${discuss}s, votes ${t.day_vote}s.`,
    s.voteMode === 'daily' ? 'A vote every day.' : 'Votes only after a night with a death or an explosion.',
    s.revealRoles ? 'Roles are revealed when someone is out.' : 'Roles stay secret until landing.',
    s.anonymousVotes ? 'Votes are anonymous.' : 'Everyone sees who voted for whom.',
    s.whispers ? 'Whispers to nearby seats are allowed.' : 'No whispering.',
  ];
}

function Toggle({ checked, onChange, title, hint }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint?: string }) {
  return (
    <label class="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function SettingsForm({
  initial,
  submitLabel,
  onSubmit,
  extra,
  playerCount = 0,
}: {
  initial: Settings;
  submitLabel: string;
  onSubmit: (settings: Settings) => Promise<string | null> | string | null;
  extra?: ComponentChildren;
  playerCount?: number;
}) {
  const [s, setS] = useState<Settings>(() => structuredClone(initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Settings>) => {
    setS((prev) => ({ ...prev, ...patch }));
    setError(null);
  };
  const setCard = (card: SpecialCard, delta: number) =>
    set({ cards: { ...s.cards, [card]: Math.max(0, Math.min(MAX_PLAYERS, s.cards[card] + delta)) } });

  const minPlayers = minPlayersFor(s);
  const problem =
    validateSettings(s) ??
    (minPlayers === null
      ? 'These roles can never take off: saboteurs must start as a minority.'
      : minPlayers > s.maxPassengers
        ? `These roles need at least ${minPlayers} passengers.`
        : null) ??
    (s.maxPassengers < playerCount ? `${playerCount} passengers are already aboard.` : null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const result = await onSubmit(s);
    setBusy(false);
    if (result) setError(result);
  };

  const timers = TIMERS[s.timers];
  return (
    <form class="settings" onSubmit={submit}>
      <section class="settings-section">
        <h2>Destination</h2>
        <div class="destinations">
          {DESTINATION_ORDER.map((id) => {
            const d = DESTINATIONS[id];
            return (
              <button type="button" key={id} class={`dest${s.destination === id ? ' on' : ''}`} aria-pressed={s.destination === id} onClick={() => set({ destination: id })}>
                <span class="dest-code">{id}</span>
                <span class="dest-city">{d.city}</span>
                <span class="dest-nights">{d.nights} nights</span>
                <span class="dest-blurb">{d.blurb}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section class="settings-section two">
        <div class="stack">
          <h2>Cabin</h2>
          <label class="field">
            <span class="label">Max passengers: {s.maxPassengers}</span>
            <input type="range" min={MIN_PLAYERS} max={MAX_PLAYERS} value={s.maxPassengers} onInput={(e) => set({ maxPassengers: Number(e.currentTarget.value) })} />
          </label>
          <div class="field">
            <span class="label">Pace</span>
            <div class="segmented">
              {(Object.keys(TIMERS) as TimerPreset[]).map((t) => (
                <button type="button" key={t} class={s.timers === t ? 'on' : ''} onClick={() => set({ timers: t })}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <p class="hint">
              Nights {timers.night_move + timers.night_act}s · Discussion {timers.day_discuss}s · Vote {timers.day_vote}s
            </p>
          </div>
        </div>
        <div>
          <h2>Rules</h2>
          <Toggle checked={s.revealRoles} onChange={(v) => set({ revealRoles: v })} title="Reveal roles when someone is out" />
          <Toggle
            checked={s.voteMode === 'daily'}
            onChange={(v) => set({ voteMode: v ? 'daily' : 'afterIncident' })}
            title="Vote every day"
            hint="Off: only vote after a night with a death or an explosion."
          />
          <Toggle checked={s.anonymousVotes} onChange={(v) => set({ anonymousVotes: v })} title="Anonymous votes" />
          <Toggle checked={s.whispers} onChange={(v) => set({ whispers: v })} title="Whispers to nearby seats" />
        </div>
      </section>

      <section class="settings-section">
        <h2>Roles</h2>
        <div class="segmented">
          <button type="button" class={s.rolesMode === 'auto' ? 'on' : ''} onClick={() => set({ rolesMode: 'auto' })}>
            Auto (balanced)
          </button>
          <button
            type="button"
            class={s.rolesMode === 'custom' ? 'on' : ''}
            onClick={() => set({ rolesMode: 'custom', cards: countSpecials(s.cards) > 0 ? s.cards : presetCards(s.maxPassengers) })}
          >
            Custom
          </button>
        </div>
        {s.rolesMode === 'auto' ? (
          <p class="hint">
            Balanced for however many passengers board. With a full cabin of {s.maxPassengers}: {describeCards(presetCards(s.maxPassengers))}.
          </p>
        ) : (
          <>
            <div class="cards">
              {SPECIAL_CARDS.map((card) => (
                <div class="card-count" key={card}>
                  <span>
                    <b>{CARD_NAME[card][0]}</b>
                    <br />
                    <small class="muted">{CARD_NOTE[card]}</small>
                  </span>
                  <div class="stepper">
                    <button type="button" aria-label={`Fewer ${CARD_NAME[card][1]}`} onClick={() => setCard(card, -1)}>
                      −
                    </button>
                    <b>{s.cards[card]}</b>
                    <button type="button" aria-label={`More ${CARD_NAME[card][1]}`} onClick={() => setCard(card, 1)}>
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p class="hint">Everyone else is a Passenger.{minPlayers ? ` Needs at least ${minPlayers} passengers.` : ''}</p>
          </>
        )}
        <label class="field">
          <span class="label">Stewardess turns rogue: {Math.round(s.stewardessRogueChance * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(s.stewardessRogueChance * 100)}
            onInput={(e) => set({ stewardessRogueChance: Number(e.currentTarget.value) / 100 })}
          />
        </label>
      </section>

      {extra && <section class="settings-section">{extra}</section>}

      <div class="settings-submit">
        {(error ?? problem) && <p class="error-text">{error ?? problem}</p>}
        <button class="btn primary big" type="submit" disabled={busy || problem !== null}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: The booking page**

```tsx file=src/app/pages/Book.tsx
import { useState } from 'preact/hooks';
import { defaultSettings, type Settings } from '../../engine';
import { Notice } from '../Notice';
import { loadProfile } from '../profile';
import { navigate } from '../router';
import { bookFlight } from '../sessions';
import { SettingsForm } from '../SettingsForm';

export function Book() {
  const [controlTower, setControlTower] = useState(false);
  if (!loadProfile().name.trim()) {
    return (
      <Notice title="Who's the captain?">
        <p>Write your name on the boarding pass first.</p>
      </Notice>
    );
  }
  const submit = (settings: Settings) => {
    navigate(`/f/${bookFlight(settings, controlTower)}`);
    return null;
  };
  return (
    <div class="page book">
      <header class="page-head">
        <button class="btn ghost small" onClick={() => navigate('/')}>
          ← Terminal
        </button>
        <h1>Book a flight</h1>
        <p class="muted">Pick a destination and the rules. You can change them until the doors close.</p>
      </header>
      <SettingsForm
        initial={defaultSettings()}
        submitLabel="Create flight"
        onSubmit={submit}
        extra={
          <label class="toggle">
            <input type="checkbox" checked={controlTower} onChange={(e) => setControlTower(e.currentTarget.checked)} />
            <span>
              <b>Control tower</b>
              <small>Run the flight from this device without playing, for example on a TV or a spare laptop.</small>
            </span>
          </label>
        }
      />
    </div>
  );
}
```

- [ ] **Step 3: Type-check and commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(app): booking page and flight settings form"
```

---

### Task 6: Joining a flight and the boarding gate

**Files:**
- Create: `src/app/pages/Flight.tsx`, `src/app/pages/Boarding.tsx`

- [ ] **Step 1: The flight page (name prompt, connection states)**

```tsx file=src/app/pages/Flight.tsx
import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatCode, normalizeCode } from '../../net/code';
import { TV } from '../../tv/TV';
import { useClientSnapshot } from '../hooks';
import { Notice, Searching } from '../Notice';
import { loadProfile, saveProfile } from '../profile';
import { ProfileEditor } from '../ProfileEditor';
import { closeFlight, openFlight, type OpenFlight } from '../sessions';
import { Boarding } from './Boarding';

export function Flight({ code: raw }: { code: string }) {
  const code = normalizeCode(raw);
  const [named, setNamed] = useState(() => loadProfile().name.trim().length > 0);
  if (!code) {
    return (
      <Notice title="That is not a flight number">
        <p>Flight numbers look like FT-7K2Q.</p>
      </Notice>
    );
  }
  if (!named) return <NamePrompt code={code} onDone={() => setNamed(true)} />;
  return <FlightSession key={code} code={code} />;
}

function NamePrompt({ code, onDone }: { code: string; onDone: () => void }) {
  const [profile, setProfile] = useState(loadProfile);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: Event) => {
    e.preventDefault();
    if (!profile.name.trim()) {
      setError('Tell the crew your name first.');
      return;
    }
    saveProfile({ ...profile, name: profile.name.trim() });
    onDone();
  };
  return (
    <div class="notice-page">
      <form class="notice" onSubmit={submit}>
        <div class="label">Boarding {formatCode(code)}</div>
        <h1>Who is flying?</h1>
        <ProfileEditor
          profile={profile}
          onChange={(p) => {
            setProfile(p);
            setError(null);
          }}
        />
        {error && <p class="error-text">{error}</p>}
        <button class="btn primary big" type="submit">
          Board flight
        </button>
      </form>
    </div>
  );
}

function FlightSession({ code }: { code: string }) {
  const flight = useMemo(() => openFlight(code), [code]);
  useEffect(() => () => closeFlight(code), [code]);
  if (flight.kind === 'blocked') {
    return (
      <Notice title="This flight is open in another tab">
        <p>Close the other tab, then reload this one.</p>
      </Notice>
    );
  }
  return <Connected flight={flight} />;
}

function Connected({ flight }: { flight: OpenFlight }) {
  const snap = useClientSnapshot(flight.client);
  const { state } = snap;
  if (snap.status === 'refused') {
    return (
      <Notice title="You are not on this flight">
        <p>{snap.reason ?? 'The host turned you away.'}</p>
      </Notice>
    );
  }
  if (!state) return <Searching code={flight.code} status={snap.status} hosting={flight.host !== null} />;
  return (
    <>
      {snap.status === 'lost' && (
        <div class="lost-banner" role="status">
          Lost contact with the captain. Reconnecting…
        </div>
      )}
      {state.game ? <TV flight={flight} snap={snap} state={state} /> : <Boarding flight={flight} state={state} />}
    </>
  );
}
```

- [ ] **Step 2: The boarding gate**

```tsx file=src/app/pages/Boarding.tsx
import { useEffect, useRef, useState } from 'preact/hooks';
import { CHAT_MAX_LENGTH, DESTINATIONS, checkTakeoff, type IntentResult } from '../../engine';
import { formatCode } from '../../net/code';
import type { ClientState } from '../../net/protocol';
import { Avatar } from '../Avatar';
import { useToast } from '../hooks';
import { loadProfile, saveProfile, type Profile } from '../profile';
import { ProfileEditor } from '../ProfileEditor';
import { flightLink, navigate } from '../router';
import { endFlight, type OpenFlight } from '../sessions';
import { SettingsForm, describeRules } from '../SettingsForm';

export function Boarding({ flight, state }: { flight: OpenFlight; state: ClientState }) {
  const { client } = flight;
  const [editing, setEditing] = useState(false);
  const [toast, showToast] = useToast();
  const run = async (request: Promise<IntentResult>) => {
    const result = await request;
    if (!result.ok) showToast(result.error);
  };
  const dest = DESTINATIONS[state.settings.destination];
  const me = state.players.find((p) => p.id === state.you) ?? null;
  const takeoffError = checkTakeoff(
    state.settings,
    state.players.map(({ id, name, look }) => ({ id, name, look })),
  );

  if (editing && state.isHost) {
    return (
      <div class="page">
        <header class="page-head">
          <button class="btn ghost small" onClick={() => setEditing(false)}>
            ← Back to the gate
          </button>
          <h1>Flight settings</h1>
        </header>
        <SettingsForm
          initial={state.settings}
          submitLabel="Save changes"
          playerCount={state.players.length}
          onSubmit={async (settings) => {
            const result = await client.command({ kind: 'settings', settings });
            if (result.ok) setEditing(false);
            return result.ok ? null : result.error;
          }}
        />
      </div>
    );
  }

  return (
    <div class="page boarding">
      <header class="gate">
        <div class="gate-info">
          <div class="label">Now boarding · Gate 13</div>
          <h1 class="flight-no">{formatCode(state.code)}</h1>
          <div class="route">
            <span>Destination</span>
            <b>{dest.city}</b>
            <span class="muted">
              {dest.id} · {dest.nights} nights
            </span>
          </div>
          <p class="muted">{dest.blurb}</p>
        </div>
        <ShareBox code={state.code} />
      </header>

      <div class="boarding-grid">
        <section class="panel">
          <div class="panel-head">
            <h2>Passenger manifest</h2>
            <span class="muted">
              {state.players.length} / {state.settings.maxPassengers} seats
            </span>
          </div>
          <ul class="manifest">
            {state.players.map((p) => (
              <li key={p.id} class={p.connected ? '' : 'offline'}>
                <Avatar look={p.look} size={38} dim={!p.connected} />
                <span class="name">{p.name}</span>
                <span class="tags">
                  {p.host && <span class="badge amber">Host</span>}
                  {p.bot && <span class="badge">Bot</span>}
                  {p.id === state.you && <span class="badge cyan">You</span>}
                  {!p.connected && <span class="badge red">Offline</span>}
                </span>
                {state.isHost && !p.host && (
                  <button class="btn ghost tiny" onClick={() => run(client.command({ kind: 'kick', playerId: p.id }))}>
                    Remove
                  </button>
                )}
              </li>
            ))}
            {state.players.length === 0 && <li class="muted">Nobody aboard yet.</li>}
          </ul>
          {state.isHost && (
            <button
              class="btn ghost small"
              disabled={state.players.length >= state.settings.maxPassengers}
              onClick={() => run(client.command({ kind: 'addBot' }))}
            >
              + Add a bot passenger
            </button>
          )}
        </section>

        <div class="stack">
          <LobbyChat flight={flight} state={state} />
          <section class="panel">
            <div class="panel-head">
              <h2>Flight rules</h2>
              {state.isHost && (
                <button class="btn ghost tiny" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
            </div>
            <ul class="rule-list">
              {describeRules(state.settings).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
          {me && <MyPass flight={flight} />}
        </div>
      </div>

      <footer class="boarding-bar">
        {state.isHost ? (
          <>
            <EndButton code={state.code} />
            <span class="muted grow">{takeoffError ?? 'Everyone aboard? Close the doors to take off.'}</span>
            <button class="btn primary big" disabled={takeoffError !== null} onClick={() => run(client.command({ kind: 'takeoff' }))}>
              Close doors & take off
            </button>
          </>
        ) : (
          <>
            <button class="btn ghost small" onClick={() => navigate('/')}>
              Leave
            </button>
            <span class="muted grow">Waiting for the captain to close the doors…</span>
          </>
        )}
      </footer>
      {toast && (
        <div class="toast" role="alert">
          {toast}
        </div>
      )}
    </div>
  );
}

function ShareBox({ code }: { code: string }) {
  const link = flightLink(code);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div class="share">
      <div class="label">Invite your friends</div>
      <p>
        Share the flight number <b>{formatCode(code)}</b> or this link:
      </p>
      <div class="share-link">
        <input class="input" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <button class="btn" onClick={copy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function LobbyChat({ flight, state }: { flight: OpenFlight; state: ClientState }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.lobbyChat.length]);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!text.trim()) return;
    const result = await flight.client.sendLobbyChat(text);
    if (result.ok) {
      setText('');
      setError(null);
    } else {
      setError(result.error);
    }
  };
  return (
    <section class="panel lobby-chat">
      <div class="panel-head">
        <h2>Gate chat</h2>
      </div>
      <ol class="chat-log" ref={listRef}>
        {state.lobbyChat.length === 0 && <li class="muted empty">Say hi while you wait.</li>}
        {state.lobbyChat.map((m) => (
          <li key={m.id} class="msg">
            <b>{m.name}</b> {m.text}
          </li>
        ))}
      </ol>
      {state.you !== null && (
        <form class="chat-input" onSubmit={submit}>
          <input
            class="input"
            value={text}
            maxLength={CHAT_MAX_LENGTH}
            placeholder="Message the gate…"
            aria-label="Message"
            onInput={(e) => setText(e.currentTarget.value)}
          />
          <button class="btn" type="submit" disabled={!text.trim()}>
            Send
          </button>
        </form>
      )}
      {error && <p class="error-text">{error}</p>}
    </section>
  );
}

function MyPass({ flight }: { flight: OpenFlight }) {
  const [profile, setProfile] = useState(loadProfile);
  const change = (next: Profile) => {
    setProfile(next);
    saveProfile(next);
    if (next.name.trim()) flight.client.updateProfile(next.name.trim(), next.look);
  };
  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Your boarding pass</h2>
      </div>
      <ProfileEditor profile={profile} onChange={change} />
    </section>
  );
}

function EndButton({ code }: { code: string }) {
  const [sure, setSure] = useState(false);
  if (!sure) {
    return (
      <button class="btn ghost small" onClick={() => setSure(true)}>
        End flight
      </button>
    );
  }
  return (
    <button
      class="btn danger small"
      onClick={() => {
        endFlight(code);
        navigate('/');
      }}
    >
      Really end the flight?
    </button>
  );
}
```

- [ ] **Step 3: Type-check** (needs `src/tv/TV.tsx` from Task 7 — run after Task 7)


---

### Task 7: The seatback TV

**Files:**
- Create: `src/tv/context.ts`, `src/tv/format.ts`, `src/tv/format.test.ts`, `src/tv/icons.tsx`, `src/tv/Header.tsx`, `src/tv/SeatMap.tsx`, `src/tv/MapTab.tsx`, `src/tv/ActionTab.tsx`, `src/tv/ChatTab.tsx`, `src/tv/VoteTab.tsx`, `src/tv/FlightTab.tsx`, `src/tv/Overlays.tsx`, `src/tv/TV.tsx`, `src/styles/tv.css`

- [ ] **Step 1: Write the failing formatting test**

```ts file=src/tv/format.test.ts
import { describe, expect, it } from 'vitest';
import { clock, shortName } from './format';

describe('tv formatting', () => {
  it('formats countdowns', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(999)).toBe('0:01');
    expect(clock(61_000)).toBe('1:01');
    expect(clock(-5)).toBe('0:00');
  });

  it('shortens names for seat cells', () => {
    expect(shortName('Ann Marie')).toBe('Ann');
    expect(shortName('Bartholomew')).toBe('Bartho…');
  });
});
```

Run: `npx vitest run src/tv` — Expected: FAIL (cannot resolve `./format`).

- [ ] **Step 2: Context, formatting helpers and icons**

```ts file=src/tv/context.ts
import type { OpenFlight } from '../app/sessions';
import type { Intent, PlayerView } from '../engine';
import type { ClientSnapshot } from '../net/client';
import type { ClientState } from '../net/protocol';

/** Everything a TV tab needs. */
export interface TVContext {
  flight: OpenFlight;
  state: ClientState;
  game: PlayerView;
  snap: ClientSnapshot;
  /** Milliseconds left in the current phase. */
  left: number;
  /** Send an intent; shows a toast and resolves false when the host refuses it. */
  send: (intent: Intent) => Promise<boolean>;
  toast: (message: string) => void;
}
```

```ts file=src/tv/format.ts
import { ROLES, describeLocation, type LogEntry, type NightAction, type PlayerSummary, type PlayerView, type RoleId, type Team } from '../engine';

export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const teamName = (team: Team): string => (team === 'saboteurs' ? 'Saboteurs' : 'Passengers');
export const roleName = (role: RoleId): string => ROLES[role].name;

export function playerById(game: PlayerView, id: string | null | undefined): PlayerSummary | undefined {
  return id ? game.players.find((p) => p.id === id) : undefined;
}

export function nameOf(game: PlayerView, id: string | null | undefined): string {
  return playerById(game, id)?.name ?? 'someone';
}

export function nameWithSeat(game: PlayerView, id: string): string {
  const p = playerById(game, id);
  if (!p) return 'someone';
  return p.seat ? `${p.name} (${p.seat})` : p.name;
}

export function shortName(name: string): string {
  const first = name.split(' ')[0] || name;
  return first.length > 7 ? `${first.slice(0, 6)}…` : first;
}

export function phaseTitle(game: PlayerView): string {
  const n = game.phase.night;
  switch (game.phase.kind) {
    case 'takeoff':
      return 'Takeoff';
    case 'night_move':
      return `Night ${n} · Lights out`;
    case 'night_act':
      return `Night ${n} · In the dark`;
    case 'dawn':
      return `Dawn after night ${n}`;
    case 'day_discuss':
      return `Day ${n} · Discussion`;
    case 'day_vote':
      return `Day ${n} · Vote`;
    case 'verdict':
      return `Day ${n} · Verdict`;
    case 'ended': {
      const r = game.result;
      if (!r) return 'Flight over';
      return r.winner === 'draw' ? 'No survivors' : `${teamName(r.winner)} win`;
    }
  }
}

export function phaseHint(game: PlayerView): string {
  const you = game.you;
  const playing = you !== null && you.status === 'alive';
  switch (game.phase.kind) {
    case 'takeoff':
      return 'Fasten your seatbelt. Your boarding pass shows your secret role.';
    case 'night_move':
      if (!playing) return 'The living are changing seats in the dark.';
      if (you.buckled) return 'The seatbelt sign is on over your seat.';
      return you.role === 'pilot' ? 'Change seats if you like, and pick who gets the seatbelt sign.' : 'Change seats or stay put. Nobody can talk.';
    case 'night_act':
      if (!playing) return 'Abilities are being used in the dark.';
      return you.buckled ? 'You are buckled in. Wait for dawn.' : 'Use your ability from your new seat, then press Done.';
    case 'dawn':
      return 'The lights come back on. Here is what happened overnight.';
    case 'day_discuss':
      return 'Talk it out. Who moved? Who is lying?';
    case 'day_vote':
      return 'Vote to restrain someone. They need more votes than Skip.';
    case 'verdict':
      return 'The cabin has decided.';
    case 'ended':
      return 'Open the black box to see what really happened.';
  }
}

export function describeAction(game: PlayerView, action: NightAction): string {
  switch (action.kind) {
    case 'treat':
      return action.target === game.you?.id ? 'treat yourself' : `treat ${nameWithSeat(game, action.target)}`;
    case 'sweep':
      return 'sweep the seats around you for bombs';
    case 'inspect':
      return action.what === 'cart' ? 'inspect the drink cart' : 'inspect the lavatory';
    case 'serve':
      return `serve ${nameWithSeat(game, action.target)} a drink`;
    case 'plant': {
      const where =
        action.where === 'seat' ? describeLocation({ kind: 'seat', seat: game.you?.seat ?? '?' }) : describeLocation({ kind: action.where });
      return `plant a bomb ${where} (${action.fuse}-night fuse)`;
    }
  }
}

export function whenLabel(e: LogEntry): string {
  switch (e.phase) {
    case 'takeoff':
      return 'Takeoff';
    case 'night_move':
    case 'night_act':
      return `Night ${e.night}`;
    case 'ended':
      return 'Landing';
    default:
      return `Day ${e.night}`;
  }
}

/** What happened during the most recent night, as far as this player can see. */
export function morningReport(game: PlayerView): LogEntry[] {
  const n = game.phase.night;
  return game.log.filter((e) => e.night === n && (e.phase === 'night_move' || e.phase === 'night_act') && e.to !== 'end');
}
```

```tsx file=src/tv/icons.tsx
import type { ComponentChildren } from 'preact';

function Icon({ children, size = 22 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconMap = () => (
  <Icon>
    <rect x="4" y="3" width="16" height="18" rx="3" />
    <path d="M8.5 7.5h2M13.5 7.5h2M8.5 12h2M13.5 12h2M8.5 16.5h2M13.5 16.5h2" />
  </Icon>
);

export const IconBolt = () => (
  <Icon>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </Icon>
);

export const IconChat = () => (
  <Icon>
    <path d="M4 5h16v11H9l-5 4z" />
  </Icon>
);

export const IconVote = () => (
  <Icon>
    <path d="M4 13h16v7H4z" />
    <path d="M8 13V4h8v9" />
    <path d="m10 8 1.5 1.5L14 7" />
  </Icon>
);

export const IconPlane = () => (
  <Icon>
    <path d="M12 2c1 0 2 1.5 2 4v5l7 4v2l-7-2v4l2 2v1l-4-1-4 1v-1l2-2v-4l-7 2v-2l7-4V6c0-2.5 1-4 2-4z" />
  </Icon>
);

export function IconBomb({ size = 14 }: { size?: number }) {
  return (
    <svg class="icon-bomb" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10" cy="14" r="7" fill="currentColor" />
      <path d="M14 8l3-3M17 5h2M17 5V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  );
}

export function IconCart({ size = 18 }: { size?: number }) {
  return (
    <svg class="icon-cart" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="3" width="14" height="15" rx="2" fill="currentColor" />
      <path d="M5 9h14M5 13h14" stroke="#0a1324" stroke-width="1.5" />
      <circle cx="8" cy="20.5" r="1.8" fill="currentColor" />
      <circle cx="16" cy="20.5" r="1.8" fill="currentColor" />
    </svg>
  );
}
```

- [ ] **Step 3: Header, seat map and map tab**

```tsx file=src/tv/Header.tsx
import { DESTINATIONS } from '../engine';
import { formatCode } from '../net/code';
import type { TVContext } from './context';
import { clock, phaseHint, phaseTitle } from './format';

export function Header({ ctx, onLeave }: { ctx: TVContext; onLeave: () => void }) {
  const { game, state, left } = ctx;
  const d = DESTINATIONS[game.settings.destination];
  const ended = game.phase.kind === 'ended';
  return (
    <header class="tv-header">
      <div class="tv-logo">
        <span class="tv-logo-mark">
          FLIGHT <b>13</b>
        </span>
        <span class="tv-logo-sub">
          {formatCode(state.code)} → {d.id}
        </span>
      </div>
      <div class="tv-phase">
        <div class="tv-phase-title">{phaseTitle(game)}</div>
        <div class="tv-phase-hint">{phaseHint(game)}</div>
      </div>
      <div class="tv-clock">
        {!ended && <div class={`tv-time${left < 10_000 ? ' urgent' : ''}`}>{clock(left)}</div>}
        <div class="label">{game.phase.night > 0 ? `Night ${game.phase.night} of ${game.phase.nights}` : 'Climbing'}</div>
      </div>
      <button class="tv-leave" onClick={onLeave} aria-label="Leave the flight" title="Leave the flight">
        ✕
      </button>
    </header>
  );
}
```

```tsx file=src/tv/SeatMap.tsx
import type { VNode } from 'preact';
import { TOP } from '../app/Avatar';
import { useMediaQuery } from '../app/hooks';
import { grid, type PlayerSummary, type PlayerView, type SeatId } from '../engine';
import { shortName } from './format';
import { IconBomb, IconCart } from './icons';

export interface SeatPick {
  options: ReadonlySet<SeatId>;
  selected: SeatId | null;
  onPick: (seat: SeatId) => void;
}

export interface PlayerPick {
  options: ReadonlySet<string>;
  selected: string | null;
  onPick: (playerId: string) => void;
}

const LETTERS = ['A', 'B', 'C', '', 'D', 'E', 'F'];

/** The cabin as the seatback TV draws it: front on the left (top when the screen is tall). */
export function SeatMap({
  game,
  seatPick,
  playerPick,
  preview,
}: {
  game: PlayerView;
  seatPick?: SeatPick;
  playerPick?: PlayerPick;
  preview?: ReadonlySet<SeatId>;
}) {
  const vertical = useMediaQuery('(max-aspect-ratio: 1/1)');
  const { rows, cartRow, cartDestroyed, lavatoryDestroyed } = game.cabin;
  const youId = game.you?.id ?? null;
  const saboteurView = game.you?.team === 'saboteurs';
  const occupant = new Map<SeatId, PlayerSummary>();
  for (const p of game.players) if (p.seat) occupant.set(p.seat, p);
  const scorched = new Set(game.cabin.scorched.map((c) => `${c.row}:${c.col}`));
  const live = game.bombs.filter((b) => !b.exploded);
  const seatBombs = new Set(live.flatMap((b) => (b.location.kind === 'seat' ? [b.location.seat] : [])));
  const cartBomb = live.some((b) => b.location.kind === 'cart');
  const lavBomb = live.some((b) => b.location.kind === 'lavatory');

  /** Cabin row r (0 = galley, rows + 1 = rear) and column c (-1 = labels) on the CSS grid. */
  const at = (r: number, c: number, span = 1) => {
    const along = `${r + 2}`;
    const across = span > 1 ? `${c + 2} / span ${span}` : `${c + 2}`;
    return vertical ? { gridRow: along, gridColumn: across } : { gridColumn: along, gridRow: across };
  };

  const cells: VNode[] = [];
  for (let r = 1; r <= rows; r++) {
    cells.push(
      <div key={`n${r}`} class="sm-num" style={at(r, -1)}>
        {r}
      </div>,
    );
  }
  LETTERS.forEach((letter, c) => {
    if (letter) {
      cells.push(
        <div key={`l${c}`} class="sm-letter" style={at(-1, c)}>
          {letter}
        </div>,
      );
    }
  });
  cells.push(
    <div key="galley" class="sm-block sm-galley" style={at(0, 0, 7)}>
      <span>Galley</span>
    </div>,
    <div key="lav" class={`sm-block sm-lav${lavatoryDestroyed ? ' destroyed' : ''}`} style={at(rows + 1, 0, 3)}>
      <span>WC</span>
      {lavBomb && <IconBomb />}
    </div>,
    <div key="crew" class="sm-block sm-crew" style={at(rows + 1, 4, 3)}>
      <span>Crew</span>
    </div>,
  );

  for (let r = 1; r <= rows; r++) {
    for (let c = 0; c < 7; c++) {
      if (c === grid.AISLE_COL) {
        const cart = !cartDestroyed && cartRow === r;
        cells.push(
          <div key={`a${r}`} class={`sm-aisle${scorched.has(`${r}:${c}`) ? ' scorched' : ''}`} style={at(r, c)}>
            {cart && (
              <span class="sm-cart" title="Drink cart">
                <IconCart />
                {cartBomb && <IconBomb />}
              </span>
            )}
          </div>,
        );
        continue;
      }
      const seat = grid.seatId({ row: r, col: c });
      const p = occupant.get(seat);
      const you = !!p && p.id === youId;
      const hidden = game.blackout && !!p && !you;
      const pickSeat = seatPick?.options.has(seat) ?? false;
      const pickPlayer = !!p && (playerPick?.options.has(p.id) ?? false);
      const selected = seatPick?.selected === seat || (!!p && playerPick?.selected === p.id);
      const classes = ['sm-seat', p ? (p.status === 'dead' ? 'dead' : 'taken') : 'empty'];
      if (you) classes.push('you');
      if (saboteurView && p && !you && p.team === 'saboteurs') classes.push('mate');
      if (pickSeat || pickPlayer) classes.push('pick');
      if (selected) classes.push('selected');
      if (preview?.has(seat)) classes.push('preview');
      if (scorched.has(`${r}:${c}`)) classes.push('scorched');
      const who = !p ? 'empty' : hidden ? 'someone' : `${p.name}${p.status === 'dead' ? ' (dead)' : ''}${you ? ' (you)' : ''}`;
      const onPick = pickSeat ? () => seatPick!.onPick(seat) : pickPlayer ? () => playerPick!.onPick(p!.id) : undefined;
      cells.push(
        <button
          key={seat}
          type="button"
          class={classes.join(' ')}
          style={at(r, c)}
          title={`${seat} · ${who}`}
          aria-label={`${seat}, ${who}`}
          disabled={!onPick}
          onClick={onPick}
        >
          {p && !hidden && <span class="sm-stripe" style={{ background: TOP[p.look.top] ?? TOP[0] }} />}
          <span class="sm-name">{!p ? '' : p.status === 'dead' ? '✕' : hidden ? '?' : shortName(p.name)}</span>
          {seatBombs.has(seat) && <IconBomb />}
        </button>,
      );
    }
  }

  return (
    <div class={`seatmap${vertical ? ' vertical' : ''}`} style={{ '--rows': String(rows) }}>
      {cells}
    </div>
  );
}

export function MapLegend({ game }: { game: PlayerView }) {
  return (
    <div class="sm-legend">
      <span>
        <i class="lg you" />
        You
      </span>
      <span>
        <i class="lg" />
        Passenger
      </span>
      <span>
        <i class="lg empty" />
        Empty seat
      </span>
      <span>
        <i class="lg dead" />
        Dead
      </span>
      {game.you?.team === 'saboteurs' && (
        <span>
          <i class="lg mate" />
          Saboteur ally
        </span>
      )}
      <span>
        <IconCart size={14} />
        Drink cart
      </span>
      {game.bombs.some((b) => !b.exploded) && (
        <span>
          <IconBomb />
          Bomb you know about
        </span>
      )}
    </div>
  );
}
```

```tsx file=src/tv/MapTab.tsx
import type { TVContext } from './context';
import { MapLegend, SeatMap } from './SeatMap';

export function MapTab({ ctx }: { ctx: TVContext }) {
  const { game } = ctx;
  const inPlay = game.players.filter((p) => p.status === 'alive').length;
  return (
    <div class="tab map-tab">
      <div class="panel-title">
        Seat map
        <span class="muted">
          {inPlay} still in play{game.blackout ? ' · Blackout: names are hidden today' : ''}
        </span>
      </div>
      <SeatMap game={game} />
      <MapLegend game={game} />
    </div>
  );
}
```

- [ ] **Step 4: The action tab**

```tsx file=src/tv/ActionTab.tsx
import { useState } from 'preact/hooks';
import { ROLES, grid, type NightAction, type PlayerView } from '../engine';
import type { TVContext } from './context';
import { describeAction, nameWithSeat, roleName, teamName, whenLabel } from './format';
import { SeatMap } from './SeatMap';

type TargetAction = Extract<NightAction, { target: string }>;
type Check = 'sweep' | 'cart' | 'lavatory';
type BombSpot = 'seat' | 'cart' | 'lavatory';

export function ActionTab({ ctx }: { ctx: TVContext }) {
  const { game } = ctx;
  const you = game.you;
  if (!you) {
    return (
      <div class="tab">
        <TowerPanel />
      </div>
    );
  }
  if (you.status !== 'alive') {
    return (
      <div class="tab">
        <GhostPanel game={game} />
      </div>
    );
  }
  const kind = game.phase.kind;
  return (
    <div class="tab action-tab">
      <RoleStrip game={game} />
      {kind === 'night_move' && (you.buckled ? <Buckled game={game} /> : <MovePanel ctx={ctx} />)}
      {kind === 'night_act' && (you.buckled ? <Buckled game={game} /> : <AbilityPanel ctx={ctx} />)}
      {kind !== 'night_move' && kind !== 'night_act' && <Notes game={game} />}
    </div>
  );
}

function RoleStrip({ game }: { game: PlayerView }) {
  const you = game.you!;
  const info = ROLES[you.role];
  return (
    <div class={`role-strip ${you.team}`}>
      <div>
        <div class="label">Your role</div>
        <div class="role-name">{info.name}</div>
        <div class="role-meta">
          <span class={`team-tag ${you.team}`}>{teamName(you.team)}</span>
          <span>Seat {you.seat ?? '—'}</span>
        </div>
      </div>
      <p class="role-how">{info.howTo}</p>
      {you.poisoned && (
        <div class="callout red">
          <b>You were poisoned.</b> Get the Nurse to sit next to you and treat you tonight, or you will not survive the next dawn.
        </div>
      )}
    </div>
  );
}

function Buckled({ game }: { game: PlayerView }) {
  return (
    <div class="callout amber">
      <b>Ding.</b> The seatbelt sign is on over your seat{game.you!.buckled === 'turbulence' ? ' because of turbulence' : ''}. You cannot move
      or use an ability tonight.
    </div>
  );
}

function MovePanel({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const you = game.you!;
  const chosen = game.mine?.move ?? null;
  const options = new Set(game.options?.seats ?? []);
  return (
    <div class="stack">
      <div class="panel-title">
        Change seats?
        <span class="muted">Tap an empty seat, or stay in {you.seat}.</span>
      </div>
      <SeatMap
        game={game}
        seatPick={{ options, selected: chosen && chosen !== 'stay' ? chosen : null, onPick: (seat) => void send({ kind: 'move', to: seat }) }}
      />
      <div class="row">
        <button class={`btn${chosen === 'stay' ? ' primary' : ''}`} onClick={() => void send({ kind: 'move', to: 'stay' })}>
          Stay in {you.seat}
        </button>
        <span class="muted">
          {chosen === null ? 'Choose before time runs out, or you stay put.' : chosen === 'stay' ? 'You will stay put.' : `You will move to ${chosen}.`}
        </span>
      </div>
      {you.role === 'pilot' && <SeatbeltPicker ctx={ctx} />}
    </div>
  );
}

function SeatbeltPicker({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const chosen = game.mine?.seatbelt ?? null;
  const targets = game.options?.seatbelt ?? [];
  const last = game.you?.lastSeatbeltTarget;
  return (
    <div class="ability-card">
      <div class="ability-title">Seatbelt sign</div>
      <p class="muted">
        Lock one passenger in tonight: no moving and no ability.{last ? ` You cannot pick ${nameWithSeat(game, last)} two nights running.` : ''}
      </p>
      <div class="chips">
        {targets.map((id) => (
          <button key={id} class={`chip${chosen === id ? ' on' : ''}`} onClick={() => void send({ kind: 'seatbelt', target: id })}>
            {nameWithSeat(game, id)}
          </button>
        ))}
        <button class={`chip${chosen === 'none' ? ' on' : ''}`} onClick={() => void send({ kind: 'seatbelt', target: 'none' })}>
          No one
        </button>
      </div>
    </div>
  );
}

function AbilityPanel({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const you = game.you!;
  const mine = game.mine!;
  const actions = game.options?.actions ?? [];
  let body;
  switch (you.role) {
    case 'nurse':
      body = <TargetPicker ctx={ctx} title="Treat someone" actions={actions} empty="Nobody is within reach. Sit next to someone tomorrow night." />;
      break;
    case 'stewardess_loyal':
    case 'stewardess_rogue':
      body = (
        <TargetPicker ctx={ctx} title={you.role === 'stewardess_rogue' ? 'Serve a poisoned drink' : 'Serve a drink'} actions={actions} empty="Nobody to serve." />
      );
      break;
    case 'investigator':
      body = <InvestigatorPicker ctx={ctx} actions={actions} />;
      break;
    case 'bomber':
    case 'mastermind':
      body = <BombPicker ctx={ctx} actions={actions} />;
      break;
    case 'pilot':
      body = <p class="muted">Your seatbelt call is in. Nothing else to do tonight.</p>;
      break;
    default:
      body = <p class="muted">You have no ability. Close your eyes and listen.</p>;
  }
  return (
    <div class="stack">
      {body}
      <div class="done-row">
        <span>
          {mine.acted
            ? mine.action
              ? `Tonight you will ${describeAction(game, mine.action)}.`
              : 'You are resting tonight.'
            : 'Press Done when you are finished. Everyone has to.'}
        </span>
        <button class={`btn${mine.acted ? '' : ' primary'}`} onClick={() => void send({ kind: 'act', action: mine.acted ? mine.action : null })}>
          {mine.acted ? 'Done ✓' : 'Done'}
        </button>
      </div>
    </div>
  );
}

function TargetPicker({ ctx, title, actions, empty }: { ctx: TVContext; title: string; actions: NightAction[]; empty: string }) {
  const { game, send } = ctx;
  const targeted = actions.filter((a): a is TargetAction => 'target' in a);
  const byTarget = new Map(targeted.map((a) => [a.target, a]));
  const current = game.mine?.action;
  const selected = current && 'target' in current ? current.target : null;
  const choose = (id: string) => {
    const action = byTarget.get(id);
    if (action) void send({ kind: 'act', action });
  };
  if (targeted.length === 0) return <p class="muted">{empty}</p>;
  return (
    <div class="stack">
      <div class="panel-title">{title}</div>
      <div class="chips">
        {targeted.map((a) => (
          <button key={a.target} class={`chip${selected === a.target ? ' on' : ''}`} onClick={() => choose(a.target)}>
            {a.target === game.you?.id ? 'Yourself' : nameWithSeat(game, a.target)}
          </button>
        ))}
      </div>
      <SeatMap game={game} playerPick={{ options: new Set(byTarget.keys()), selected, onPick: choose }} />
    </div>
  );
}

function InvestigatorPicker({ ctx, actions }: { ctx: TVContext; actions: NightAction[] }) {
  const { game, send } = ctx;
  const [hover, setHover] = useState<Check | null>(null);
  const you = game.you!;
  const rows = game.cabin.rows;
  const current = game.mine?.action ?? null;
  const find = (key: Check) => actions.find((a) => (key === 'sweep' ? a.kind === 'sweep' : a.kind === 'inspect' && a.what === key));
  const isCurrent = (key: Check) => !!current && (key === 'sweep' ? current.kind === 'sweep' : current.kind === 'inspect' && current.what === key);
  const areas: Record<Check, Set<string>> = {
    sweep: new Set(grid.seatsWithin([grid.parseSeat(you.seat!)!], grid.SWEEP_RADIUS, rows)),
    cart: new Set(grid.seatsWithin([grid.cartCell(game.cabin.cartRow)], 1, rows)),
    lavatory: new Set(grid.seatsWithin(grid.lavatoryCells(rows), 1, rows)),
  };
  const shown: Check = hover ?? (current?.kind === 'inspect' ? current.what : 'sweep');
  const options: { key: Check; title: string; sub: string }[] = [
    { key: 'sweep', title: 'Sweep nearby seats', sub: 'Every seat within 1 of you, diagonals included.' },
    {
      key: 'cart',
      title: 'Inspect the drink cart',
      sub: find('cart')
        ? `It is right next to you (row ${game.cabin.cartRow}).`
        : game.cabin.cartDestroyed
          ? 'The cart is gone.'
          : 'Sit in an aisle seat next to the cart first (highlighted).',
    },
    {
      key: 'lavatory',
      title: 'Inspect the lavatory',
      sub: find('lavatory') ? 'You are right next to it.' : game.cabin.lavatoryDestroyed ? 'The lavatory is destroyed.' : `Sit in row ${rows}, seats A–C, first.`,
    },
  ];
  return (
    <div class="stack">
      <div class="panel-title">
        Check for bombs <span class="muted">Highlighted seats show where each check reaches.</span>
      </div>
      <div class="option-grid">
        {options.map((o) => {
          const action = find(o.key);
          return (
            <button
              key={o.key}
              class={`option${isCurrent(o.key) ? ' on' : ''}`}
              disabled={!action}
              onMouseEnter={() => setHover(o.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(o.key)}
              onBlur={() => setHover(null)}
              onClick={() => action && void send({ kind: 'act', action })}
            >
              <b>{o.title}</b>
              <span>{o.sub}</span>
            </button>
          );
        })}
      </div>
      <SeatMap game={game} preview={areas[shown]} />
    </div>
  );
}

function BombPicker({ ctx, actions }: { ctx: TVContext; actions: NightAction[] }) {
  const { game, send } = ctx;
  const you = game.you!;
  const current = game.mine?.action ?? null;
  const planned = current?.kind === 'plant' ? current : null;
  const [where, setWhere] = useState<BombSpot>(planned?.where ?? 'seat');
  const [fuse, setFuse] = useState<1 | 2>(planned?.fuse ?? 2);
  if (you.bombUsed) return <p class="muted">Your bomb is already planted. Stay hidden, and stay out of the blast.</p>;
  const can = (w: BombSpot) => actions.some((a) => a.kind === 'plant' && a.where === w);
  const rows = game.cabin.rows;
  const centers = where === 'seat' ? [grid.parseSeat(you.seat!)!] : where === 'cart' ? [grid.cartCell(game.cabin.cartRow)] : grid.lavatoryCells(rows);
  const blast = new Set(grid.seatsWithin(centers, grid.BLAST_RADIUS, rows));
  const labels: Record<BombSpot, string> = { seat: `Under ${you.seat}`, cart: 'Drink cart', lavatory: 'Lavatory' };
  const note =
    where === 'cart'
      ? 'A cart bomb goes off wherever the cart is when the fuse runs out, and it reaches both sides of the aisle.'
      : where === 'lavatory'
        ? 'A lavatory bomb destroys the lavatory and hits the back rows.'
        : 'You are sitting on it. Move away before it goes off, and hope the Pilot does not buckle you in.';
  return (
    <div class="stack">
      <div class="panel-title">
        Plant your bomb <span class="muted">One per game. Red seats are caught in the blast.</span>
      </div>
      <div class="row">
        <div class="segmented">
          {(['seat', 'cart', 'lavatory'] as const).map((w) => (
            <button key={w} class={where === w ? 'on' : ''} disabled={!can(w)} onClick={() => setWhere(w)}>
              {labels[w]}
            </button>
          ))}
        </div>
        <div class="segmented">
          {([1, 2] as const).map((f) => (
            <button key={f} class={fuse === f ? 'on' : ''} onClick={() => setFuse(f)}>
              Fuse: {f} night{f > 1 ? 's' : ''}
            </button>
          ))}
        </div>
      </div>
      <p class="hint">
        {note} It explodes at the end of night {game.phase.night + fuse}, after everyone changes seats.
      </p>
      <SeatMap game={game} preview={blast} />
      <div class="row">
        <button class="btn danger" disabled={!can(where)} onClick={() => void send({ kind: 'act', action: { kind: 'plant', where, fuse } })}>
          {planned ? 'Update the plan' : 'Plant bomb'}
        </button>
        {planned && <span class="muted">Planned: {describeAction(game, planned)}.</span>}
        {planned && (
          <button class="btn ghost small" onClick={() => void send({ kind: 'act', action: null })}>
            Not tonight
          </button>
        )}
      </div>
    </div>
  );
}

function Notes({ game }: { game: PlayerView }) {
  const notes = game.log.filter((e) => Array.isArray(e.to) || e.to === 'saboteurs').slice().reverse();
  return (
    <div class="stack">
      <div class="panel-title">
        Your notes <span class="muted">Private results and messages only you can see.</span>
      </div>
      {notes.length === 0 ? (
        <p class="muted">Nothing yet. Your night results will show up here.</p>
      ) : (
        <ol class="notes">
          {notes.map((e) => (
            <li key={e.id} class={`note tag-${e.tag}`}>
              <span class="when">{whenLabel(e)}</span>
              {e.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GhostPanel({ game }: { game: PlayerView }) {
  const you = game.you!;
  const cause = game.players.find((p) => p.id === you.id)?.cause;
  const how =
    cause === 'restrained' ? 'The passengers restrained you.' : cause === 'poison' ? 'The poison got you.' : 'You were caught in an explosion.';
  return (
    <div class="stack">
      <div class="ghost-card">
        <div class="label">You are out</div>
        <h2>{how}</h2>
        <p>
          You were the <b>{roleName(you.role)}</b> ({teamName(you.team)}). Keep watching, and talk with the other ghosts in Chat.
        </p>
      </div>
      <Notes game={game} />
    </div>
  );
}

function TowerPanel() {
  return (
    <div class="ghost-card">
      <div class="label">Control tower</div>
      <h2>You are running this flight</h2>
      <p>You see only what the whole cabin can see. Follow along on the Map and Flight tabs.</p>
    </div>
  );
}
```

- [ ] **Step 5: Chat, vote and flight tabs**

```tsx file=src/tv/ChatTab.tsx
import { useEffect, useRef, useState } from 'preact/hooks';
import { TOP } from '../app/Avatar';
import { CHAT_MAX_LENGTH, type ChatMessage, type PlayerView } from '../engine';
import type { TVContext } from './context';
import { nameOf, nameWithSeat, playerById } from './format';

type Channel = 'cabin' | 'saboteurs' | 'ghosts' | 'whisper';

const LABEL: Record<Channel, string> = { cabin: 'Cabin', saboteurs: 'Saboteurs', ghosts: 'Ghosts', whisper: 'Whisper' };
const EMPTY: Record<Channel, string> = {
  cabin: 'No one has said anything yet.',
  saboteurs: 'Your private channel. Plan in the dark.',
  ghosts: 'Only the dead can read this.',
  whisper: 'Whispers you send or receive show up here.',
};

export function ChatTab({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const you = game.you;
  const alive = you?.status === 'alive';
  const kind = game.phase.kind;
  const night = kind === 'night_move' || kind === 'night_act';
  const day = kind === 'day_discuss' || kind === 'day_vote';
  const channels: Channel[] = ['cabin'];
  if (you?.team === 'saboteurs') channels.push('saboteurs');
  if (you && !alive) channels.push('ghosts');
  if (alive && game.settings.whispers) channels.push('whisper');

  const [picked, setPicked] = useState<Channel>(() => (alive && night && you?.team === 'saboteurs' ? 'saboteurs' : you && !alive ? 'ghosts' : 'cabin'));
  const [to, setTo] = useState<string | null>(null);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const channel: Channel = channels.includes(picked) ? picked : 'cabin';
  const whisperTargets = game.options?.whisper ?? [];
  const shown = game.chat.filter((m) => {
    if (channel === 'cabin') return m.channel === 'cabin' || m.channel === 'whisper';
    if (channel === 'whisper') return m.channel === 'whisper' && (m.from === you?.id || m.to === you?.id);
    return m.channel === channel;
  });
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, channel]);

  let blocked: string | null = null;
  if (!you) blocked = 'The control tower listens but cannot talk.';
  else if (channel === 'cabin') blocked = kind === 'ended' ? null : !alive ? 'Ghosts cannot talk to the living.' : night ? 'Lights out. The cabin is silent at night.' : null;
  else if (channel === 'saboteurs') blocked = !alive ? 'You are out.' : night ? null : 'The saboteur channel only works at night.';
  else if (channel === 'whisper') {
    if (!day) blocked = 'You can only whisper during the day.';
    else if (whisperTargets.length === 0) blocked = 'Nobody is close enough to whisper to.';
    else if (!to || !whisperTargets.includes(to)) blocked = 'Pick someone nearby to whisper to.';
  }

  const submit = async (e: Event) => {
    e.preventDefault();
    if (blocked || !text.trim()) return;
    const ok = channel === 'whisper' ? await send({ kind: 'whisper', to: to!, text }) : await send({ kind: 'chat', channel, text });
    if (ok) setText('');
  };

  const ready = game.mine?.ready ?? false;
  return (
    <div class="tab chat-tab">
      <div class="chips">
        {channels.map((c) => (
          <button key={c} class={`chip${channel === c ? ' on' : ''}`} onClick={() => setPicked(c)}>
            {LABEL[c]}
          </button>
        ))}
        {alive && kind === 'day_discuss' && (
          <button class={`chip ready-chip${ready ? ' on' : ''}`} disabled={ready} onClick={() => void send({ kind: 'ready' })}>
            {ready ? 'Ready ✓ waiting for the others' : 'Ready to vote'}
          </button>
        )}
      </div>
      {channel === 'whisper' && whisperTargets.length > 0 && (
        <div class="chips whisper-to">
          <span class="label">To</span>
          {whisperTargets.map((id) => (
            <button key={id} class={`chip small${to === id ? ' on' : ''}`} onClick={() => setTo(id)}>
              {nameWithSeat(game, id)}
            </button>
          ))}
        </div>
      )}
      <ol class="chat-log tv-chat" ref={listRef}>
        {shown.length === 0 && <li class="muted empty">{EMPTY[channel]}</li>}
        {shown.map((m) => (
          <ChatLine key={m.id} game={game} m={m} />
        ))}
      </ol>
      <form class="chat-input" onSubmit={submit}>
        <input
          class="input"
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={blocked ?? 'Type a message…'}
          disabled={blocked !== null}
          aria-label="Message"
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <button class="btn primary" type="submit" disabled={blocked !== null || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function ChatLine({ game, m }: { game: PlayerView; m: ChatMessage }) {
  const from = nameOf(game, m.from);
  if (m.channel === 'whisper') {
    const to = nameOf(game, m.to);
    return m.text ? (
      <li class="msg whisper">
        <b>
          {from} → {to}
        </b>
        {m.text}
      </li>
    ) : (
      <li class="msg notice">
        {from} whispered something to {to}.
      </li>
    );
  }
  const color = TOP[playerById(game, m.from)?.look.top ?? 0];
  return (
    <li class={`msg ${m.channel}`}>
      <span class="dot" style={{ background: color }} />
      <b>{from}</b>
      {m.text}
    </li>
  );
}
```

```tsx file=src/tv/VoteTab.tsx
import { Avatar } from '../app/Avatar';
import type { PlayerView } from '../engine';
import type { TVContext } from './context';
import { clock, nameOf } from './format';

export function VoteTab({ ctx }: { ctx: TVContext }) {
  const { game, send, left } = ctx;
  if (game.phase.kind !== 'day_vote') {
    return (
      <div class="tab">
        <LastVerdict game={game} />
      </div>
    );
  }
  const counts = game.votes?.counts ?? {};
  const byVoter = game.votes?.byVoter ?? null;
  const mine = game.mine?.vote ?? null;
  const canVote = new Set(game.options?.vote ?? []);
  const voting = game.options !== null;
  const voters = (target: string) =>
    byVoter
      ? Object.entries(byVoter)
          .filter(([, t]) => t === target)
          .map(([v]) => nameOf(game, v))
      : [];
  const candidates = game.players.filter((p) => p.status === 'alive');
  return (
    <div class="tab vote-tab">
      <div class="panel-title">
        Who should be restrained?
        <span class="muted">They need more votes than Skip. Not voting counts as Skip. {clock(left)} left.</span>
      </div>
      <div class="vote-grid">
        {candidates.map((p) => (
          <button key={p.id} class={`vote-card${mine === p.id ? ' on' : ''}`} disabled={!canVote.has(p.id)} onClick={() => void send({ kind: 'vote', target: p.id })}>
            <Avatar look={p.look} size={44} />
            <span class="vote-name">
              {p.name}
              {p.id === game.you?.id ? ' (you)' : ''}
            </span>
            <span class="vote-seat">{p.seat}</span>
            <span class="vote-count">{counts[p.id] ?? 0}</span>
            {voters(p.id).length > 0 && <span class="vote-voters">{voters(p.id).join(', ')}</span>}
          </button>
        ))}
        <button class={`vote-card skip${mine === 'skip' ? ' on' : ''}`} disabled={!voting} onClick={() => void send({ kind: 'vote', target: 'skip' })}>
          <span class="vote-name">Skip</span>
          <span class="vote-seat">Restrain no one</span>
          <span class="vote-count">{counts.skip ?? 0}</span>
          {voters('skip').length > 0 && <span class="vote-voters">{voters('skip').join(', ')}</span>}
        </button>
      </div>
      {!voting && <p class="muted">Only passengers still in play can vote.</p>}
    </div>
  );
}

export function LastVerdict({ game }: { game: PlayerView }) {
  const v = game.verdict;
  if (!v) {
    return (
      <div class="stack">
        <div class="panel-title">Voting</div>
        <p class="muted">The cabin votes during the day. Nothing to vote on yet.</p>
      </div>
    );
  }
  return (
    <div class="stack">
      <div class="panel-title">
        Last verdict <span class="muted">Day {v.night}</span>
      </div>
      <p class="verdict-line">{v.restrained ? `${nameOf(game, v.restrained)} was restrained.` : 'No one was restrained.'}</p>
      <Tally game={game} tally={v.tally} />
    </div>
  );
}

export function Tally({ game, tally }: { game: PlayerView; tally: Record<string, number> }) {
  return (
    <ul class="tally">
      {Object.entries(tally)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => (
          <li key={id}>
            <span>{id === 'skip' ? 'Skip' : nameOf(game, id)}</span>
            <b>{n}</b>
          </li>
        ))}
    </ul>
  );
}
```

```tsx file=src/tv/FlightTab.tsx
import { DESTINATIONS, isNightPhase, type PlayerView } from '../engine';
import type { TVContext } from './context';
import { whenLabel } from './format';

export function FlightTab({ ctx }: { ctx: TVContext }) {
  const { game } = ctx;
  const d = DESTINATIONS[game.settings.destination];
  const log = game.log.filter((e) => e.to === 'all').slice().reverse();
  return (
    <div class="tab flight-tab">
      <FlightMap progress={flightProgress(game)} city={d.city} code={d.id} />
      <div class="flight-facts">
        <span>
          <b>{d.city}</b> ({d.id})
        </span>
        <span>{game.phase.night > 0 ? `Night ${game.phase.night} of ${game.phase.nights}` : 'Just took off'}</span>
        <span class="muted">{d.blurb}</span>
      </div>
      <div class="panel-title">Cabin log</div>
      <ol class="notes">
        {log.map((e) => (
          <li key={e.id} class={`note tag-${e.tag}`}>
            <span class="when">{whenLabel(e)}</span>
            {e.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

function flightProgress(game: PlayerView): number {
  if (game.phase.kind === 'ended') return 1;
  if (game.phase.night === 0) return 0.02;
  const done = game.phase.night - (isNightPhase(game.phase.kind) ? 1 : 0.5);
  return Math.min(0.98, Math.max(0.02, done / game.phase.nights));
}

function FlightMap({ progress, city, code }: { progress: number; city: string; code: string }) {
  // Quadratic arc from (40, 150) through control point (300, 30) to (560, 150).
  const t = progress;
  const x = (1 - t) ** 2 * 40 + 2 * (1 - t) * t * 300 + t ** 2 * 560;
  const y = (1 - t) ** 2 * 150 + 2 * (1 - t) * t * 30 + t ** 2 * 150;
  const dx = 2 * (1 - t) * 260 + 2 * t * 260;
  const dy = 2 * (1 - t) * -120 + 2 * t * 120;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <svg class="flight-map" viewBox="0 0 600 190" role="img" aria-label={`Flight progress: ${Math.round(progress * 100)}% of the way to ${city}`}>
      <defs>
        <linearGradient id="fm-trail" x1="0" x2="1">
          <stop offset="0" stop-color="#ffb547" stop-opacity="0.15" />
          <stop offset="1" stop-color="#ffb547" />
        </linearGradient>
      </defs>
      <path d="M40 150 Q300 30 560 150" class="fm-route" />
      <path d="M40 150 Q300 30 560 150" class="fm-done" pathLength={1} stroke-dasharray={`${progress} 1`} />
      <circle cx="40" cy="150" r="6" class="fm-dot" />
      <circle cx="560" cy="150" r="6" class="fm-dot dest" />
      <text x="40" y="180" class="fm-label" text-anchor="middle">
        Departure
      </text>
      <text x="560" y="180" class="fm-label dest" text-anchor="middle">
        {code}
      </text>
      <g transform={`translate(${x} ${y}) rotate(${angle + 90})`}>
        <path
          class="fm-plane"
          d="M0-14c1.3 0 2.2 1.8 2.2 4.5v4.6l8.8 5v2.6l-8.8-2.4v5.2l3 2.4V10L0 8.6-5.2 10V7.9l3-2.4V.3l-8.8 2.4V.1l8.8-5v-4.6C-2.2-12.2-1.3-14 0-14z"
        />
      </g>
    </svg>
  );
}
```

- [ ] **Step 6: Overlays and the TV frame**

```tsx file=src/tv/Overlays.tsx
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Avatar } from '../app/Avatar';
import { DESTINATIONS, ROLES, type PlayerView } from '../engine';
import type { TVContext } from './context';
import { morningReport, roleName, teamName, whenLabel } from './format';
import { Tally } from './VoteTab';

export function PhaseOverlay({ ctx, onLeave }: { ctx: TVContext; onLeave: () => void }) {
  const { game } = ctx;
  const key = `${game.phase.kind}:${game.phase.night}`;
  const [closed, setClosed] = useState<string | null>(null);
  if (closed === key) return null;
  const close = () => setClosed(key);
  switch (game.phase.kind) {
    case 'takeoff':
      return game.you ? <BoardingPass game={game} onClose={close} /> : null;
    case 'dawn':
      return <MorningReport game={game} onClose={close} />;
    case 'verdict':
      return <VerdictCard game={game} onClose={close} />;
    case 'ended':
      return <EndScreen ctx={ctx} onLeave={onLeave} />;
    default:
      return null;
  }
}

function Overlay({ children, onClose, wide = false }: { children: ComponentChildren; onClose?: () => void; wide?: boolean }) {
  return (
    <div class="tv-overlay" role="dialog" aria-modal="true">
      <div class={`tv-card${wide ? ' wide' : ''}`}>
        {children}
        {onClose && (
          <button class="btn primary" onClick={onClose}>
            Got it
          </button>
        )}
      </div>
    </div>
  );
}

function BoardingPass({ game, onClose }: { game: PlayerView; onClose: () => void }) {
  const you = game.you!;
  const info = ROLES[you.role];
  const d = DESTINATIONS[game.settings.destination];
  const allies = game.players.filter((p) => p.team === 'saboteurs' && p.id !== you.id);
  return (
    <Overlay onClose={onClose}>
      <div class={`pass ${you.team}`}>
        <div class="pass-head">
          <span>Boarding pass</span>
          <span>Flight 13 → {d.id}</span>
        </div>
        <div class="pass-body">
          <div>
            <div class="label">Passenger</div>
            <div class="pass-big">{you.name}</div>
          </div>
          <div>
            <div class="label">Seat</div>
            <div class="pass-big">{you.seat}</div>
          </div>
          <div>
            <div class="label">Role</div>
            <div class="pass-big">{info.name}</div>
          </div>
          <div>
            <div class="label">Team</div>
            <div class={`pass-big team ${you.team}`}>{teamName(you.team)}</div>
          </div>
        </div>
        <p class="pass-blurb">{info.blurb}</p>
        <p>{info.howTo}</p>
        {you.team === 'saboteurs' && (
          <p class="pass-allies">
            Your allies: {allies.length ? allies.map((p) => `${p.name} (${p.role ? roleName(p.role) : '?'})`).join(', ') : 'none. You are on your own.'}
          </p>
        )}
      </div>
    </Overlay>
  );
}

function MorningReport({ game, onClose }: { game: PlayerView; onClose: () => void }) {
  const entries = morningReport(game);
  return (
    <Overlay onClose={onClose} wide>
      <div class="label">Morning report · Night {game.phase.night}</div>
      <h2>The lights come back on</h2>
      <ol class="notes">
        {entries.length === 0 && <li class="note">Nothing to report.</li>}
        {entries.map((e) => {
          const secret = Array.isArray(e.to) || e.to === 'saboteurs';
          return (
            <li key={e.id} class={`note tag-${e.tag}${secret ? ' private' : ''}`}>
              {secret && <span class="when">{e.to === 'saboteurs' ? 'Saboteurs' : 'Only you'}</span>}
              {e.text}
            </li>
          );
        })}
      </ol>
    </Overlay>
  );
}

function VerdictCard({ game, onClose }: { game: PlayerView; onClose: () => void }) {
  const v = game.verdict;
  const restrained = v?.restrained ? game.players.find((p) => p.id === v.restrained) : undefined;
  return (
    <Overlay onClose={onClose}>
      <div class="label">Verdict · Day {game.phase.night}</div>
      {restrained ? (
        <>
          <Avatar look={restrained.look} size={72} />
          <h2>{restrained.name} is restrained</h2>
          {restrained.role && restrained.team && (
            <p>
              They were the <b>{roleName(restrained.role)}</b> ({teamName(restrained.team)}).
            </p>
          )}
        </>
      ) : (
        <h2>No one was restrained</h2>
      )}
      {v && <Tally game={game} tally={v.tally} />}
    </Overlay>
  );
}

function EndScreen({ ctx, onLeave }: { ctx: TVContext; onLeave: () => void }) {
  const { game, state, flight } = ctx;
  const [view, setView] = useState<'roles' | 'blackbox'>('roles');
  const r = game.result;
  const summary = game.log.filter((e) => e.tag === 'gameover').at(-1)?.text ?? '';
  const blackBox = game.log.filter((e) => e.to === 'end');
  const outcome = (p: PlayerView['players'][number]) =>
    p.status === 'alive' ? 'Made it' : p.cause === 'restrained' ? 'Restrained' : p.cause === 'poison' ? 'Poisoned' : 'Caught in a blast';
  return (
    <div class="tv-overlay" role="dialog" aria-modal="true">
      <div class="tv-card wide end">
        <div class="label">{r?.reason === 'landed' ? 'Flight 13 has landed' : 'Flight over'}</div>
        <h2 class={`end-title ${r?.winner ?? ''}`}>{r ? (r.winner === 'draw' ? 'No survivors' : `${teamName(r.winner)} win`) : 'Flight over'}</h2>
        {game.you && r && r.winner !== 'draw' && <p class="end-you">{r.winner === game.you.team ? 'Your team won' : 'Your team lost'}</p>}
        <p>{summary}</p>
        <div class="segmented">
          <button class={view === 'roles' ? 'on' : ''} onClick={() => setView('roles')}>
            Everyone's roles
          </button>
          <button class={view === 'blackbox' ? 'on' : ''} onClick={() => setView('blackbox')}>
            Black box
          </button>
        </div>
        {view === 'roles' ? (
          <ul class="role-reveal">
            {game.players.map((p) => (
              <li key={p.id} class={p.team ?? ''}>
                <Avatar look={p.look} size={32} dim={p.status !== 'alive'} />
                <span class="name">{p.name}</span>
                <span class="role">{p.role ? roleName(p.role) : '?'}</span>
                <span class="status">{outcome(p)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <ol class="notes blackbox">
            {blackBox.length === 0 && <li class="note">The black box is empty.</li>}
            {blackBox.map((e) => (
              <li key={e.id} class={`note tag-${e.tag}`}>
                <span class="when">{whenLabel(e)}</span>
                {e.text.replace(/^Night \d+: /, '')}
              </li>
            ))}
          </ol>
        )}
        <div class="row">
          {state.isHost ? (
            <button class="btn primary big" onClick={() => void flight.client.command({ kind: 'boardAgain' })}>
              Board again
            </button>
          ) : (
            <span class="muted">The captain can board everyone again.</span>
          )}
          <button class="btn ghost" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
```

```tsx file=src/tv/TV.tsx
import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useNow, useToast } from '../app/hooks';
import { navigate } from '../app/router';
import { endFlight, type OpenFlight } from '../app/sessions';
import { isNightPhase, type Intent, type PhaseKind, type PlayerView } from '../engine';
import { msLeft, type ClientSnapshot } from '../net/client';
import type { ClientState } from '../net/protocol';
import { ActionTab } from './ActionTab';
import { ChatTab } from './ChatTab';
import type { TVContext } from './context';
import { FlightTab } from './FlightTab';
import { Header } from './Header';
import { IconBolt, IconChat, IconMap, IconPlane, IconVote } from './icons';
import { MapTab } from './MapTab';
import { PhaseOverlay } from './Overlays';
import { VoteTab } from './VoteTab';

export type TabId = 'map' | 'action' | 'chat' | 'vote' | 'flight';

const TABS: { id: TabId; label: string; Icon: () => VNode }[] = [
  { id: 'map', label: 'Map', Icon: IconMap },
  { id: 'action', label: 'Action', Icon: IconBolt },
  { id: 'chat', label: 'Chat', Icon: IconChat },
  { id: 'vote', label: 'Vote', Icon: IconVote },
  { id: 'flight', label: 'Flight', Icon: IconPlane },
];

const AUTO_TAB: Partial<Record<PhaseKind, TabId>> = { night_move: 'action', night_act: 'action', day_discuss: 'chat', day_vote: 'vote' };

export function TV({ flight, snap, state }: { flight: OpenFlight; snap: ClientSnapshot; state: ClientState }) {
  const game = state.game!;
  const now = useNow(250);
  const [toast, showToast] = useToast();
  const [tab, setTab] = useState<TabId>(() => AUTO_TAB[game.phase.kind] ?? 'action');
  const [leaving, setLeaving] = useState(false);
  const phaseKey = `${game.phase.kind}:${game.phase.night}`;
  const lastPhase = useRef(phaseKey);
  useEffect(() => {
    if (lastPhase.current === phaseKey) return;
    lastPhase.current = phaseKey;
    const next = AUTO_TAB[game.phase.kind];
    if (next) setTab(next);
  }, [phaseKey]);
  const unread = useUnread(game, tab === 'chat');

  const send = async (intent: Intent) => {
    const result = await flight.client.sendIntent(intent);
    if (!result.ok) showToast(result.error);
    return result.ok;
  };
  const ctx: TVContext = { flight, state, game, snap, left: msLeft(snap, now), send, toast: showToast };

  const you = game.you;
  const acting = !!you && you.status === 'alive' && !you.buckled;
  const pendingAction =
    acting &&
    ((game.phase.kind === 'night_move' && (game.mine?.move === null || (you.role === 'pilot' && game.mine?.seatbelt === null))) ||
      (game.phase.kind === 'night_act' && !game.mine?.acted));
  const pendingVote = game.phase.kind === 'day_vote' && game.options !== null && game.mine?.vote === null;
  const badges: Partial<Record<TabId, string>> = {
    action: pendingAction ? '!' : undefined,
    vote: pendingVote ? '!' : undefined,
    chat: unread > 0 ? String(Math.min(unread, 99)) : undefined,
  };

  return (
    <div class={`tv ${isNightPhase(game.phase.kind) ? 'night' : 'day'}`}>
      <div class="tv-bezel">
        <div class="tv-screen">
          <Header ctx={ctx} onLeave={() => setLeaving(true)} />
          <main class="tv-body">
            {tab === 'map' && <MapTab ctx={ctx} />}
            {tab === 'action' && <ActionTab ctx={ctx} />}
            {tab === 'chat' && <ChatTab ctx={ctx} />}
            {tab === 'vote' && <VoteTab ctx={ctx} />}
            {tab === 'flight' && <FlightTab ctx={ctx} />}
          </main>
          <nav class="tv-tabs" aria-label="Seatback menu">
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} class={`tv-tab${tab === id ? ' on' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
                <Icon />
                <span>{label}</span>
                {badges[id] && <em class="tv-badge">{badges[id]}</em>}
              </button>
            ))}
          </nav>
          <PhaseOverlay ctx={ctx} onLeave={() => setLeaving(true)} />
          {leaving && <LeaveDialog flight={flight} onStay={() => setLeaving(false)} />}
          {toast && (
            <div class="tv-toast" role="alert">
              {toast}
            </div>
          )}
        </div>
        <div class="tv-brand">Flight 13 · In-flight system</div>
      </div>
    </div>
  );
}

function useUnread(game: PlayerView, reading: boolean): number {
  const latest = game.chat.at(-1)?.id ?? 0;
  const lastSeen = useRef(latest);
  useEffect(() => {
    if (reading) lastSeen.current = latest;
  }, [reading, latest]);
  if (reading) return 0;
  return game.chat.filter((m) => m.id > lastSeen.current && m.from !== game.you?.id).length;
}

function LeaveDialog({ flight, onStay }: { flight: OpenFlight; onStay: () => void }) {
  const hosting = flight.host !== null;
  return (
    <div class="tv-overlay" role="dialog" aria-modal="true">
      <div class="tv-card">
        <h2>Leave the flight?</h2>
        <p>
          {hosting
            ? 'You are the host. If you leave, the flight pauses for everyone until you come back to this page.'
            : 'You can come back with the same link and take your seat again.'}
        </p>
        <div class="row">
          <button class="btn primary" onClick={onStay}>
            Stay aboard
          </button>
          <button class="btn ghost" onClick={() => navigate('/')}>
            Leave
          </button>
          {hosting && (
            <button
              class="btn danger"
              onClick={() => {
                endFlight(flight.code);
                navigate('/');
              }}
            >
              End flight for everyone
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: TV styles**

```css file=src/styles/tv.css
/* ---------- Frame ---------- */
.tv {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: max(12px, 2vmin);
  background: radial-gradient(1200px 600px at 50% -10%, #1a2438 0%, transparent 60%), linear-gradient(180deg, #0a0d14, #05070b);
}

.tv.night {
  background: radial-gradient(1000px 500px at 50% -10%, #0e1730 0%, transparent 60%), linear-gradient(180deg, #04060c, #020306);
}

.tv-bezel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(100%, 1200px);
  height: min(calc(100dvh - 24px), 800px);
  padding: 16px 16px 30px;
  border-radius: 26px;
  background: linear-gradient(160deg, #24282f, #0d0f13 55%, #181b21);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.07), inset 0 -2px 0 rgba(0, 0, 0, 0.6);
}

.tv-screen {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border-radius: 12px;
  background: radial-gradient(120% 90% at 50% 0%, #10203d 0%, #091326 55%, #060c18 100%);
  box-shadow: inset 0 0 0 1px rgba(120, 160, 255, 0.08), inset 0 0 70px rgba(0, 0, 0, 0.55);
}

.tv.night .tv-screen {
  background: radial-gradient(120% 90% at 50% 0%, #0b1631 0%, #070e1e 55%, #040912 100%);
}

.tv-screen::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 30;
  pointer-events: none;
  background:
    linear-gradient(115deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0) 32%),
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.018) 0 1px, transparent 1px 3px);
}

.tv-brand {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 8px;
  text-align: center;
  font: 600 10px var(--display);
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: #4a5160;
}

/* ---------- Header and tabs ---------- */
.tv-header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 18px;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(120, 160, 255, 0.1);
  background: linear-gradient(180deg, rgba(10, 20, 40, 0.9), rgba(10, 20, 40, 0.5));
}

.tv-logo {
  display: flex;
  flex-direction: column;
  line-height: 1;
}

.tv-logo-mark {
  font: 700 22px var(--display);
  letter-spacing: 0.08em;
}

.tv-logo-mark b {
  color: var(--amber);
}

.tv-logo-sub {
  margin-top: 4px;
  font: 600 11px var(--display);
  letter-spacing: 0.16em;
  color: var(--dim);
}

.tv-phase {
  min-width: 0;
}

.tv-phase-title {
  font: 700 22px/1.1 var(--display);
  letter-spacing: 0.03em;
}

.tv-phase-hint {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  color: var(--dim);
}

.tv-clock {
  text-align: right;
}

.tv-time {
  font: 700 32px/1 var(--display);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}

.tv-time.urgent {
  color: var(--amber);
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.55;
  }
}

.tv-leave {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--dim);
}

.tv-leave:hover {
  color: var(--ink);
  border-color: #36507c;
}

.tv-body {
  overflow-y: auto;
  padding: 16px 18px;
}

.tv-tabs {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  border-top: 1px solid rgba(120, 160, 255, 0.1);
  background: rgba(6, 12, 24, 0.85);
}

.tv-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 9px 4px 10px;
  border: 0;
  background: transparent;
  color: var(--dim);
  font: 600 12px var(--display);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.tv-tab:hover {
  color: var(--ink);
}

.tv-tab.on {
  color: var(--amber);
  background: linear-gradient(180deg, rgba(255, 181, 71, 0.1), transparent);
  box-shadow: inset 0 3px 0 var(--amber);
}

.tv-badge {
  position: absolute;
  top: 6px;
  left: calc(50% + 8px);
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--red);
  color: #fff;
  font: 700 11px/18px var(--body);
  font-style: normal;
  letter-spacing: 0;
}

/* ---------- Tab content ---------- */
.tab {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 100%;
}

.panel-title {
  font: 700 20px var(--display);
  letter-spacing: 0.02em;
}

.panel-title .muted {
  margin-left: 8px;
  font: 400 13px var(--body);
  letter-spacing: 0;
}

.role-strip {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 6px 20px;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: linear-gradient(90deg, rgba(79, 209, 197, 0.08), rgba(14, 24, 43, 0.6));
}

.role-strip.saboteurs {
  border-color: #4a2330;
  background: linear-gradient(90deg, rgba(255, 94, 98, 0.1), rgba(14, 24, 43, 0.6));
}

.role-strip .callout {
  grid-column: 1 / -1;
}

.role-name {
  font: 700 30px/1 var(--display);
  letter-spacing: 0.02em;
}

.role-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  font-size: 13px;
  color: var(--dim);
}

.role-how {
  font-size: 14px;
  color: #c6d3ec;
}

.team-tag {
  padding: 1px 8px;
  border-radius: 999px;
  font: 600 11px/18px var(--display);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.team-tag.passengers {
  background: rgba(79, 209, 197, 0.14);
  color: var(--cyan);
}

.team-tag.saboteurs {
  background: rgba(255, 94, 98, 0.16);
  color: var(--red);
}

.callout {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid;
  font-size: 14px;
}

.callout.amber {
  background: rgba(255, 181, 71, 0.1);
  border-color: rgba(255, 181, 71, 0.35);
  color: #ffe1b0;
}

.callout.red {
  background: rgba(255, 94, 98, 0.1);
  border-color: rgba(255, 94, 98, 0.4);
  color: #ffd0d1;
}

.ability-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: rgba(14, 24, 43, 0.6);
}

.ability-title {
  font: 700 18px var(--display);
}

.option-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
}

.option {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  text-align: left;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: #0d182d;
}

.option span {
  font-size: 13px;
  color: var(--dim);
}

.option:hover:not(:disabled) {
  border-color: #3a5686;
}

.option.on {
  border-color: var(--amber);
  background: rgba(255, 181, 71, 0.08);
  box-shadow: inset 0 0 0 1px var(--amber);
}

.option:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.done-row {
  position: sticky;
  bottom: -16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0 -18px -16px;
  padding: 12px 18px;
  border-top: 1px solid rgba(120, 160, 255, 0.1);
  background: rgba(6, 12, 24, 0.94);
}

.notes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.note {
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid #16233d;
  background: rgba(14, 24, 43, 0.7);
  font-size: 14px;
}

.note .when {
  display: inline-block;
  min-width: 64px;
  margin-right: 8px;
  font: 600 11px var(--display);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--dim);
}

.note.private {
  border-color: rgba(185, 164, 255, 0.35);
}

.note.tag-explosion {
  border-color: rgba(255, 94, 98, 0.5);
  background: rgba(80, 20, 24, 0.45);
}

.note.tag-death,
.note.tag-sick {
  border-color: rgba(255, 94, 98, 0.35);
}

.note.tag-verdict,
.note.tag-gameover,
.note.tag-turbulence,
.note.tag-anomaly,
.note.tag-buckled {
  border-color: rgba(255, 181, 71, 0.4);
}

.note.tag-serve,
.note.tag-sweep,
.note.tag-inspect {
  border-color: rgba(79, 209, 197, 0.35);
}

.note.tag-saved,
.note.tag-cured {
  border-color: rgba(91, 227, 139, 0.4);
}

.ghost-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(185, 164, 255, 0.08), rgba(14, 24, 43, 0.6));
}

.ghost-card h2 {
  font-size: 26px;
}

/* ---------- Seat map ---------- */
.seatmap {
  --cell: clamp(28px, 5.4vh, 44px);
  display: grid;
  gap: 4px;
  grid-template-columns: 22px 36px repeat(var(--rows), minmax(30px, 1fr)) 44px;
  grid-template-rows: 18px repeat(3, var(--cell)) calc(var(--cell) * 0.6) repeat(3, var(--cell));
  padding: 10px;
  overflow-x: auto;
  border-radius: 14px;
  border: 1px solid #142039;
  background: rgba(4, 9, 18, 0.6);
}

.seatmap.vertical {
  --cell: 34px;
  grid-template-columns: 22px repeat(3, minmax(0, 1fr)) minmax(20px, 0.6fr) repeat(3, minmax(0, 1fr));
  grid-template-rows: 18px 30px repeat(var(--rows), var(--cell)) 40px;
}

.sm-num,
.sm-letter {
  display: grid;
  place-items: center;
  font: 600 11px var(--display);
  letter-spacing: 0.1em;
  color: var(--faint);
}

.sm-block {
  display: grid;
  place-items: center;
  border-radius: 8px;
  border: 1px solid #16233d;
  background: repeating-linear-gradient(135deg, #0b1426 0 6px, #0d172b 6px 12px);
  font: 600 11px var(--display);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--faint);
}

.seatmap:not(.vertical) .sm-galley span,
.seatmap:not(.vertical) .sm-crew span {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
}

.sm-lav {
  gap: 4px;
  background: #101b30;
  color: #9fb0cf;
}

.sm-lav.destroyed {
  background: radial-gradient(circle, #3b2415, #120b07 70%);
  color: #8a5a3a;
  text-decoration: line-through;
}

.sm-aisle {
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: repeating-linear-gradient(90deg, #0a1122 0 5px, #0c1427 5px 10px);
}

.seatmap.vertical .sm-aisle {
  background: repeating-linear-gradient(0deg, #0a1122 0 5px, #0c1427 5px 10px);
}

.sm-aisle.scorched,
.sm-seat.scorched {
  box-shadow: inset 0 0 12px rgba(255, 120, 40, 0.4);
}

.sm-cart {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: #d7dfee;
  filter: drop-shadow(0 0 6px rgba(79, 209, 197, 0.5));
}

.sm-seat {
  position: relative;
  display: grid;
  place-items: center;
  min-width: 0;
  padding: 0 2px;
  overflow: hidden;
  border-radius: 8px 8px 5px 5px;
  border: 1px solid #22365a;
  background: #15233c;
  color: var(--ink);
  font: 600 11px/1 var(--display);
  letter-spacing: 0.02em;
}

.sm-seat:disabled {
  opacity: 1;
  cursor: default;
}

.sm-seat.empty {
  border-color: #172641;
  background: #0c1629;
}

.sm-seat.dead {
  border-color: #4a1f26;
  background: #2a1418;
  color: #b56b73;
}

.sm-seat.you {
  z-index: 1;
  box-shadow: 0 0 0 2px var(--cyan), 0 0 16px rgba(79, 209, 197, 0.45);
}

.sm-seat.mate {
  border-color: var(--red);
  box-shadow: inset 0 0 0 1px rgba(255, 94, 98, 0.6);
}

.sm-seat.pick {
  border: 1px dashed var(--amber);
  cursor: pointer;
}

.sm-seat.pick:hover {
  background: #2b2410;
}

.sm-seat.selected {
  border-color: var(--amber);
  background: var(--amber);
  color: var(--amber-ink);
}

.sm-seat.preview {
  border-color: rgba(255, 94, 98, 0.8);
  background-image: linear-gradient(rgba(255, 94, 98, 0.38), rgba(255, 94, 98, 0.38));
}

.sm-stripe {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
}

.sm-name {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
}

.icon-bomb {
  color: var(--red);
  filter: drop-shadow(0 0 4px rgba(255, 94, 98, 0.8));
}

.sm-seat .icon-bomb {
  position: absolute;
  right: 2px;
  bottom: 2px;
}

.sm-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  font-size: 12px;
  color: var(--dim);
}

.sm-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.lg {
  display: inline-block;
  width: 14px;
  height: 12px;
  border-radius: 4px 4px 3px 3px;
  border: 1px solid #22365a;
  background: #15233c;
}

.lg.you {
  box-shadow: 0 0 0 2px var(--cyan);
}

.lg.empty {
  border-color: #172641;
  background: #0c1629;
}

.lg.dead {
  border-color: #4a1f26;
  background: #2a1418;
}

.lg.mate {
  border-color: var(--red);
}

/* ---------- Chat and votes ---------- */
.chat-tab .tv-chat {
  flex: 1;
  min-height: 160px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid #142039;
  background: rgba(4, 9, 18, 0.5);
}

.whisper-to {
  align-items: center;
}

.vote-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.vote-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 10px 12px;
  text-align: center;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: #0d182d;
}

.vote-card:hover:not(:disabled) {
  border-color: #3a5686;
}

.vote-card:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.vote-card.on {
  border-color: var(--red);
  background: rgba(255, 94, 98, 0.08);
  box-shadow: inset 0 0 0 1px var(--red);
}

.vote-card.skip.on {
  border-color: var(--amber);
  background: rgba(255, 181, 71, 0.08);
  box-shadow: inset 0 0 0 1px var(--amber);
}

.vote-name {
  font-weight: 600;
}

.vote-seat {
  font-size: 12px;
  color: var(--dim);
}

.vote-count {
  position: absolute;
  top: 8px;
  right: 10px;
  font: 700 22px var(--display);
  color: var(--amber);
}

.vote-voters {
  font-size: 11px;
  line-height: 1.3;
  color: var(--dim);
}

.tally {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tally li {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(14, 24, 43, 0.7);
}

.verdict-line {
  font: 700 24px var(--display);
}

/* ---------- Flight ---------- */
.flight-map {
  width: 100%;
  max-height: 210px;
}

.fm-route {
  fill: none;
  stroke: #22365a;
  stroke-width: 2;
  stroke-dasharray: 2 8;
  stroke-linecap: round;
}

.fm-done {
  fill: none;
  stroke: url(#fm-trail);
  stroke-width: 3;
  stroke-linecap: round;
}

.fm-dot {
  fill: #22365a;
}

.fm-dot.dest {
  fill: var(--amber);
}

.fm-label {
  fill: var(--dim);
  font: 600 13px var(--display);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.fm-label.dest {
  fill: var(--amber);
}

.fm-plane {
  fill: var(--ink);
  filter: drop-shadow(0 0 6px rgba(255, 181, 71, 0.6));
}

.flight-facts {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 18px;
}

/* ---------- Overlays ---------- */
.tv-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(3, 6, 12, 0.72);
  backdrop-filter: blur(3px);
  animation: fade-in 0.25s ease;
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
}

.tv-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  width: min(560px, 100%);
  max-height: 100%;
  overflow-y: auto;
  padding: 22px;
  border-radius: 18px;
  border: 1px solid #22365a;
  background: linear-gradient(180deg, #0f1c33, #0a1426);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}

.tv-card.wide {
  width: min(820px, 100%);
}

.tv-card h2 {
  font-size: 30px;
}

.tv-card .notes {
  width: 100%;
}

.pass {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 14px;
  background: var(--paper);
  color: var(--paper-ink);
}

.pass .label {
  color: #7a6f5c;
}

.pass-head {
  display: flex;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 2px dashed #c8bfad;
  font: 700 13px var(--display);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.pass-body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}

.pass-big {
  font: 700 26px/1.1 var(--display);
}

.pass-big.team.saboteurs {
  color: #c0392b;
}

.pass-big.team.passengers {
  color: #11756c;
}

.pass-blurb {
  font-style: italic;
}

.pass-allies {
  font-weight: 600;
  color: #a52a20;
}

.end-title {
  font-size: 44px !important;
}

.end-title.passengers {
  color: var(--cyan);
}

.end-title.saboteurs {
  color: var(--red);
}

.end-you {
  font: 700 18px var(--display);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--amber);
}

.role-reveal {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}

.role-reveal li {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid #16233d;
  background: rgba(14, 24, 43, 0.8);
}

.role-reveal li.saboteurs {
  border-color: rgba(255, 94, 98, 0.5);
}

.role-reveal .avatar {
  grid-row: 1 / 3;
}

.role-reveal .name {
  font-weight: 600;
}

.role-reveal .role {
  grid-column: 3;
  grid-row: 1;
  font: 600 13px var(--display);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--amber);
}

.role-reveal .status {
  grid-column: 2 / 4;
  font-size: 12px;
  color: var(--dim);
}

.blackbox {
  max-height: 320px;
  overflow-y: auto;
}

.tv-toast {
  position: absolute;
  left: 50%;
  bottom: 76px;
  z-index: 20;
  max-width: min(90%, 520px);
  padding: 10px 16px;
  transform: translateX(-50%);
  border-radius: 12px;
  border: 1px solid #6b2029;
  background: #2a1419;
  color: #ffd4d6;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

/* ---------- Phones ---------- */
@media (max-width: 760px), (max-height: 520px) {
  .tv {
    padding: 0;
    place-items: stretch;
  }

  .tv-bezel {
    width: 100%;
    height: 100dvh;
    padding: 0;
    border-radius: 0;
  }

  .tv-screen {
    border-radius: 0;
  }

  .tv-brand,
  .tv-logo {
    display: none;
  }

  .tv-header {
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 10px;
    padding: 10px 12px;
  }

  .tv-phase-title {
    font-size: 18px;
  }

  .tv-time {
    font-size: 24px;
  }

  .tv-body {
    padding: 12px;
  }

  .done-row {
    bottom: -12px;
    margin: 0 -12px -12px;
    padding: 10px 12px;
  }

  .role-strip {
    grid-template-columns: 1fr;
  }

  .tv-tab {
    font-size: 10px;
    letter-spacing: 0.08em;
  }
}

.ready-chip {
  margin-left: auto;
}

.ready-chip.on:disabled {
  opacity: 1;
  cursor: default;
}
```

- [ ] **Step 8: Run tests, type-check and build**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: all tests pass, no type errors, `dist/` produced.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(tv): seatback TV with map, actions, chat, votes, flight log and overlays"
```

---

### Task 8: Verify in the browser

- [ ] **Step 1:** Add `.claude/launch.json` with a `flight13` config (`npm run dev -- --port 5173 --strictPort`, port 5173) and start it with the preview tool.
- [ ] **Step 2:** Tab 1 at `/flight-13/`: enter a name, book a flight (London, Quick pace), land on the gate. Check the console is clean.
- [ ] **Step 3:** Tab 2 at `/flight-13/?p=2#/f/<code>`: board as a second passenger over real Trystero. Both manifests show two passengers.
- [ ] **Step 4:** Host adds three bots and takes off. Walk through a night (move, act), dawn, discussion, vote and verdict in both tabs, with screenshots. Play to the end screen and board again.
- [ ] **Step 5:** Check phone width (375 px) for the home page, gate and TV.

### Task 9: Deploy to GitHub Pages

- [ ] **Step 1: Workflow**

```yaml file=.github/workflows/deploy.yml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 2:** `gh repo create Teamingzooper/flight-13 --public --source . --remote origin`, push `main`, enable Pages with `gh api -X POST repos/Teamingzooper/flight-13/pages -f build_type=workflow`, watch the run, then open `https://teamingzooper.github.io/flight-13/` and repeat a two-tab boarding check against the live site.
