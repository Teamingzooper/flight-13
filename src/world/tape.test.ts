import { describe, expect, it } from 'vitest';
import { applyIntent, viewFor, type GameState, type NightAction } from '../engine';
import { COCKPIT } from '../engine/grid';
import { advanceTo, makeGame } from '../engine/testkit';
import { TAPE_CLIP, TAPE_INTRO, clipAt, planTape, tapeClock } from './tape';

const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);

function flight(): GameState {
  return makeGame([
    { id: 'pilot', role: 'pilot', seat: COCKPIT },
    { id: 'bomber', role: 'bomber', seat: '4C' },
    { id: 'nurse', role: 'nurse', seat: '5B' },
    { id: 'mid', role: 'passenger', seat: '5C' },
    { id: 'edge', role: 'passenger', seat: '6F' },
    { id: 'far', role: 'passenger', seat: '8A' },
  ]);
}

describe('the camera tape', () => {
  it('replays each sighting in turn, with its caption and a night clock', () => {
    const s = flight();
    advanceTo(s, 'night_act', 1);
    act(s, 'pilot', { kind: 'watch', startRow: 3 });
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    act(s, 'nurse', { kind: 'treat', target: 'mid' });
    advanceTo(s, 'day_discuss', 1);
    const tape = planTape(viewFor(s, 'pilot', 0), () => null)!;
    expect(tape.night).toBe(1);
    expect(tape.rows).toEqual([3, 4, 5]);
    expect(tape.clips.map((c) => [c.actor, c.kind, c.text])).toEqual([
      ['bomber', 'under_seat', 'bomber bent down under their seat'],
      ['nurse', 'lean', 'nurse leaned over to mid'],
    ]);
    expect(tape.clips[1].target).toBe('mid');
    expect(tape.clips.map((c) => c.at)).toEqual([TAPE_INTRO, TAPE_INTRO + TAPE_CLIP]);
    expect(clipAt(tape, TAPE_INTRO + TAPE_CLIP + 0.5)?.actor).toBe('nurse');
    expect(clipAt(tape, 0.2)).toBeNull();
    expect(tape.length).toBeGreaterThan(TAPE_INTRO + 2 * TAPE_CLIP);
    // Rows 2–6 are in the picture; row 8 and the flight deck are not.
    expect(tape.cast.map((c) => c.id).sort()).toEqual(['bomber', 'edge', 'mid', 'nurse']);
  });

  it('seats people where they sat that night, when the 3D view saw it', () => {
    const s = flight();
    advanceTo(s, 'night_act', 1);
    act(s, 'pilot', { kind: 'watch', startRow: 3 });
    advanceTo(s, 'day_discuss', 1);
    const that = new Map([
      ['bomber', '3A'],
      ['far', '4F'],
    ]);
    const tape = planTape(viewFor(s, 'pilot', 0), (night) => (night === 1 ? that : null))!;
    expect(tape.cast).toEqual([
      { id: 'bomber', seat: '3A' },
      { id: 'far', seat: '4F' },
    ]);
  });

  it('shows a quiet night, and nothing before the cameras ever ran', () => {
    const s = flight();
    advanceTo(s, 'day_discuss', 1);
    expect(planTape(viewFor(s, 'pilot', 0), () => null)).toBeNull();
    advanceTo(s, 'night_act', 2);
    act(s, 'pilot', { kind: 'watch', startRow: 6 });
    advanceTo(s, 'day_discuss', 2);
    const tape = planTape(viewFor(s, 'pilot', 0), () => null)!;
    expect(tape.clips).toEqual([]);
    expect(tape.length).toBeGreaterThan(2);
  });

  it('runs the clock from just after midnight to the small hours', () => {
    expect(tapeClock(0, 1)).toBe('02:20');
    expect(tapeClock(0, 4)).toBe('00:44');
    expect(tapeClock(3, 4)).toBe('03:55');
  });
});
