import { describe, expect, it } from 'vitest';
import { botIntents } from './bots';
import { DESTINATION_ORDER } from './destinations';
import { applyIntent, phaseDue, tick } from './engine';
import { aisleRow, isSeatInCabin } from './grid';
import { isStewardess } from './roles';
import { defaultSettings } from './settings';
import { createGame } from './setup';
import { TEST_LOOK } from './testkit';
import type { DestinationId, GameState } from './types';

function assertInvariants(s: GameState): void {
  const seats = s.players.map((p) => p.seat).filter((seat): seat is string => seat !== null);
  expect(new Set(seats).size).toBe(seats.length);
  for (const p of s.players) {
    if (p.status === 'restrained') expect(p.seat).toBeNull();
    else if (isStewardess(p.role)) expect(aisleRow(p.seat)).toBeLessThanOrEqual(s.cabin.rows);
    else expect(p.seat !== null && isSeatInCabin(p.seat, s.cabin.rows)).toBe(true);
    if (p.status !== 'alive') {
      expect(p.cause).not.toBeNull();
      expect(p.outNight).not.toBeNull();
    }
  }
  expect(s.phase.night).toBeLessThanOrEqual(s.nights);
  const planters = s.bombs.map((b) => b.planterId);
  expect(new Set(planters).size).toBe(planters.length);
  expect(s.cabin.cartRow).toBeGreaterThanOrEqual(1);
  expect(s.cabin.cartRow).toBeLessThanOrEqual(s.cabin.rows);
  if (s.night.washroom) expect(s.players.find((p) => p.id === s.night.washroom)?.washroomUsed).toBe(true);
}

function simulate(seed: number, players: number, destination: DestinationId): GameState {
  const settings = { ...defaultSettings(), destination, maxPassengers: players };
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
      for (const destination of DESTINATION_ORDER) {
        for (let seed = 1; seed <= 6; seed++) {
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
    expect(games).toBe(13 * 5 * 6);
    // 390 whole games: allow for a busy machine running the other test files alongside.
  }, 30_000);
});
