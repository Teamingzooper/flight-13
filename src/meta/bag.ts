import { ITEM_ORDER, isItemId, planeLands, type ItemId, type PlayerView } from '../engine';
import { ACHIEVEMENTS } from './achievements';
import { PRICES } from './shop';

/** Items by count. */
export type ItemCounts = Partial<Record<ItemId, number>>;

/** What one finished game paid out. */
export interface Settlement {
  gameId: string;
  credits: number;
  lines: { label: string; credits: number }[];
  /** A random item for winning. */
  souvenir: ItemId | null;
  /** Achievement ids unlocked by this game. */
  achievements: string[];
}

/** Everything a player has collected, kept in this browser. */
export interface Bag {
  v: 1;
  credits: number;
  items: ItemCounts;
  /** Achievement id → when it was unlocked. */
  achievements: Record<string, number>;
  /** Hashes of developer codes already used here. */
  redeemed: string[];
  stats: { flights: number; wins: number; landed: string[] };
  /** Recent finished games, newest last: nothing pays twice and a reload shows the same end screen. */
  settled: Settlement[];
  /** Items already taken out of the bag, by game id (they are used up as they are used). */
  spent: Record<string, ItemId[]>;
}

const KEEP_GAMES = 20;

/** New players start with a few credits and a small kit. */
export function newBag(): Bag {
  return {
    v: 1,
    credits: 100,
    items: { antidote: 1, flashlight: 1, ffcard: 1 },
    achievements: {},
    redeemed: [],
    stats: { flights: 0, wins: 0, landed: [] },
    settled: [],
    spent: {},
  };
}

const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

function cleanCounts(raw: unknown): ItemCounts {
  const out: ItemCounts = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, n] of Object.entries(raw)) if (isItemId(id) && count(n) > 0) out[id] = count(n);
  return out;
}

/** A bag from storage, or a new one if there is nothing usable there. */
export function cleanBag(raw: unknown): Bag {
  if (!raw || typeof raw !== 'object') return newBag();
  const r = raw as Partial<Bag>;
  const strings = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);
  const stats = (r.stats ?? {}) as Partial<Bag['stats']>;
  return {
    v: 1,
    credits: count(r.credits),
    items: cleanCounts(r.items),
    achievements: Object.fromEntries(Object.entries(r.achievements ?? {}).filter(([, t]) => typeof t === 'number')),
    redeemed: strings(r.redeemed),
    stats: { flights: count(stats.flights), wins: count(stats.wins), landed: strings(stats.landed) },
    settled: Array.isArray(r.settled) ? r.settled.filter((x) => x && typeof x.gameId === 'string').slice(-KEEP_GAMES) : [],
    spent: Object.fromEntries(Object.entries(r.spent ?? {}).map(([id, items]) => [id, (Array.isArray(items) ? items : []).filter(isItemId)])),
  };
}

export function countOf(bag: Bag, item: ItemId): number {
  return bag.items[item] ?? 0;
}

export function addItems(bag: Bag, items: ItemCounts): Bag {
  const next = { ...bag.items };
  for (const [id, n] of Object.entries(items) as [ItemId, number][]) next[id] = (next[id] ?? 0) + n;
  return { ...bag, items: next };
}

/** Buy one item at Duty Free; null if the credits do not cover it. */
export function buy(bag: Bag, item: ItemId): Bag | null {
  const price = PRICES[item];
  if (bag.credits < price) return null;
  return addItems({ ...bag, credits: bag.credits - price }, { [item]: 1 });
}

/** Only items you have can go in the carry-on (duplicates need as many copies). */
export function canPack(bag: Bag, items: readonly ItemId[]): boolean {
  const need: ItemCounts = {};
  for (const id of items) need[id] = (need[id] ?? 0) + 1;
  return (Object.entries(need) as [ItemId, number][]).every(([id, n]) => countOf(bag, id) >= n);
}

/** Take items used in a game out of the bag, once each however often this is called. */
export function spendUsed(bag: Bag, gameId: string, used: readonly ItemId[]): Bag {
  const before = bag.spent[gameId] ?? [];
  if (used.length <= before.length) return bag;
  const items = { ...bag.items };
  for (const id of used.slice(before.length)) items[id] = Math.max(0, (items[id] ?? 0) - 1);
  const spent = { ...bag.spent, [gameId]: [...used] };
  const ids = Object.keys(spent);
  for (const old of ids.slice(0, Math.max(0, ids.length - KEEP_GAMES))) delete spent[old];
  return { ...bag, items, spent };
}

export function settlementFor(bag: Bag, gameId: string): Settlement | undefined {
  return bag.settled.find((s) => s.gameId === gameId);
}

/**
 * Pay out a finished game once: its flight credits, a souvenir for a win, and any achievements it
 * unlocked (each with its item). Spectators and unfinished games change nothing.
 */
export function settleGame(bag: Bag, view: PlayerView, random: () => number): Bag {
  const you = view.you;
  if (!you || !view.result || view.phase.kind !== 'ended' || settlementFor(bag, view.gameId)) return bag;
  const award = view.awards?.[you.id] ?? { credits: 0, lines: [] };
  const won = view.result.winner === you.team;
  // Only the five real destinations count toward landing everywhere.
  const where = view.settings.destination;
  const landed = planeLands(view.result) && where !== 'custom' && !bag.stats.landed.includes(where) ? [...bag.stats.landed, where] : bag.stats.landed;
  const stats = { flights: bag.stats.flights + 1, wins: bag.stats.wins + (won ? 1 : 0), landed };
  const context = { view, won, team: you.team, mine: view.stats?.[you.id] ?? null, flights: stats.flights, landed };
  const unlocked = ACHIEVEMENTS.filter((a) => !bag.achievements[a.id] && a.check(context));
  const souvenir = won ? ITEM_ORDER[Math.min(ITEM_ORDER.length - 1, Math.floor(random() * ITEM_ORDER.length))] : null;

  const gained: ItemCounts = {};
  for (const id of [...(souvenir ? [souvenir] : []), ...unlocked.map((a) => a.reward)]) gained[id] = (gained[id] ?? 0) + 1;
  const settlement: Settlement = {
    gameId: view.gameId,
    credits: award.credits,
    lines: award.lines,
    souvenir,
    achievements: unlocked.map((a) => a.id),
  };
  const now = Date.now();
  return addItems(
    {
      ...bag,
      credits: bag.credits + award.credits,
      achievements: { ...bag.achievements, ...Object.fromEntries(unlocked.map((a) => [a.id, now])) },
      stats,
      settled: [...bag.settled, settlement].slice(-KEEP_GAMES),
    },
    gained,
  );
}
