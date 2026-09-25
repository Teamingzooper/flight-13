import { describe, expect, it } from 'vitest';
import { applyIntent, viewFor, type GameState, type NightAction, type PlayerView, type RoleId } from '../engine';
import { advanceTo, makeGame } from '../engine/testkit';
import { hear } from './hear';
import { know } from './knowledge';
import { believe, suspects, type HeardLine, type SeatHistory } from './mind';

const act = (s: GameState, id: string, action: NightAction) => applyIntent(s, id, { kind: 'act', action }, 0);
const flat = () => 0.5;

/** Seats by player for the nights so far, as a brain would have recorded them. */
function history(view: PlayerView, nights: number[]): SeatHistory {
  const seats = new Map(view.players.filter((p) => p.seat).map((p) => [p.id, p.seat!]));
  return new Map(nights.map((n) => [n, seats]));
}

/** Chat lines as a bot would have heard them. */
function lines(view: PlayerView, said: [from: string, text: string][]): HeardLine[] {
  const roster = view.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat }));
  return said.map(([from, text], i) => ({ id: i, t: i * 1000, night: view.phase.night, from, channel: 'cabin', heard: hear(text, from, roster, 'cabin') }));
}

function cabin(roles: Partial<Record<string, RoleId>> = {}) {
  return makeGame([
    { id: 'bomber', role: roles.bomber ?? 'bomber', seat: '5C' },
    { id: 'master', role: roles.master ?? 'mastermind', seat: '8A' },
    { id: 'inv', role: 'investigator', seat: '4C' },
    { id: 'nurse', role: 'nurse', seat: '6D' },
    { id: 'p1', role: roles.p1 ?? 'passenger', seat: '1A' },
    { id: 'p2', role: roles.p2 ?? 'passenger', seat: '2A' },
    { id: 'p3', role: 'passenger', seat: '3A' },
  ]);
}

describe('beliefs', () => {
  it('whoever sat on a seat where a bomb turned up is the top suspect', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    act(s, 'inv', { kind: 'sweep' });
    advanceTo(s, 'day_discuss', 1);
    const view = viewFor(s, 'inv', 0);
    const b = believe(know(view), [], history(view, [1]), 'normal', flat);
    expect(suspects(b)[0][0]).toBe('bomber');
    expect(b.why.get('bomber')).toEqual({ kind: 'bomb', seat: '5C' });
  });

  it('two Investigator claims raise both claimers, except for a gullible (Easy) bot', () => {
    const s = cabin();
    advanceTo(s, 'day_discuss', 1);
    const view = viewFor(s, 'p3', 0);
    const said = lines(view, [
      ['p1', "I'm the investigator"],
      ['p2', "No, I'm the investigator"],
    ]);
    const normal = believe(know(view), said, history(view, [1]), 'normal', flat);
    const easy = believe(know(view), said, history(view, [1]), 'easy', flat);
    expect(normal.suspicion.get('p1')!).toBeGreaterThan(normal.suspicion.get('nurse')!);
    expect(normal.why.get('p2')).toMatchObject({ kind: 'double_claim', role: 'investigator' });
    expect(easy.suspicion.get('p1')).toBe(easy.suspicion.get('nurse'));
  });

  it('the real Investigator knows a second one is lying', () => {
    const s = cabin();
    advanceTo(s, 'day_discuss', 1);
    const view = viewFor(s, 'inv', 0);
    const b = believe(know(view), lines(view, [['p2', "I'm the investigator"]]), history(view, [1]), 'normal', flat);
    expect(suspects(b)[0][0]).toBe('p2');
  });

  it('a claimed Pilot outside the cockpit is lying', () => {
    const s = cabin();
    advanceTo(s, 'day_discuss', 1);
    const view = viewFor(s, 'p3', 0);
    const b = believe(know(view), lines(view, [['p1', "I'm the pilot"]]), history(view, [1]), 'hard', flat);
    expect(b.why.get('p1')).toEqual({ kind: 'lied_role', role: 'pilot' });
  });

  it('a saboteur bot never suspects its team, however much the cabin does', () => {
    const s = cabin();
    advanceTo(s, 'day_discuss', 1);
    const view = viewFor(s, 'bomber', 0);
    const b = believe(know(view), lines(view, [['p1', 'master is the bomber'], ['p2', 'master is sus'], ['p3', 'p1 is sus']]), history(view, [1]), 'hard', flat);
    expect(b.suspicion.get('master')).toBe(0);
    expect(suspects(b)[0][0]).toBe('p1');
  });

  it('only sees its own view: swapping two other players’ hidden roles changes nothing', () => {
    const a = cabin();
    const z = cabin({ bomber: 'passenger', p1: 'bomber' });
    for (const s of [a, z]) advanceTo(s, 'day_discuss', 1);
    const va = viewFor(a, 'p3', 0);
    const vz = viewFor(z, 'p3', 0);
    expect(va).toEqual(vz);
    const said: [string, string][] = [['p1', 'bomber is sus'], ['nurse', "I'm the nurse"]];
    expect(believe(know(va), lines(va, said), history(va, [1]), 'hard', flat)).toEqual(believe(know(vz), lines(vz, said), history(vz, [1]), 'hard', flat));
  });
});
