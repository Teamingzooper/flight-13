import { describe, expect, it } from 'vitest';
import { applyIntent, viewFor, type GameState, type Intent } from '../engine';
import { COCKPIT } from '../engine/grid';
import { advanceTo, makeGame } from '../engine/testkit';
import { REEL_INTRO, planReels } from './recorder';

const send = (s: GameState, id: string, intent: Intent) => applyIntent(s, id, intent, 0);

/** A flight with a bit of everything: a Pilot's calls, a plant, a treatment, a vote and a blast. */
function flight(): GameState {
  const s = makeGame([
    { id: 'pilot', role: 'pilot', seat: COCKPIT },
    { id: 'bomber', role: 'bomber', seat: '4B' },
    { id: 'nurse', role: 'nurse', seat: '6A' },
    { id: 'kim', role: 'passenger', seat: '6B' },
    { id: 'max', role: 'passenger', seat: '2E' },
    { id: 'lee', role: 'passenger', seat: '4C' },
    { id: 'zed', role: 'passenger', seat: '8F' },
  ]);
  advanceTo(s, 'night_move', 1);
  send(s, 'pilot', { kind: 'seatbelt', target: 'zed' });
  advanceTo(s, 'night_act', 1);
  send(s, 'bomber', { kind: 'act', action: { kind: 'plant', where: 'seat', fuse: 1 } });
  send(s, 'nurse', { kind: 'act', action: { kind: 'treat', target: 'kim' } });
  send(s, 'pilot', { kind: 'act', action: { kind: 'watch', startRow: 3 } });
  advanceTo(s, 'day_vote', 1);
  for (const id of ['pilot', 'bomber', 'nurse', 'kim', 'lee', 'zed']) send(s, id, { kind: 'vote', target: 'max' });
  advanceTo(s, 'night_move', 2);
  send(s, 'bomber', { kind: 'move', to: '1A' });
  advanceTo(s, 'ended');
  return s;
}

describe('the flight recorder', () => {
  it('has a reel for every night once the flight is over', () => {
    const s = flight();
    const reels = planReels(viewFor(s, 'kim', 0));
    expect(reels.map((r) => r.night)).toEqual([1, 2, 3, 4, 5].slice(0, s.recorder.length));
  });

  it('tells a night in order: the calls, what people did, and the day’s verdict', () => {
    const s = flight();
    const [first] = planReels(viewFor(s, 'kim', 0));
    expect(first.clips.map((c) => [c.kind, c.actor, c.text])).toEqual([
      ['caption', '', 'Pilot pilot buckled in zed.'],
      ['lean', 'nurse', 'Nurse nurse treated kim.'],
      ['under_seat', 'bomber', 'Bomber bomber planted a bomb under seat 4B (fuse 1).'],
      ['caption', '', 'Pilot pilot watched rows 3–5 on the cabin cameras.'],
      ['restrained', 'max', 'The passengers restrained max (Passenger) and walked them to the rear galley.'],
    ]);
    // The camera goes where it happens: zed's row for the seatbelt, each person's row, the watched rows.
    expect(first.clips.map((c) => c.row)).toEqual([8, 6, 4, 3, 2]);
    expect(first.clips[0].at).toBe(REEL_INTRO);
    expect(first.clips.at(-1)!.clock).toBe('DAY');
    // Everyone in the cabin that night, where they sat (the Pilot flies; max had not been restrained yet).
    expect(first.cast.map((c) => `${c.id}:${c.seat}`).sort()).toEqual(['bomber:4B', 'kim:6B', 'lee:4C', 'max:2E', 'nurse:6A', 'zed:8F']);
  });

  it('shows lunch being drugged by day, over the row it happened', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '4B' },
      { id: 'kim', role: 'passenger', seat: '4C' },
      { id: 'max', role: 'passenger', seat: '2E' },
      { id: 'lee', role: 'passenger', seat: '6C' },
      { id: 'zed', role: 'passenger', seat: '8F' },
      { id: 'nurse', role: 'nurse', seat: '6A' },
    ]);
    advanceTo(s, 'day_discuss', 2);
    send(s, 'kim', { kind: 'order', dish: 'pasta' });
    send(s, 'bomber', { kind: 'tamper', dish: 'pasta' });
    advanceTo(s, 'ended');
    const reel = planReels(viewFor(s, 'kim', 0)).find((r) => r.night === 2)!;
    const lunch = reel.clips.find((c) => c.text.includes('drugged'))!;
    expect(lunch).toMatchObject({ kind: 'caption', text: 'bomber drugged the pasta around row 4.', row: 4, clock: 'DAY' });
  });

  it('shows the blast at dawn, and who it took', () => {
    const s = flight();
    const second = planReels(viewFor(s, 'kim', 0))[1];
    const blast = second.clips.find((c) => c.kind === 'blast')!;
    expect(blast.text).toMatch(/^BOOM! A bomb went off under seat 4B\./);
    expect(blast.clock).toBe('MORNING');
    expect(blast.victims).toEqual(expect.arrayContaining(['nurse', 'kim', 'lee']));
    expect(blast.cells).toEqual([{ row: 4, col: 1 }]);
    expect(blast.row).toBe(4);
    // The bomber moved away before it went off, and the reel opens with them walking there.
    expect(second.cast.find((c) => c.id === 'bomber')?.seat).toBe('1A');
    expect(second.clips[0]).toMatchObject({ kind: 'caption', clock: 'LIGHTS OUT', text: 'Seats change: bomber to 1A.', row: 1 });
    expect(second.from?.get('bomber')).toBe('4B');
  });
});
