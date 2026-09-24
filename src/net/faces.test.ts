import { describe, expect, it } from 'vitest';
import { defaultSettings, type Look } from '../engine';
import { ClientSession } from './client';
import { FACE_TEMPLATES } from './face';
import { HostSession, newHostSnapshot } from './host';
import { MemoryHub } from './transport';

const LOOK: Look = { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, topStyle: 0, bottom: 0 };
const SMILE = FACE_TEMPLATES[0].face;
const GRUMPY = FACE_TEMPLATES[3].face;

async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function flight() {
  const network = new MemoryHub();
  const local = new MemoryHub();
  const host = new HostSession({
    network: network.join('host'),
    local: local.join('host-local'),
    snapshot: newHostSnapshot('TEST', 'host-token-0001', { ...defaultSettings(), maxPassengers: 8 }, false),
    now: () => 1000,
    random: () => 0.5,
    defer: (fn) => void setTimeout(fn, 0),
  });
  const captain = new ClientSession({ transport: local.join('local'), code: 'TEST', token: 'host-token-0001', name: 'Captain', look: LOOK });
  const board = (name: string, face?: string) =>
    new ClientSession({ transport: network.join(), code: 'TEST', token: `${name}-token-0001`, name, look: LOOK, face });
  return { host, captain, board };
}

describe('painted faces', () => {
  it('reach everyone on the flight, and follow profile changes while boarding', async () => {
    const { captain, board } = flight();
    const ann = board('Ann', SMILE);
    await settle();
    expect(captain.faces.get(ann.playerId!)).toBe(SMILE);
    expect(ann.faces.get(ann.playerId!)).toBe(SMILE);
    ann.updateProfile('Ann', LOOK, GRUMPY);
    await settle();
    expect(captain.faces.get(ann.playerId!)).toBe(GRUMPY);
  });

  it('give bots a ready-made face, and ignore junk', async () => {
    const { captain, board } = flight();
    await settle();
    await captain.command({ kind: 'addBot' });
    await settle();
    const bot = captain.snapshot.state!.players.find((p) => p.bot)!;
    expect(FACE_TEMPLATES.map((t) => t.face)).toContain(captain.faces.get(bot.id));
    const eve = board('Eve', 'not a face!');
    await settle();
    expect(captain.faces.has(eve.playerId!)).toBe(false);
  });
});
