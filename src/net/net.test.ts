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
