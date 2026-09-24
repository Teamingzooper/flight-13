import { describe, expect, it } from 'vitest';
import { defaultSettings, type Look } from '../engine';
import { ClientSession } from './client';
import { HostSession, newHostSnapshot } from './host';
import { parseClientMessage } from './protocol';
import { MemoryHub } from './transport';

const LOOK: Look = { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, topStyle: 0, bottom: 0 };

async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function flight() {
  let now = 1_000;
  const network = new MemoryHub();
  const local = new MemoryHub();
  const host = new HostSession({
    network: network.join('host'),
    local: local.join('host-local'),
    snapshot: newHostSnapshot('TEST', 'host-token-0001', { ...defaultSettings(), maxPassengers: 8 }, false),
    now: () => now,
    random: () => 0.5,
    defer: (fn) => void setTimeout(fn, 0),
  });
  const captain = new ClientSession({ transport: local.join('local'), code: 'TEST', token: 'host-token-0001', name: 'Captain', look: LOOK, now: () => now });
  const board = (name: string) => new ClientSession({ transport: network.join(), code: 'TEST', token: `${name}-token-0001`, name, look: LOOK, now: () => now });
  return { host, captain, board, advance: (ms: number) => void (now += ms) };
}

describe('pose channel', () => {
  it('relays where a passenger is looking to everyone else', async () => {
    const { host, captain, board, advance } = flight();
    const ann = board('Ann');
    await settle();
    ann.sendPose({ yaw: 0.5, pitch: -0.2, lean: true });
    await settle();
    advance(200);
    host.tickNow();
    await settle();
    expect(captain.poses.get(ann.playerId!)).toEqual({ yaw: 0.5, pitch: -0.2, lean: true });
  });

  it('never shows who is using their screen at night', async () => {
    const { host, captain, board, advance } = flight();
    const ann = board('Ann');
    await settle();
    for (let i = 0; i < 3; i++) await captain.command({ kind: 'addBot' });
    await captain.command({ kind: 'takeoff' });
    await settle();
    advance(13_000);
    host.tickNow();
    await settle();
    expect(captain.snapshot.state!.game!.phase.kind).toBe('night_move');
    ann.sendPose({ yaw: 0.1, pitch: 0, lean: true });
    await settle();
    advance(200);
    host.tickNow();
    await settle();
    expect(captain.poses.get(ann.playerId!)).toEqual({ yaw: 0.1, pitch: 0, lean: false });
  });

  it('forgets the pose of a passenger who leaves', async () => {
    const { host, captain, board, advance } = flight();
    const ann = board('Ann');
    await settle();
    ann.sendPose({ yaw: 0.5, pitch: -0.2, lean: true });
    await settle();
    advance(200);
    host.tickNow();
    await settle();
    const id = ann.playerId!;
    expect(captain.poses.has(id)).toBe(true);
    ann.close();
    await settle();
    advance(200);
    host.tickNow();
    await settle();
    expect(captain.poses.has(id)).toBe(false);
  });

  it('cleans up pose messages', () => {
    expect(parseClientMessage({ t: 'pose', yaw: 99, pitch: -5, lean: 'yes' })).toEqual({ t: 'pose', yaw: Math.PI, pitch: -1.3, lean: false });
    expect(parseClientMessage({ t: 'pose', yaw: Number.NaN, pitch: 0 })).toBeNull();
  });
});
