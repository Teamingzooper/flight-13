import { isCustomRole, teamOf, type RoleId } from '../engine';
import type { HostSnapshot } from './host';

/** One passenger's result, for their account's stats. */
export interface FlightResult {
  /** Their player token (the account that has it gets the result). */
  token: string;
  /** The role, or 'custom-passengers' / 'custom-saboteurs' for a role made up for that flight. */
  role: string;
  won: boolean;
}

/** The key a role's results are counted under. */
export function statsRole(role: RoleId): string {
  return isCustomRole(role) ? `custom-${teamOf(role)}` : role;
}

/** Everyone's result once the flight has landed (people only, not bots); null before then. */
export function flightResults(s: HostSnapshot): FlightResult[] | null {
  const game = s.game;
  if (!game || game.phase.kind !== 'ended' || !game.result || s.tutorial) return null;
  const results: FlightResult[] = [];
  for (const p of game.players) {
    const person = s.players.find((x) => x.id === p.id);
    if (!person || person.bot || !person.token) continue;
    results.push({ token: person.token, role: statsRole(p.role), won: game.result.winner === teamOf(p.role) });
  }
  return results;
}
