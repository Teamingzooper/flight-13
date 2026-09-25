import { describe, expect, it } from 'vitest';
import { botIntents } from './bots';
import { DESTINATION_ORDER, bombsFor, destinationOf } from './destinations';
import { applyIntent, phaseDue, tick } from './engine';
import { aisleRow, isSeatInCabin } from './grid';
import { isPilot, isStewardess } from './roles';
import { defaultSettings } from './settings';
import { createGame } from './setup';
import { TEST_LOOK } from './testkit';
import type { DestinationId, GameState, Settings } from './types';

function assertInvariants(s: GameState): void {
  const seats = s.players.map((p) => p.seat).filter((seat): seat is string => seat !== null);
  expect(new Set(seats).size).toBe(seats.length);
  for (const p of s.players) {
    if (p.status === 'restrained') expect(p.seat).toBeNull();
    else if (isStewardess(p.role)) expect(aisleRow(p.seat)).toBeLessThanOrEqual(s.cabin.rows);
    else if (isPilot(p.role)) expect(p.seat).toBe('Cockpit');
    else expect(p.seat !== null && isSeatInCabin(p.seat, s.cabin.rows)).toBe(true);
    if (p.status !== 'alive') {
      expect(p.cause).not.toBeNull();
      expect(p.outNight).not.toBeNull();
    }
  }
  expect(s.phase.night).toBeLessThanOrEqual(s.nights);
  // A bomb for every three nights, at most one a night, and one live bomb per spot.
  const planted = new Map<string, number>();
  for (const b of s.bombs) planted.set(b.planterId, (planted.get(b.planterId) ?? 0) + 1);
  for (const p of s.players) expect(p.bombsPlanted).toBe(planted.get(p.id) ?? 0);
  for (const n of planted.values()) expect(n).toBeLessThanOrEqual(bombsFor(destinationOf(s.settings).nights));
  expect(new Set(s.bombs.map((b) => `${b.planterId}@${b.plantedNight}`)).size).toBe(s.bombs.length);
  const live = s.bombs.filter((b) => !b.exploded && !b.defused).map((b) => (b.location.kind === 'seat' ? b.location.seat : b.location.kind));
  expect(new Set(live).size).toBe(live.length);
  expect(s.cabin.cartRow).toBeGreaterThanOrEqual(1);
  expect(s.cabin.cartRow).toBeLessThanOrEqual(s.cabin.rows);
  if (s.night.washroom) expect(s.players.find((p) => p.id === s.night.washroom)?.washroomUsed).toBe(true);
}

/** A long host-made flight with every effect at once. */
const WILD: Partial<Settings> = {
  destination: 'custom',
  customDestination: { city: 'Nowhere', code: 'NWH', nights: 10, twists: ['turbulence', 'redeye', 'triangle'] },
};

function simulate(seed: number, players: number, destination: DestinationId | Partial<Settings>): GameState {
  const settings = { ...defaultSettings(), ...(typeof destination === 'string' ? { destination } : destination), maxPassengers: players };
  const roster = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: TEST_LOOK }));
  let now = 0;
  const s = createGame({ settings, players: roster, seed, now });
  const bots = { rng: seed * 7919 + 1 };
  for (let step = 0; step < 400 && s.phase.kind !== 'ended'; step++) {
    for (const p of s.players) {
      for (const intent of botIntents(s, p.id, bots)) {
        const result = applyIntent(s, p.id, intent, now);
        if (!result.ok) throw new Error(`Bot intent rejected in ${s.phase.kind}: ${result.error} ${JSON.stringify(intent)}`);
      }
    }
    now = phaseDue(s);
    tick(s, now);
    assertInvariants(s);
  }
  return s;
}

describe('bot simulation', () => {
  it('every game ends cleanly across sizes and destinations', () => {
    const report: string[] = [];
    const reasons: Record<string, number> = {};
    let games = 0;
    for (let players = 4; players <= 16; players++) {
      const wins: Record<string, number> = { passengers: 0, saboteurs: 0, draw: 0 };
      for (const destination of [...DESTINATION_ORDER, WILD]) {
        // The long custom flight is the slowest to play out: fewer seeds.
        for (let seed = 1; seed <= (destination === WILD ? 3 : 6); seed++) {
          const s = simulate(seed * 1000 + players, players, destination);
          expect(s.phase.kind).toBe('ended');
          expect(s.result).not.toBeNull();
          wins[s.result!.winner]++;
          reasons[s.result!.reason] = (reasons[s.result!.reason] ?? 0) + 1;
          games++;
        }
      }
      report.push(`${String(players).padStart(2)} players: passengers ${wins.passengers}, saboteurs ${wins.saboteurs}, draw ${wins.draw}`);
    }
    // Vitest hides console output of passing tests; stderr always shows.
    if (process.env.SIM_REPORT) process.stderr.write(`${report.join('\n')}\nby reason: ${JSON.stringify(reasons)}\n`);
    expect(games).toBe(13 * (5 * 6 + 3));
    // 429 whole games: allow for a busy machine running the other test files alongside.
  }, 60_000);
});
