import { grid, type Cell, type LogEntry, type PlayerView, type SeatId, type Sighting } from '../engine';

/**
 * Last night's tape from the Pilot's cabin cameras: who to put back in their seats, and what each of them does
 * when, with a caption and a night clock. Pure; Cabin3D plays it with stand-ins only the camera sees.
 */

/** What a clip shows: something the cameras could see, or (on the flight recorder) a caption, a blast, a death or a verdict. */
export type ClipKind = Sighting['kind'] | 'caption' | 'blast' | 'slump' | 'restrained';

export interface Clip {
  /** Seconds from the start of the tape. */
  at: number;
  dur: number;
  /** Who acts ('' for nobody: a caption). */
  actor: string;
  kind: ClipKind;
  target?: string;
  seat?: SeatId;
  text: string;
  /** The time on the camera's clock, like "02:14" (or MORNING, or DAY). */
  clock: string;
  /** The row the flight recorder's camera looks at (the Pilot's tape keeps its three rows). */
  row?: number;
  /** Who falls when this clip plays: a blast's victims, or a poison death. */
  victims?: string[];
  /** Where a blast went off. */
  cells?: Cell[];
}

export interface Tape {
  night: number;
  /** The three rows the cameras watched. */
  rows: number[];
  clips: Clip[];
  /** Everyone the camera shows (the watched rows and one row either side), where they sat that night. */
  cast: { id: string; seat: SeatId }[];
  /** Where everyone sat that night (targets outside the cast too). */
  seats: ReadonlyMap<string, SeatId>;
  /** Seconds. */
  length: number;
}

/** Stillness before the first clip, each clip, and stillness after the last one (seconds). */
export const TAPE_INTRO = 1.5;
export const TAPE_CLIP = 3.6;
export const TAPE_OUTRO = 1.4;
const QUIET = 4;

/** The Pilot's most recent camera report, if any. */
export function lastWatch(log: readonly LogEntry[], you: string): LogEntry | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.tag === 'watch' && Array.isArray(e.to) && e.to.includes(you) && Array.isArray(e.data?.rows)) return e;
  }
  return null;
}

/** Camera time for clip `i` of `n`: spread between just after midnight and half past four. */
export function tapeClock(i: number, n: number): string {
  const minutes = 12 + Math.round(((i + 0.5) / Math.max(1, n)) * 255);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Fallback caption for sightings saved before captions were: "Jo bent down under their seat". */
function caption(s: Sighting, name: (id: string) => string): string {
  const a = name(s.actor);
  const t = s.target ? name(s.target) : '';
  switch (s.kind) {
    case 'under_seat':
      return `${a} bent down under their seat`;
    case 'cart':
      return `${a} fiddled with the drink cart`;
    case 'lavatory':
      return `${a} peered at the lavatory door`;
    case 'lean':
      return s.target && s.target !== s.actor ? `${a} leaned over to ${t}` : `${a} rummaged in a bag`;
    case 'drink':
      return `${a} handed ${t} a drink`;
    case 'check':
      return `${a} checked under the seats`;
    case 'look_around':
      return `${a} looked around the seats nearby`;
    case 'cuff':
      return `${a} snapped handcuffs on ${t}`;
    case 'flashlight':
      return `${a} shone a light under ${s.seat ?? 'a seat'}`;
    case 'pills':
      return `${a} slipped something into ${t}’s water`;
  }
}

/**
 * The tape for the Pilot's latest camera report. `seatsOn(night)`: where everyone sat that night, as the 3D view
 * saw it (null after a reload: current seats stand in, and only people still in play that night are cast).
 */
export function planTape(game: PlayerView, seatsOn: (night: number) => ReadonlyMap<string, SeatId> | null): Tape | null {
  const you = game.you;
  if (!you) return null;
  const entry = lastWatch(game.log, you.id);
  if (!entry) return null;
  const rows = (entry.data!.rows as number[]).slice(0, 3);
  const seen = (Array.isArray(entry.data!.seen) ? entry.data!.seen : []) as Sighting[];
  const night = entry.night;
  const seatsThatNight = seatsOn(night);
  const byId = new Map(game.players.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.name ?? 'Someone';

  const seats = new Map<string, SeatId>();
  if (seatsThatNight) for (const [id, seat] of seatsThatNight) seats.set(id, seat);
  else {
    for (const p of game.players) {
      const inPlay = p.status === 'alive' || (p.outNight !== null && p.outNight >= night);
      if (inPlay && p.seat && !grid.isCockpit(p.seat)) seats.set(p.id, p.seat);
    }
  }

  const lo = rows[0] - 1;
  const hi = rows[rows.length - 1] + 1;
  const cast = [...seats]
    .filter(([, seat]) => {
      const row = grid.parsePlace(seat)?.row ?? -1;
      return row >= lo && row <= hi;
    })
    .map(([id, seat]) => ({ id, seat }));

  const clips: Clip[] = seen.map((s, i) => ({
    at: TAPE_INTRO + i * TAPE_CLIP,
    dur: TAPE_CLIP,
    actor: s.actor,
    kind: s.kind,
    ...(s.target ? { target: s.target } : {}),
    ...(s.seat ? { seat: s.seat } : {}),
    text: s.text ?? caption(s, name),
    clock: tapeClock(i, seen.length),
  }));
  const length = clips.length ? TAPE_INTRO + clips.length * TAPE_CLIP + TAPE_OUTRO : QUIET;
  return { night, rows, clips, cast, seats, length };
}

/** The clip playing at `t` seconds, if any. */
export function clipAt(tape: Tape, t: number): Clip | null {
  return tape.clips.find((c) => t >= c.at && t < c.at + c.dur) ?? null;
}
