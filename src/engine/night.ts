import { DESTINATIONS } from './destinations';
import { BLAST_RADIUS, SWEEP_RADIUS, aisleRow, cartCell, distance, distanceToAny, isAisleSpot, lavatoryCells, parsePlace, parseSeat, rowSeats, seatOrder } from './grid';
import { consumeItem } from './items';
import { nextInt, pick } from './rng';
import { ROLES, isPilot, isSaboteur, isStewardess } from './roles';
import { checkAction, checkCourse, checkJumpseat, checkMove, checkRoughAir, checkSeatbelt, flightDeckError } from './rules';
import { phaseDurationMs } from './settings';
import { emptyDay, emptyNight } from './setup';
import { activePlayers, addLog, cellOf, fuseText, getPlayer, inWashroom, isActive, label, newId, readNote, removeFromPlay, statsOf } from './state';
import type { Anomaly, Bomb, BombLocation, Cell, GameState, MoveTarget, NightAction, PlayerState } from './types';

const ANOMALIES: readonly Anomaly[] = ['turbulence', 'runaway_cart', 'blackout'];

export function describeLocation(loc: BombLocation, cartRow?: number): string {
  switch (loc.kind) {
    case 'seat':
      return `under seat ${loc.seat}`;
    case 'cart':
      return cartRow ? `on the drink cart at row ${cartRow}` : 'on the drink cart';
    case 'lavatory':
      return 'in the lavatory';
  }
}

/** Lights out: start night `night` (moves and seatbelts), applying destination twists. */
export function startNight(s: GameState, night: number, now: number): void {
  s.phase = { kind: 'night_move', night, startedAt: now, endsAt: now + phaseDurationMs(s.settings, 'night_move'), earlyEndAt: null };
  s.night = emptyNight();
  s.day = emptyDay();
  s.incidentAtDawn = false;
  const twist = DESTINATIONS[s.settings.destination].twist;
  if (twist === 'triangle') s.night.anomaly = pick(s, ANOMALIES);
  if (twist === 'turbulence' || s.night.anomaly === 'turbulence') {
    const candidates = activePlayers(s);
    if (candidates.length > 0) {
      const victim = pick(s, candidates);
      s.night.buckled[victim.id] = 'turbulence';
      addLog(s, now, 'all', 'turbulence', `Turbulence! The seatbelt sign locked ${victim.name} (${victim.seat}) in for the night.`, {
        player: victim.id,
      });
    }
  }
}

/** End of night_move: the Pilot's seatbelts apply first, then every seat change at once. */
export function resolveMoves(s: GameState, now: number): void {
  const n = s.phase.night;
  // The flight deck first: course, rough air and the seatbelt sign; then, with everyone buckled, the jump seat.
  const pilots = activePlayers(s).filter((p) => isPilot(p.role));
  for (const pilot of pilots) {
    if (flightDeckError(s, pilot) !== null) {
      pilot.lastSeatbeltTarget = null;
      continue;
    }
    changeCourse(s, pilot, now);
    flyRoughAir(s, pilot, now);
    seatbeltSign(s, pilot, now);
  }
  for (const pilot of pilots) if (flightDeckError(s, pilot) === null) callUp(s, pilot, now);

  // Every move is checked against the cabin as it was when the lights went out, then all happen at once.
  const claims = new Map<MoveTarget, PlayerState[]>();
  for (const p of activePlayers(s)) {
    const to = s.night.moves[p.id];
    // (The jump seat guest spends the night on the flight deck instead.)
    if (!to || to === 'stay' || s.night.buckled[p.id] || p.id === s.night.jumpseat) continue;
    if (checkMove(s, p, to) !== null) continue;
    claims.set(to, [...(claims.get(to) ?? []), p]);
  }
  for (const to of [...claims.keys()].sort((a, b) => seatOrder(a) - seatOrder(b))) {
    const claimants = claims.get(to)!;
    const winner = claimants.length === 1 ? claimants[0] : pick(s, claimants);
    if (to === 'washroom') goToWashroom(s, winner, now);
    else {
      const from = winner.seat;
      winner.seat = to;
      const text = isAisleSpot(to)
        ? `Night ${n}: Stewardess ${winner.name} walked from row ${aisleRow(from)} to row ${aisleRow(to)}.`
        : `Night ${n}: ${winner.name} moved from ${from} to ${to}.`;
      addLog(s, now, 'end', 'move', text, { player: winner.id, from, to });
    }
    for (const loser of claimants) {
      if (loser === winner) continue;
      addLog(s, now, [loser.id], 'bumped', to === 'washroom' ? `Someone beat you to the lavatory. You stayed in ${loser.seat}.` : `Someone beat you to ${to}. You stayed in ${loser.seat}.`);
    }
  }

  // The drink cart rolls with the Stewardess (the first one still working, if there are several).
  const crew = activePlayers(s).find((p) => isStewardess(p.role) && isAisleSpot(p.seat));
  const row = crew ? aisleRow(crew.seat) : null;
  if (row !== null && !s.cabin.cartDestroyed && row !== s.cabin.cartRow) {
    s.cabin.cartRow = row;
    addLog(s, now, 'all', 'cart', `The drink cart is now at row ${row}.`);
  }
}

/** The seatbelt sign over one passenger (never the same one two nights running). */
function seatbeltSign(s: GameState, pilot: PlayerState, now: number): void {
  const n = s.phase.night;
  const choice = s.night.seatbelts[pilot.id];
  if (!choice || choice === 'none') {
    pilot.lastSeatbeltTarget = null;
    return;
  }
  const error = checkSeatbelt(s, pilot, choice);
  if (error) {
    pilot.lastSeatbeltTarget = null;
    addLog(s, now, [pilot.id], 'fizzle', `The seatbelt sign did not come on: ${error}`);
    return;
  }
  const target = getPlayer(s, choice)!;
  pilot.lastSeatbeltTarget = target.id;
  addLog(s, now, [pilot.id], 'seatbelt', `You turned on the seatbelt sign for ${target.name} (${target.seat}).`);
  if (s.night.freed[target.id]) {
    addLog(s, now, [target.id], 'item', 'Ding. The seatbelt sign lit up over your seat, but your extender keeps you free tonight.');
    addLog(s, now, 'end', 'seatbelt', `Night ${n}: Pilot ${pilot.name} tried to buckle in ${target.name}, who had a seatbelt extender.`);
    return;
  }
  s.night.buckled[target.id] ??= 'pilot';
  addLog(
    s,
    now,
    [target.id],
    'buckled',
    isStewardess(target.role)
      ? 'Ding. The captain told the crew to stay put. You are stuck at your post tonight and cannot use an ability.'
      : 'Ding. The seatbelt sign lit up over your seat. You are stuck here tonight and cannot use an ability.',
  );
  addLog(s, now, 'end', 'seatbelt', `Night ${n}: Pilot ${pilot.name} buckled in ${target.name}.`);
}

/** Once per flight: land a night later (hold) or a night sooner (shortcut). Everyone hears. */
function changeCourse(s: GameState, pilot: PlayerState, now: number): void {
  const change = s.night.courses[pilot.id];
  if (!change || checkCourse(s, pilot, change) !== null) return;
  pilot.courseUsed = true;
  s.nights += change === 'hold' ? 1 : -1;
  const text =
    change === 'hold'
      ? `The captain is holding: Flight 13 now lands after night ${s.nights}.`
      : `The captain is taking a shortcut: Flight 13 now lands after night ${s.nights}.`;
  addLog(s, now, 'all', 'course', text, { change, nights: s.nights });
  addLog(s, now, 'end', 'course', `Night ${s.phase.night}: Pilot ${pilot.name} ${change === 'hold' ? 'flew a holding pattern' : 'took a shortcut'}.`);
}

/** Once per flight: rough air buckles everyone in three rows (crew working them included). */
function flyRoughAir(s: GameState, pilot: PlayerState, now: number): void {
  const start = s.night.roughair[pilot.id];
  if (start === undefined || checkRoughAir(s, pilot, start) !== null) return;
  pilot.roughAirUsed = true;
  const rows = [start, start + 1, start + 2];
  for (const p of activePlayers(s)) {
    const cell = p.seat ? parsePlace(p.seat) : null;
    if (!cell || !rows.includes(cell.row)) continue;
    if (s.night.freed[p.id]) {
      addLog(s, now, [p.id], 'item', 'The plane bucked through rough air, but your seatbelt extender keeps you free tonight.');
      continue;
    }
    s.night.buckled[p.id] ??= 'rough';
    addLog(s, now, [p.id], 'buckled', 'The plane bucked through rough air and the seatbelt sign came on over your row. You cannot move or use an ability tonight.');
  }
  addLog(s, now, 'all', 'roughair', `The plane bucked through rough air over rows ${start}–${start + 2}. Everyone there is buckled in tonight.`, { rows });
  addLog(s, now, 'end', 'roughair', `Night ${s.phase.night}: Pilot ${pilot.name} flew through rough air over rows ${start}–${start + 2}.`);
}

/** The jump seat: the guest spends the night on the flight deck (unless they are buckled in). */
function callUp(s: GameState, pilot: PlayerState, now: number): void {
  const target = s.night.jumpseats[pilot.id];
  if (!target || target === 'none' || checkJumpseat(s, pilot, target) !== null) return;
  const guest = getPlayer(s, target)!;
  if (s.night.buckled[guest.id]) {
    addLog(s, now, [pilot.id], 'fizzle', `You called ${guest.name} up to the flight deck, but they are buckled in tonight.`);
    return;
  }
  s.night.jumpseat = guest.id;
  const back = isAisleSpot(guest.seat) ? 'back at your post' : `back in ${guest.seat}`;
  addLog(s, now, [guest.id], 'jumpseat', `The captain called you up to the flight deck for the night. You sit in the jump seat, out of everyone's reach, and will be ${back} by morning.`);
  addLog(s, now, [pilot.id], 'jumpseat', `${guest.name} is up in the jump seat tonight.`);
  addLog(s, now, 'all', 'jumpseat', `${guest.name} was called up to the flight deck for the night.`, { player: guest.id });
  addLog(s, now, 'end', 'jumpseat', `Night ${s.phase.night}: Pilot ${pilot.name} called ${guest.name} up to the jump seat.`);
}

/** Lock yourself in the lavatory for the night: out of reach, and any poison washed out. */
function goToWashroom(s: GameState, p: PlayerState, now: number): void {
  const n = s.phase.night;
  s.night.washroom = p.id;
  p.washroomUsed = true;
  const cured = p.poisonedNight !== null;
  p.poisonedNight = null;
  p.poisonedBy = null;
  addLog(
    s,
    now,
    [p.id],
    'washroom',
    `You slipped into the lavatory and locked the door. Nobody can reach you tonight, and you will be back in ${p.seat} by morning.${
      cured ? ' You rinsed the poison out at the sink and already feel better.' : ''
    }`,
    { cured },
  );
  addLog(s, now, 'all', 'washroom', `${p.name} went to the lavatory. The door is locked for the night.`, { player: p.id });
  addLog(s, now, 'end', 'washroom', `Night ${n}: ${p.name} spent the night in the lavatory${cured ? ' and washed out the poison' : ''}.`);
}

/** Look under your own seat (or search the lavatory you are locked in). The answer is final. */
export function searchSeat(s: GameState, p: PlayerState, now: number): void {
  const n = s.phase.night;
  s.night.searched[p.id] = true;
  if (inWashroom(s, p.id)) {
    const found = s.bombs.filter((b) => !b.exploded && !b.defused && b.location.kind === 'lavatory');
    for (const b of found) if (!p.knownBombIds.includes(b.id)) p.knownBombIds.push(b.id);
    statsOf(s, p.id).found += found.length;
    const text =
      found.length === 0
        ? 'You searched every corner of the lavatory. Paper towels, a spare roll, nothing else.'
        : `Behind the mirror panel you found a bomb, ${fuseText(found[0], n)}. You are locked in here with it.`;
    addLog(s, now, [p.id], 'search', text, { bombs: found.map((b) => b.id), lavatory: true });
    addLog(s, now, 'end', 'search', `Night ${n}: ${p.name} searched the lavatory${found.length ? ' and found a bomb' : ''}.`);
    return;
  }
  const found = s.bombs.filter((b) => !b.exploded && !b.defused && b.location.kind === 'seat' && b.location.seat === p.seat);
  for (const b of found) if (!p.knownBombIds.includes(b.id)) p.knownBombIds.push(b.id);
  statsOf(s, p.id).found += found.length;
  const text =
    found.length === 0
      ? `You looked under ${p.seat}. Nothing but crumbs and a life vest.`
      : `You looked under ${p.seat} and found a bomb, ${fuseText(found[0], n)}. Get away from it.`;
  addLog(s, now, [p.id], 'search', text, { bombs: found.map((b) => b.id), seat: p.seat });
  addLog(s, now, 'end', 'search', `Night ${n}: ${p.name} looked under ${p.seat}${found.length ? ' and found a bomb' : ''}.`);
}

interface Acting {
  actor: PlayerState;
  action: NightAction;
}

/** End of night_act: everything that happens in the dark, in the spec's order. */
export function resolveNight(s: GameState, now: number): void {
  const n = s.phase.night;
  const rows = s.cabin.rows;
  const cartRowAtAct = s.cabin.cartRow;

  // 1. Only valid actions from active, unbuckled players count.
  const acts: Acting[] = [];
  for (const actor of activePlayers(s)) {
    const action = s.night.actions[actor.id];
    if (!action || s.night.buckled[actor.id]) continue;
    const error = checkAction(s, actor, action);
    if (error) {
      addLog(s, now, [actor.id], 'fizzle', `Your action failed: ${error}`);
      continue;
    }
    acts.push({ actor, action });
  }
  acts.sort((a, b) => seatOrder(a.actor.seat!) - seatOrder(b.actor.seat!));
  const playerById = (id: string) => getPlayer(s, id)!;
  /** Who used an ability on whom tonight, for compact mirrors. */
  const visits = new Map<string, string[]>();
  const visit = (target: string, text: string) => visits.set(target, [...(visits.get(target) ?? []), text]);
  for (const pilot of activePlayers(s)) {
    if (pilot.role === 'pilot' && pilot.lastSeatbeltTarget && s.night.seatbelts[pilot.id] === pilot.lastSeatbeltTarget) {
      visit(pilot.lastSeatbeltTarget, `${pilot.name} turned on your seatbelt sign`);
    }
  }
  for (const [user, seat] of Object.entries(s.night.flashlights)) {
    const sitter = activePlayers(s).find((p) => p.seat === seat);
    if (sitter) visit(sitter.id, `${playerById(user).name} shone a flashlight under your seat`);
  }

  // 0. Sleeping pills: whoever swallowed one does nothing tonight.
  for (const [sleeper, by] of Object.entries(s.night.asleep)) {
    const p = playerById(sleeper);
    if (!isActive(p)) continue;
    visit(p.id, `${playerById(by).name} slipped something into your water`);
    const i = acts.findIndex((a) => a.actor.id === p.id && a.action.kind !== 'search');
    if (i >= 0) acts.splice(i, 1);
    addLog(
      s,
      now,
      [p.id],
      'fizzle',
      i >= 0
        ? 'You dozed off before you could do anything. Someone must have slipped something into your water.'
        : 'You slept like a stone. Someone must have slipped something into your water.',
    );
  }

  // 1b. Handcuffs: the Air Marshal's target is out before anyone acts, and does nothing tonight.
  const cuffed = new Set<string>();
  for (const { actor, action } of acts) {
    if (action.kind !== 'cuff' || cuffed.has(actor.id)) continue;
    const t = playerById(action.target);
    if (!isActive(t)) continue;
    const seat = t.seat;
    visit(t.id, `${actor.name} snapped handcuffs on you`);
    if (consumeItem(t, 'bobbypin')) {
      actor.cuffsUsed = true;
      addLog(s, now, [actor.id], 'cuff', `You handcuffed ${t.name} (${seat}), but they picked the lock and slipped free. Your cuffs are gone.`);
      addLog(s, now, [t.id], 'item', 'Someone snapped handcuffs on you in the dark. You picked the lock with your bobby pin and slipped free.');
      addLog(s, now, 'end', 'cuff', `Night ${n}: Air Marshal ${actor.name} handcuffed ${t.name}, who picked the lock with a bobby pin.`);
      continue;
    }
    actor.cuffsUsed = true;
    cuffed.add(t.id);
    removeFromPlay(s, t, 'restrained', n);
    s.incidentAtDawn = true;
    addLog(s, now, [actor.id], 'cuff', `You handcuffed ${t.name} (${seat}).`);
    addLog(s, now, 'all', 'cuff', `The Air Marshal handcuffed ${label(t)} in ${seat} and walked them to the rear galley.`, { player: t.id });
    addLog(s, now, 'end', 'cuff', `Night ${n}: Air Marshal ${actor.name} handcuffed ${t.name}.`);
    readNote(s, t, now);
  }
  for (let i = acts.length - 1; i >= 0; i--) {
    const { actor, action } = acts[i];
    if (cuffed.has(actor.id)) {
      if (action.kind !== 'search' && action.kind !== 'cuff') addLog(s, now, [actor.id], 'fizzle', 'You were handcuffed before you could act.');
      acts.splice(i, 1);
    } else if ('target' in action && action.kind !== 'cuff' && cuffed.has(action.target)) {
      addLog(s, now, [actor.id], 'fizzle', `${playerById(action.target).name} was handcuffed and led away before you got to them.`);
      acts.splice(i, 1);
    }
  }

  // 2. Treatments (and who gave them, so a Nurse is credited for every life saved).
  const treated = new Set<string>();
  const nursesOf = new Map<string, string[]>();
  const rescued = (id: string) => {
    for (const nurse of nursesOf.get(id) ?? []) statsOf(s, nurse).rescues++;
  };
  for (const { actor, action } of acts) {
    if (action.kind !== 'treat') continue;
    const t = playerById(action.target);
    treated.add(t.id);
    nursesOf.set(t.id, [...(nursesOf.get(t.id) ?? []), actor.id]);
    if (t.id !== actor.id) visit(t.id, `${actor.name} treated you`);
    if (t.id === actor.id) actor.selfTreatUsed = true;
    addLog(s, now, [actor.id], 'treat', t.id === actor.id ? 'You treated yourself tonight.' : `You treated ${t.name} (${t.seat}).`);
    addLog(s, now, 'end', 'treat', `Night ${n}: Nurse ${actor.name} treated ${t.name}.`);
  }

  // 3. Bombs are planted.
  for (const { actor, action } of acts) {
    if (action.kind !== 'plant') continue;
    const location: BombLocation = action.where === 'seat' ? { kind: 'seat', seat: actor.seat! } : { kind: action.where };
    const bomb: Bomb = {
      id: `bomb${newId(s)}`,
      planterId: actor.id,
      location,
      plantedNight: n,
      detonateNight: n + action.fuse,
      exploded: false,
      explodedAt: null,
      defused: false,
    };
    s.bombs.push(bomb);
    actor.bombUsed = true;
    const where = describeLocation(location);
    addLog(s, now, 'saboteurs', 'plant', `${actor.name} planted a bomb ${where}. It goes off at the end of night ${bomb.detonateNight}.`, {
      bomb: bomb.id,
    });
    addLog(s, now, 'end', 'plant', `Night ${n}: ${ROLES[actor.role].name} ${actor.name} planted a bomb ${where} (fuse ${action.fuse}).`);
  }

  // 4. Poisoned drinks.
  for (const { actor, action } of acts) {
    if (action.kind !== 'serve' || actor.role !== 'stewardess_rogue') continue;
    const t = playerById(action.target);
    visit(t.id, `${actor.name} served you a drink`);
    addLog(s, now, [actor.id], 'serve', `You served ${t.name} (${t.seat}) a poisoned drink.`);
    if (treated.has(t.id)) {
      rescued(t.id);
      addLog(s, now, [t.id], 'saved', 'Someone slipped poison into your drink, but the treatment you got tonight neutralized it.');
      addLog(s, now, 'end', 'poison', `Night ${n}: ${actor.name} poisoned ${t.name}, but the Nurse's treatment neutralized it.`);
    } else if (consumeItem(t, 'antidote')) {
      addLog(s, now, [t.id], 'item', 'Your drink tasted bitter. Your antidote neutralized the poison.');
      addLog(s, now, 'end', 'poison', `Night ${n}: ${actor.name} poisoned ${t.name}, whose antidote neutralized it.`);
    } else {
      if (t.poisonedNight === null) {
        t.poisonedNight = n;
        t.poisonedBy = actor.id;
      }
      addLog(s, now, 'end', 'poison', `Night ${n}: ${actor.name} poisoned ${t.name}.`);
    }
  }

  // 5. Investigations (the cart is where it stood during night_act), and the loyal Stewardess's checks.
  const live = s.bombs.filter((b) => !b.exploded && !b.defused);
  for (const { actor, action } of acts) {
    if (action.kind !== 'check') continue;
    const row = aisleRow(actor.seat)!;
    const seats = rowSeats(row, action.side);
    // The Mastermind hides a bomb too well for a glance from the aisle.
    const found = live.filter(
      (b) => b.location.kind === 'seat' && seats.includes(b.location.seat) && getPlayer(s, b.planterId)?.role !== 'mastermind',
    );
    for (const seat of seats) {
      const sitter = activePlayers(s).find((p) => p.seat === seat && !inWashroom(s, p.id));
      if (sitter) visit(sitter.id, `${actor.name} checked under your seat`);
    }
    for (const b of found) if (!actor.knownBombIds.includes(b.id)) actor.knownBombIds.push(b.id);
    statsOf(s, actor.id).found += found.length;
    const what = `under ${seats.slice(0, 2).join(', ')} and ${seats[2]}`;
    const text =
      found.length === 0
        ? `You worked row ${row} and checked ${what}. No bombs.`
        : `You worked row ${row}, checked ${what} and found ${found.length === 1 ? 'a bomb' : `${found.length} bombs`}: ${found
            .map((b) => `${describeLocation(b.location)}, ${fuseText(b, n)}`)
            .join('; ')}.`;
    addLog(s, now, [actor.id], 'check', text, { bombs: found.map((b) => b.id), seats });
    addLog(s, now, 'end', 'check', `Night ${n}: Stewardess ${actor.name} checked ${what}${found.length ? ' and found a bomb' : ''}.`);
  }
  for (const { actor, action } of acts) {
    if (action.kind !== 'sweep' && action.kind !== 'inspect') continue;
    let found: Bomb[];
    let what: string;
    if (action.kind === 'sweep') {
      const here = cellOf(actor);
      found = live.filter((b) => b.location.kind === 'seat' && distance(parseSeat(b.location.seat)!, here) <= SWEEP_RADIUS);
      what = `the seats around ${actor.seat}`;
    } else {
      found = live.filter((b) => b.location.kind === action.what);
      what = action.what === 'cart' ? `the drink cart at row ${cartRowAtAct}` : 'the lavatory';
    }
    for (const b of found) if (!actor.knownBombIds.includes(b.id)) actor.knownBombIds.push(b.id);
    statsOf(s, actor.id).found += found.length;
    const text =
      found.length === 0
        ? `You checked ${what}. No bombs.`
        : `You checked ${what} and found ${found.length === 1 ? 'a bomb' : `${found.length} bombs`}: ${found
            .map((b) => `${describeLocation(b.location)}, ${fuseText(b, n)}`)
            .join('; ')}.`;
    addLog(s, now, [actor.id], action.kind, text, { bombs: found.map((b) => b.id) });
    addLog(s, now, 'end', action.kind, `Night ${n}: Investigator ${actor.name} checked ${what}${found.length ? ' and found a bomb' : ''}.`);
  }

  // 6. A runaway cart leaves the Stewardess behind (she catches up with it when she next walks).
  if (s.night.anomaly === 'runaway_cart' && !s.cabin.cartDestroyed) {
    s.cabin.cartRow = 1 + nextInt(s, rows);
    addLog(s, now, 'all', 'anomaly', `In the dark, the drink cart broke loose and rolled to row ${s.cabin.cartRow}.`, { anomaly: 'runaway_cart' });
  }

  // 6b. Bombs defused tonight are found out at dawn (the planter's seat is a clue).
  for (const [bombId] of Object.entries(s.night.defused)) {
    const bomb = s.bombs.find((b) => b.id === bombId);
    if (!bomb) continue;
    const where = describeLocation(bomb.location);
    s.incidentAtDawn = true;
    addLog(s, now, 'all', 'defused', `Someone found a bomb ${where} and defused it in the night.`, { bomb: bomb.id, location: bomb.location });
    addLog(s, now, 'saboteurs', 'defused', `The bomb ${where} was defused.`, { bomb: bomb.id });
  }

  // 7. Explosions.
  for (const bomb of s.bombs) {
    if (bomb.exploded || bomb.defused || bomb.detonateNight !== n) continue;
    const centers: Cell[] =
      bomb.location.kind === 'seat'
        ? [parseSeat(bomb.location.seat)!]
        : bomb.location.kind === 'cart'
          ? [cartCell(s.cabin.cartRow)]
          : lavatoryCells(rows);
    bomb.exploded = true;
    bomb.explodedAt = centers;
    s.cabin.scorched.push(...centers);
    if (bomb.location.kind === 'cart') s.cabin.cartDestroyed = true;
    if (bomb.location.kind === 'lavatory') s.cabin.lavatoryDestroyed = true;
    s.incidentAtDawn = true;
    const victims: PlayerState[] = [];
    for (const p of activePlayers(s)) {
      // Whoever is locked in the lavatory is only caught by a bomb in there with them.
      const caught = inWashroom(s, p.id) ? bomb.location.kind === 'lavatory' : !!p.seat && distanceToAny(cellOf(p), centers) <= BLAST_RADIUS;
      if (!caught) continue;
      if (treated.has(p.id)) {
        rescued(p.id);
        addLog(s, now, [p.id], 'saved', 'You were caught in the blast, but the treatment you got tonight kept you alive.');
      } else if (consumeItem(p, 'pillow')) {
        addLog(s, now, [p.id], 'item', 'You braced with your neck pillow. The blast knocked you flat, but you survived.');
        addLog(s, now, 'end', 'item', `Night ${n}: ${p.name} braced with a neck pillow and survived the blast.`);
      } else {
        removeFromPlay(s, p, 'explosion', n);
        victims.push(p);
        if (!isSaboteur(p.role)) statsOf(s, bomb.planterId).kills++;
      }
    }
    const where = describeLocation(bomb.location, bomb.location.kind === 'cart' ? s.cabin.cartRow : undefined);
    const casualties = victims.length ? ` Killed: ${victims.map(label).join(', ')}.` : ' Nobody was caught in the blast.';
    addLog(s, now, 'all', 'explosion', `BOOM! A bomb went off ${where}.${casualties}`, {
      bomb: bomb.id,
      cells: centers,
      victims: victims.map((v) => v.id),
    });
    for (const v of victims) readNote(s, v, now);
  }

  // 8. Poison: last night's victims die unless treated; tonight's victims feel sick.
  for (const p of activePlayers(s)) {
    if (p.poisonedNight === null) continue;
    if (p.poisonedNight < n) {
      if (treated.has(p.id)) {
        rescued(p.id);
        p.poisonedNight = null;
        p.poisonedBy = null;
        addLog(s, now, [p.id], 'cured', "The Nurse's treatment worked. Your poisoning is cured.");
      } else {
        if (p.poisonedBy && !isSaboteur(p.role)) statsOf(s, p.poisonedBy).kills++;
        removeFromPlay(s, p, 'poison', n);
        s.incidentAtDawn = true;
        addLog(s, now, 'all', 'death', `${label(p)} died of poisoning.`, { player: p.id, cause: 'poison' });
        readNote(s, p, now);
      }
    } else {
      addLog(s, now, [p.id], 'sick', 'You feel sick. Your drink was poisoned. Unless the Nurse treats you tomorrow night, you will not survive.');
    }
  }

  // 8b. Compact mirrors show who came near in the dark.
  for (const id of Object.keys(s.night.mirrors)) {
    const seen = visits.get(id) ?? [];
    addLog(
      s,
      now,
      [id],
      'item',
      seen.length ? `In your compact mirror you saw: ${seen.join('; ')}.` : 'You watched your compact mirror all night. Nobody came near you.',
    );
  }

  // 9. Twists and the quiet-night note.
  if (s.night.anomaly === 'blackout') {
    s.blackoutNight = n;
    addLog(s, now, 'all', 'anomaly', 'The cabin lights failed. The seat map is offline today.', { anomaly: 'blackout' });
  }
  if (!s.incidentAtDawn) addLog(s, now, 'all', 'info', 'The night passed quietly.');
}
