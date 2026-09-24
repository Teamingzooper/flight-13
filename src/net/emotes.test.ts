import { describe, expect, it } from 'vitest';
import { defaultSettings, type Look, type PhaseKind } from '../engine';
import { ClientSession } from './client';
import { canEmote } from './emotes';
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
  const ann = new ClientSession({ transport: network.join(), code: 'TEST', token: 'ann-token-0001', name: 'Ann', look: LOOK, now: () => now });
  const advance = (ms: number) => void (now += ms);
  /** Take off with a few bots, then run the phases out until `kind`. */
  const flyTo = async (kind: PhaseKind) => {
    for (let i = 0; i < 3; i++) await captain.command({ kind: 'addBot' });
    await captain.command({ kind: 'takeoff' });
    await settle();
    for (let i = 0; i < 400 && captain.snapshot.state!.game!.phase.kind !== kind; i++) {
      advance(1000);
      host.tickNow();
      await settle();
    }
    expect(captain.snapshot.state!.game!.phase.kind).toBe(kind);
  };
  return { host, captain, ann, advance, flyTo };
}

describe('emotes', () => {
  it('are for people in play while the lights are on', () => {
    expect(canEmote('day_discuss', 'alive')).toBe(true);
    expect(canEmote('verdict', 'alive')).toBe(true);
    expect(canEmote('night_act', 'alive')).toBe(false);
    expect(canEmote('packing', 'alive')).toBe(false);
    expect(canEmote('day_vote', 'dead')).toBe(false);
    expect(canEmote('day_vote', 'restrained')).toBe(false);
  });

  it('only accepts gestures it knows', () => {
    expect(parseClientMessage({ t: 'emote', emote: 'wave' })).toEqual({ t: 'emote', emote: 'wave' });
    expect(parseClientMessage({ t: 'emote', emote: 'moon' })).toBeNull();
  });

  it('shows a daytime gesture to everyone, the sender included', async () => {
    const { captain, ann, flyTo } = flight();
    await settle();
    await flyTo('day_discuss');
    ann.sendEmote('wave');
    await settle();
    expect(captain.emotes.get(ann.playerId!)?.emote).toBe('wave');
    expect(ann.emotes.get(ann.playerId!)?.emote).toBe('wave');
  });

  it('ignores gestures in the dark, and anyone gesturing too fast', async () => {
    const { captain, ann, advance, flyTo } = flight();
    await settle();
    await flyTo('night_move');
    ann.sendEmote('wave');
    await settle();
    expect(captain.emotes.size).toBe(0);
    await flyTo('day_discuss');
    ann.sendEmote('clap');
    ann.sendEmote('shrug');
    await settle();
    const first = captain.emotes.get(ann.playerId!);
    expect(first?.emote).toBe('clap');
    advance(1500);
    ann.sendEmote('shrug');
    await settle();
    expect(captain.emotes.get(ann.playerId!)).toEqual({ emote: 'shrug', seq: first!.seq + 1 });
  });
});
