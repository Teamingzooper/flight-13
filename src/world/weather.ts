import { isNightPhase, type PlayerView } from '../engine';
import { hash01 } from '../bots/personality';

/**
 * What the sky outside looks like: the runway before takeoff; by day clear or overcast; a sunset over the verdict;
 * at night stars, the Bermuda Triangle's aurora, or a thunderstorm (every turbulent night, and now and then anyway);
 * a sunrise at dawn. The same for everyone on the flight (it only depends on the game).
 */
export type SkyKind = 'runway' | 'day' | 'cloudy' | 'sunset' | 'night' | 'storm' | 'dawn' | 'aurora';

/** Nights with no turbulence that storm anyway, and days under cloud. */
const STORM_ODDS = 0.2;
const CLOUD_ODDS = 0.3;

export function skyFor(game: PlayerView, triangle: boolean): SkyKind {
  const kind = game.phase.kind;
  if (kind === 'packing' || kind === 'boarding' || kind === 'takeoff') return 'runway';
  const night = game.phase.night;
  const roll = (what: string) => hash01(`${game.gameId}:${night}:${what}`);
  if (isNightPhase(kind)) {
    if (triangle) return 'aurora';
    // Turbulence and rough air come with the weather to match.
    const rough = game.log.some((e) => e.night === night && e.to === 'all' && (e.tag === 'turbulence' || e.tag === 'roughair'));
    return rough || roll('storm') < STORM_ODDS ? 'storm' : 'night';
  }
  if (kind === 'dawn') return 'dawn';
  if (kind === 'verdict') return 'sunset';
  return roll('cloud') < CLOUD_ODDS ? 'cloudy' : 'day';
}
