import { describe, expect, it } from 'vitest';
import { emptyCards } from './roles';
import { defaultSettings } from './settings';
import { checkTakeoff, createGame, dealRoles, type NewPlayer } from './setup';
import type { Look } from './types';

const LOOK: Look = { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, topStyle: 0, bottom: 0 };
const passengers = (n: number): NewPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: LOOK }));

describe('createGame', () => {
  it('deals the preset roles and gives everyone a distinct seat', () => {
    const s = createGame({ settings: { ...defaultSettings(), maxPassengers: 10 }, players: passengers(10), seed: 5, now: 0 });
    const roles = s.players.map((p) => p.role);
    expect(roles.filter((r) => r === 'bomber')).toHaveLength(2);
    expect(roles.filter((r) => r === 'mastermind')).toHaveLength(1);
    expect(roles.filter((r) => r.startsWith('stewardess'))).toHaveLength(1);
    expect(new Set(s.players.map((p) => p.seat)).size).toBe(10);
    expect(s.cabin.rows).toBe(10);
    expect(s.nights).toBe(5);
    expect(s.phase).toMatchObject({ kind: 'takeoff', night: 0, endsAt: 12_000 });
  });

  it('is deterministic for a seed', () => {
    const make = () => createGame({ settings: defaultSettings(), players: passengers(8), seed: 77, now: 0 });
    expect(make().players).toEqual(make().players);
  });

  it('turns the stewardess rogue or loyal according to the odds', () => {
    const cards = { ...emptyCards(), stewardess: 1 };
    expect(dealRoles({ rng: 1 }, cards, 4, 1)).toContain('stewardess_rogue');
    expect(dealRoles({ rng: 1 }, cards, 4, 0)).toContain('stewardess_loyal');
  });

  it('refuses to take off with too few passengers or a bad custom deck', () => {
    expect(checkTakeoff(defaultSettings(), passengers(3))).toMatch(/at least 4/);
    const custom = { ...defaultSettings(), rolesMode: 'custom' as const, cards: { ...emptyCards(), bomber: 3 } };
    expect(checkTakeoff(custom, passengers(6))).toMatch(/minority/);
    expect(() => createGame({ settings: custom, players: passengers(6), seed: 1, now: 0 })).toThrow();
  });
});
