import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../engine';
import { ClientSession } from './client';
import { HostSession, newHostSnapshot } from './host';
import { MemoryHub } from './transport';
import { VOICE_FAR, VOICE_NEAR, micOpen, proximityGain, sendsTo, voiceRoute } from './voiceRules';

describe('voice rules', () => {
  it('carries living voices through the cabin by day, to the living and the ghosts', () => {
    expect(voiceRoute('day_discuss', true, true)).toBe('cabin');
    expect(voiceRoute('day_vote', true, false)).toBe('cabin');
    expect(voiceRoute('takeoff', true, true)).toBe('cabin');
  });

  it('keeps the cabin silent at night and while packing', () => {
    expect(voiceRoute('night_move', true, true)).toBeNull();
    expect(voiceRoute('night_act', true, false)).toBeNull();
    expect(voiceRoute('packing', true, true)).toBeNull();
    expect(micOpen('night_act', true)).toBe(false);
    expect(micOpen('boarding', true)).toBe(false);
    expect(micOpen('day_discuss', true)).toBe(true);
  });

  it('lets ghosts talk among themselves any time, never to the living', () => {
    expect(voiceRoute('night_act', false, false)).toBe('ghosts');
    expect(voiceRoute('day_discuss', false, true)).toBeNull();
    expect(micOpen('night_move', false)).toBe(true);
    expect(sendsTo('day_discuss', false, true)).toBe(false);
    expect(sendsTo('day_discuss', false, false)).toBe(true);
    expect(sendsTo('night_act', true, true)).toBe(true);
  });

  it('opens everything up once the plane has landed', () => {
    expect(voiceRoute('ended', false, true)).toBe('everyone');
    expect(micOpen('ended', false)).toBe(true);
    expect(sendsTo('ended', false, true)).toBe(true);
  });

  it('fades voices out with distance', () => {
    expect(proximityGain(0.5)).toBe(1);
    expect(proximityGain(VOICE_NEAR)).toBe(1);
    expect(proximityGain(VOICE_FAR)).toBe(0);
    expect(proximityGain(20)).toBe(0);
    const mid = proximityGain((VOICE_NEAR + VOICE_FAR) / 2);
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.5);
    expect(proximityGain(3)).toBeGreaterThan(proximityGain(4));
  });
});

describe('voice peers', () => {
  it('the host tells everyone which network peer is which player, while their voice is on', async () => {
    const look = { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, topStyle: 0, bottom: 0 };
    const settle = async () => {
      for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const network = new MemoryHub();
    const local = new MemoryHub();
    const hostNet = network.join('host-net');
    new HostSession({
      network: hostNet,
      local: local.join('host-local'),
      snapshot: newHostSnapshot('TEST', 'host-token-0001', { ...defaultSettings(), maxPassengers: 8 }, false),
      now: () => 1_000,
      random: () => 0.5,
      defer: (fn) => void setTimeout(fn, 0),
    });
    const captain = new ClientSession({ transport: local.join('local'), code: 'TEST', token: 'host-token-0001', name: 'Captain', look });
    const annNet = network.join('ann-net');
    const ann = new ClientSession({ transport: annNet, code: 'TEST', token: 'ann-token-0001', name: 'Ann', look });
    await settle();
    expect(captain.snapshot.state?.voice).toEqual({});
    ann.sendVoice(true);
    captain.sendVoice(true);
    await settle();
    // Ann by her own network id; the captain (on the host's browser) by the host's.
    expect(ann.snapshot.state?.voice).toEqual({ 'ann-net': ann.playerId, 'host-net': captain.playerId });
    ann.sendVoice(false);
    await settle();
    expect(captain.snapshot.state?.voice).toEqual({ 'host-net': captain.playerId });
  });
});
