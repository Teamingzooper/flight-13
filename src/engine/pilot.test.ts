import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { COCKPIT, parsePlace } from './grid';
import { TEST_LOOK, advanceTo, logTexts, makeGame, player, type TestPlayer } from './testkit';
import type { GameState, MoveTarget, NightAction } from './types';
import { viewFor } from './view';
import { emptyCards, isPilot, validateCards } from './roles';
import { defaultSettings, validateSettings } from './settings';
import { createGame, dealRoles } from './setup';

describe('rogue Pilots', () => {
  it('turn rogue by the odds, but only while the saboteurs stay outnumbered', () => {
    const cards = { ...emptyCards(), bomber: 1, pilot: 1 };
    expect(dealRoles({ rng: 1 }, cards, 6, 0, 1)).toContain('pilot_rogue');
    expect(dealRoles({ rng: 1 }, cards, 6, 0, 0)).toContain('pilot');
    // Four passengers: a second saboteur would be half the cabin, so the Pilot stays loyal.
    expect(dealRoles({ rng: 1 }, cards, 4, 0, 1)).toContain('pilot');
    expect(isPilot('pilot_rogue')).toBe(true);
    expect(isPilot('stewardess_rogue')).toBe(false);
  });

  it('fit one to a flight deck, with odds the host can set', () => {
    expect(validateCards({ ...emptyCards(), bomber: 1, pilot: 2 }, 8, 0)).toBe('Only one Pilot fits on the flight deck.');
    expect(defaultSettings().pilotRogueChance).toBe(0.3);
    expect(validateSettings({ ...defaultSettings(), pilotRogueChance: 2 })).toBe('Pilot odds must be between 0 and 1.');
  });
});


const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);
const move = (s: GameState, id: string, to: MoveTarget) => applyIntent(s, id, { kind: 'move', to }, 0);

/** A Pilot on the flight deck of an 8-row cabin, a Bomber in row 1, and passengers down the plane. */
function cabin(extra: TestPlayer[] = [], role: TestPlayer['role'] = 'pilot'): GameState {
  return makeGame([
    { id: 'pilot', role, seat: COCKPIT },
    { id: 'bomber', role: 'bomber', seat: '1C' },
    { id: 'front', role: 'passenger', seat: '1D' },
    { id: 'mid', role: 'passenger', seat: '4B' },
    { id: 'back', role: 'passenger', seat: '7F' },
    { id: 'p5', role: 'passenger', seat: '8A' },
    ...extra,
  ]);
}

describe('the flight deck', () => {
  it('seats the Pilot at takeoff', () => {
    const settings = { ...defaultSettings(), maxPassengers: 8, rolesMode: 'custom' as const, cards: { ...emptyCards(), bomber: 1, pilot: 1 } };
    const roster = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: TEST_LOOK }));
    const s = createGame({ settings, players: roster, seed: 5, now: 0 });
    const onDeck = s.players.filter((p) => p.seat === COCKPIT);
    expect(onDeck).toHaveLength(1);
    expect(isPilot(onDeck[0].role)).toBe(true);
  });

  it('is where the Pilot sits, and he never leaves it', () => {
    const s = cabin();
    expect(parsePlace(COCKPIT)).toEqual({ row: -3, col: 3 });
    advanceTo(s, 'night_move', 1);
    expect(move(s, 'pilot', '5A')).toEqual({ ok: false, error: 'The Pilot stays on the flight deck.' });
    expect(move(s, 'pilot', 'washroom').ok).toBe(false);
    expect(viewFor(s, 'pilot', 0).options?.seats).toEqual([]);
    expect(viewFor(s, 'pilot', 0).options?.washroom).toBe('You cannot leave the flight deck.');
  });

  it('is out of reach of blasts in row 1', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'front').status).toBe('dead');
    expect(player(s, 'pilot').status).toBe('alive');
  });

  it('has no seat to look under', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'pilot', { kind: 'search' })).toEqual({ ok: false, error: 'You have no seat to look under.' });
  });
});

const call = (s: GameState, intent: Parameters<typeof applyIntent>[2]) => applyIntent(s, 'pilot', intent, 0);

describe('lights out on the flight deck', () => {
  it('calls someone up to the jump seat: safe tonight, back by morning, and everyone sees', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    expect(call(s, { kind: 'jumpseat', target: 'mid' })).toEqual({ ok: true });
    move(s, 'mid', 'washroom');
    advanceTo(s, 'night_act', 1);
    expect(s.night.jumpseat).toBe('mid');
    expect(player(s, 'mid').washroomUsed).toBe(false);
    expect(logTexts(s, 'all')).toContain('mid was called up to the flight deck for the night.');
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'mid').seat).toBe('4B');
  });

  it('cannot call up anyone who is buckled in', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    call(s, { kind: 'seatbelt', target: 'mid' });
    call(s, { kind: 'jumpseat', target: 'mid' });
    advanceTo(s, 'night_act', 1);
    expect(s.night.jumpseat).toBeNull();
    expect(logTexts(s, 'pilot')).toContain('You called mid up to the flight deck, but they are buckled in tonight.');
  });

  it('flies through rough air once per flight, buckling three rows', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    expect(call(s, { kind: 'roughair', startRow: 3 })).toEqual({ ok: true });
    advanceTo(s, 'night_act', 1);
    expect(s.night.buckled.mid).toBe('rough');
    expect(s.night.buckled.back).toBeUndefined();
    expect(logTexts(s, 'all')).toContain('The plane bucked through rough air over rows 3–5. Everyone there is buckled in tonight.');
    advanceTo(s, 'night_move', 2);
    expect(call(s, { kind: 'roughair', startRow: 1 })).toEqual({ ok: false, error: 'You already flew through rough air on this flight.' });
  });

  it('changes course once: hold adds a night, a shortcut cannot land before tonight', () => {
    const s = cabin();
    const nights = s.nights;
    advanceTo(s, 'night_move', 1);
    expect(call(s, { kind: 'course', change: 'hold' })).toEqual({ ok: true });
    advanceTo(s, 'night_act', 1);
    expect(s.nights).toBe(nights + 1);
    expect(logTexts(s, 'all')).toContain(`The captain is holding: Flight 13 now lands after night ${nights + 1}.`);
    advanceTo(s, 'night_move', 2);
    expect(call(s, { kind: 'course', change: 'shortcut' })).toEqual({ ok: false, error: 'You already changed course on this flight.' });
    const late = cabin([], 'pilot_rogue');
    advanceTo(late, 'night_move', late.nights);
    expect(call(late, { kind: 'course', change: 'shortcut' })).toEqual({ ok: false, error: 'Too late for a shortcut: we land after tonight.' });
  });

  it('a shortcut lands the plane a night early', () => {
    const s = cabin([], 'pilot_rogue');
    const nights = s.nights;
    advanceTo(s, 'night_move', 1);
    expect(call(s, { kind: 'course', change: 'shortcut' })).toEqual({ ok: true });
    advanceTo(s, 'ended');
    expect(s.phase.night).toBe(nights - 1);
    expect(s.result).toMatchObject({ winner: 'saboteurs', reason: 'landed' });
  });

  it('makes no calls while turbulence has him', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    s.night.buckled.pilot = 'turbulence';
    expect(call(s, { kind: 'jumpseat', target: 'mid' })).toEqual({ ok: false, error: 'Turbulence has you fighting the controls tonight.' });
  });
});

describe('in the dark on the flight deck', () => {
  it('the cameras see three rows, and planting looks just like looking under a seat', () => {
    const s = cabin([
      { id: 'b2', role: 'bomber', seat: '4C' },
      { id: 'nurse', role: 'nurse', seat: '5B' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'pilot', { kind: 'watch', startRow: 3 })).toEqual({ ok: true });
    act(s, 'b2', { kind: 'plant', where: 'seat', fuse: 2 });
    act(s, 'mid', { kind: 'search' });
    act(s, 'nurse', { kind: 'treat', target: 'mid' });
    advanceTo(s, 'dawn', 1);
    const seen = logTexts(s, 'pilot').find((t) => t.startsWith('On the cabin cameras over rows 3–5 you saw:'))!;
    expect(seen).toContain('b2 bent down under their seat');
    expect(seen).toContain('mid bent down under their seat');
    expect(seen).toContain('nurse leaned over to mid');
    expect(seen).not.toContain('bomber');
    // The same sightings as data, for bots and replays.
    const entry = s.log.find((e) => e.tag === 'watch' && Array.isArray(e.to) && e.to.includes('pilot'))!;
    expect(entry.data).toMatchObject({ rows: [3, 4, 5] });
    expect(entry.data!.seen).toEqual(
      expect.arrayContaining([
        { actor: 'b2', kind: 'plant' },
        { actor: 'mid', kind: 'search' },
        { actor: 'nurse', kind: 'treat', target: 'mid' },
      ]),
    );
  });

  it('shows empty rows sleeping', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'pilot', { kind: 'watch', startRow: 5 });
    advanceTo(s, 'dawn', 1);
    expect(logTexts(s, 'pilot')).toContain('The cabin cameras showed rows 5–7 sleeping.');
  });

  it('a saboteur in the jump seat can knock the Pilot out for the next night', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    applyIntent(s, 'pilot', { kind: 'jumpseat', target: 'bomber' }, 0);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 })).toEqual({ ok: false, error: 'You are on the flight deck tonight.' });
    expect(act(s, 'bomber', { kind: 'knockout' })).toEqual({ ok: true });
    act(s, 'pilot', { kind: 'watch', startRow: 1 });
    advanceTo(s, 'night_move', 2);
    expect(logTexts(s, 'pilot')).toContain('bomber knocked you out cold in the jump seat. You will be in no state to fly tomorrow night either.');
    expect(logTexts(s, 'pilot')).toContain('You were knocked out before you could check the cameras.');
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'mid' }, 0)).toEqual({ ok: false, error: 'You are still out cold.' });
  });

  it('passengers in the jump seat cannot knock anyone out', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    applyIntent(s, 'pilot', { kind: 'jumpseat', target: 'mid' }, 0);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'mid', { kind: 'knockout' })).toEqual({ ok: false, error: 'You are on the flight deck tonight.' });
    expect(act(s, 'mid', { kind: 'search' }).ok).toBe(false);
  });

  it('coffee from row 1 can poison the flight deck, and only a Nurse in the jump seat can treat the Pilot', () => {
    const s = cabin([
      { id: 'stew', role: 'stewardess_rogue', seat: 'Aisle 1' },
      { id: 'nurse', role: 'nurse', seat: '2B' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'nurse', { kind: 'treat', target: 'pilot' }).ok).toBe(false);
    expect(act(s, 'stew', { kind: 'serve', target: 'pilot' })).toEqual({ ok: true });
    advanceTo(s, 'night_move', 2);
    applyIntent(s, 'pilot', { kind: 'jumpseat', target: 'nurse' }, 0);
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'nurse', { kind: 'treat', target: 'pilot' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'pilot').status).toBe('alive');
  });

  it('coffee only goes up from row 1', () => {
    const s = cabin([{ id: 'stew', role: 'stewardess_rogue', seat: 'Aisle 3' }]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'stew', { kind: 'serve', target: 'pilot' })).toEqual({ ok: false, error: 'pilot is on the flight deck. Take the coffee up from row 1.' });
  });

  it('keeps the jump seat guest out of the cabin: no blasts, handcuffs or treatment reach them', () => {
    const s = cabin([{ id: 'marshal', role: 'marshal', seat: '4C' }]);
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    advanceTo(s, 'night_move', 2);
    applyIntent(s, 'pilot', { kind: 'jumpseat', target: 'front' }, 0);
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'marshal', { kind: 'cuff', target: 'front' })).toEqual({ ok: false, error: 'front is up on the flight deck tonight.' });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'front').status).toBe('alive');
  });
});

describe('the PA', () => {
  it('lets only the Pilot talk to the whole plane, by day, now and then', () => {
    const s = cabin();
    const pa = (id: string, text: string, now = 0) => applyIntent(s, id, { kind: 'chat', channel: 'pa', text }, now);
    advanceTo(s, 'night_move', 1);
    expect(pa('pilot', 'Hello').ok).toBe(false);
    advanceTo(s, 'day_discuss', 1);
    expect(pa('mid', 'Hello')).toEqual({ ok: false, error: 'Only the Pilot can use the PA.' });
    expect(pa('pilot', 'x'.repeat(141)).ok).toBe(false);
    expect(pa('pilot', 'Watch row 4.', 100_000)).toEqual({ ok: true });
    expect(pa('pilot', 'Again.', 105_000)).toEqual({ ok: false, error: 'The PA needs a moment: 10s.' });
    expect(viewFor(s, 'back', 0).chat.at(-1)).toMatchObject({ channel: 'pa', from: 'pilot', text: 'Watch row 4.' });
  });
});

describe('the Pilot on screen', () => {
  it('sees every call on offer, and everyone sees his guest', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    const o = viewFor(s, 'pilot', 0).options!;
    expect(o.jumpseat).toContain('mid');
    expect(o.roughair).toEqual([1, 2, 3, 4, 5, 6]);
    expect(o.course).toEqual(['hold', 'shortcut']);
    applyIntent(s, 'pilot', { kind: 'jumpseat', target: 'mid' }, 0);
    expect(viewFor(s, 'pilot', 0).mine?.jumpseat).toBe('mid');
    advanceTo(s, 'night_act', 1);
    expect(viewFor(s, 'back', 0).jumpseat).toBe('mid');
    expect(viewFor(s, 'mid', 0).you?.inJumpSeat).toBe(true);
    expect(viewFor(s, 'pilot', 0).options?.actions).toContainEqual({ kind: 'watch', startRow: 1 });
  });

  it('shows a knocked-out Pilot nothing to call', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    player(s, 'pilot').knockedOutNight = 1;
    const view = viewFor(s, 'pilot', 0);
    expect(view.you?.knockedOut).toBe(true);
    expect(view.options?.jumpseat).toEqual([]);
    expect(view.options?.seatbelt).toEqual([]);
  });
});
