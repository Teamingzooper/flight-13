import { describe, expect, it } from 'vitest';
import { customRoleId, describeCustomRole, roleInfo, validateCustomRoles } from './custom';
import { applyIntent } from './engine';
import { emptyCards, isSaboteur, teamOf, validateCards } from './roles';
import { defaultSettings } from './settings';
import { createGame } from './setup';
import { TEST_LOOK, advanceTo, logTexts, makeGame, player } from './testkit';
import type { CustomRole, GameState, NightAction, Settings } from './types';
import { viewFor } from './view';

const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);
const role = (over: Partial<CustomRole>): CustomRole => ({ name: 'Chef', team: 'saboteurs', ability: 'poison', uses: 1, count: 1, ...over });

/**
 * A flight with three roles of the host's own: a saboteur Chef who poisons once (custom_s1), a passenger Bouncer with
 * two pairs of handcuffs (custom_p2) and a saboteur Smuggler with one bomb (custom_s3).
 */
function flight(): GameState {
  const customRoles: CustomRole[] = [
    role({ name: 'Chef' }),
    role({ name: 'Bouncer', team: 'passengers', ability: 'cuff', uses: 2 }),
    role({ name: 'Smuggler', ability: 'bomb', uses: 1 }),
  ];
  return makeGame(
    [
      { id: 'chef', role: 'custom_s1', seat: '4B' },
      { id: 'bouncer', role: 'custom_p2', seat: '6B' },
      { id: 'smuggler', role: 'custom_s3', seat: '8A' },
      { id: 'amy', role: 'passenger', seat: '4C' },
      { id: 'ben', role: 'passenger', seat: '6C' },
      { id: 'cat', role: 'passenger', seat: '7C' },
      { id: 'dan', role: 'nurse', seat: '1A' },
      { id: 'eve', role: 'passenger', seat: '2A' },
    ],
    { settings: { rolesMode: 'custom', customRoles } },
  );
}

describe('custom roles', () => {
  it('must have sensible names, teams, abilities and counts', () => {
    expect(validateCustomRoles([role({})])).toBeNull();
    expect(validateCustomRoles([role({ name: '  ' })])).toMatch(/name of 1 to 16/);
    expect(validateCustomRoles([role({ name: 'A very long role name' })])).toMatch(/name of 1 to 16/);
    expect(validateCustomRoles([role({ name: 'nurse' })])).toBe('“nurse” is already a role. Pick another name.');
    expect(validateCustomRoles([role({}), role({ name: 'CHEF' })])).toBe('Two custom roles are called “CHEF”.');
    expect(validateCustomRoles([role({ team: 'passengers', ability: 'bomb' })])).toMatch(/Only saboteurs can plant bombs/);
    expect(validateCustomRoles([role({ ability: 'cuff', uses: 'nightly' })])).toBe('Pick how often Chef can use it.');
    expect(validateCustomRoles([role({ count: 3 })])).toBe('Deal 0 to 2 Chef cards.');
    expect(validateCustomRoles([1, 2, 3, 4].map((i) => role({ name: `Role ${i}` })))).toBe('At most 3 custom roles.');
  });

  it('count toward the deck: a custom saboteur is enough, but saboteurs stay a minority', () => {
    const cards = { ...emptyCards(), nurse: 1 };
    expect(validateCards(cards, 6, 0)).toMatch(/Add at least one saboteur/);
    expect(validateCards(cards, 6, 0, [role({ count: 1 })])).toBeNull();
    expect(validateCards(cards, 6, 0, [role({ count: 2 }), role({ name: 'Spy', count: 1 })])).toMatch(/minority/);
    expect(validateCards(cards, 3, 0, [role({ count: 1 }), role({ name: 'Tourist', team: 'passengers', ability: 'none', count: 2 })])).toMatch(/Too many special roles/);
  });

  it('are dealt when the host chooses the roles, under ids that carry their team', () => {
    const settings: Settings = {
      ...defaultSettings(),
      maxPassengers: 8,
      rolesMode: 'custom',
      cards: { ...emptyCards(), nurse: 1 },
      customRoles: [role({ name: 'Chef', count: 1 }), role({ name: 'Tourist', team: 'passengers', ability: 'none', uses: 'nightly', count: 2 })],
    };
    const roster = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: TEST_LOOK }));
    const s = createGame({ settings, players: roster, seed: 9, now: 0 });
    const roles = s.players.map((p) => p.role).sort();
    expect(roles.filter((r) => r === 'custom_s1')).toHaveLength(1);
    expect(roles.filter((r) => r === 'custom_p2')).toHaveLength(2);
    expect(isSaboteur('custom_s1')).toBe(true);
    expect(teamOf('custom_p2')).toBe('passengers');
    expect(customRoleId(1, 'passengers')).toBe('custom_p2');
    // Not dealt when the roles are automatic.
    const auto = createGame({ settings: { ...settings, rolesMode: 'auto' }, players: roster, seed: 9, now: 0 });
    expect(auto.players.some((p) => p.role.startsWith('custom'))).toBe(false);
  });

  it('show their own name and how-to', () => {
    const s = flight();
    expect(roleInfo('custom_s1', s.settings)).toMatchObject({ name: 'Chef', team: 'saboteurs' });
    expect(roleInfo('custom_s1', s.settings).howTo).toMatch(/^Once per flight, slip poison to someone within 1 seat/);
    expect(roleInfo('custom_p2', s.settings).howTo).toMatch(/^Twice per flight, handcuff someone within 2 seats/);
    expect(roleInfo('custom_s3', s.settings).howTo).toMatch(/^You carry one bomb/);
    expect(roleInfo('nurse', s.settings).name).toBe('Nurse');
    expect(describeCustomRole(s.settings.customRoles[0])).toBe('Chef (Saboteurs, poisons a neighbour, once per flight) ×1');
  });

  it('poison a neighbour, once: it looks like leaning over on the cameras', () => {
    const s = flight();
    advanceTo(s, 'night_act', 1);
    expect(viewFor(s, 'chef', 0).options?.actions).toContainEqual({ kind: 'poison', target: 'amy' });
    expect(act(s, 'chef', { kind: 'poison', target: 'cat' })).toEqual({ ok: false, error: 'cat is too far away. Sit next to them first.' });
    expect(act(s, 'amy', { kind: 'poison', target: 'chef' })).toEqual({ ok: false, error: 'You have no poison.' });
    expect(act(s, 'chef', { kind: 'poison', target: 'amy' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'amy').poisonedNight).toBe(1);
    expect(player(s, 'chef').abilityUses).toBe(1);
    expect(viewFor(s, 'chef', 0).you?.usesLeft).toBe(0);
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'chef', { kind: 'poison', target: 'amy' })).toEqual({ ok: false, error: 'You have used up your ability for this flight.' });
    expect(viewFor(s, 'chef', 0).options?.actions.some((a) => a.kind === 'poison')).toBe(false);
  });

  it('cuff as often as the host allows, named as themselves', () => {
    const s = flight();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bouncer', { kind: 'cuff', target: 'ben' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(logTexts(s, 'all')).toContain('The Bouncer handcuffed ben (Passenger) in 6C and walked them to the rear galley.');
    expect(viewFor(s, 'bouncer', 0).you?.usesLeft).toBe(1);
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'bouncer', { kind: 'cuff', target: 'cat' })).toEqual({ ok: true });
    advanceTo(s, 'night_act', 3);
    expect(act(s, 'bouncer', { kind: 'cuff', target: 'amy' })).toEqual({ ok: false, error: 'You already used your handcuffs.' });
  });

  it('plant the bombs they were given, and the black box names the role', () => {
    const s = flight();
    advanceTo(s, 'night_act', 1);
    expect(viewFor(s, 'smuggler', 0).you?.bombsLeft).toBe(1);
    expect(act(s, 'smuggler', { kind: 'plant', where: 'seat', fuse: 2 })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(viewFor(s, 'smuggler', 0).you?.bombsLeft).toBe(0);
    expect(logTexts(s, 'end')).toContain('Night 1: Smuggler smuggler planted a bomb under seat 8A (fuse 2).');
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'smuggler', { kind: 'plant', where: 'seat', fuse: 1 })).toEqual({ ok: false, error: 'You have no bombs left.' });
  });

  it('with no ability, can only look under their seat', () => {
    const s = flight();
    // (The Bouncer's card, remade as a Tourist.)
    s.settings.customRoles[1] = role({ name: 'Tourist', team: 'passengers', ability: 'none', uses: 'nightly' });
    advanceTo(s, 'night_act', 1);
    expect(viewFor(s, 'bouncer', 0).options?.actions).toEqual([{ kind: 'search' }]);
    expect(roleInfo('custom_p2', s.settings).howTo).toMatch(/^An ordinary passenger/);
  });

  it('can be the host’s own pick, while it is in the deck', () => {
    const settings: Settings = {
      ...defaultSettings(),
      maxPassengers: 8,
      rolesMode: 'custom',
      cards: { ...emptyCards(), bomber: 1, nurse: 1 },
      customRoles: [role({ name: 'Chef', count: 1 })],
    };
    const roster = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: TEST_LOOK }));
    for (const seed of [1, 2, 3, 4]) {
      const s = createGame({ settings, players: roster, seed, now: 0, chosen: { player: 'p0', role: 'custom_s1' } });
      expect(player(s, 'p0').role).toBe('custom_s1');
      expect(s.players.filter((p) => isSaboteur(p.role))).toHaveLength(2);
    }
    // Taken out of the deck since: dealt at random instead.
    const gone = createGame({ settings: { ...settings, customRoles: [role({ name: 'Chef', count: 0 })] }, players: roster, seed: 4, now: 0, chosen: { player: 'p0', role: 'custom_s1' } });
    expect(gone.players.some((p) => p.role === 'custom_s1')).toBe(false);
  });
});
