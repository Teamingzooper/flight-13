import { grid, isNightPhase, isPaPhase, isPilot, type PlayerView } from '../engine';
import { nameWithSeat } from '../tv/format';
import { lastWatch } from './tape';

/**
 * The Pilot's controls around the captain's seat: what each one is called, where it is, what clicking it does
 * in each phase, and what it shows. Pure, so the 3D view, the HUD and the seatback screen agree.
 */

export type ControlId = 'seatbelt' | 'monitor' | 'intercom' | 'roughair' | 'course' | 'handset';

export const CONTROL_ORDER: readonly ControlId[] = ['seatbelt', 'monitor', 'intercom', 'roughair', 'course', 'handset'];

export const CONTROLS: Record<ControlId, { name: string; where: string }> = {
  seatbelt: { name: 'Seatbelt sign', where: 'the switch overhead' },
  monitor: { name: 'Cabin cameras', where: 'the monitor on the pedestal' },
  intercom: { name: 'Cabin intercom', where: 'the CALL button above the camera monitor' },
  roughair: { name: 'Rough air', where: 'the RIDE lever on the pedestal' },
  course: { name: 'Course', where: 'the HDG dial in front of you' },
  handset: { name: 'PA handset', where: 'the handset on your left' },
};

/** What the camera console is for: the live feed, aiming tonight's cameras, picking a passenger, rough air, or last night's tape. */
export type ConsoleMode = 'live' | 'watch' | 'seatbelt' | 'jumpseat' | 'roughair' | 'replay';

export type ControlUse = { kind: 'console'; mode: ConsoleMode } | { kind: 'course' } | { kind: 'pa' } | { kind: 'no'; why: string };

/** The Pilot, in his seat, still in play: the only one who works the controls. */
export function atTheControls(game: PlayerView): boolean {
  const you = game.you;
  return !!you && isPilot(you.role) && you.status === 'alive' && grid.isCockpit(you.seat) && game.phase.kind !== 'ended';
}

const WHILE_SEATS_CHANGE = 'while seats change at night';

/** What clicking a control does right now. `tape`: last night's camera tape is there to replay. */
export function controlAction(game: PlayerView, id: ControlId, tape: boolean): ControlUse {
  if (!atTheControls(game)) return { kind: 'no', why: 'Only the captain works the controls.' };
  const you = game.you!;
  const kind = game.phase.kind;
  const night = isNightPhase(kind);
  if (night && you.knockedOut) return { kind: 'no', why: 'You are out cold: the plane flies itself tonight.' };
  if (night && you.buckled) return { kind: 'no', why: 'Turbulence: you are fighting the controls all night.' };
  const moving = kind === 'night_move';
  switch (id) {
    case 'seatbelt':
      return moving ? { kind: 'console', mode: 'seatbelt' } : { kind: 'no', why: `The seatbelt sign goes on ${WHILE_SEATS_CHANGE}.` };
    case 'intercom':
      return moving ? { kind: 'console', mode: 'jumpseat' } : { kind: 'no', why: `Call someone up to the jump seat ${WHILE_SEATS_CHANGE}.` };
    case 'roughair':
      if (you.roughAirUsed) return { kind: 'no', why: 'Rough air: already flown on this flight.' };
      return moving && (game.options?.roughair.length || game.mine?.roughair != null)
        ? { kind: 'console', mode: 'roughair' }
        : { kind: 'no', why: `Fly through rough air ${WHILE_SEATS_CHANGE} (once per flight).` };
    case 'course':
      if (you.courseUsed) return { kind: 'no', why: `Course already changed: we land after night ${game.phase.nights}.` };
      if (!moving) return { kind: 'no', why: `Change course ${WHILE_SEATS_CHANGE} (once per flight).` };
      return game.options?.course.length || game.mine?.course ? { kind: 'course' } : { kind: 'no', why: 'Too late to change course: we land after tonight.' };
    case 'handset':
      return isPaPhase(kind) ? { kind: 'pa' } : { kind: 'no', why: 'The PA is for announcements by day.' };
    case 'monitor':
      if (kind === 'night_act') return { kind: 'console', mode: 'watch' };
      if (tape && !night) return { kind: 'console', mode: 'replay' };
      return { kind: 'console', mode: 'live' };
  }
}

/** A short state for a control: tonight's call, or what it is waiting for. `tape`: last night's tape is ready to watch. */
export function controlStatus(game: PlayerView, id: ControlId, onAir = false, tape = false): string {
  const mine = game.mine;
  const you = game.you;
  const night = isNightPhase(game.phase.kind);
  switch (id) {
    case 'seatbelt': {
      const target = night ? mine?.seatbelt : null;
      if (target && target !== 'none') return `on for ${nameWithSeat(game, target)}`;
      if (!night) return 'at night';
      return target === 'none' ? 'off tonight' : game.phase.kind === 'night_move' ? 'pick someone' : 'off tonight';
    }
    case 'intercom': {
      const guest = night ? mine?.jumpseat : null;
      if (guest && guest !== 'none') return `calling ${nameWithSeat(game, guest)}`;
      return night ? 'nobody called' : 'at night';
    }
    case 'roughair':
      if (you?.roughAirUsed) return 'used';
      return mine?.roughair != null ? `rows ${mine.roughair}–${mine.roughair + 2} tonight` : 'once per flight';
    case 'course':
      if (you?.courseUsed) return 'used';
      return mine?.course === 'hold' ? 'hold tonight' : mine?.course === 'shortcut' ? 'shortcut tonight' : 'once per flight';
    case 'monitor': {
      const action = mine?.action;
      if (game.phase.kind === 'night_act') return action?.kind === 'watch' ? `watching rows ${action.startRow}–${action.startRow + 2}` : 'aim the cameras';
      return tape && !night ? 'last night’s tape' : 'live';
    }
    case 'handset':
      return onAir ? 'on air' : isPaPhase(game.phase.kind) ? 'by day' : 'by day only';
  }
}

/** Last night's camera tape is ready to watch: the cameras ran on the night just gone, and it is day now. */
export function tapeReady(game: PlayerView): boolean {
  const you = game.you;
  if (!you || isNightPhase(game.phase.kind)) return false;
  const entry = lastWatch(game.log, you.id);
  return !!entry && entry.night === game.phase.night;
}

/** What the flight deck shows: the seatbelt lamp, the CALL light, the lever, the dial and the handset. */
export interface DeckLook {
  belt: boolean;
  call: boolean;
  lever: boolean;
  dial: 'hold' | 'shortcut' | null;
  handsetUp: boolean;
}

export function deckLook(game: PlayerView, onAir: boolean): DeckLook {
  const mine = game.mine;
  const on = atTheControls(game) && isNightPhase(game.phase.kind);
  return {
    belt: on && !!mine?.seatbelt && mine.seatbelt !== 'none',
    call: on && !!mine?.jumpseat && mine.jumpseat !== 'none',
    lever: on && mine?.roughair != null,
    dial: on ? (mine?.course ?? null) : null,
    handsetUp: onAir,
  };
}
