import { isSaboteur } from './roles';
import { statsOf } from './state';
import type { Award, GameResult, GameState } from './types';

export const CREDITS = { win: 100, landed: 50, rescue: 10, kill: 10 } as const;

/** The plane touches down at its destination (passengers alive then earn the landing bonus). */
export function planeLands(result: GameResult): boolean {
  return result.reason === 'eliminated' || result.reason === 'landed';
}

/**
 * Flight credits for everyone once the game is over. Passengers: a win, being alive at landing, and each
 * life the Nurse's treatment saved. Saboteurs: each passenger killed by their bomb or poison, and a win.
 */
export function computeAwards(s: GameState, result: GameResult): Record<string, Award> {
  const awards: Record<string, Award> = {};
  for (const p of s.players) {
    const stats = statsOf(s, p.id);
    const lines: Award['lines'] = [];
    if (isSaboteur(p.role)) {
      if (stats.kills > 0) lines.push({ label: stats.kills === 1 ? '1 passenger taken out' : `${stats.kills} passengers taken out`, credits: stats.kills * CREDITS.kill });
      if (result.winner === 'saboteurs') lines.push({ label: 'Saboteurs won', credits: CREDITS.win });
    } else {
      if (result.winner === 'passengers') lines.push({ label: 'Passengers won', credits: CREDITS.win });
      if (p.status === 'alive' && planeLands(result)) lines.push({ label: 'Alive at landing', credits: CREDITS.landed });
      if (stats.rescues > 0) lines.push({ label: stats.rescues === 1 ? 'Saved a life' : `Saved ${stats.rescues} lives`, credits: stats.rescues * CREDITS.rescue });
    }
    awards[p.id] = { credits: lines.reduce((sum, l) => sum + l.credits, 0), lines };
  }
  return awards;
}
