import { describe, expect, it } from 'vitest';
import { applyIntent, viewFor, type DestinationId, type GameState, type PlayerView } from '../engine';
import { advanceTo, makeGame } from '../engine/testkit';
import { directorCues, type Cue } from './director';

/** A bomber in 4B with passengers around; `far` (4E) is who we watch from. */
function flight(destination: DestinationId = 'LHR'): GameState {
  return makeGame(
    [
      { id: 'bomber', role: 'bomber', seat: '4B' },
      { id: 'near', role: 'passenger', seat: '5C' },
      { id: 'far', role: 'passenger', seat: '4E' },
      { id: 'nurse', role: 'nurse', seat: '1F' },
      { id: 'pilot', role: 'pilot', seat: '8F' },
      { id: 'inv', role: 'investigator', seat: '2E' },
    ],
    { destination },
  );
}

/** Views arrive over the network as copies, so clone them like the transport does. */
const view = (s: GameState): PlayerView => structuredClone(viewFor(s, 'far', 0));
const kinds = (cues: Cue[]) => cues.map((c) => c.kind);
const captain = (cues: Cue[]) => cues.flatMap((c) => (c.kind === 'pa' ? [c.text] : [])).join(' ');

describe('director', () => {
  it('says nothing when nothing changed', () => {
    const s = flight();
    advanceTo(s, 'day_discuss', 1);
    const v = view(s);
    expect(directorCues(v, v)).toEqual([]);
  });

  it('welcomes passengers at takeoff but replays nothing when joining mid-flight', () => {
    const s = flight();
    expect(directorCues(null, view(s))).toEqual([]);
    advanceTo(s, 'takeoff');
    const cues = directorCues(null, view(s));
    expect(kinds(cues)).toContain('takeoff');
    expect(captain(cues)).toContain('London');
    advanceTo(s, 'night_act', 1);
    expect(directorCues(null, view(s))).toEqual([]);
  });

  it('turns the lights out at night and back on at dawn', () => {
    const s = flight();
    const takeoff = view(s);
    advanceTo(s, 'night_move', 1);
    const night = view(s);
    const out = directorCues(takeoff, night);
    expect(kinds(out)).toContain('lightsOut');
    expect(captain(out)).toContain('Night 1 of 5');
    advanceTo(s, 'dawn', 1);
    const on = directorCues(night, view(s));
    expect(on).toContainEqual({ kind: 'lightsOn', afterBlast: false });
  });

  it('cues an explosion once, and brings the lights up after it', () => {
    const s = flight();
    advanceTo(s, 'night_act', 1);
    expect(applyIntent(s, 'bomber', { kind: 'act', action: { kind: 'plant', where: 'seat', fuse: 1 } }, 0).ok).toBe(true);
    advanceTo(s, 'night_move', 2);
    expect(applyIntent(s, 'bomber', { kind: 'move', to: '1A' }, 0).ok).toBe(true);
    advanceTo(s, 'night_act', 2);
    const before = view(s);
    advanceTo(s, 'dawn', 2);
    const after = view(s);
    const cues = directorCues(before, after);
    expect(cues).toContainEqual({ kind: 'explosion', id: after.bombs[0].id, centers: [{ row: 4, col: 1 }], where: 'seat', victims: ['near'] });
    expect(cues).toContainEqual({ kind: 'lightsOn', afterBlast: true });
    expect(captain(cues)).toContain('mask');
    expect(kinds(directorCues(after, after))).not.toContain('explosion');
  });

  it('warns about turbulence and bumps the cabin on turbulent nights', () => {
    const s = flight('HNL');
    const takeoff = view(s);
    advanceTo(s, 'night_move', 1);
    const cues = directorCues(takeoff, view(s));
    expect(kinds(cues)).toContain('turbulence');
    expect(captain(cues)).toContain('turbulence');
  });

  it('sends the drink cart rolling when it breaks loose', () => {
    const s = flight('BDA');
    advanceTo(s, 'night_act', 1);
    s.night.anomaly = 'runaway_cart';
    s.cabin.cartRow = 1;
    const before = view(s);
    advanceTo(s, 'dawn', 1);
    const after = view(s);
    expect(after.cabin.cartRow).not.toBe(before.cabin.cartRow);
    expect(directorCues(before, after)).toContainEqual({ kind: 'cartRoll', from: before.cabin.cartRow, to: after.cabin.cartRow, runaway: true });
  });

  it('names the passenger who is restrained', () => {
    const s = flight();
    advanceTo(s, 'day_vote', 1);
    for (const id of ['bomber', 'near', 'nurse', 'pilot', 'inv']) applyIntent(s, id, { kind: 'vote', target: 'far' }, 0);
    const vote = view(s);
    advanceTo(s, 'verdict', 1);
    const cues = directorCues(vote, view(s));
    expect(cues).toContainEqual({ kind: 'restrained', playerId: 'far' });
    expect(captain(cues)).toContain('far has been restrained');
  });

  it('reads black box notes out, and names who the Air Marshal detained', () => {
    const s = makeGame(
      [
        { id: 'bomber', role: 'bomber', seat: '4B' },
        { id: 'marshal', role: 'marshal', seat: '4C' },
        { id: 'far', role: 'passenger', seat: '4E' },
        { id: 'nurse', role: 'nurse', seat: '1F' },
        { id: 'pilot', role: 'pilot', seat: '8F' },
        { id: 'inv', role: 'investigator', seat: '2E' },
        { id: 'mm', role: 'mastermind', seat: '8A' },
      ],
      {},
    );
    applyIntent(s, 'bomber', { kind: 'note', text: 'I regret nothing.' }, 0);
    advanceTo(s, 'night_act', 1);
    expect(applyIntent(s, 'marshal', { kind: 'act', action: { kind: 'cuff', target: 'bomber' } }, 0).ok).toBe(true);
    const before = view(s);
    advanceTo(s, 'dawn', 1);
    const cues = directorCues(before, view(s));
    expect(cues).toContainEqual({ kind: 'restrained', playerId: 'bomber' });
    expect(captain(cues)).toContain('The Air Marshal has detained bomber');
    expect(captain(cues)).toContain('I regret nothing.');
  });

  it('announces the landing', () => {
    const s = flight('LAS');
    advanceTo(s, 'night_act', 3);
    const last = view(s);
    advanceTo(s, 'ended');
    const cues = directorCues(last, view(s));
    expect(kinds(cues)).toContain('landing');
    expect(captain(cues)).toContain('Las Vegas');
  });
});
