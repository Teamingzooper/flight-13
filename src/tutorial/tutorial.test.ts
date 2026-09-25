import { describe, expect, it } from 'vitest';
import type { Look, PlayerView } from '../engine';
import { ClientSession } from '../net/client';
import { HostSession, newHostSnapshot } from '../net/host';
import { MemoryHub } from '../net/transport';
import { TUTORIAL_YOU, tutorialCoach, tutorialSettings } from './script';

const LOOK: Look = { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, topStyle: 0, bottom: 0 };
const TOKEN = 'student-token-0001';

async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function school() {
  let now = 1_000;
  let seed = 0.41;
  const local = new MemoryHub();
  const host = new HostSession({
    network: new MemoryHub().join('host'),
    local: local.join('host-local'),
    snapshot: newHostSnapshot('SCHL', TOKEN, tutorialSettings(), false, true),
    now: () => now,
    random: () => (seed = (seed * 997 + 0.123) % 1),
    defer: (fn) => void setTimeout(fn, 0),
  });
  const you = new ClientSession({ transport: local.join('local'), code: 'SCHL', token: TOKEN, name: 'Student', look: LOOK, now: () => now });
  /** Let the host run for `ms`, a quarter second at a time (bots play their cues as time passes). */
  const wait = async (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      now += 250;
      host.tickNow();
    }
    await settle();
  };
  const view = () => you.snapshot.state!.game!;
  return { host, you, wait, view, coach: () => tutorialCoach(you.snapshot.state!.game) };
}

describe('the tutorial flight', () => {
  it('boards you with five scripted bots, and seats you next to the Bomber', async () => {
    const { you, host, wait, view } = school();
    await settle();
    const lobby = you.snapshot.state!;
    expect(lobby.tutorial).toBe(true);
    expect(lobby.players.map((p) => p.name)).toEqual(['Mia (bot)', 'Ravi (bot)', 'Sam (bot)', 'Nora (bot)', 'Leo (bot)', 'Student']);
    expect(tutorialCoach(null)?.title).toBe('Welcome to Flight School');
    expect(await you.command({ kind: 'takeoff' })).toEqual({ ok: true });
    await wait(500);
    const game = view();
    expect(game.you).toMatchObject({ role: TUTORIAL_YOU.role, seat: '3B' });
    const roles = Object.fromEntries(host.snapshot.game!.players.map((p) => [p.name, `${p.role}@${p.seat}`]));
    expect(roles).toMatchObject({ 'Mia (bot)': 'bomber@3C', 'Ravi (bot)': 'investigator@5E', 'Leo (bot)': 'pilot@Cockpit' });
  });

  it('waits for you, and plays out to a win: flashlight, chat, vote', async () => {
    const { you, wait, view, coach } = school();
    await settle();
    await you.command({ kind: 'takeoff' });
    await wait(5_000);
    // Packing waits for you, however long you take.
    expect(view().phase.kind).toBe('packing');
    expect(coach()?.title).toBe('Pack your carry-on');
    await wait(120_000);
    expect(view().phase.kind).toBe('packing');
    await you.sendIntent({ kind: 'pack', items: ['flashlight'], ready: true });
    await wait(60_000);
    expect(view().phase.kind).toBe('night_move');
    expect(coach()?.title).toBe('Lights out');
    await you.sendIntent({ kind: 'move', to: 'stay' });
    await wait(10_000);
    expect(view().phase.kind).toBe('night_act');
    expect(coach()?.text).toMatch(/Shine your Pocket flashlight under 3C/);
    expect(await you.sendIntent({ kind: 'use', item: 'flashlight', seat: '3C' })).toEqual({ ok: true });
    await wait(1_000);
    expect(coach()?.text).toMatch(/Your flashlight found something under 3C/);
    const found = view().log.find((e) => e.tag === 'item' && e.to !== 'end');
    expect(found?.text).toMatch(/bomb/);
    await you.sendIntent({ kind: 'act', action: null });
    await wait(20_000);
    expect(view().phase.kind).toBe('day_discuss');
    await wait(20_000);
    const said = view().chat.map((m) => m.text);
    expect(said.some((t) => t.includes('bomb under 3C'))).toBe(true);
    expect(coach()?.title).toBe('Talk it over');
    await you.sendIntent({ kind: 'chat', channel: 'cabin', text: 'My flashlight found a bomb under Mia’s seat!' });
    await wait(500);
    expect(coach()?.text).toBe('Heard enough? Press Ready to vote.');
    await you.sendIntent({ kind: 'ready' });
    await wait(5_000);
    expect(view().phase.kind).toBe('day_vote');
    const mia = view().players.find((p) => p.name === 'Mia (bot)')!;
    await you.sendIntent({ kind: 'vote', target: mia.id });
    await wait(40_000);
    const end: PlayerView = view();
    expect(end.phase.kind).toBe('ended');
    expect(end.result).toMatchObject({ winner: 'passengers' });
    expect(coach()?.title).toBe('You graduated!');
  });
});
