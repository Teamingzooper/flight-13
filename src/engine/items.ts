import { aisleRow, distance, isSeatInCabin, parsePlace, parseSeat, rowSeats, seatsWithin } from './grid';
import { isStewardess } from './roles';
import { activePlayers, addLog, cellOf, emptySeats, fuseText, getPlayer, inWashroom, isActive, isGuest, occupantOf, statsOf } from './state';
import type { Bomb, GameState, ItemId, PhaseKind, PlayerState, SeatId } from './types';

/** Items that fit in a carry-on. */
export const MAX_PACKED = 3;

/** When an item can be used: at night, by day, or any time (automatic items). */
export type ItemWhen = 'night' | 'day' | 'any';

export interface ItemInfo {
  id: ItemId;
  name: string;
  when: ItemWhen;
  /** Works by itself when it is needed; there is nothing to press. */
  automatic: boolean;
  blurb: string;
}

export const ITEMS: Record<ItemId, ItemInfo> = {
  antidote: {
    id: 'antidote',
    name: 'Antidote',
    when: 'any',
    automatic: true,
    blurb: 'The next time your drink is poisoned, the poison does nothing.',
  },
  defuser: {
    id: 'defuser',
    name: 'Defuser',
    when: 'night',
    automatic: false,
    blurb: 'Disarm a bomb you found within reach: under your seat, in the lavatory while you are in it, or (crew) anywhere in your row.',
  },
  extender: {
    id: 'extender',
    name: 'Seatbelt extender',
    when: 'night',
    automatic: false,
    blurb: 'The seatbelt sign cannot hold you tonight. Works while buckled.',
  },
  flashlight: {
    id: 'flashlight',
    name: 'Pocket flashlight',
    when: 'night',
    automatic: false,
    blurb: 'Look under a seat next to yours without using up your night.',
  },
  pills: {
    id: 'pills',
    name: 'Sleeping pills',
    when: 'night',
    automatic: false,
    blurb: 'After seats change, slip one to a neighbour: they sleep through the night and cannot act.',
  },
  mirror: {
    id: 'mirror',
    name: 'Compact mirror',
    when: 'night',
    automatic: false,
    blurb: 'Watch it tonight, and at dawn you know who used an ability on you.',
  },
  ffcard: {
    id: 'ffcard',
    name: 'Frequent-flyer card',
    when: 'day',
    automatic: false,
    blurb: 'Flash it before the vote: your vote counts twice today.',
  },
  pillow: { id: 'pillow', name: 'Neck pillow', when: 'any', automatic: true, blurb: 'Brace for impact: you survive one blast.' },
  bobbypin: {
    id: 'bobbypin',
    name: 'Bobby pin',
    when: 'any',
    automatic: false,
    blurb: "Once the Air Marshal's handcuffs are on you, pick the lock and slip back to your seat.",
  },
};

export const ITEM_ORDER: readonly ItemId[] = ['antidote', 'defuser', 'extender', 'flashlight', 'pills', 'mirror', 'ffcard', 'pillow', 'bobbypin'];

export function isItemId(x: unknown): x is ItemId {
  return typeof x === 'string' && Object.hasOwn(ITEMS, x);
}

/** One way to use an item right now. */
export interface ItemUse {
  item: ItemId;
  /** A neighbour (sleeping pills). */
  target?: string;
  /** A seat next to yours (flashlight). */
  seat?: SeatId;
}

const NIGHT: ReadonlySet<PhaseKind> = new Set(['night_move', 'night_act']);
const DAY: ReadonlySet<PhaseKind> = new Set(['day_discuss', 'day_vote']);

/** Use up one of an item; false if none is left. */
export function consumeItem(p: PlayerState, item: ItemId): boolean {
  const i = p.items.indexOf(item);
  if (i < 0) return false;
  p.items.splice(i, 1);
  p.usedItems.push(item);
  return true;
}

/** Where a defuser reaches: under your seat, the lavatory you are locked in, or every seat in the Stewardess's row. */
function withinReach(s: GameState, p: PlayerState, b: Bomb): boolean {
  if (inWashroom(s, p.id)) return b.location.kind === 'lavatory';
  if (b.location.kind !== 'seat') return false;
  const row = isStewardess(p.role) ? aisleRow(p.seat) : null;
  return row === null ? b.location.seat === p.seat : rowSeats(row, undefined, s.cabin.cols).includes(b.location.seat);
}

/** A live bomb you know about and can reach. */
function defusableBomb(s: GameState, p: PlayerState): Bomb | undefined {
  return s.bombs.find((b) => !b.exploded && !b.defused && p.knownBombIds.includes(b.id) && withinReach(s, p, b));
}

/** Where a defused bomb was, for the log. */
function bombPlace(b: Bomb): string {
  return b.location.kind === 'seat' ? `under ${b.location.seat}` : b.location.kind === 'lavatory' ? 'in the lavatory' : 'on the drink cart';
}

export function checkItemUse(s: GameState, p: PlayerState, use: ItemUse): string | null {
  if (!use || !isItemId(use.item)) return 'Unknown item.';
  const info = ITEMS[use.item];
  const name = info.name.toLowerCase();
  if (!p.items.includes(use.item)) return `You have no ${name} in your carry-on.`;
  if (info.automatic) return `Your ${name} works by itself when you need it.`;
  if (use.item === 'bobbypin') {
    if (p.status !== 'restrained' || !p.cuffedFrom) return 'Keep it for the Air Marshal’s handcuffs: pick the lock once they are on you.';
    return s.phase.kind === 'ended' ? 'The flight is over.' : null;
  }
  if (!isActive(p) || !p.seat) return 'You are out of play.';
  const kind = s.phase.kind;
  if (info.when === 'night' && !NIGHT.has(kind)) return `Your ${name} is for use at night.`;
  if (NIGHT.has(kind) && s.night.drowsy[p.id]) return 'You are fast asleep tonight.';
  if (info.when === 'day' && !DAY.has(kind)) return `Your ${name} is for use during the day.`;
  switch (use.item) {
    case 'defuser':
      return defusableBomb(s, p) ? null : 'You have not found a bomb within reach.';
    case 'extender':
      return s.night.freed[p.id] ? 'Your extender is already clicked in.' : null;
    case 'flashlight': {
      if (inWashroom(s, p.id)) return 'You are locked in the lavatory tonight.';
      if (s.night.flashlights[p.id]) return 'You already used a flashlight tonight.';
      const seat = use.seat;
      if (typeof seat !== 'string' || !isSeatInCabin(seat, s.cabin.rows, s.cabin.cols)) return 'Pick a seat to look under.';
      if (seat === p.seat) return 'Look under your own seat without the flashlight.';
      if (distance(parseSeat(seat)!, cellOf(p)) > 1) return 'Pick a seat right next to yours.';
      return null;
    }
    case 'pills': {
      if (kind !== 'night_act') return 'Slip it once seats have changed.';
      if (inWashroom(s, p.id)) return 'You are locked in the lavatory tonight.';
      if (isGuest(s, p.id)) return 'You are on the flight deck tonight.';
      const t = use.target === undefined ? undefined : getPlayer(s, use.target);
      if (!t || !isActive(t) || !t.seat) return 'Pick someone who is still in play.';
      if (t.id === p.id) return 'Those are for someone else.';
      if (inWashroom(s, t.id)) return `${t.name} is locked in the lavatory tonight.`;
      if (isGuest(s, t.id)) return `${t.name} is up on the flight deck tonight.`;
      if (distance(cellOf(t), cellOf(p)) > 1) return `${t.name} is too far away. Pick a neighbour.`;
      return null;
    }
    case 'mirror':
      return s.night.mirrors[p.id] ? 'Your mirror is already out.' : null;
    case 'ffcard':
      return s.day.doubled[p.id] ? 'Your vote already counts twice today.' : null;
    default:
      return 'That item cannot be used like that.';
  }
}

/** Every legal item use for a player right now (the TV and bots use this). */
export function possibleItemUses(s: GameState, p: PlayerState): ItemUse[] {
  // In the Air Marshal's handcuffs, the one thing you can do is pick the lock.
  if (p.status === 'restrained') return checkItemUse(s, p, { item: 'bobbypin' }) === null ? [{ item: 'bobbypin' }] : [];
  if (!isActive(p) || !p.seat) return [];
  const uses: ItemUse[] = [];
  for (const item of new Set(p.items)) {
    switch (item) {
      case 'flashlight':
        for (const seat of seatsWithin([cellOf(p)], 1, s.cabin.rows, s.cabin.cols)) uses.push({ item, seat });
        break;
      case 'pills':
        for (const t of activePlayers(s)) uses.push({ item, target: t.id });
        break;
      default:
        uses.push({ item });
    }
  }
  return uses.filter((u) => checkItemUse(s, p, u) === null);
}

/** Apply a use that `checkItemUse` accepted. Night effects that wait for the dark resolve in night.ts. */
export function useItem(s: GameState, p: PlayerState, use: ItemUse, now: number): void {
  const n = s.phase.night;
  consumeItem(p, use.item);
  switch (use.item) {
    case 'defuser': {
      const bomb = defusableBomb(s, p)!;
      bomb.defused = true;
      s.night.defused[bomb.id] = p.id;
      statsOf(s, p.id).defused++;
      addLog(s, now, [p.id], 'item', `You cut the wires. The bomb ${bombPlace(bomb)} is dead.`, { bomb: bomb.id });
      addLog(s, now, 'end', 'item', `Night ${n}: ${p.name} defused the bomb ${bombPlace(bomb)}.`);
      break;
    }
    case 'extender': {
      const buckled = s.night.buckled[p.id] !== undefined;
      s.night.freed[p.id] = true;
      delete s.night.buckled[p.id];
      addLog(
        s,
        now,
        [p.id],
        'item',
        buckled
          ? 'You clicked in your seatbelt extender and slipped free. You can move and act tonight.'
          : 'You clicked in your seatbelt extender. The seatbelt sign cannot hold you tonight.',
      );
      addLog(s, now, 'end', 'item', `Night ${n}: ${p.name} used a seatbelt extender.`);
      break;
    }
    case 'flashlight': {
      const seat = use.seat!;
      s.night.flashlights[p.id] = seat;
      const found = s.bombs.filter((b) => !b.exploded && !b.defused && b.location.kind === 'seat' && b.location.seat === seat);
      for (const b of found) if (!p.knownBombIds.includes(b.id)) p.knownBombIds.push(b.id);
      statsOf(s, p.id).found += found.length;
      addLog(
        s,
        now,
        [p.id],
        'item',
        found.length === 0
          ? `You shone your flashlight under ${seat}. Nothing there.`
          : `You shone your flashlight under ${seat} and found a bomb, ${fuseText(found[0], n)}.`,
        { bombs: found.map((b) => b.id), seat },
      );
      // (A Bomber checking on their own work reads as that, not as a discovery.)
      const own = found.length > 0 && found.every((b) => b.planterId === p.id);
      addLog(s, now, 'end', 'item', `Night ${n}: ${p.name} looked under ${seat} with a flashlight${found.length ? (own ? ' and checked on their own bomb' : ' and found a bomb') : ''}.`);
      break;
    }
    case 'pills': {
      const t = getPlayer(s, use.target!)!;
      s.night.asleep[t.id] ??= p.id;
      addLog(s, now, [p.id], 'item', `You slipped a sleeping pill into ${t.name}’s water. They will not be doing anything tonight.`);
      addLog(s, now, 'end', 'item', `Night ${n}: ${p.name} gave ${t.name} a sleeping pill.`);
      break;
    }
    case 'mirror':
      s.night.mirrors[p.id] = true;
      addLog(s, now, [p.id], 'item', 'You propped your compact mirror on the tray table. At dawn you will know who came near you.');
      break;
    case 'bobbypin': {
      // Back to the seat you were taken from, or the nearest free one if somebody has taken it.
      const home = p.cuffedFrom!;
      const cell = parsePlace(home);
      const free = emptySeats(s).sort((a, b) => (cell ? distance(parseSeat(a)!, cell) - distance(parseSeat(b)!, cell) : 0));
      const seat = occupantOf(s, home) ? (free[0] ?? home) : home;
      p.status = 'alive';
      p.cause = null;
      p.outNight = null;
      p.seat = seat;
      p.cuffedFrom = null;
      addLog(s, now, 'all', 'item', `${p.name} picked the lock of their handcuffs with a bobby pin and slipped back to ${seat}.`, { player: p.id });
      addLog(s, now, 'end', 'item', `Night ${n}: ${p.name} picked the Air Marshal’s handcuffs with a bobby pin.`);
      break;
    }
    case 'ffcard':
      s.day.doubled[p.id] = true;
      addLog(s, now, 'all', 'item', `${p.name} flashed a frequent-flyer card. Their vote counts twice today.`, { player: p.id });
      break;
    default:
      break;
  }
}
