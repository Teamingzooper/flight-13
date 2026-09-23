import { DESTINATIONS } from './destinations';
import { isSaboteur } from './roles';
import { activePlayers } from './state';
import type { GameResult, GameState } from './types';

export function checkWin(s: GameState): GameResult | null {
  const active = activePlayers(s);
  const saboteurs = active.filter((p) => isSaboteur(p.role)).length;
  const passengers = active.length - saboteurs;
  const night = s.phase.night;
  if (active.length === 0) return { winner: 'draw', reason: 'no_survivors', night };
  if (saboteurs === 0) return { winner: 'passengers', reason: 'eliminated', night };
  if (saboteurs >= passengers) return { winner: 'saboteurs', reason: 'parity', night };
  return null;
}

/** The plane is on the ground: any saboteur still free walks off. */
export function landingResult(s: GameState): GameResult {
  return checkWin(s) ?? { winner: 'saboteurs', reason: 'landed', night: s.phase.night };
}

export function resultText(s: GameState, r: GameResult): string {
  const city = DESTINATIONS[s.settings.destination].city;
  switch (r.reason) {
    case 'eliminated':
      return 'Every saboteur has been dealt with. Passengers win!';
    case 'parity':
      return 'The saboteurs now outnumber everyone else and take over the plane. Saboteurs win!';
    case 'landed':
      return `Flight 13 landed in ${city} with saboteurs still aboard. They slip away into the terminal. Saboteurs win!`;
    case 'no_survivors':
      return 'Nobody is left. There are no winners on Flight 13.';
  }
}
