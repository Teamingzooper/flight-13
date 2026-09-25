import { describe, expect, it } from 'vitest';
import { applyIntent, viewFor, type GameState, type Intent } from '../engine';
import { COCKPIT } from '../engine/grid';
import { advanceTo, makeGame } from '../engine/testkit';
import { controlAction, controlStatus, deckLook, tapeReady } from './cockpit';

const send = (s: GameState, id: string, intent: Intent) => applyIntent(s, id, intent, 0);

function flight(): GameState {
  return makeGame([
    { id: 'pilot', role: 'pilot', seat: COCKPIT },
    { id: 'bomber', role: 'bomber', seat: '1C' },
    { id: 'jo', role: 'passenger', seat: '4B' },
    { id: 'kim', role: 'passenger', seat: '5E' },
    { id: 'lee', role: 'nurse', seat: '7F' },
  ]);
}

describe('the Pilot’s controls', () => {
  it('work while seats change at night: seatbelt, intercom, rough air and course', () => {
    const s = flight();
    advanceTo(s, 'night_move', 1);
    const view = viewFor(s, 'pilot', 0);
    expect(controlAction(view, 'seatbelt', false)).toEqual({ kind: 'console', mode: 'seatbelt' });
    expect(controlAction(view, 'intercom', false)).toEqual({ kind: 'console', mode: 'jumpseat' });
    expect(controlAction(view, 'roughair', false)).toEqual({ kind: 'console', mode: 'roughair' });
    expect(controlAction(view, 'course', false)).toEqual({ kind: 'course' });
    expect(controlAction(view, 'monitor', true)).toEqual({ kind: 'console', mode: 'live' });
    expect(controlAction(view, 'handset', false)).toEqual({ kind: 'no', why: 'The PA is for announcements by day.' });
    expect(controlStatus(view, 'seatbelt')).toBe('pick someone');
  });

  it('show tonight’s calls, on the deck and in words', () => {
    const s = flight();
    advanceTo(s, 'night_move', 1);
    send(s, 'pilot', { kind: 'seatbelt', target: 'jo' });
    send(s, 'pilot', { kind: 'jumpseat', target: 'lee' });
    send(s, 'pilot', { kind: 'roughair', startRow: 4 });
    send(s, 'pilot', { kind: 'course', change: 'hold' });
    const view = viewFor(s, 'pilot', 0);
    expect(controlStatus(view, 'seatbelt')).toBe('on for jo (4B)');
    expect(controlStatus(view, 'intercom')).toBe('calling lee (7F)');
    expect(controlStatus(view, 'roughair')).toBe('rows 4–6 tonight');
    expect(controlStatus(view, 'course')).toBe('hold tonight');
    expect(deckLook(view, false)).toEqual({ belt: true, call: true, lever: true, dial: 'hold', handsetUp: false });
  });

  it('aim the cameras in the dark, and replay the tape by day', () => {
    const s = flight();
    advanceTo(s, 'night_act', 1);
    expect(controlAction(viewFor(s, 'pilot', 0), 'monitor', true)).toEqual({ kind: 'console', mode: 'watch' });
    expect(controlAction(viewFor(s, 'pilot', 0), 'seatbelt', false).kind).toBe('no');
    advanceTo(s, 'day_discuss', 1);
    const day = viewFor(s, 'pilot', 0);
    expect(controlAction(day, 'monitor', true)).toEqual({ kind: 'console', mode: 'replay' });
    expect(controlAction(day, 'monitor', false)).toEqual({ kind: 'console', mode: 'live' });
    expect(controlAction(day, 'handset', false)).toEqual({ kind: 'pa' });
    expect(controlAction(day, 'seatbelt', false)).toEqual({ kind: 'no', why: 'The seatbelt sign goes on while seats change at night.' });
    expect(deckLook(day, true).handsetUp).toBe(true);
  });

  it('say when last night’s tape is ready, until the next night', () => {
    const s = flight();
    advanceTo(s, 'night_act', 1);
    expect(tapeReady(viewFor(s, 'pilot', 0))).toBe(false);
    send(s, 'pilot', { kind: 'act', action: { kind: 'watch', startRow: 3 } });
    advanceTo(s, 'day_discuss', 1);
    const day = viewFor(s, 'pilot', 0);
    expect(tapeReady(day)).toBe(true);
    expect(controlStatus(day, 'monitor', false, true)).toBe('last night’s tape');
    advanceTo(s, 'night_move', 2);
    expect(tapeReady(viewFor(s, 'pilot', 0))).toBe(false);
    advanceTo(s, 'day_discuss', 2);
    // Night 2's cameras never ran: night 1's tape is old news.
    expect(tapeReady(viewFor(s, 'pilot', 0))).toBe(false);
  });

  it('are only for the captain', () => {
    const s = flight();
    advanceTo(s, 'night_move', 1);
    expect(controlAction(viewFor(s, 'jo', 0), 'seatbelt', false)).toEqual({ kind: 'no', why: 'Only the captain works the controls.' });
  });

  it('say when a once-per-flight call is spent', () => {
    const s = flight();
    advanceTo(s, 'night_move', 1);
    send(s, 'pilot', { kind: 'roughair', startRow: 2 });
    advanceTo(s, 'night_move', 2);
    const view = viewFor(s, 'pilot', 0);
    expect(controlAction(view, 'roughair', false)).toEqual({ kind: 'no', why: 'Rough air: already flown on this flight.' });
    expect(controlStatus(view, 'roughair')).toBe('used');
  });
});
