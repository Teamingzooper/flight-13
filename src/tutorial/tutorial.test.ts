import { describe, expect, it } from 'vitest';
import type { Intent, ItemId, Look, PhaseKind, PlayerView } from '../engine';
import { ClientSession } from '../net/client';
import { HostSession, newHostSnapshot } from '../net/host';
import { MemoryHub } from '../net/transport';
import { LESSONS, LESSON_ORDER, tutorialCoach, type LessonId } from './lessons';
import { botName, tutorialSettings, type TutorialBot } from './script';

const LOOK: Look = { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, topStyle: 0, bottom: 0 };
const TOKEN = 'student-token-0001';

async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function school(lesson: LessonId = 'passenger') {
  let now = 1_000;
  let seed = 0.41;
  const local = new MemoryHub();
  const host = new HostSession({
    network: new MemoryHub().join('host'),
    local: local.join('host-local'),
    snapshot: newHostSnapshot('SCHL', TOKEN, tutorialSettings(), false, true, lesson),
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
  /** Run until the flight reaches `kind` (failing after `max` ms). */
  const until = async (kind: PhaseKind, max = 120_000) => {
    const now = () => you.snapshot.state?.game?.phase.kind;
    for (let t = 0; t < max && now() !== kind; t += 500) await wait(500);
    expect(now()).toBe(kind);
  };
  const send = async (intent: Intent) => {
    expect(await you.sendIntent(intent)).toEqual({ ok: true });
    await settle();
  };
  const bot = (name: TutorialBot) => view().players.find((p) => p.name === botName(name))!;
  /** Take off and pack (nothing, or the flashlight). */
  const board = async (items: ItemId[] = []) => {
    await settle();
    await you.command({ kind: 'takeoff' });
    await until('packing');
    await send({ kind: 'pack', items, ready: true });
    await until('night_move');
  };
  /** Say something, get ready, and vote to restrain `who`. */
  const accuse = async (who: TutorialBot, text: string, channel: 'cabin' | 'pa' = 'cabin') => {
    await until('day_discuss');
    await wait(20_000);
    await send({ kind: 'chat', channel, text });
    await wait(500);
    expect(coach()?.text).toBe('Heard enough? Press Ready to vote.');
    await send({ kind: 'ready' });
    await until('day_vote');
    await send({ kind: 'vote', target: bot(who).id });
  };
  const coach = () => tutorialCoach(you.snapshot.state!.game, lesson);
  return { host, you, wait, until, send, bot, board, accuse, view, coach };
}

describe('Flight School', () => {
  it('casts each lesson: you in its role and seat, the bots in theirs', async () => {
    for (const id of LESSON_ORDER) {
      const { you, host, view, until } = school(id);
      await settle();
      const lobby = you.snapshot.state!;
      expect(lobby.tutorial).toBe(true);
      expect(lobby.lesson).toBe(id);
      expect(lobby.players.map((p) => p.name)).toEqual(['Mia (bot)', 'Ravi (bot)', 'Sam (bot)', 'Nora (bot)', 'Leo (bot)', 'Student']);
      expect(tutorialCoach(null, id)?.text).toContain(`lesson: the ${LESSONS[id].title}`);
      await you.command({ kind: 'takeoff' });
      await until('packing');
      expect(view().you).toMatchObject(LESSONS[id].you);
      const cast = Object.fromEntries(host.snapshot.game!.players.map((p) => [p.name, { role: p.role, seat: p.seat }]));
      for (const [name, place] of Object.entries(LESSONS[id].cast)) expect(cast[botName(name as TutorialBot)]).toEqual(place);
      // A bomb from boarding in every lesson but the Bomber's (you plant your own).
      expect(host.snapshot.game!.bombs.length).toBe(LESSONS[id].bomb ? 1 : 0);
    }
  });

  it('keeps its cast: no bots added or removed', async () => {
    const { you } = school('passenger');
    await settle();
    const mia = you.snapshot.state!.players.find((p) => p.name === 'Mia (bot)')!;
    expect(await you.command({ kind: 'kick', playerId: mia.id })).toMatchObject({ ok: false });
    expect(await you.command({ kind: 'addBot' })).toMatchObject({ ok: false });
    expect(you.snapshot.state!.players).toHaveLength(6);
  });

  it('Passenger: waits for you, and plays out to a win: flashlight, chat, vote', async () => {
    const { wait, view, coach, until, send, board, accuse } = school('passenger');
    await board(['flashlight']);
    expect(coach()?.title).toBe('Lights out');
    await send({ kind: 'move', to: 'stay' });
    await until('night_act');
    expect(coach()?.text).toMatch(/Shine your Pocket flashlight under 3C/);
    await send({ kind: 'use', item: 'flashlight', seat: '3C' });
    await wait(1_000);
    expect(coach()?.text).toMatch(/Your flashlight found something under 3C/);
    expect(view().log.find((e) => e.tag === 'item' && e.to !== 'end')?.text).toMatch(/bomb/);
    await send({ kind: 'act', action: null });
    await until('day_discuss');
    await wait(20_000);
    expect(view().chat.some((m) => m.text.includes('bomb under 3C'))).toBe(true);
    await accuse('Mia', 'My flashlight found a bomb under Mia’s seat!');
    await until('ended');
    const end: PlayerView = view();
    expect(end.result).toMatchObject({ winner: 'passengers' });
    expect(coach()?.title).toBe('You graduated!');
  });

  it('Packing waits for you, however long you take', async () => {
    const { you, wait, view, coach, until } = school('passenger');
    await settle();
    await you.command({ kind: 'takeoff' });
    await until('packing');
    expect(coach()?.title).toBe('Pack your carry-on');
    await wait(120_000);
    expect(view().phase.kind).toBe('packing');
  });

  it('Nurse: your treatment pulls Ravi through the blast that kills Sam', async () => {
    const { view, coach, until, send, bot, board, accuse } = school('nurse');
    await board();
    expect(coach()?.text).toMatch(/Stay in 6B/);
    await send({ kind: 'move', to: 'stay' });
    await until('night_act');
    expect(coach()?.text).toMatch(/Treat Ravi/);
    await send({ kind: 'act', action: { kind: 'treat', target: bot('Ravi').id } });
    expect(coach()?.text).toBe('Ravi is in your care tonight. Wait for the morning.');
    await until('dawn');
    expect(bot('Ravi').status).toBe('alive');
    expect(bot('Sam').status).not.toBe('alive');
    expect(bot('Mia').status).toBe('alive');
    expect(coach()?.text).toMatch(/Ravi pulled through/);
    await accuse('Mia', 'That bomb was under Mia’s old seat!');
    await until('ended');
    expect(view().result).toMatchObject({ winner: 'passengers' });
  });

  it('Stewardess: you walk the cart to row 3 and your check finds the bomb', async () => {
    const { view, coach, until, send, board, accuse } = school('stewardess');
    await board();
    expect(coach()?.text).toMatch(/pick Aisle 3/);
    await send({ kind: 'move', to: 'Aisle 3' });
    expect(coach()?.text).toBe('The cart is on its way to row 3.');
    await until('night_act');
    expect(view().you?.seat).toBe('Aisle 3');
    expect(coach()?.text).toMatch(/check the Left side/);
    await send({ kind: 'act', action: { kind: 'check', side: 'left' } });
    await until('dawn');
    expect(view().log.some((e) => e.tag === 'check' && /found a bomb: .*3C/.test(e.text))).toBe(true);
    expect(coach()?.text).toMatch(/turned up a bomb under 3C/);
    await accuse('Mia', 'I checked row 3 last night, and there’s a bomb under 3C!');
    await until('ended');
    expect(view().result).toMatchObject({ winner: 'passengers' });
  });

  it('Pilot: your cameras catch Mia, and you tell the plane over the PA', async () => {
    const { view, coach, until, send, board, accuse } = school('pilot');
    await board();
    expect(coach()?.text).toMatch(/pick No one/);
    await send({ kind: 'seatbelt', target: 'none' });
    expect(coach()?.text).toMatch(/Your calls are in/);
    await until('night_act');
    expect(coach()?.text).toMatch(/watch rows 2–4/);
    await send({ kind: 'act', action: { kind: 'watch', startRow: 2 } });
    await until('dawn');
    expect(view().log.some((e) => e.tag === 'watch' && e.text.includes('Mia (bot) bent down under their seat'))).toBe(true);
    expect(coach()?.text).toMatch(/cameras caught Mia/);
    await until('day_discuss');
    expect(coach()?.text).toMatch(/announcement on the PA/);
    await accuse('Mia', 'Flight deck here: my cameras caught Mia bending under 3C.', 'pa');
    await until('ended');
    expect(view().result).toMatchObject({ winner: 'passengers' });
  });

  it('Bomber: plant, frame Ravi, get clear, and the blast hands you the plane', async () => {
    const { view, coach, until, send, bot, board, accuse } = school('bomber');
    await board();
    expect(coach()?.text).toMatch(/Stay in 3C/);
    await send({ kind: 'move', to: 'stay' });
    await until('night_act');
    expect(coach()?.text).toMatch(/Plant your bomb under your seat/);
    await send({ kind: 'act', action: { kind: 'plant', where: 'seat', fuse: 1 } });
    expect(coach()?.text).toBe('Planted. Now act normal.');
    await until('dawn');
    expect(coach()?.text).toMatch(/Nobody noticed a thing/);
    await accuse('Ravi', 'I saw Ravi up and about last night.');
    await until('verdict');
    expect(bot('Ravi').status).toBe('restrained');
    expect(coach()?.text).toMatch(/Ravi really was the Investigator/);
    await until('night_move');
    expect(view().phase.night).toBe(2);
    expect(coach()?.text).toMatch(/row 6/);
    await send({ kind: 'move', to: '6F' });
    await until('night_act');
    await send({ kind: 'act', action: null });
    await until('ended');
    expect(view().result).toMatchObject({ winner: 'saboteurs', reason: 'parity' });
    for (const name of ['Mia', 'Sam', 'Nora'] as const) expect(bot(name).status).not.toBe('alive');
    expect(coach()?.title).toBe('You graduated!');
    expect(coach()?.text).toMatch(/the plane is yours/);
  });

  it('carries on off the script: with no cues, the bots think for themselves', async () => {
    const { view, until, send, board, accuse } = school('bomber');
    await board();
    await send({ kind: 'move', to: 'stay' });
    await until('night_act');
    // A longer fuse than the lesson asks for: there is no script for a second day.
    await send({ kind: 'act', action: { kind: 'plant', where: 'seat', fuse: 2 } });
    await accuse('Ravi', 'I saw Ravi up and about last night.');
    await until('night_move');
    await send({ kind: 'move', to: '6F' });
    await until('night_act');
    await send({ kind: 'act', action: null });
    await until('day_discuss');
    expect(view().phase.night).toBe(2);
    await send({ kind: 'ready' });
    // The bots get ready on their own, and the vote comes round.
    await until('day_vote', 60_000);
  });
});
