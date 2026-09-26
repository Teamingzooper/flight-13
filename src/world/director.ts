import { destinationOf, isNightPhase, type Cell, type GameResult, type PlayerView } from '../engine';
import { captainName } from '../tv/format';

/** Something the cabin should play: a sound, an effect, a camera move or a captain announcement. */
export type Cue =
  | { kind: 'takeoff' }
  | { kind: 'lightsOut' }
  | { kind: 'lightsOn'; afterBlast: boolean }
  | { kind: 'explosion'; id: string; centers: Cell[]; where: 'seat' | 'cart' | 'lavatory'; victims: string[] }
  | { kind: 'turbulence' }
  | { kind: 'cartRoll'; from: number; to: number; runaway: boolean }
  | { kind: 'restrained'; playerId: string }
  | { kind: 'landing'; result: GameResult }
  /** The vote opens. */
  | { kind: 'voteOpen' }
  /** A bomb was found and defused overnight (public; the one who did it hears their own snip). */
  | { kind: 'defused' }
  /** Someone died of poison at dawn. */
  | { kind: 'poisoned'; playerId: string }
  /** The Pilot flew rough air over three rows. */
  | { kind: 'roughAir'; rows: number[] }
  /** Someone used an item everyone can see (a frequent-flyer card, a bobby pin on their cuffs). */
  | { kind: 'item'; playerId: string; item: string }
  /** An announcement: the flight deck's automatic ones, or the Pilot's own (`who`). */
  | { kind: 'pa'; text: string; who?: string };

const pa = (text: string): Cue => ({ kind: 'pa', text });
const CAPTION_MAX = 160;
const clip = (text: string) => (text.length > CAPTION_MAX ? `${text.slice(0, CAPTION_MAX - 1).trimEnd()}\u2026` : text);

/**
 * Compare two consecutive views of the game and say what just happened in the cabin. Only public
 * information goes into announcements. The first view only welcomes passengers at takeoff, so joining
 * or reloading mid-flight never replays old moments.
 */
export function directorCues(prev: PlayerView | null, next: PlayerView): Cue[] {
  const cues: Cue[] = [];
  const kind = next.phase.kind;
  const city = destinationOf(next.settings).city;
  const welcome = () => cues.push({ kind: 'takeoff' }, pa(`Welcome aboard Flight 13 to ${city}. We land in ${next.phase.nights} nights. Cabin crew, arm doors and cross-check.`));

  if (!prev) {
    if (kind === 'takeoff') welcome();
    return cues;
  }
  if (kind === 'takeoff') {
    if (prev.phase.kind !== 'takeoff') welcome();
    return cues;
  }

  const seen = new Set(prev.log.map((e) => e.id));
  const fresh = next.log.filter((e) => !seen.has(e.id));

  const exploded = new Set(prev.bombs.filter((b) => b.exploded).map((b) => b.id));
  for (const b of next.bombs) {
    if (!b.exploded || exploded.has(b.id)) continue;
    const entry = next.log.find((e) => e.tag === 'explosion' && e.data?.bomb === b.id);
    const victims = Array.isArray(entry?.data?.victims) ? (entry.data.victims as string[]) : [];
    cues.push({ kind: 'explosion', id: b.id, centers: b.explodedAt ?? [], where: b.location.kind, victims });
  }
  const blast = cues.length > 0;

  const wasNight = isNightPhase(prev.phase.kind);
  const night = isNightPhase(kind);
  const bumpy = fresh.some((e) => e.tag === 'turbulence' && e.night === next.phase.night);
  if (!wasNight && night) {
    cues.push({ kind: 'lightsOut' });
    const warning = bumpy ? ' We expect turbulence tonight, so keep your seatbelt fastened.' : '';
    cues.push(pa(`Night ${next.phase.night} of ${next.phase.nights}. Cabin crew, please dim the cabin lights.${warning}`));
  }
  if (bumpy) cues.push({ kind: 'turbulence' });
  if (wasNight && !night) {
    cues.push({ kind: 'lightsOn', afterBlast: blast });
    if (kind !== 'ended') {
      if (blast) cues.push(pa('Ladies and gentlemen, please remain calm. Put on your own mask before helping others.'));
      else if (next.blackout) cues.push(pa('We are having trouble with the cabin lights. Please bear with us.'));
      else cues.push(pa('Good morning, ladies and gentlemen. The cabin lights are coming back on.'));
    }
  }

  if (next.cabin.cartRow !== prev.cabin.cartRow && !next.cabin.cartDestroyed) {
    const runaway = fresh.some((e) => e.tag === 'anomaly' && e.data?.anomaly === 'runaway_cart');
    cues.push({ kind: 'cartRoll', from: prev.cabin.cartRow, to: next.cabin.cartRow, runaway });
  }

  for (const p of next.players) {
    const before = prev.players.find((q) => q.id === p.id);
    if (p.status === 'restrained' && before && before.status !== 'restrained') {
      const cuffed = fresh.some((e) => e.tag === 'cuff' && e.to === 'all' && e.data?.player === p.id);
      cues.push(
        { kind: 'restrained', playerId: p.id },
        pa(cuffed ? `The Air Marshal has detained ${p.name}. Please stay in your seats.` : `${p.name} has been restrained and escorted to the rear galley.`),
      );
    }
  }
  // The vote opens (and, after it, a verdict that restrained nobody is still said).
  if (kind === 'day_vote' && prev.phase.kind !== 'day_vote') cues.push({ kind: 'voteOpen' }, pa('The vote is now open. Choose who should be restrained.'));
  if (fresh.some((e) => e.tag === 'verdict' && e.to === 'all' && e.text === 'No one was restrained.')) cues.push(pa('The cabin could not agree. Nobody was restrained.'));
  // What the night left behind: a bomb made safe, a passenger lost to poison, rough air, a new course.
  if (fresh.some((e) => e.tag === 'defused' && e.to === 'all')) cues.push({ kind: 'defused' }, pa('A bomb was found and made safe overnight. Thank you, whoever you are.'));
  for (const e of fresh) {
    if (e.tag === 'death' && e.to === 'all' && e.data?.cause === 'poison' && typeof e.data.player === 'string') {
      cues.push({ kind: 'poisoned', playerId: e.data.player }, pa('Ladies and gentlemen, we have lost a passenger to a sudden illness. Please stay in your seats.'));
    }
    if (e.tag === 'roughair' && e.to === 'all' && Array.isArray(e.data?.rows)) {
      cues.push({ kind: 'roughAir', rows: e.data.rows as number[] }, pa('We are flying through some rough air. Keep your seatbelts fastened.'));
    }
    if (e.tag === 'course' && e.to === 'all') cues.push(pa(clip(e.text)));
    if (e.tag === 'item' && e.to === 'all' && typeof e.data?.player === 'string') {
      const item = e.text.includes('bobby pin') ? 'bobbypin' : e.text.includes('frequent-flyer') ? 'ffcard' : 'item';
      cues.push({ kind: 'item', playerId: e.data.player, item });
      if (item === 'bobbypin') {
        const name = next.players.find((p) => p.id === e.data!.player)?.name ?? 'A passenger';
        cues.push(pa(`${name} has slipped their handcuffs and is back in their seat.`));
      }
    }
  }

  // The crew call lunch.
  if (fresh.some((e) => e.tag === 'meal' && e.to === 'all' && e.text.startsWith('Lunch is served'))) {
    cues.push(pa('Ladies and gentlemen, lunch is served: chicken or pasta, as it comes. Enjoy your meal.'));
  }
  // Black box notes are read out to the cabin.
  for (const e of fresh) if (e.tag === 'note' && e.to === 'all') cues.push(pa(clip(e.text)));
  // The Pilot's own announcements over the PA.
  const said = new Set(prev.chat.map((m) => m.id));
  for (const m of next.chat) {
    if (m.channel !== 'pa' || said.has(m.id)) continue;
    const name = next.players.find((p) => p.id === m.from)?.name ?? '';
    cues.push({ kind: 'pa', text: clip(m.text), who: captainName(name) });
  }

  if (kind === 'ended' && prev.phase.kind !== 'ended' && next.result) {
    cues.push({ kind: 'landing', result: next.result }, pa(endingLine(next.result, city)));
  }
  return cues;
}

function endingLine(r: GameResult, city: string): string {
  if (r.winner === 'draw') return 'Mayday, mayday, mayday.';
  if (r.reason === 'landed') return `Ladies and gentlemen, welcome to ${city}. Someone on board got away with it.`;
  if (r.winner === 'passengers') return `The saboteurs are under control. We continue to ${city} as planned.`;
  return 'This is not your captain speaking. This plane is ours now.';
}
