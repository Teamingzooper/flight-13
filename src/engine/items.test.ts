import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import type { ItemUse } from './items';
import { normalizeGame } from './state';
import { advanceTo, logTexts, makeGame, player, type TestPlayer } from './testkit';
import type { GameState, ItemId, NightAction } from './types';
import { viewFor } from './view';

const pack = (s: GameState, id: string, items: ItemId[], ready = true) => applyIntent(s, id, { kind: 'pack', items, ready }, 0);
const use = (s: GameState, id: string, u: ItemUse) => applyIntent(s, id, { kind: 'use', ...u }, 0);
const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);
const move = (s: GameState, id: string, to: string) => applyIntent(s, id, { kind: 'move', to }, 0);
const voteAll = (s: GameState, target: string, voters?: string[]) => {
  for (const p of s.players) {
    if (p.status === 'alive' && p.id !== target && (!voters || voters.includes(p.id))) applyIntent(s, p.id, { kind: 'vote', target }, 0);
  }
};

/** Eight passengers in an 8-row cabin: a Bomber and a Mastermind among them. */
function cabin(extra: TestPlayer[] = []): GameState {
  return makeGame([
    { id: 'bomber', role: 'bomber', seat: '4B' },
    { id: 'mastermind', role: 'mastermind', seat: '8A' },
    { id: 'marshal', role: 'marshal', seat: '4E' },
    { id: 'pilot', role: 'pilot', seat: '8F' },
    { id: 'nurse', role: 'nurse', seat: '1F' },
    { id: 'p1', role: 'passenger', seat: '6A' },
    { id: 'p2', role: 'passenger', seat: '2D' },
    { id: 'p3', role: 'passenger', seat: '7C' },
    ...extra,
  ]);
}

describe('packing', () => {
  it('fits up to three known items, only while packing, and stays private', () => {
    const s = cabin();
    expect(s.phase.kind).toBe('packing');
    expect(pack(s, 'p1', ['antidote', 'defuser', 'pillow', 'mirror']).ok).toBe(false);
    expect(pack(s, 'p1', ['antidote', 'bogus' as ItemId]).ok).toBe(false);
    expect(applyIntent(s, 'p1', { kind: 'pack', items: 'antidote' as unknown as ItemId[], ready: true }, 0).ok).toBe(false);
    expect(pack(s, 'p1', ['antidote', 'antidote'], false)).toEqual({ ok: true });
    expect(player(s, 'p1').items).toEqual(['antidote', 'antidote']);
    expect(viewFor(s, 'p1', 0).you).toMatchObject({ items: ['antidote', 'antidote'], packed: false });
    expect(viewFor(s, 'p1', 0).packing).toEqual({ done: 0, total: 8 });
    expect(JSON.stringify(viewFor(s, 'p2', 0))).not.toContain('antidote');

    for (const p of s.players) if (p.id !== 'p1') pack(s, p.id, []);
    expect(s.phase.earlyEndAt).toBeNull();
    expect(pack(s, 'p1', ['antidote'], true).ok).toBe(true);
    expect(viewFor(s, 'p1', 0).packing).toEqual({ done: 8, total: 8 });
    expect(s.phase.earlyEndAt).toBe(3000);

    advanceTo(s, 'boarding');
    expect(pack(s, 'p1', []).ok).toBe(false);
    expect(player(s, 'p1').items).toEqual(['antidote']);
  });

  it('automatic items cannot be used by hand, and nobody can use what they did not pack', () => {
    const s = cabin();
    pack(s, 'p1', ['antidote', 'pillow', 'bobbypin']);
    advanceTo(s, 'night_act', 1);
    for (const item of ['antidote', 'pillow', 'bobbypin'] as const) expect(use(s, 'p1', { item }).ok).toBe(false);
    expect(use(s, 'p2', { item: 'mirror' })).toEqual({ ok: false, error: 'You have no compact mirror in your carry-on.' });
    expect(viewFor(s, 'p1', 0).options?.items).toEqual([]);
  });
});

describe('carry-on items', () => {
  it('an antidote neutralizes one poisoning', () => {
    const s = cabin([{ id: 'stew', role: 'stewardess_rogue', seat: 'Aisle 6' }]);
    pack(s, 'p1', ['antidote']);
    advanceTo(s, 'night_act', 1);
    act(s, 'stew', { kind: 'serve', target: 'p1' });
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'p1')).toMatchObject({ poisonedNight: null, items: [], usedItems: ['antidote'] });
    expect(logTexts(s, 'p1')).toContain('Your drink tasted bitter. Your antidote neutralized the poison.');

    advanceTo(s, 'night_act', 2);
    act(s, 'stew', { kind: 'serve', target: 'p1' });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'p1').poisonedNight).toBe(2);
  });

  it('the Nurse is credited before an antidote is spent', () => {
    const s = cabin([{ id: 'stew', role: 'stewardess_rogue', seat: 'Aisle 1' }]);
    pack(s, 'nurse', ['antidote']);
    advanceTo(s, 'night_act', 1);
    act(s, 'stew', { kind: 'serve', target: 'nurse' });
    act(s, 'nurse', { kind: 'treat', target: 'nurse' });
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'nurse').items).toEqual(['antidote']);
    expect(s.stats.nurse.rescues).toBe(1);
  });

  it('a defuser disarms a bomb found under your seat, and the cabin hears of it at dawn', () => {
    const s = cabin();
    pack(s, 'p1', ['defuser']);
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    advanceTo(s, 'night_move', 2);
    move(s, 'bomber', '1A');
    advanceTo(s, 'night_move', 3);
    move(s, 'p1', '4B');
    advanceTo(s, 'night_act', 3);
    expect(use(s, 'p1', { item: 'defuser' })).toEqual({ ok: false, error: 'You have not found a bomb within reach.' });
    act(s, 'p1', { kind: 'search' });
    expect(viewFor(s, 'p1', 0).options?.items).toEqual([{ item: 'defuser' }]);
    expect(use(s, 'p1', { item: 'defuser' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 3);
    expect(s.bombs[0]).toMatchObject({ exploded: false, defused: true });
    expect(player(s, 'p1').status).toBe('alive');
    expect(logTexts(s, 'all')).toContain('Someone found a bomb under seat 4B and defused it in the night.');
    expect(logTexts(s, 'saboteurs')).toContain('The bomb under seat 4B was defused.');
    expect(s.stats.p1).toMatchObject({ found: 1, defused: 1 });
    expect(s.incidentAtDawn).toBe(true);
  });

  it('a seatbelt extender frees you once you are buckled', () => {
    const s = cabin();
    pack(s, 'p1', ['extender']);
    advanceTo(s, 'night_move', 1);
    applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'p1' }, 0);
    advanceTo(s, 'night_act', 1);
    expect(s.night.buckled.p1).toBe('pilot');
    expect(act(s, 'p1', { kind: 'search' }).ok).toBe(false);
    expect(use(s, 'p1', { item: 'extender' })).toEqual({ ok: true });
    expect(s.night.buckled.p1).toBeUndefined();
    expect(act(s, 'p1', { kind: 'search' }).ok).toBe(true);
  });

  it('a seatbelt extender clicked in early keeps the sign from holding you', () => {
    const s = cabin();
    pack(s, 'p1', ['extender']);
    advanceTo(s, 'night_move', 1);
    expect(use(s, 'p1', { item: 'extender' })).toEqual({ ok: true });
    applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'p1' }, 0);
    advanceTo(s, 'night_act', 1);
    expect(s.night.buckled.p1).toBeUndefined();
    expect(logTexts(s, 'p1')).toContain('Ding. The seatbelt sign lit up over your seat, but your extender keeps you free tonight.');
    expect(logTexts(s, 'pilot')).toContain('You turned on the seatbelt sign for p1 (6A).');
  });

  it('a pocket flashlight looks under a neighbouring seat without using up the night', () => {
    const s = cabin();
    pack(s, 'p1', ['flashlight']);
    advanceTo(s, 'night_move', 1);
    move(s, 'p1', '5A');
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    advanceTo(s, 'night_act', 2);
    expect(use(s, 'p1', { item: 'flashlight', seat: '8F' }).ok).toBe(false);
    expect(use(s, 'p1', { item: 'flashlight', seat: '5A' }).ok).toBe(false);
    expect(viewFor(s, 'p1', 0).options?.items.map((u) => u.seat).sort()).toEqual(['4A', '4B', '5B', '6A', '6B']);
    expect(use(s, 'p1', { item: 'flashlight', seat: '4B' })).toEqual({ ok: true });
    expect(player(s, 'p1').knownBombIds).toEqual([s.bombs[0].id]);
    expect(logTexts(s, 'p1').some((t) => t.startsWith('You shone your flashlight under 4B and found a bomb'))).toBe(true);
    expect(act(s, 'p1', { kind: 'search' }).ok).toBe(true);
  });

  it('sleeping pills keep a neighbour from acting tonight', () => {
    const s = cabin();
    pack(s, 'p1', ['pills']);
    advanceTo(s, 'night_move', 1);
    move(s, 'p1', '5A');
    expect(use(s, 'p1', { item: 'pills', target: 'bomber' })).toEqual({ ok: false, error: 'Slip it once seats have changed.' });
    advanceTo(s, 'night_act', 1);
    expect(use(s, 'p1', { item: 'pills', target: 'nurse' }).ok).toBe(false);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    expect(use(s, 'p1', { item: 'pills', target: 'bomber' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(s.bombs).toEqual([]);
    expect(player(s, 'bomber').bombsPlanted).toBe(0);
    expect(logTexts(s, 'bomber')).toContain('You dozed off before you could do anything. Someone must have slipped something into your water.');
  });

  it('a compact mirror shows who used an ability on you', () => {
    const s = cabin([
      { id: 'watcher', role: 'passenger', seat: '2E' },
      { id: 'stew', role: 'stewardess_loyal', seat: 'Aisle 2' },
    ]);
    pack(s, 'watcher', ['mirror']);
    pack(s, 'p3', ['mirror']);
    advanceTo(s, 'night_move', 1);
    expect(use(s, 'watcher', { item: 'mirror' })).toEqual({ ok: true });
    expect(use(s, 'p3', { item: 'mirror' })).toEqual({ ok: true });
    applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'watcher' }, 0);
    advanceTo(s, 'night_act', 1);
    act(s, 'nurse', { kind: 'treat', target: 'watcher' });
    act(s, 'stew', { kind: 'check', side: 'right' });
    advanceTo(s, 'dawn', 1);
    expect(logTexts(s, 'watcher')).toContain(
      'In your compact mirror you saw: pilot turned on your seatbelt sign; nurse treated you; stew checked under your seat.',
    );
    expect(logTexts(s, 'p3')).toContain('You watched your compact mirror all night. Nobody came near you.');
  });

  it('a frequent-flyer card doubles your vote for the day, in public', () => {
    const s = cabin();
    pack(s, 'p1', ['ffcard']);
    advanceTo(s, 'night_act', 1);
    expect(use(s, 'p1', { item: 'ffcard' }).ok).toBe(false);
    advanceTo(s, 'day_vote', 1);
    expect(use(s, 'p1', { item: 'ffcard' })).toEqual({ ok: true });
    expect(logTexts(s, 'all')).toContain('p1 flashed a frequent-flyer card. Their vote counts twice today.');
    voteAll(s, 'bomber', ['p1', 'p2', 'p3', 'nurse']);
    expect(viewFor(s, 'p2', 0).votes?.counts.bomber).toBe(5);
    advanceTo(s, 'verdict', 1);
    // Five votes (one doubled) against four skips; without the card it would have been a tie.
    expect(s.verdict).toMatchObject({ restrained: 'bomber', tally: { bomber: 5, skip: 4 } });
  });

  it('a neck pillow gets you through one blast', () => {
    const s = cabin();
    pack(s, 'p1', ['pillow']);
    advanceTo(s, 'night_act', 1);
    act(s, 'mastermind', { kind: 'plant', where: 'seat', fuse: 1 });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'p1')).toMatchObject({ status: 'alive', usedItems: ['pillow'] });
    expect(player(s, 'p3').status).toBe('dead');
    expect(logTexts(s, 'p1')).toContain('You braced with your neck pillow. The blast knocked you flat, but you survived.');
    // The Mastermind caught themselves too, but only passengers count as kills.
    expect(s.stats.mastermind.kills).toBe(1);
  });

  it("a bobby pin picks the Air Marshal's handcuffs, and the cuffs are gone", () => {
    const s = cabin();
    pack(s, 'bomber', ['bobbypin']);
    advanceTo(s, 'night_move', 1);
    move(s, 'marshal', '4C');
    advanceTo(s, 'night_act', 1);
    act(s, 'marshal', { kind: 'cuff', target: 'bomber' });
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'bomber')).toMatchObject({ status: 'alive', bombsPlanted: 1, usedItems: ['bobbypin'] });
    expect(player(s, 'marshal').cuffsUsed).toBe(true);
    expect(logTexts(s, 'bomber')).toContain('Someone snapped handcuffs on you in the dark. You picked the lock with your bobby pin and slipped free.');
    expect(logTexts(s, 'marshal')).toContain('You handcuffed bomber (4B), but they picked the lock and slipped free. Your cuffs are gone.');
  });
});

describe('flight credits', () => {
  it('saboteurs earn 10 per passenger killed and 100 for a win; passengers nothing when the plane is taken', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '1A' },
      { id: 'a', role: 'passenger', seat: '1B' },
      { id: 'b', role: 'passenger', seat: '2A' },
      { id: 'c', role: 'passenger', seat: '8F' },
    ]);
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    advanceTo(s, 'night_move', 2);
    move(s, 'bomber', '6D');
    advanceTo(s, 'ended');
    expect(s.result).toMatchObject({ winner: 'saboteurs', reason: 'parity' });
    expect(s.awards!.bomber).toEqual({
      credits: 120,
      lines: [
        { label: '2 passengers taken out', credits: 20 },
        { label: 'Saboteurs won', credits: 100 },
      ],
    });
    expect(s.awards!.c).toEqual({ credits: 0, lines: [] });
    expect(viewFor(s, 'c', 0).awards?.bomber.credits).toBe(120);
    expect(viewFor(s, 'c', 0).stats?.bomber.kills).toBe(2);
  });

  it('passengers earn 100 for a win and 50 alive at landing; the Nurse 10 per life saved', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '1A' },
      { id: 'stew', role: 'stewardess_rogue', seat: 'Aisle 5' },
      { id: 'nurse', role: 'nurse', seat: '5A' },
      { id: 'a', role: 'passenger', seat: '5B' },
      { id: 'b', role: 'passenger', seat: '7F' },
      { id: 'c', role: 'passenger', seat: '8F' },
    ]);
    advanceTo(s, 'night_act', 1);
    act(s, 'stew', { kind: 'serve', target: 'a' });
    act(s, 'nurse', { kind: 'treat', target: 'a' });
    advanceTo(s, 'day_vote', 1);
    voteAll(s, 'bomber');
    advanceTo(s, 'day_vote', 2);
    voteAll(s, 'stew');
    advanceTo(s, 'ended');
    expect(s.result).toMatchObject({ winner: 'passengers', reason: 'eliminated' });
    expect(s.awards!.nurse).toEqual({
      credits: 160,
      lines: [
        { label: 'Passengers won', credits: 100 },
        { label: 'Alive at landing', credits: 50 },
        { label: 'Saved a life', credits: 10 },
      ],
    });
    expect(s.awards!.a.credits).toBe(150);
    expect(s.awards!.bomber.credits).toBe(0);
  });
});

describe('old saves', () => {
  it('gain empty carry-ons, stats and a game id', () => {
    const s = cabin();
    const old = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & GameState;
    delete (old as Partial<GameState>).stats;
    delete (old as Partial<GameState>).packed;
    for (const p of old.players) delete (p as Partial<typeof p>).items;
    delete (old.night as Partial<GameState['night']>).asleep;
    for (const p of old.players) delete (p as Partial<typeof p>).washroomUsed;
    delete (old.night as Partial<GameState['night']>).washroom;
    const fixed = normalizeGame(old);
    expect(fixed.players[0].items).toEqual([]);
    expect(fixed.players[0].washroomUsed).toBe(false);
    expect(fixed.night.washroom).toBeNull();
    expect(fixed.stats).toEqual({});
    expect(fixed.night.asleep).toEqual({});
    expect(typeof fixed.id).toBe('string');
  });
});
