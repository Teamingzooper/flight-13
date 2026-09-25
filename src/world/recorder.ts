import { grid, type Cell, type LogEntry, type NightAction, type NightRecord, type PlayerView, type SeatId } from '../engine';
import { tapeClock, type Clip, type ClipKind, type Tape } from './tape';

/**
 * The flight recorder: once the flight is over, each night becomes a reel of clips, the black box's own lines
 * acted out by the people who did them, then the blasts and deaths at dawn and the day's verdict. Pure; the 3D
 * view plays reels like the Pilot's camera tape, and the end screen steps through them on the seat map.
 */

export const REEL_INTRO = 1.8;
/** A longer opening when people change seats, so they have walked to their new ones before anything happens. */
export const REEL_MOVES_INTRO = 4.5;
export const REEL_OUTRO = 1.2;
const LENGTH: Partial<Record<ClipKind, number>> = { caption: 2.6, blast: 3.4, slump: 2.8, restrained: 3.0 };
const ACT = 3.2;

/** The black box tag each night action is written under. */
const ACT_TAG: Partial<Record<NightAction['kind'], string>> = {
  plant: 'plant',
  treat: 'treat',
  serve: 'poison',
  check: 'check',
  sweep: 'sweep',
  inspect: 'inspect',
  search: 'search',
  cuff: 'cuff',
  watch: 'watch',
  knockout: 'knockout',
};

/** What an action looks like acted out (the truth this time: the recorder saw everything). */
function actedAs(action: NightAction, inWashroom: boolean): ClipKind {
  switch (action.kind) {
    case 'plant':
      return action.where === 'seat' ? 'under_seat' : action.where;
    case 'treat':
      return 'lean';
    case 'serve':
      return 'drink';
    case 'check':
      return 'check';
    case 'sweep':
      return 'look_around';
    case 'inspect':
      return action.what;
    case 'search':
      return inWashroom ? 'lavatory' : 'under_seat';
    case 'cuff':
      return 'cuff';
    default:
      return 'caption';
  }
}

/** The cabin row of a seat or crew spot (null for the flight deck, which no cabin camera sees). */
const rowOf = (seat: SeatId | undefined) => (seat && !grid.isCockpit(seat) ? (grid.parsePlace(seat)?.row ?? null) : null);

/** The player a black box line names first (and the longer name where two start there: "Jon" over "Jo"). */
function whoIn(text: string, ids: readonly string[], name: (id: string) => string): string | null {
  const hits = ids.filter((id) => name(id) !== '' && text.includes(name(id)));
  hits.sort((a, b) => text.indexOf(name(a)) - text.indexOf(name(b)) || name(b).length - name(a).length);
  return hits[0] ?? null;
}

type Draft = Omit<Clip, 'at' | 'dur' | 'clock'> & { when: 'night' | 'dawn' | 'day' };

/** One night's reel (`before`: the night before, so the reel can show who changed seats). */
export function planReel(game: PlayerView, record: NightRecord, before?: NightRecord): Tape {
  const n = record.night;
  const byId = new Map(game.players.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.name ?? '';
  const seats = new Map(Object.entries(record.seats));
  // (The Pilot's own lines name him first; the camera wants whoever he called.)
  const everyone = [...seats].filter(([, seat]) => !grid.isCockpit(seat)).map(([id]) => id);
  const used = new Set<number>();
  const drafts: Draft[] = [];

  for (const e of game.log) {
    if (e.night !== n) continue;
    const text = e.text.replace(/^(Night|Day) \d+: /, '');
    if (e.to === 'end' && e.tag !== 'move' && e.tag !== 'gameover') drafts.push(fromBlackBox(e, text));
    else if (e.to === 'all' && (e.tag === 'explosion' || e.tag === 'death' || e.tag === 'verdict')) drafts.push(fromPublic(e, text));
  }

  function fromBlackBox(e: LogEntry, text: string): Draft {
    // An action: match it to what the recorder saw, to act it out.
    const i = record.acts.findIndex((a, k) => !used.has(k) && ACT_TAG[a.action.kind] === e.tag && text.includes(name(a.actor)));
    if (i >= 0) {
      used.add(i);
      const { actor, action } = record.acts[i];
      const target = 'target' in action ? action.target : undefined;
      const kind = actedAs(action, record.washroom === actor);
      // Up on the flight deck (the jump seat): the camera looks at the front rows.
      const row = rowOf(seats.get(actor)) ?? (action.kind === 'watch' ? action.startRow : 1);
      return { when: 'night', actor: kind === 'caption' ? '' : actor, kind, text, row, ...(target ? { target } : {}) };
    }
    if (e.tag === 'item') {
      const item = record.items.find((it) => text.includes(name(it.user)) && (it.item === 'flashlight' ? text.includes('flashlight') : text.includes('pill')));
      if (item) {
        const row = rowOf(item.seat) ?? rowOf(seats.get(item.user)) ?? 1;
        return {
          when: 'night',
          actor: item.user,
          kind: item.item,
          text,
          row,
          ...(item.seat ? { seat: item.seat } : {}),
          ...(item.target ? { target: item.target } : {}),
        };
      }
    }
    // Lunch, by day: a caption over the row the food was drugged around.
    if (e.tag === 'meal') {
      const row = typeof e.data?.row === 'number' ? e.data.row : undefined;
      return { when: 'day', actor: '', kind: 'caption', text, ...(row ? { row } : {}) };
    }
    // A call from the flight deck, a night in the lavatory, a defused bomb: a caption, looking at whoever it names.
    const who = whoIn(text, everyone, name);
    return { when: 'night', actor: '', kind: 'caption', text, ...(who ? { row: rowOf(seats.get(who)) ?? undefined } : {}) };
  }

  function fromPublic(e: LogEntry, text: string): Draft {
    const data = e.data ?? {};
    if (e.tag === 'explosion') {
      const cells = (Array.isArray(data.cells) ? data.cells : []) as Cell[];
      const victims = (Array.isArray(data.victims) ? data.victims : []) as string[];
      return { when: 'dawn', actor: '', kind: 'blast', text, victims, cells, row: cells[0]?.row ?? 1 };
    }
    const player = typeof data.player === 'string' ? data.player : null;
    if (e.tag === 'death' && player) {
      return { when: 'dawn', actor: '', kind: 'slump', text, victims: [player], row: rowOf(seats.get(player)) ?? 1 };
    }
    if (e.tag === 'verdict' && player) {
      return { when: 'day', actor: player, kind: 'restrained', text, row: rowOf(seats.get(player)) ?? 1 };
    }
    return { when: e.tag === 'verdict' ? 'day' : 'dawn', actor: '', kind: 'caption', text };
  }

  // Who changed seats since the night before: the reel opens with them walking there.
  const from = before ? new Map(Object.entries(before.seats)) : undefined;
  const movers = from ? [...seats].filter(([id, seat]) => from.has(id) && from.get(id) !== seat && !grid.isCockpit(seat)) : [];
  const moved = movers.length > 0;

  // Captions without a place of their own keep the camera where it was.
  let row = drafts.find((d) => d.row)?.row ?? 1;
  const nights = drafts.filter((d) => d.when === 'night').length;
  let t = moved ? REEL_MOVES_INTRO : REEL_INTRO;
  let k = 0;
  const opening: Clip[] = moved
    ? [
        {
          at: 0.3,
          dur: REEL_MOVES_INTRO - 0.3,
          actor: '',
          kind: 'caption',
          text: `Seats change: ${movers.map(([id, seat]) => `${name(id)} to ${seat}`).join(', ')}.`,
          clock: 'LIGHTS OUT',
          row: rowOf(movers[0][1]) ?? row,
        },
      ]
    : [];
  const clips: Clip[] = drafts.map(({ when, ...d }) => {
    row = d.row ?? row;
    const dur = LENGTH[d.kind] ?? ACT;
    const clock = when === 'night' ? tapeClock(k++, nights) : when === 'dawn' ? 'MORNING' : 'DAY';
    const clip: Clip = { ...d, row, at: t, dur, clock };
    t += dur;
    return clip;
  });

  const away = new Set([record.washroom, record.jumpseat].filter((id): id is string => !!id));
  const cast = [...seats].filter(([id, seat]) => !away.has(id) && !grid.isCockpit(seat)).map(([id, seat]) => ({ id, seat }));
  const all = [...opening, ...clips];
  const rows = [...new Set(all.map((c) => c.row!))];
  return { night: n, rows, clips: all, cast, seats, length: t + REEL_OUTRO, ...(moved && from ? { from } : {}) };
}

/** Every night of a finished flight, in order (none until it is over). */
export function planReels(game: PlayerView): Tape[] {
  const records = game.recorder ?? [];
  return records.map((record, i) => planReel(game, record, records[i - 1]));
}
