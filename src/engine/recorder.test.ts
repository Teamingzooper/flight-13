import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { advanceTo, makeGame } from './testkit';
import type { GameState, MoveTarget, NightAction } from './types';
import { viewFor } from './view';

const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);
const move = (s: GameState, id: string, to: MoveTarget) => applyIntent(s, id, { kind: 'move', to }, 0);

describe('the flight recorder', () => {
  it('notes each night: seats before the handcuffs, what was really done, items, and who was away', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '4B' },
      { id: 'marshal', role: 'marshal', seat: '4C' },
      { id: 'nurse', role: 'nurse', seat: '6A' },
      { id: 'kim', role: 'passenger', seat: '6B' },
      { id: 'lou', role: 'passenger', seat: '8F' },
      { id: 'max', role: 'passenger', seat: '2E' },
    ]);
    advanceTo(s, 'night_move', 1);
    expect(move(s, 'lou', 'washroom')).toEqual({ ok: true });
    advanceTo(s, 'night_act', 1);
    act(s, 'marshal', { kind: 'cuff', target: 'bomber' });
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    act(s, 'nurse', { kind: 'treat', target: 'kim' });
    s.night.flashlights.max = '2F';
    advanceTo(s, 'dawn', 1);

    expect(s.recorder).toHaveLength(1);
    const [night] = s.recorder;
    expect(night.night).toBe(1);
    // The bomber was sitting there when the night began, even though they end it in the rear galley.
    expect(night.seats).toMatchObject({ bomber: '4B', marshal: '4C', nurse: '6A', kim: '6B', max: '2E' });
    expect(night.washroom).toBe('lou');
    expect(night.jumpseat).toBeNull();
    // Handcuffed before they could plant: only the cuff and the treatment happened.
    expect(night.acts.map((a) => `${a.actor}:${a.action.kind}`).sort()).toEqual(['marshal:cuff', 'nurse:treat']);
    expect(night.items).toEqual([{ user: 'max', item: 'flashlight', seat: '2F' }]);
  });

  it('stays sealed until the flight is over', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '4B' },
      { id: 'a', role: 'passenger', seat: '1A' },
      { id: 'b', role: 'passenger', seat: '2A' },
      { id: 'c', role: 'passenger', seat: '3A' },
      { id: 'd', role: 'passenger', seat: '5A' },
    ]);
    advanceTo(s, 'day_discuss', 1);
    expect(s.recorder).toHaveLength(1);
    expect(viewFor(s, 'bomber', 0).recorder).toBeNull();
    advanceTo(s, 'ended');
    expect(viewFor(s, 'a', 0).recorder).toHaveLength(s.nights);
  });
});
