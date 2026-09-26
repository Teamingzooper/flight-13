import { describeLocation, grid, roleNameIn, type Dish, type Settings, type LogEntry, type NightAction, type PlayerSummary, type PlayerView, type RoleId, type Team } from '../engine';

export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const teamName = (team: Team): string => (team === 'saboteurs' ? 'Saboteurs' : 'Passengers');

export const DISH_ICON: Record<Dish, string> = { chicken: '🍗', pasta: '🍝' };
/** A role's name (the host's own roles by the name they gave them, from the flight's settings). */
export const roleName = (role: RoleId, settings: Settings): string => roleNameIn(role, settings);

export function playerById(game: PlayerView, id: string | null | undefined): PlayerSummary | undefined {
  return id ? game.players.find((p) => p.id === id) : undefined;
}

export function nameOf(game: PlayerView, id: string | null | undefined): string {
  return playerById(game, id)?.name ?? 'someone';
}

/**
 * What the flight is waiting on you for right now (the same things the phase needs from you before it can end early):
 * a move or the Pilot's seatbelt call at lights out, an action in the dark, a vote. Nothing while you are asleep,
 * buckled in or out of play.
 */
export function awaitingYou(game: PlayerView): 'action' | 'vote' | null {
  const you = game.you;
  if (!you || you.status !== 'alive' || you.buckled || you.drowsy || you.asleep) return null;
  const mine = game.mine;
  const pilot = you.role === 'pilot' || you.role === 'pilot_rogue';
  switch (game.phase.kind) {
    case 'night_move':
      if (pilot) return !you.knockedOut && mine?.seatbelt === null ? 'action' : null;
      return mine?.move === null ? 'action' : null;
    case 'night_act':
      return pilot && you.knockedOut ? null : mine?.acted ? null : 'action';
    case 'day_vote':
      return (game.options?.vote.length ?? 0) > 0 && mine?.vote === null ? 'vote' : null;
    default:
      return null;
  }
}

export function nameWithSeat(game: PlayerView, id: string): string {
  const p = playerById(game, id);
  if (!p) return 'someone';
  // (In a blackout the seat map is down: nobody can tell who sits where.)
  return p.seat && !game.blackout ? `${p.name} (${placeLabel(p.seat)})` : p.name;
}

/** A seat, where the Stewardess is working ("crew, row 5"), or the flight deck. */
export function placeLabel(seat: string): string {
  if (grid.isCockpit(seat)) return 'flight deck';
  const row = grid.aisleRow(seat);
  return row === null ? seat : `crew, row ${row}`;
}

/** A seat for a small label: the seat itself, or who works where (crew in the aisle, the Pilot). */
export function seatPill(seat: string | null): string {
  if (!seat) return '';
  return grid.isCockpit(seat) ? 'Pilot' : grid.isAisleSpot(seat) ? 'Crew' : seat;
}

/** How the Pilot signs PA announcements ("Captain Ann"; a name that already says Captain is left alone). */
export function captainName(name: string): string {
  return /^captain\b/i.test(name.trim()) ? name.trim() : `Captain ${name}`.trim();
}

export function shortName(name: string): string {
  const first = name.split(' ')[0] || name;
  return first.length > 7 ? `${first.slice(0, 6)}…` : first;
}

export function phaseTitle(game: PlayerView): string {
  const n = game.phase.night;
  switch (game.phase.kind) {
    case 'packing':
      return 'Packing';
    case 'boarding':
      return 'Boarding';
    case 'takeoff':
      return 'Takeoff';
    case 'night_move':
      return `Night ${n} · Lights out`;
    case 'night_act':
      return `Night ${n} · In the dark`;
    case 'dawn':
      return `Dawn after night ${n}`;
    case 'day_discuss':
      return `Day ${n} · Discussion`;
    case 'day_vote':
      return `Day ${n} · Vote`;
    case 'verdict':
      return `Day ${n} · Verdict`;
    case 'ended': {
      const r = game.result;
      if (!r) return 'Flight over';
      return r.winner === 'draw' ? 'No survivors' : `${teamName(r.winner)} win`;
    }
  }
}

export function phaseHint(game: PlayerView): string {
  const you = game.you;
  const playing = you !== null && you.status === 'alive';
  switch (game.phase.kind) {
    case 'packing':
      return you?.packed ? 'Bag packed. Waiting for the others.' : 'Your boarding pass shows your secret role. Pack three items for the flight.';
    case 'boarding':
      return 'Now boarding. Find your seat.';
    case 'takeoff':
      return 'Fasten your seatbelt. Wheels up in a moment.';
    case 'night_move':
      if (!playing) return 'The living are changing seats in the dark.';
      if (you.drowsy) return 'You are fast asleep tonight.';
      if (you.role === 'pilot' || you.role === 'pilot_rogue') return 'Make your flight deck calls: seatbelt sign, jump seat, rough air, course.';
      if (you.buckled) return 'The seatbelt sign is on over your seat.';
      // (Typed chat is shut at night; voice chat allows a whisper to the seats right round you, if the captain allows it.)
      return game.settings.voiceMode !== 'off' && game.settings.nightVoiceRange > 0
        ? 'Change seats or stay put. The chat is shut: only whispers carry.'
        : 'Change seats or stay put. Nobody can talk.';
    case 'night_act':
      if (!playing) return 'Abilities are being used in the dark.';
      if (you.drowsy || you.asleep) return 'You are fast asleep tonight.';
      if (you.role === 'pilot' || you.role === 'pilot_rogue') return 'Aim the cabin cameras at three rows.';
      if (you.inJumpSeat) return 'You are up on the flight deck tonight.';
      return you.buckled ? 'You are buckled in. Wait for dawn.' : 'Use your ability from your new seat, or rest.';
    case 'dawn':
      return 'The lights come back on. Here is what happened overnight.';
    case 'day_discuss':
      return 'Talk it out. Who moved? Who is lying?';
    case 'day_vote':
      return 'Vote to restrain someone. They need more votes than Skip.';
    case 'verdict':
      return 'The cabin has decided.';
    case 'ended':
      return 'Open the black box to see what really happened.';
  }
}

export function describeAction(game: PlayerView, action: NightAction): string {
  switch (action.kind) {
    case 'treat':
      return action.target === game.you?.id ? 'treat yourself' : `treat ${nameWithSeat(game, action.target)}`;
    case 'sweep':
      return 'sweep the seats around you for bombs';
    case 'inspect':
      return action.what === 'cart' ? 'inspect the drink cart' : 'inspect the lavatory';
    case 'serve':
      return `serve ${nameWithSeat(game, action.target)} a poisoned drink`;
    case 'poison':
      return `slip poison to ${nameWithSeat(game, action.target)}`;
    case 'check':
      return `check under the ${action.side === 'left' ? 'left-hand' : 'right-hand'} seats of your row`;
    case 'plant': {
      const where =
        action.where === 'seat' ? describeLocation({ kind: 'seat', seat: game.you?.seat ?? '?' }) : describeLocation({ kind: action.where });
      return `plant a bomb ${where}, set for the end of night ${game.phase.night + action.fuse}`;
    }
    case 'search':
      return game.you?.inWashroom ? 'search the lavatory' : 'look under your seat';
    case 'cuff':
      return `handcuff ${nameWithSeat(game, action.target)}`;
    case 'watch':
      return `watch rows ${action.startRow}–${action.startRow + 2} on the cabin cameras`;
    case 'knockout':
      return 'knock the Pilot out cold';
    case 'jam':
      return 'take your phone off airplane mode (the cabin cameras show only static tonight)';
  }
}

export function whenLabel(e: LogEntry): string {
  switch (e.phase) {
    case 'takeoff':
      return 'Takeoff';
    case 'night_move':
    case 'night_act':
      return `Night ${e.night}`;
    case 'ended':
      return 'Landing';
    default:
      return `Day ${e.night}`;
  }
}

/** What happened during the most recent night, as far as this player can see. */
export function morningReport(game: PlayerView): LogEntry[] {
  const n = game.phase.night;
  return game.log.filter((e) => e.night === n && (e.phase === 'night_move' || e.phase === 'night_act') && e.to !== 'end');
}
