import { describe, expect, it } from 'vitest';
import { giveRole, isSaboteur } from './roles';
import { defaultSettings } from './settings';
import { createGame } from './setup';
import { TEST_LOOK, logTexts } from './testkit';
import type { RoleId } from './types';

const count = (deck: readonly RoleId[], role: RoleId) => deck.filter((r) => r === role).length;
const saboteurs = (deck: readonly RoleId[]) => deck.filter(isSaboteur).length;

describe('the host picking their own role', () => {
  const deck: RoleId[] = ['passenger', 'bomber', 'nurse', 'passenger', 'stewardess_loyal', 'pilot', 'investigator', 'passenger'];

  it('swaps with whoever drew it', () => {
    const out = giveRole(deck, 0, 'nurse') as RoleId[];
    expect(out[0]).toBe('nurse');
    expect(out[2]).toBe('passenger');
    expect([...out].sort()).toEqual([...deck].sort());
  });

  it('makes a role nobody drew out of a card of the same team, so the teams keep their size', () => {
    const marshal = giveRole(deck, 1, 'marshal') as RoleId[];
    expect(marshal[1]).toBe('marshal');
    expect(count(marshal, 'passenger')).toBe(2);
    expect(saboteurs(marshal)).toBe(1);
    const mastermind = giveRole(deck, 0, 'mastermind') as RoleId[];
    expect(mastermind[0]).toBe('mastermind');
    expect(count(mastermind, 'bomber')).toBe(0);
    expect(saboteurs(mastermind)).toBe(1);
  });

  it('turns the dealt Stewardess or Pilot while the saboteurs stay outnumbered', () => {
    const rogue = giveRole(deck, 0, 'stewardess_rogue') as RoleId[];
    expect(rogue[0]).toBe('stewardess_rogue');
    expect(count(rogue, 'stewardess_loyal')).toBe(0);
    expect(saboteurs(rogue)).toBe(2);
    const pilot = giveRole(deck, 3, 'pilot_rogue') as RoleId[];
    expect(pilot[3]).toBe('pilot_rogue');
    expect(count(pilot, 'pilot')).toBe(0);
    // Four aboard, one of them the Bomber: a second saboteur would make it even, so the Stewardess comes out of the Bomber.
    const small: RoleId[] = ['passenger', 'bomber', 'stewardess_loyal', 'passenger'];
    const out = giveRole(small, 0, 'stewardess_rogue') as RoleId[];
    expect(out[0]).toBe('stewardess_rogue');
    expect(saboteurs(out)).toBe(1);
    expect(giveRole(['passenger', 'bomber', 'pilot', 'passenger'], 0, 'pilot_rogue')).toMatch(/too strong/);
  });

  it('gives the host the role at takeoff, and a random one with a note when it cannot', () => {
    const players = ['host', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id, look: TEST_LOOK }));
    for (const role of ['bomber', 'nurse', 'investigator', 'pilot', 'passenger', 'stewardess_rogue'] as RoleId[]) {
      for (let seed = 1; seed <= 5; seed++) {
        const s = createGame({ settings: { ...defaultSettings(), maxPassengers: 6 }, players, seed, now: 0, chosen: { player: 'host', role } });
        expect(s.players[0].role).toBe(role);
        expect(saboteurs(s.players.map((p) => p.role)) * 2).toBeLessThan(6);
      }
    }
    const four = players.slice(0, 4);
    const s = createGame({ settings: { ...defaultSettings(), maxPassengers: 4 }, players: four, seed: 3, now: 0, chosen: { player: 'host', role: 'pilot_rogue' } });
    expect(s.players[0].role).not.toBe('pilot_rogue');
    expect(logTexts(s, 'host')[0]).toMatch(/^You could not be the Rogue Pilot this flight/);
  });
});
