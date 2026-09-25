import { describe, expect, it } from 'vitest';
import { defaultSettings, type Look } from '../engine';
import { ClientSession } from './client';
import { CAPTAIN_GRACE_MS, MOVE_TICKET_MS, HostSession, newHostSnapshot } from './host';
import { MemoryHub } from './transport';

const LOOK: Look = { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, topStyle: 0, bottom: 0 };
const CAPTAIN = 'captain-token-0001';

async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A flight run by the server: no in-page client, everyone (the captain too) joins over the network. */
function serverFlight(opts: { controlTower?: boolean } = {}) {
  let now = 1_000;
  let seed = 0.37;
  const hub = new MemoryHub();
  let ended = 0;
  const host = new HostSession({
    network: hub.join('server'),
    snapshot: newHostSnapshot('TEST', CAPTAIN, { ...defaultSettings(), maxPassengers: 8 }, opts.controlTower ?? false),
    serverHosted: true,
    onEnd: () => void ended++,
    now: () => now,
    random: () => (seed = (seed * 997 + 0.123) % 1),
    defer: (fn) => void setTimeout(fn, 0),
  });
  const board = (name: string, token = `${name.toLowerCase()}-token-0001`, move?: string) => {
    const transport = hub.join();
    const client = new ClientSession({ transport, code: 'TEST', token, name, look: LOOK, move, now: () => now });
    return { client, leave: () => client.close() };
  };
  return { host, board, advance: (ms: number) => void (now += ms), ended: () => ended };
}

describe('server flights', () => {
  it('the captain is whoever holds the booking token, on any device', async () => {
    const { board } = serverFlight();
    const cap = board('Cap', CAPTAIN);
    const ann = board('Ann');
    await settle();
    expect(cap.client.snapshot.state!.isHost).toBe(true);
    expect(ann.client.snapshot.state!.isHost).toBe(false);
    expect(await ann.client.command({ kind: 'addBot' })).toEqual({ ok: false, error: 'Only the host can do that.' });
    expect(await cap.client.command({ kind: 'addBot' })).toEqual({ ok: true });
  });

  it("a control tower flight's captain joins as the tower", async () => {
    const { board } = serverFlight({ controlTower: true });
    const cap = board('Cap', CAPTAIN);
    const ann = board('Ann');
    await settle();
    expect(cap.client.snapshot.state!.you).toBeNull();
    expect(cap.client.snapshot.state!.isHost).toBe(true);
    expect(ann.client.snapshot.state!.players.map((p) => p.name)).toEqual(['Ann']);
  });

  it('the flight carries on without the captain, and someone else takes over after a while', async () => {
    const { host, board, advance } = serverFlight();
    const cap = board('Cap', CAPTAIN);
    const ann = board('Ann');
    const bob = board('Bob');
    await settle();
    cap.leave();
    await settle();
    advance(CAPTAIN_GRACE_MS - 1000);
    host.tickNow();
    await settle();
    expect(ann.client.snapshot.state!.isHost).toBe(false);
    advance(2000);
    host.tickNow();
    await settle();
    // Ann boarded before Bob.
    expect(ann.client.snapshot.state!.isHost).toBe(true);
    expect(bob.client.snapshot.state!.isHost).toBe(false);
    expect(host.snapshot.hostToken).toBe('ann-token-0001');
    // The old captain is an ordinary passenger when they come back.
    const back = board('Cap', CAPTAIN);
    await settle();
    expect(back.client.snapshot.state!.isHost).toBe(false);
  });

  it('pauses while nobody is aboard and gives the time back', async () => {
    const { host, board, advance } = serverFlight();
    const cap = board('Cap', CAPTAIN);
    await settle();
    for (let i = 0; i < 4; i++) await cap.client.command({ kind: 'addBot' });
    expect(await cap.client.command({ kind: 'takeoff' })).toEqual({ ok: true });
    await settle();
    const endsAt = host.snapshot.game!.phase.endsAt;
    host.idle(true);
    advance(600_000);
    host.tickNow();
    expect(host.snapshot.game!.phase.endsAt).toBe(endsAt);
    host.idle(false);
    expect(host.snapshot.pausedAt).toBeNull();
    expect(host.snapshot.game!.phase.endsAt).toBe(endsAt + 600_000);
  });

  it('the captain can end the flight for everyone', async () => {
    const { board, ended } = serverFlight();
    const cap = board('Cap', CAPTAIN);
    const ann = board('Ann');
    await settle();
    expect(await ann.client.command({ kind: 'end' })).toEqual({ ok: false, error: 'Only the host can do that.' });
    expect(await cap.client.command({ kind: 'end' })).toEqual({ ok: true });
    await settle();
    expect(ended()).toBe(1);
    expect(ann.client.snapshot.status).toBe('refused');
    expect(ann.client.snapshot.reason).toBe('The captain ended this flight.');
  });

  it('moves a seat to another device mid-flight: same seat and role, and the old screen leaves', async () => {
    const { host, board } = serverFlight();
    const cap = board('Cap', CAPTAIN);
    const laptop = board('Ann');
    await settle();
    for (let i = 0; i < 4; i++) await cap.client.command({ kind: 'addBot' });
    await cap.client.command({ kind: 'takeoff' });
    await settle();
    const seat = laptop.client.snapshot.state!.you;
    const role = laptop.client.snapshot.state!.game!.you!.role;
    const ticket = await laptop.client.requestMove();
    if (!ticket.ok) throw new Error(ticket.error);
    const phone = board('Phone default', 'ann-phone-token-01', ticket.ticket);
    await settle();
    expect(phone.client.snapshot.state!.you).toBe(seat);
    expect(phone.client.snapshot.state!.game!.you!.role).toBe(role);
    expect(phone.client.snapshot.state!.players.find((p) => p.id === seat)!.name).toBe('Ann');
    expect(laptop.client.snapshot.status).toBe('refused');
    expect(laptop.client.snapshot.reason).toBe('You moved to another device. This screen has left the flight.');
    // Used once: the ticket is gone, and the phone's own token finds the seat from now on.
    expect(host.snapshot.moves).toEqual({});
    phone.leave();
    await settle();
    const again = board('Phone default', 'ann-phone-token-01');
    await settle();
    expect(again.client.snapshot.state!.you).toBe(seat);
  });

  it('the captaincy moves with the captain', async () => {
    const { board } = serverFlight();
    const cap = board('Cap', CAPTAIN);
    await settle();
    const ticket = await cap.client.requestMove();
    if (!ticket.ok) throw new Error(ticket.error);
    const phone = board('Cap', 'cap-phone-token-01', ticket.ticket);
    await settle();
    expect(phone.client.snapshot.state!.isHost).toBe(true);
    expect(cap.client.snapshot.status).toBe('refused');
  });

  it('a control tower moves to another screen', async () => {
    const { board } = serverFlight({ controlTower: true });
    const tower = board('Tower', CAPTAIN);
    await settle();
    const ticket = await tower.client.requestMove();
    if (!ticket.ok) throw new Error(ticket.error);
    const tv = board('Tv', 'tower-tv-token-001', ticket.ticket);
    await settle();
    expect(tv.client.snapshot.state!.you).toBeNull();
    expect(tv.client.snapshot.state!.isHost).toBe(true);
    expect(tower.client.snapshot.status).toBe('refused');
  });

  it('an old or used ticket does not work', async () => {
    const { board, advance } = serverFlight();
    board('Cap', CAPTAIN);
    const ann = board('Ann');
    await settle();
    const ticket = await ann.client.requestMove();
    if (!ticket.ok) throw new Error(ticket.error);
    advance(MOVE_TICKET_MS + 1);
    const late = board('Late', 'late-token-000001', ticket.ticket);
    await settle();
    expect(late.client.snapshot.status).toBe('refused');
    expect(late.client.snapshot.reason).toMatch(/expired/);
    expect(ann.client.snapshot.status).toBe('joined');
  });
});
