import { bombsFor, destinationOf } from './destinations';
import { ROLES, type RoleInfo } from './roles';
import type { CustomAbility, CustomRole, CustomRoleId, CustomUses, GameState, PlayerState, RoleId, Settings, Team } from './types';

/**
 * Roles the host makes up: a name, a team, one ability borrowed from a role the game already has (or none), and how
 * often it can be used. Each is dealt like any other card (only when the host chooses the roles). A custom role's id
 * carries its team and which of the flight's custom roles it is, so team checks never need the settings.
 */

export const CUSTOM_ROLE_LIMITS = { roles: 3, nameLength: 16, cards: 2 } as const;

export const CUSTOM_ROLE_IDS: readonly CustomRoleId[] = ['custom_p1', 'custom_p2', 'custom_p3', 'custom_s1', 'custom_s2', 'custom_s3'];

export interface AbilityInfo {
  id: CustomAbility;
  name: string;
  /** A few words, for the builder and the rules list. */
  short: string;
  teams: readonly Team[];
}

const BOTH: readonly Team[] = ['passengers', 'saboteurs'];

export const ABILITIES: Record<CustomAbility, AbilityInfo> = {
  none: { id: 'none', name: 'No ability', short: 'no ability', teams: BOTH },
  treat: { id: 'treat', name: 'Treat', short: 'treats a neighbour, like the Nurse', teams: BOTH },
  sweep: { id: 'sweep', name: 'Investigate', short: 'sweeps for bombs, like the Investigator', teams: BOTH },
  cuff: { id: 'cuff', name: 'Handcuffs', short: 'handcuffs someone within 2 seats, like the Air Marshal', teams: BOTH },
  poison: { id: 'poison', name: 'Poison', short: 'poisons a neighbour', teams: BOTH },
  bomb: { id: 'bomb', name: 'Plant bombs', short: 'plants bombs, like the Bomber', teams: ['saboteurs'] },
};

export const ABILITY_ORDER: readonly CustomAbility[] = ['none', 'treat', 'sweep', 'cuff', 'poison', 'bomb'];

/** Uses a custom role can have, for its ability (handcuffs are never every night). */
export function usesFor(ability: CustomAbility): readonly CustomUses[] {
  if (ability === 'none') return ['nightly'];
  return ability === 'cuff' ? [1, 2] : ['nightly', 2, 1];
}

export function newCustomRole(taken: readonly CustomRole[]): CustomRole {
  const names = ['Tourist', 'Chef', 'Bodyguard', 'Smuggler', 'Doctor', 'Spy'];
  const free = names.find((n) => !taken.some((r) => r.name.toLowerCase() === n.toLowerCase())) ?? `Role ${taken.length + 1}`;
  return { name: free, team: 'passengers', ability: 'none', uses: 'nightly', count: 1 };
}

export function isCustomRole(role: RoleId): role is CustomRoleId {
  return role.startsWith('custom_');
}

/** The id the `index`-th custom role is dealt under. */
export function customRoleId(index: number, team: Team): CustomRoleId {
  return `custom_${team === 'saboteurs' ? 's' : 'p'}${index + 1}` as CustomRoleId;
}

/** The custom role behind an id (null for built-in roles, or an id that no longer matches the settings). */
export function customDef(settings: Pick<Settings, 'customRoles'>, role: RoleId): CustomRole | null {
  if (!isCustomRole(role)) return null;
  const index = Number(role.slice(-1)) - 1;
  const def = settings.customRoles?.[index];
  return def && customRoleId(index, def.team) === role ? def : null;
}

export function customAbility(settings: Pick<Settings, 'customRoles'>, role: RoleId): CustomAbility | null {
  return customDef(settings, role)?.ability ?? null;
}

/** Can this role do this (built in, or the ability a custom role was given)? */
export function hasAbility(settings: Pick<Settings, 'customRoles'>, role: RoleId, ability: Exclude<CustomAbility, 'none'>): boolean {
  const custom = customAbility(settings, role);
  if (custom !== null) return custom === ability;
  switch (ability) {
    case 'treat':
      return role === 'nurse';
    case 'sweep':
      return role === 'investigator';
    case 'cuff':
      return role === 'marshal';
    case 'bomb':
      return role === 'bomber' || role === 'mastermind';
    case 'poison':
      return false;
  }
}

/** How many times a custom role's ability works per flight (null: every night). Bombs: how many it carries. */
export function usesLimit(def: CustomRole, nights: number): number | null {
  if (def.ability === 'none') return 0;
  if (def.ability === 'bomb') return def.uses === 'nightly' ? bombsFor(nights) : def.uses;
  if (def.ability === 'cuff') return def.uses === 2 ? 2 : 1;
  return def.uses === 'nightly' ? null : def.uses;
}

/** A custom role's uses left this flight (null: not a custom role, or no limit). Bombs count as planted. */
export function usesLeft(s: GameState, p: PlayerState): number | null {
  const def = customDef(s.settings, p.role);
  if (!def) return null;
  const limit = usesLimit(def, destinationOf(s.settings).nights);
  if (limit === null) return null;
  return Math.max(0, limit - (def.ability === 'bomb' ? p.bombsPlanted : p.abilityUses));
}

const HOW: Record<Exclude<CustomAbility, 'none' | 'bomb'>, string> = {
  treat: 'treat someone within 1 seat of you (diagonals count; across the aisle does not). They cannot die tonight and any poison is cured. You can treat yourself once.',
  sweep: 'sweep the seats within 1 of you for bombs, or inspect the drink cart or the lavatory if you are sitting next to it.',
  cuff: 'handcuff someone within 2 seats of you while the lights are out. They cannot act that night and are walked to the rear galley at dawn.',
  poison:
    'slip poison to someone within 1 seat of you. They fall sick at dawn and die the next dawn unless they are treated, wash it out in the lavatory, or carry an antidote. On the cabin cameras it looks just like leaning over.',
};

/** How a custom role plays, for its role card. */
export function customHowTo(def: CustomRole, nights: number): string {
  switch (def.ability) {
    case 'none':
      return def.team === 'saboteurs'
        ? 'No special ability, but you know your fellow saboteurs and plot with them at night. Blend in, steer the vote, and stay free until landing.'
        : 'No special ability, but at night you can look under your seat, and once per flight you can hide in the washroom. Watch closely, argue, and vote.';
    case 'bomb': {
      const n = usesLimit(def, nights)!;
      return `You carry ${n === 1 ? 'one bomb' : `${n} bombs`} and plant at most one a night: under your seat, on the drink cart (from an aisle seat next to it) or in the lavatory (from a seat next to it). Each goes off at the end of tomorrow night or the night after, and everyone within 2 seats is caught in the blast.`;
    }
    default: {
      const when = def.ability === 'cuff' ? (def.uses === 2 ? 'Twice per flight' : 'Once per flight') : def.uses === 'nightly' ? 'Each night' : def.uses === 2 ? 'Twice per flight' : 'Once per flight';
      return `${when}, ${HOW[def.ability]}`;
    }
  }
}

/** One line for the rules list: "Chef (Saboteurs, poisons a neighbour, once per flight) ×1". */
export function describeCustomRole(def: CustomRole): string {
  const team = def.team === 'saboteurs' ? 'Saboteurs' : 'Passengers';
  const uses = def.ability === 'none' ? '' : def.ability === 'cuff' ? (def.uses === 2 ? ', twice' : ', once') : def.uses === 'nightly' ? '' : def.uses === 2 ? ', twice per flight' : ', once per flight';
  return `${def.name} (${team}, ${ABILITIES[def.ability].short}${uses}) ×${def.count}`;
}

/** Name, team and how-to for any role, custom ones included. */
export function roleInfo(role: RoleId, settings: Settings): RoleInfo {
  const def = customDef(settings, role);
  if (!def) return ROLES[role];
  return {
    id: role,
    name: def.name,
    team: def.team,
    blurb: `A role made up for this flight: ${ABILITIES[def.ability].short}.`,
    howTo: customHowTo(def, destinationOf(settings).nights),
  };
}

/** Just the name. */
export function roleNameIn(role: RoleId, settings: Settings): string {
  return roleInfo(role, settings).name;
}

/** The custom cards in the deck: only when the host chooses the roles. */
export function customCards(settings: Pick<Settings, 'rolesMode' | 'customRoles'>): RoleId[] {
  if (settings.rolesMode !== 'custom') return [];
  return (settings.customRoles ?? []).flatMap((def, i) => Array.from({ length: def.count }, () => customRoleId(i, def.team)));
}

const BUILT_IN_NAMES = new Set([...Object.values(ROLES).filter((r) => !isCustomRole(r.id)).map((r) => r.name.toLowerCase()), 'marshal', 'stewardess', 'saboteur']);

/** Why these custom roles are not allowed, or null. */
export function validateCustomRoles(list: readonly CustomRole[]): string | null {
  if (!Array.isArray(list as unknown)) return 'Custom roles must be a list.';
  if (list.length > CUSTOM_ROLE_LIMITS.roles) return `At most ${CUSTOM_ROLE_LIMITS.roles} custom roles.`;
  const names = new Set<string>();
  for (const def of list) {
    const name = typeof def?.name === 'string' ? def.name.trim() : '';
    if (name.length < 1 || name.length > CUSTOM_ROLE_LIMITS.nameLength) return `Give each custom role a name of 1 to ${CUSTOM_ROLE_LIMITS.nameLength} characters.`;
    const key = name.toLowerCase();
    if (BUILT_IN_NAMES.has(key)) return `“${name}” is already a role. Pick another name.`;
    if (names.has(key)) return `Two custom roles are called “${name}”.`;
    names.add(key);
    if (def.team !== 'passengers' && def.team !== 'saboteurs') return `Pick a team for ${name}.`;
    if (!ABILITY_ORDER.includes(def.ability)) return `Pick an ability for ${name}.`;
    if (!ABILITIES[def.ability].teams.includes(def.team)) return `Only saboteurs can plant bombs: put ${name} on their side, or pick another ability.`;
    if (!usesFor(def.ability).includes(def.uses)) return `Pick how often ${name} can use it.`;
    if (!Number.isInteger(def.count) || def.count < 0 || def.count > CUSTOM_ROLE_LIMITS.cards) return `Deal 0 to ${CUSTOM_ROLE_LIMITS.cards} ${name} cards.`;
  }
  return null;
}
