import { describe, expect, it } from 'vitest';
import { defaultSettings, type Look } from '../engine';
import { boardRow, isBoardFlight, sortBoard, type BoardFlight } from './board';
import { newHostSnapshot } from './host';

const LOOK: Look = { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, topStyle: 0, bottom: 0 };

function boarding() {
  const s = newHostSnapshot('7K2Q', 'cap-token', { ...defaultSettings(), destination: 'LHR', maxPassengers: 10 }, false);
  s.players.push({ id: 'p1', token: 'cap-token', name: 'Kay', look: LOOK, bot: false });
  s.players.push({ id: 'p2', token: '', name: 'Ada (bot)', look: LOOK, bot: true });
  s.players.push({ id: 'p3', token: 'ann-token', name: 'Ann', look: LOOK, bot: false });
  return s;
}

describe('departures board', () => {
  it("shows a listed flight that is boarding: where it goes, its captain and who's aboard", () => {
    const row = boardRow(boarding(), 2);
    expect(row).toEqual({ code: '7K2Q', city: 'London', airport: 'LHR', plane: 'Airliner', captain: 'Kay', aboard: 3, max: 10, people: 2 });
    expect(isBoardFlight(row)).toBe(true);
  });

  it('leaves out flights that are unlisted, in the air, the tutorial or empty', () => {
    const unlisted = boarding();
    unlisted.settings.listed = false;
    expect(boardRow(unlisted, 2)).toBeNull();
    expect(boardRow(boarding(), 0)).toBeNull();
    const tutorial = boarding();
    tutorial.tutorial = true;
    expect(boardRow(tutorial, 1)).toBeNull();
  });

  it('a control tower flight has no captain aboard', () => {
    const s = boarding();
    s.controlTower = true;
    expect(boardRow(s, 1)?.captain).toBe('');
  });

  it('lists flights with seats first, the busiest first', () => {
    const row = (code: string, aboard: number, people: number, max = 10): BoardFlight => ({
      code,
      city: 'London',
      airport: 'LHR',
      plane: 'Airliner',
      captain: 'Kay',
      aboard,
      max,
      people,
    });
    const sorted = sortBoard([row('AAAA', 10, 9), row('BBBB', 3, 1), row('CCCC', 5, 4)]);
    expect(sorted.map((r) => r.code)).toEqual(['CCCC', 'BBBB', 'AAAA']);
  });
});
