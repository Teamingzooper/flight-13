import { describe, expect, it } from 'vitest';
import { hear, mask, type RosterEntry } from './hear';

const ROSTER: RosterEntry[] = [
  { id: 'jo', name: 'Jo (bot)', seat: '4C' },
  { id: 'cal', name: 'Cal (bot)', seat: '5C' },
  { id: 'ann', name: 'Ann', seat: '2B' },
  { id: 'kay', name: 'Captain Kay', seat: 'Cockpit' },
  { id: 'me', name: 'Max', seat: '7A' },
];
const cabin = (text: string, speaker = 'me') => hear(text, speaker, ROSTER, 'cabin');
const team = (text: string, speaker = 'me') => hear(text, speaker, ROSTER, 'saboteurs');

describe('hearing', () => {
  it('masks names and seats, so a name is never a role', () => {
    expect(mask('Captain Kay checked 4c', ROSTER)).toBe('@kay checked #4C');
    expect(cabin('Captain Kay is on the PA').claim).toBeNull();
    expect(cabin('Captain Kay is on the PA').about).toEqual(['kay']);
  });

  it('hears a claim with a result', () => {
    const h = cabin("I'm the investigator, searched 4C and it's clean");
    expect(h.claim).toBe('investigator');
    expect(h.results).toEqual([{ what: 'clear', seats: ['4C'], where: 'seat' }]);
    expect(h.about).toEqual(['jo']);
    expect(h.accuse).toEqual([]);
    expect(h.defend).toEqual([]);
  });

  it('hears claims in other words, and not denials', () => {
    expect(cabin('nurse here, I treated Ann').claim).toBe('nurse');
    expect(cabin("i'm just a passenger").claim).toBe('passenger');
    expect(cabin("I'm the loyal stewardess").claim).toBe('stewardess_loyal');
    expect(cabin("I'm not the nurse").claim).toBeNull();
    expect(cabin("I'm sure the nurse is lying").claim).toBeNull();
  });

  it('hears an accusation with the role', () => {
    expect(cabin('Jo is the bomber').accuse).toEqual([{ id: 'jo', role: 'bomber' }]);
    expect(cabin("it's Cal").accuse).toEqual([{ id: 'cal', role: null }]);
    expect(cabin('5C is sus').accuse).toEqual([{ id: 'cal', role: null }]);
    expect(cabin("I don't trust Ann").accuse).toEqual([{ id: 'ann', role: null }]);
  });

  it('hears a defense, including a denied accusation', () => {
    const h = cabin("jo isn't sus");
    expect(h.defend).toEqual(['jo']);
    expect(h.accuse).toEqual([]);
    expect(cabin('Ann is with me, I trust her').defend).toEqual(['ann']);
  });

  it('keeps clauses apart', () => {
    const h = cabin('I trust Jo but Cal is sus');
    expect(h.defend).toEqual(['jo']);
    expect(h.accuse).toEqual([{ id: 'cal', role: null }]);
  });

  it('hears who a question is for, and what it asks', () => {
    expect(cabin('Cal, what did you find?')).toMatchObject({ to: ['cal'], ask: 'result' });
    expect(cabin('Jo what is your role?')).toMatchObject({ to: ['jo'], ask: 'role' });
    expect(cabin("who's the bomber?")).toMatchObject({ to: [], ask: 'suspect' });
    expect(cabin('anyone?')).toMatchObject({ to: ['*'], ask: 'general' });
    expect(cabin('any ideas, Ann?')).toMatchObject({ to: ['ann'] });
    // Talking about someone is not talking to them.
    expect(cabin('Jo is the bomber').to).toEqual([]);
  });

  it('hears votes, by name, seat or skip', () => {
    expect(cabin('voting 5C').vote).toBe('cal');
    expect(cabin('I vote Jo').vote).toBe('jo');
    expect(cabin('skip').vote).toBe('skip');
    expect(cabin('voting 5C').accuse).toEqual([{ id: 'cal', role: null }]);
  });

  it('hears found bombs', () => {
    const h = cabin('found wires under 2B!');
    expect(h.results).toEqual([{ what: 'bomb', seats: ['2B'], where: 'seat' }]);
    expect(h.about).toEqual(['ann']);
    expect(cabin('checked the cart, nothing').results).toEqual([{ what: 'clear', seats: [], where: 'cart' }]);
    expect(cabin('I checked my seat: clean').results).toEqual([{ what: 'clear', seats: ['7A'], where: 'seat' }]);
  });

  it('hears orders in the saboteur channel only', () => {
    expect(team('Cal, plant 5C').order).toEqual({ who: ['cal'], act: 'plant', where: 'seat', seat: '5C' });
    expect(team('everyone lay low').order).toEqual({ who: 'all', act: 'stay' });
    expect(team('Jo poison Ann').order).toMatchObject({ act: 'poison', target: 'ann' });
    expect(team('Cal, move to 6D').order).toEqual({ who: ['cal'], act: 'move', seat: '6D' });
    expect(team('Jo, knock the pilot out').order).toEqual({ who: ['jo'], act: 'knockout' });
    expect(cabin('Cal, plant 5C').order).toBeNull();
  });

  it('tells two bots with the same first name apart by their full names', () => {
    const roster: RosterEntry[] = [
      { id: 'jo1', name: 'Jo (bot)', seat: '1A' },
      { id: 'jo2', name: 'Jo (bot) 2', seat: '1B' },
    ];
    expect(hear('Jo (bot) 2 is sus', 'x', roster, 'cabin').accuse).toEqual([{ id: 'jo2', role: null }]);
    // Plain "Jo" could be either: nobody is named.
    expect(hear('Jo is sus', 'x', roster, 'cabin').about).toEqual([]);
  });
});
