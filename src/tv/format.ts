import { ROLES, describeLocation, grid, type LogEntry, type NightAction, type PlayerSummary, type PlayerView, type RoleId, type Team } from '../engine';

export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const teamName = (team: Team): string => (team === 'saboteurs' ? 'Saboteurs' : 'Passengers');
export const roleName = (role: RoleId): string => ROLES[role].name;

export function playerById(game: PlayerView, id: string | null | undefined): PlayerSummary | undefined {
  return id ? game.players.find((p) => p.id === id) : undefined;
}

export function nameOf(game: PlayerView, id: string | null | undefined): string {
  return playerById(game, id)?.name ?? 'someone';
}

export function nameWithSeat(game: PlayerView, id: string): string {
  const p = playerById(game, id);
  if (!p) return 'someone';
  return p.seat ? `${p.name} (${placeLabel(p.seat)})` : p.name;
}

/** A seat, or where the Stewardess is working ("crew, row 5"). */
export function placeLabel(seat: string): string {
  const row = grid.aisleRow(seat);
  return row === null ? seat : `crew, row ${row}`;
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
      if (you.buckled) return 'The seatbelt sign is on over your seat.';
      return you.role === 'pilot' ? 'Change seats if you like, and pick who gets the seatbelt sign.' : 'Change seats or stay put. Nobody can talk.';
    case 'night_act':
      if (!playing) return 'Abilities are being used in the dark.';
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
    case 'check':
      return `check under the ${action.side === 'left' ? 'A, B and C' : 'D, E and F'} seats of your row`;
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
