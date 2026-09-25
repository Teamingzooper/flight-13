import type { Tone } from './personality';

/**
 * Everything a bot can say, a few ways each, filled in with names, seats and roles, then coloured by its
 * tone. Lines stay short enough for a speech bubble.
 */

export type LineKind =
  | 'react_death'
  | 'react_blast'
  | 'react_quiet'
  | 'react_washroom'
  | 'react_jumpseat'
  | 'claim'
  | 'result_clear'
  | 'result_bomb'
  | 'accuse'
  | 'defend_self'
  | 'defend_other'
  | 'agree'
  | 'disagree'
  | 'answer_result'
  | 'answer_suspect'
  | 'dunno'
  | 'vote'
  | 'skip'
  | 'verdict_right'
  | 'verdict_wrong'
  | 'plan_plant'
  | 'plan_poison'
  | 'plan_low'
  | 'order_ok'
  | 'order_no'
  | 'pa_cameras'
  | 'pa_quiet'
  | 'banter';

export interface Fill {
  /** Who the line is about. */
  name?: string;
  seat?: string;
  /** "4C, 4D and 5C". */
  seats?: string;
  /** A role's display name ("Investigator"). */
  role?: string;
  /** Someone else in the line. */
  target?: string;
  /** A reason, as a clause ("a bomb turned up under 5C"). */
  why?: string;
}

export const MAX_LINE = 120;

const LINES: Record<LineKind, readonly string[]> = {
  react_death: ['RIP {name}.', 'We lost {name}. Who is next?', 'Not {name}...', 'Poor {name}. Somebody did that.', '{name} is gone. Think, people.'],
  react_blast: [
    'That blast was right by {seat}.',
    'Did everyone hear that? {seat}.',
    'That bomb was under {seat}. Who sat there?',
    'BOOM, {seat}. Explain yourselves.',
  ],
  react_quiet: ['Quiet night. Too quiet.', 'Nobody died? Good.', 'Everyone still here? Nice.', 'Well, that was a calm night.'],
  react_washroom: ['{name} spent the night in the lavatory. Why?', 'Interesting, {name} hid in the lav.', 'What were you doing in there all night, {name}?'],
  react_jumpseat: ['{name} got called up front.', 'The captain trusts {name}, huh.', 'How was the flight deck, {name}?'],
  claim: ["I'm the {role}.", "For the record, I'm the {role}.", '{role} here.', "I'll say it: I'm the {role}."],
  result_clear: ['Checked {seats} last night. Clean.', '{seats}: nothing there.', 'Nothing under {seats}.', 'I searched {seats}. All clear.'],
  result_bomb: ['Found a bomb under {seats}!', 'There was a bomb at {seats}. Who sat there?', 'Wires under {seats}. Not a drill.', 'I found something under {seats}.'],
  accuse: ["I think it's {name}: {why}.", '{name} is sus. {why}.', 'Look at {name}. {why}.', "My money's on {name}: {why}.", '{name}. {why}.'],
  defend_self: ['Not me! {why}.', 'Why me? {why}.', "I'm not the bomber. {why}.", 'Wrong person. {why}.'],
  defend_other: ['{name} is fine: {why}.', 'Leave {name} alone.', 'I trust {name}.', "It's not {name}."],
  agree: ['Agreed, {name} is sus.', 'Yeah, {name}.', '+1 on {name}.', 'I was thinking {name} too.'],
  disagree: ['Nah, not {name}.', "I doubt it's {name}.", '{name}? No way.', "I don't buy that about {name}."],
  answer_result: ["Didn't find anything worth saying.", 'Nothing to report.', 'I kept my head down last night.'],
  answer_suspect: ['Honestly? {name}. {why}.', "I'd look at {name}.", '{name}: {why}.'],
  dunno: ['No idea yet.', 'Not sure.', "Can't say yet.", 'Still thinking.'],
  vote: ['Voting {name}: {why}.', "My vote's on {name}.", '{name}. {why}.', 'Voting {name}.'],
  skip: ['Skipping, not sure yet.', "I'll skip this one.", 'Skip. Not enough to go on.', 'Not voting yet.'],
  verdict_right: ['Knew it.', 'Good call, everyone.', 'Told you.', 'One down.'],
  verdict_wrong: ['Oh no, {name} was the {role}.', 'We got it wrong. {name} was the {role}.', 'That was the {role}... oops.'],
  plan_plant: ['Planting under {seat} tonight.', "I'll set one under {seat}.", 'Bomb goes under {seat}.'],
  plan_poison: ['Serving {name} a special drink.', '{name} gets the poison tonight.', 'Going for {name} tonight.'],
  plan_low: ['Laying low tonight.', 'Staying quiet tonight.', "I'll sit this one out."],
  order_ok: ['On it.', 'Got it.', 'Will do.', 'On it: {seat}.'],
  order_no: ["Can't: {why}.", 'No can do, {why}.', '{why}, sorry.'],
  pa_cameras: [
    'This is your captain. The cameras caught {name} {why} last night.',
    'Captain here. Cabin cameras saw {name} {why}.',
    'From the flight deck: {name} was on camera last night, {why}.',
  ],
  pa_quiet: ['This is your captain. The cabin cameras were quiet last night.', 'Captain speaking: nothing on the cameras last night.'],
  banter: [
    'Anyone want peanuts?',
    'Is it me or is it cold in here?',
    'This flight is taking forever.',
    'Who packed a flashlight? Asking for a friend.',
    'Seatbelts on, people.',
  ],
};

/** The wordings for a kind of line that `fill` can complete (a template missing a slot is skipped). */
function usable(kind: LineKind, fill: Fill): string[] {
  return LINES[kind].filter((t) => [...t.matchAll(/\{(\w+)\}/g)].every((m) => fill[m[1] as keyof Fill]));
}

function tone(line: string, t: Tone, rng: () => number): string {
  const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  switch (t) {
    case 'blunt':
      return line.replace(/!/g, '.').replace(/^(honestly\?|okay so|well,)\s*/i, '');
    case 'nervous':
      return rng() < 0.45 ? `${['Um, ', 'I think ', 'Not sure, but '][Math.floor(rng() * 3)]}${low(line)}` : line;
    case 'chatty': {
      const lead = rng() < 0.4 ? `${['Okay so ', 'Honestly, ', 'Ngl, '][Math.floor(rng() * 3)]}${low(line)}` : line;
      return rng() < 0.2 ? `${lead.replace(/[.!]$/, '')} lol` : lead;
    }
    case 'formal':
      return line
        .replace(/\bsus\b/g, 'suspicious')
        .replace(/\bNah\b/g, 'No')
        .replace(/\bYeah\b/g, 'Yes')
        .replace(/^\+1 on /, 'I agree about ')
        .replace(/\blav\b/g, 'lavatory');
  }
}

/** Cut a line at a word boundary to fit a bubble. */
function fit(line: string): string {
  if (line.length <= MAX_LINE) return line;
  const cut = line.slice(0, MAX_LINE - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 60 ? cut.lastIndexOf(' ') : cut.length).replace(/[,:;]$/, '')}…`;
}

/** A line of the given kind in this tone (null if nothing fits the fill). */
export function say(kind: LineKind, fill: Fill, t: Tone, rng: () => number): string | null {
  const options = usable(kind, fill);
  if (options.length === 0) return null;
  const template = options[Math.floor(rng() * options.length)];
  const filled = template.replace(/\{(\w+)\}/g, (_, key: string) => fill[key as keyof Fill] ?? '');
  // A reason slotted in after a full stop starts a sentence.
  const shaped = tone(filled, t, rng).replace(/([.!?]\s+)([a-z])/g, (_, stop: string, c: string) => stop + c.toUpperCase());
  return fit(shaped.charAt(0).toUpperCase() + shaped.slice(1));
}

/** Every template, for tests. */
export function allTemplates(): [LineKind, string][] {
  return (Object.keys(LINES) as LineKind[]).flatMap((k) => LINES[k].map((t): [LineKind, string] => [k, t]));
}
