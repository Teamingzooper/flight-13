import { useEffect, useRef } from 'preact/hooks';
import type { PlayerView } from '../engine';
import { cabinAudio } from '../world/audio';
import { directorCues } from '../world/director';

/**
 * The 2D screen's sounds (on its own, not inside the 3D view, which plays its own): the same cues the cabin plays,
 * as sound only (the lights, announcements, blasts, restraints, the cart, turbulence), and the ones for you alone
 * (a whisper, your team, a vote coming in, the seatbelt sign over you, a bomb found under you).
 */
export function useCueSounds(game: PlayerView | null, on: boolean): void {
  const prev = useRef<PlayerView | null>(null);
  const lastDing = useRef(-Infinity);

  // Sound needs a gesture first.
  useEffect(() => {
    if (!on) return undefined;
    const unlock = () => cabinAudio.unlock();
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    return () => {
      removeEventListener('pointerdown', unlock);
      removeEventListener('keydown', unlock);
    };
  }, [on]);

  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (!on || !game || !before || before.gameId !== game.gameId || before === game) return;
    for (const cue of directorCues(before, game)) {
      switch (cue.kind) {
        case 'lightsOut':
        case 'lightsOn':
          cabinAudio.clunk();
          break;
        case 'explosion':
          cabinAudio.boom(8);
          break;
        case 'turbulence':
        case 'roughAir':
          cabinAudio.rumble(0.8);
          break;
        case 'cartRoll':
          if (cue.runaway) cabinAudio.rattle();
          else cabinAudio.roll(2, 0.4);
          break;
        case 'restrained':
          cabinAudio.zip();
          break;
        case 'poisoned':
          cabinAudio.cough(0.5);
          break;
        case 'item':
          if (cue.item === 'bobbypin') cabinAudio.lockpick();
          break;
        case 'pa':
          // (One ding-dong for a burst of announcements.)
          if (performance.now() - lastDing.current > 4000) {
            lastDing.current = performance.now();
            cabinAudio.ding();
          }
          break;
        default:
          break;
      }
    }
    const you = game.you;
    if (!you) return;
    if (you.buckled && !before.you?.buckled) cabinAudio.chime();
    const known = new Set(before.bombs.map((b) => b.id));
    if (game.bombs.some((b) => !known.has(b.id) && !b.exploded && !b.defused && b.planterId !== you.id)) cabinAudio.sting();
    const said = new Set(before.chat.map((m) => m.id));
    if (game.chat.some((m) => !said.has(m.id) && m.from !== you.id && ((m.channel === 'whisper' && m.to === you.id) || m.channel === 'saboteurs'))) cabinAudio.ping();
    const count = (v: PlayerView) => Object.values(v.votes?.counts ?? {}).reduce((a, b) => a + b, 0);
    if (game.mine?.vote && game.mine.vote !== before.mine?.vote) cabinAudio.tick(true);
    else if (count(game) > count(before)) cabinAudio.tick();
    const seen = new Set(before.log.map((e) => e.id));
    for (const e of game.log) {
      if (seen.has(e.id) || !Array.isArray(e.to) || !e.to.includes(you.id) || e.tag !== 'item') continue;
      if (e.text.startsWith('You cut the wires')) cabinAudio.snip();
      else if (e.text.includes('sleeping pill')) cabinAudio.pop();
      else cabinAudio.click();
    }
  }, [game, on]);
}

/** A soft tick each of the last five seconds of a phase, while it is still waiting on you. */
export function useLastSeconds(left: number, waiting: boolean, on: boolean): void {
  const seconds = Math.ceil(left / 1000);
  useEffect(() => {
    if (on && waiting && seconds > 0 && seconds <= 5) cabinAudio.tick();
  }, [seconds]);
}
