import type { ChatChannel, RoleId, SeatId } from '../engine';

/**
 * Reading chat the way a bot does: who a line names, and what it says about them. Keyword and pattern
 * based, English only. Names and seats are masked first ("@p3", "#4C"), so a role word inside a name
 * ("Captain Kay") never reads as a role.
 */

export interface RosterEntry {
  id: string;
  name: string;
  seat: SeatId | null;
}

export interface ResultClaim {
  what: 'clear' | 'bomb';
  seats: SeatId[];
  where: 'seat' | 'cart' | 'lavatory';
}

export type Ask = 'role' | 'result' | 'suspect' | 'general';
export type OrderAct = 'plant' | 'poison' | 'move' | 'stay' | 'knockout';

export interface Order {
  who: string[] | 'all';
  act: OrderAct;
  seat?: SeatId;
  target?: string;
  where?: 'seat' | 'cart' | 'lavatory';
}

export interface Heard {
  /** Everyone the line names: by name, first name, or the seat they sit in (never the speaker). */
  about: string[];
  /** Who it is said to: named at the start ("Jo, …") or at the end of a question; '*' for everyone. */
  to: string[];
  /** A role the speaker claims to have. */
  claim: RoleId | null;
  /** Results the speaker claims. */
  results: ResultClaim[];
  accuse: { id: string; role: RoleId | null }[];
  defend: string[];
  /** A player id, or 'skip'. */
  vote: string | null;
  ask: Ask | null;
  /** Saboteur channel only: what a teammate tells bots to do tonight. */
  order: Order | null;
}

const STOP = new Set(['i', 'me', 'you', 'the', 'a', 'an', 'it', 'is', 'so', 'no', 'ok', 'hi', 'he', 'she', 'we', 'us', 'my', 'am', 'on', 'in', 'at', 'to', 'of', 'or', 'and']);

const ROLE_WORDS: readonly [RegExp, RoleId | null][] = [
  [/\brogue\s+(stewardess|steward|flight attendant|attendant)\b/, 'stewardess_rogue'],
  [/\brogue\s+(pilot|captain)\b/, 'pilot_rogue'],
  [/\b(air marshal|sky marshal|marshal|undercover cop|cop)\b/, 'marshal'],
  [/\b(investigator|detective|inspector)\b/, 'investigator'],
  [/\b(nurse|doctor|doc|medic)\b/, 'nurse'],
  [/\b(stewardess|steward|flight attendant|attendant)\b/, 'stewardess_loyal'],
  [/\b(pilot|captain)\b/, 'pilot'],
  [/\bmastermind\b/, 'mastermind'],
  [/\bbomber\b/, 'bomber'],
  [/\b(passenger|vanilla|nobody special)\b/, 'passenger'],
];
const SABOTEUR_WORDS = /\b(saboteurs?|sab|sabs|traitor|terrorist|evil|bad guy|killer|rogue)\b/;
const ACCUSE_WORDS =
  /\b(sus|suss|sussy|suspicious|shady|sketchy|bomber|saboteurs?|sab|mastermind|liar|lying|lied|guilty|did it|killer|evil|traitor|restrain|cuff|kick|rogue|fake|faking)\b/;
const DEFEND_WORDS = /\b(clear|cleared|trust|trusted|innocent|good|safe|vouch|vouched|confirmed|legit|with me|fine|real)\b/;
const NEGATION = /\b(not|isn't|isnt|aint|ain't|never|no way|doubt|don't|dont|do not|doesn't|doesnt|can't|cant|wasn't|wasnt)\b/;
const CLEAR_WORDS = /\b(clean|clear|nothing|empty|safe|no bombs?|nada|fine|zilch)\b/;
const BOMB_WORDS = /\b(bomb|bombs|wires|device|ticking|explosives?)\b/;
const RESULT_VERBS = /\b(searched|search|checked|check|swept|sweep|looked under|looked around|inspected|inspect|found)\b/;
const EVERYONE = /\b(everyone|everybody|anyone|anybody|all of you|guys|y'all|yall|team|all)\b/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SABOTEUR_ROLES: readonly RoleId[] = ['bomber', 'mastermind', 'stewardess_rogue', 'pilot_rogue'];
const CLAIMS: readonly RegExp[] = [
  /\b(?:i'?m|i am|im)\s+(?:just\s+)?((?:not\s+)?[a-z ]{3,30})/,
  /\bas\s+(?:the|a|an)\s+([a-z ]{3,30})/,
  /\bclaim(?:ing|s)?\s+([a-z ]{3,30})/,
  /(?:^|[.!,]\s*)([a-z ]{3,20}?)\s+here\b/,
];

/** The role a phrase starts with ("nurse, and…" is the Nurse; "sure the nurse…" is nobody). */
function roleAtStart(phrase: string): RoleId | null {
  for (const [re, role] of ROLE_WORDS) {
    const m = re.exec(phrase);
    if (m && m.index === 0) return role;
  }
  return null;
}

/** Name forms a player answers to, longest first: the full name, the name without "(bot)", a unique first name. */
function nameForms(roster: RosterEntry[]): { form: string; index: number }[] {
  const base = (name: string) =>
    name
      .toLowerCase()
      .replace(/\s*\(bot\)\s*/g, ' ')
      .replace(/\s+\d+$/, '')
      .trim();
  const count = new Map<string, number>();
  const bump = (form: string) => count.set(form, (count.get(form) ?? 0) + 1);
  for (const p of roster) {
    const b = base(p.name);
    bump(b);
    if (b.split(' ')[0] !== b) bump(b.split(' ')[0]);
  }
  const forms: { form: string; index: number }[] = [];
  roster.forEach((p, index) => {
    const full = p.name.toLowerCase().trim();
    const b = base(p.name);
    const first = b.split(' ')[0];
    // The full name always works; a shorter form only when nobody else answers to it.
    const candidates = new Set([full]);
    if (count.get(b) === 1) candidates.add(b);
    if (count.get(first) === 1) candidates.add(first);
    for (const form of candidates) if (form.length >= 2 && !STOP.has(form)) forms.push({ form, index });
  });
  // Longest first, so "jo (bot) 2" wins over "jo".
  return forms.sort((a, b) => b.form.length - a.form.length);
}

/** Lower-case the line and replace seats with "#4C" and names with "@3" (their place in the roster: never a word). */
export function mask(text: string, roster: RosterEntry[]): string {
  let t = ` ${text.toLowerCase().replace(/[’‘`]/g, "'").replace(/@/g, ' ')} `;
  t = t.replace(/\b(\d{1,2})([a-f])\b/g, (_, row: string, col: string) => ` #${Number(row)}${col.toUpperCase()} `);
  for (const { form, index } of nameForms(roster)) {
    const re = new RegExp(`(^|[^a-z0-9#@])(${escapeRe(form)})(?=$|[^a-z0-9])`, 'g');
    t = t.replace(re, (_, pre: string) => `${pre} @${index} `);
  }
  return t.replace(/\s+/g, ' ').trim();
}

function roleIn(text: string): RoleId | null {
  for (const [re, role] of ROLE_WORDS) if (re.test(text)) return role;
  return null;
}

/** Mentioned ids and seats, in order. */
function mentions(masked: string, roster: RosterEntry[]): { ids: string[]; seats: SeatId[] } {
  const ids = [...masked.matchAll(/@(\d+)/g)].map((m) => roster[Number(m[1])]?.id).filter((id): id is string => !!id);
  const seats = [...masked.matchAll(/#(\d{1,2}[A-F])/g)].map((m) => m[1]);
  return { ids, seats };
}

/** The few words before `index`, for spotting a negation. */
function negatedBefore(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 24), index);
  return NEGATION.test(before);
}

export function hear(text: string, speaker: string, roster: RosterEntry[], channel: ChatChannel | 'whisper'): Heard {
  const masked = mask(text, roster);
  const bySeat = new Map(roster.filter((p) => p.seat).map((p) => [p.seat!, p.id]));
  const me = roster.find((p) => p.id === speaker);
  const { ids, seats } = mentions(masked, roster);
  const seatPeople = seats.map((s) => bySeat.get(s)).filter((id): id is string => !!id);
  const about = [...new Set([...ids, ...seatPeople])].filter((id) => id !== speaker);

  // Who it is said to: names up front followed by a comma or a question ("Jo, …", "Jo what did you find").
  const to: string[] = [];
  const lead = /^((?:@\d+\s*(?:,|and|&)?\s*)+?)(?:[,:!?]|\s(?=(?:what|who|where|why|how|did|do|can|have|are|were)\b))/.exec(masked);
  if (lead) to.push(...mentions(lead[1], roster).ids);
  const question = masked.includes('?');
  if (question) {
    const tail = /@(\d+)\s*\?+\s*$/.exec(masked);
    const asked = tail ? roster[Number(tail[1])]?.id : undefined;
    if (asked) to.push(asked);
    if (to.length === 0 && EVERYONE.test(masked)) to.push('*');
  }
  const addressed = [...new Set(to)].filter((id) => id !== speaker && id !== '*');

  // A role the speaker claims: "I'm the Nurse", "as the Nurse", "claiming Investigator", "nurse here".
  let claim: RoleId | null = null;
  for (const re of CLAIMS) {
    const m = re.exec(masked);
    if (!m) continue;
    const phrase = m[1].split(/[,.!?;:]/)[0].trim();
    if (/^(not|no|never)\b/.test(phrase)) break;
    const role = roleAtStart(phrase.replace(/^(?:(?:loyal|real|actual|legit|true|confirmed|the|a|an)\s+)+/, ''));
    if (role) {
      claim = role;
      break;
    }
  }

  // Results the speaker claims.
  const results: ResultClaim[] = [];
  if (RESULT_VERBS.test(masked)) {
    const bomb = BOMB_WORDS.test(masked) && !/\bno bombs?\b/.test(masked);
    const clear = !bomb && CLEAR_WORDS.test(masked);
    if (bomb || clear) {
      const what = bomb ? 'bomb' : 'clear';
      const resultSeats = [...seats];
      if (/\bmy seat\b|\bunder me\b|\bmy own seat\b/.test(masked) && me?.seat) resultSeats.push(me.seat);
      if (resultSeats.length > 0) results.push({ what, seats: [...new Set(resultSeats)], where: 'seat' });
      if (/\bcart\b/.test(masked)) results.push({ what, seats: [], where: 'cart' });
      if (/\b(lavatory|lav|toilet|bathroom|washroom|restroom)\b/.test(masked)) results.push({ what, seats: [], where: 'lavatory' });
    }
  }

  // Votes.
  let vote: string | null = null;
  const voteMatch = /\b(?:vote|voting|votes? for|i vote)\s+(?:for\s+|out\s+)?(@\d+|#\d{1,2}[A-F])/.exec(masked);
  if (voteMatch) {
    const token = voteMatch[1];
    vote = token.startsWith('@') ? (roster[Number(token.slice(1))]?.id ?? null) : (bySeat.get(token.slice(1)) ?? null);
    if (vote === speaker) vote = null;
  } else if (/\b(skip|skipping|abstain|abstaining|no vote)\b/.test(masked)) {
    vote = 'skip';
  }

  // Accusations and defenses, clause by clause ("I trust Jo but Cal is sus").
  const accuse: { id: string; role: RoleId | null }[] = [];
  const defend: string[] = [];
  const resultLine = RESULT_VERBS.test(masked);
  for (const clause of masked.split(/[.!;?\n]+|\bbut\b|\bwhile\b|\bwhereas\b/)) {
    const { ids: cIds, seats: cSeats } = mentions(clause, roster);
    const people = [...new Set([...cIds, ...cSeats.map((x) => bySeat.get(x)).filter((id): id is string => !!id)])].filter((id) => id !== speaker);
    if (people.length === 0) continue;
    const accuseAt = clause.search(ACCUSE_WORDS);
    const itsX = /\b(?:it'?s|it is|it was|gotta be|has to be|must be)\s+@/.test(clause) || /@\d+\s+did it\b/.test(clause);
    // (A clean search result names a seat, but it is a result, not a defense.)
    const defendAt = resultLine ? -1 : clause.search(DEFEND_WORDS);
    const accused = (accuseAt >= 0 && !negatedBefore(clause, accuseAt)) || itsX || (defendAt >= 0 && negatedBefore(clause, defendAt));
    const cleared = (accuseAt >= 0 && negatedBefore(clause, accuseAt)) || (defendAt >= 0 && !negatedBefore(clause, defendAt));
    let role = roleIn(clause);
    if (role && !SABOTEUR_ROLES.includes(role)) role = null;
    if (accused) {
      for (const id of people) accuse.push({ id, role });
    } else if (cleared) {
      for (const id of people) defend.push(id);
    } else if (SABOTEUR_WORDS.test(clause)) {
      for (const id of people) accuse.push({ id, role });
    }
  }
  if (vote && vote !== 'skip' && !accuse.some((a) => a.id === vote)) accuse.push({ id: vote, role: null });

  // Questions.
  let ask: Ask | null = null;
  if (question || /^(who|what|where|why|how|did|do|does|have|has|can|anyone|any1)\b/.test(masked)) {
    if (/\bwhat did (?:you|u|ya|@\d+) (?:find|search|check|see|get|do)\b|\bfind anything\b|\bsee anything\b|\bresults?\b|\bwhat'?d you find\b/.test(masked)) {
      ask = 'result';
    } else if (/\bwho are (?:you|u)\b|\bwhat'?s (?:your|ur) role\b|\bwhat is (?:your|ur) role\b|\bwhat are (?:you|u)\b|\broles?\?|\bclaim\?|\bwhat'?s your claim\b/.test(masked)) {
      ask = 'role';
    } else if (/\bwho'?s (?:sus|the bomber|it|the saboteur|evil|bad)\b|\bwho is (?:sus|the bomber|it|the saboteur)\b|\bwho do (?:you|u) (?:suspect|think)\b|\bthoughts on\b|\bany (?:ideas|suspects)\b/.test(masked)) {
      ask = 'suspect';
    } else if (question) {
      ask = 'general';
    }
  }

  // Orders, in the saboteur channel only.
  let order: Order | null = null;
  if (channel === 'saboteurs') {
    // "Jo, plant 5C" or just "Jo plant 5C": orders open with who they are for.
    const orderLead = /^((?:@\d+\s*(?:,|and|&)?\s*)+)(?=(?:plant|bomb|place|drop|set|poison|serve|drug|spike|move|switch|sit|go|head|stay|lay|lie|wait|do|chill|hold|knock|ko|take|hit)\b)/.exec(masked);
    const leaders = orderLead ? mentions(orderLead[1], roster).ids.filter((id) => id !== speaker) : [];
    const who: string[] | 'all' = addressed.length > 0 ? addressed : leaders.length > 0 ? leaders : 'all';
    const firstSeat = seats[0];
    if (/\b(knock|knockout|ko|take out|hit)\b[^.]*\b(pilot|captain|him)\b|\bknock (?:him|the pilot|the captain) out\b/.test(masked)) {
      order = { who, act: 'knockout' };
    } else if (/\b(plant|bomb|place|drop|set)\b/.test(masked)) {
      if (/\bcart\b/.test(masked)) order = { who, act: 'plant', where: 'cart' };
      else if (/\b(lavatory|lav|toilet|bathroom|washroom)\b/.test(masked)) order = { who, act: 'plant', where: 'lavatory' };
      else order = { who, act: 'plant', where: 'seat', ...(firstSeat ? { seat: firstSeat } : {}) };
    } else if (/\b(poison|serve|drug|spike)\b/.test(masked)) {
      const victim = ids.find((id) => id !== speaker && !(who !== 'all' && who.includes(id))) ?? (firstSeat ? bySeat.get(firstSeat) : undefined);
      order = { who, act: 'poison', ...(victim ? { target: victim } : {}) };
    } else if (/\b(move|switch|sit|go|head)\b/.test(masked) && firstSeat) {
      order = { who, act: 'move', seat: firstSeat };
    } else if (/\b(stay|lay low|lie low|wait|do nothing|chill|hold off|sit tight)\b/.test(masked)) {
      order = { who, act: 'stay' };
    }
  }

  return {
    about,
    to: addressed.length > 0 ? addressed : to.includes('*') ? ['*'] : [],
    claim,
    results,
    accuse: dedupe(accuse),
    defend: [...new Set(defend)].filter((id) => !accuse.some((a) => a.id === id)),
    vote,
    ask,
    order,
  };
}

function dedupe(list: { id: string; role: RoleId | null }[]): { id: string; role: RoleId | null }[] {
  const seen = new Map<string, RoleId | null>();
  for (const { id, role } of list) if (!seen.has(id) || (role && !seen.get(id))) seen.set(id, role);
  return [...seen].map(([id, role]) => ({ id, role }));
}
