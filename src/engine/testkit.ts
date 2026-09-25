import { phaseDue, tick } from './engine';
import { defaultSettings } from './settings';
import { createGame } from './setup';
import { getPlayer } from './state';
import type { DestinationId, GameState, Look, PhaseKind, PlayerState, RoleId, SeatId, Settings } from './types';

export const TEST_LOOK: Look = { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, topStyle: 0, bottom: 0 };

export interface TestPlayer {
  id: string;
  role: RoleId;
  seat: SeatId;
}

/** A game at takeoff with exactly these roles and seats (an 8-row cabin unless more players). */
export function makeGame(
  players: TestPlayer[],
  opts: { destination?: DestinationId | 'custom'; settings?: Partial<Settings> } = {},
): GameState {
  const settings: Settings = {
    ...defaultSettings(),
    maxPassengers: Math.max(8, players.length),
    destination: opts.destination ?? 'LHR',
    ...opts.settings,
  };
  const s = createGame({
    settings,
    players: players.map((tp) => ({ id: tp.id, name: tp.id, look: TEST_LOOK })),
    seed: 1,
    now: 0,
  });
  for (const tp of players) {
    const p = getPlayer(s, tp.id)!;
    p.role = tp.role;
    p.seat = tp.seat;
  }
  return s;
}

/** Let the current phase run out; returns the new phase kind. */
export function endPhase(s: GameState): PhaseKind {
  tick(s, phaseDue(s));
  return s.phase.kind;
}

/** Run phases until `kind` (optionally of a given night) starts. */
export function advanceTo(s: GameState, kind: PhaseKind, night?: number): void {
  for (let i = 0; i < 60; i++) {
    if (s.phase.kind === kind && (night === undefined || s.phase.night === night)) return;
    if (s.phase.kind === 'ended') break;
    endPhase(s);
  }
  throw new Error(`Never reached ${kind}${night === undefined ? '' : ` of night ${night}`}; stuck in ${s.phase.kind}`);
}

export function player(s: GameState, id: string): PlayerState {
  const p = getPlayer(s, id);
  if (!p) throw new Error(`No player ${id}`);
  return p;
}

/** Texts of log entries addressed to `to` ('all', 'end', 'saboteurs' or a player id). */
export function logTexts(s: GameState, to: string): string[] {
  return s.log.filter((e) => e.to === to || (Array.isArray(e.to) && e.to.includes(to))).map((e) => e.text);
}
