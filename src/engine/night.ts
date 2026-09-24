import { DESTINATIONS } from './destinations';
import { BLAST_RADIUS, SWEEP_RADIUS, cartCell, distance, lavatoryCells, parseSeat, seatOrder, seatsWithin } from './grid';
import { nextInt, pick } from './rng';
import { ROLES, apparentTeam } from './roles';
import { checkAction, checkMove, checkSeatbelt } from './rules';
import { phaseDurationMs } from './settings';
import { emptyDay, emptyNight } from './setup';
import { activePlayers, addLog, cellOf, getPlayer, isActive, label, newId, readNote, removeFromPlay } from './state';
import type { Anomaly, Bomb, BombLocation, Cell, GameState, NightAction, PlayerState, SeatId } from './types';

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

function fuseText(bomb: Bomb, night: number): string {
  const left = bomb.detonateNight - night;
  if (left <= 0) return 'about to go off';
  if (left === 1) return 'set to go off at the end of tomorrow night';
  return `set to go off in ${left} nights`;
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
  const turbulence = new Set(Object.keys(s.night.buckled));
  for (const pilot of activePlayers(s).filter((p) => p.role === 'pilot')) {
    const choice = s.night.seatbelts[pilot.id];
    if (turbulence.has(pilot.id) || !choice || choice === 'none') {
      pilot.lastSeatbeltTarget = null;
      continue;
    }
    const error = checkSeatbelt(s, pilot, choice);
    if (error) {
      pilot.lastSeatbeltTarget = null;
      addLog(s, now, [pilot.id], 'fizzle', `The seatbelt sign did not come on: ${error}`);
      continue;
    }
    const target = getPlayer(s, choice)!;
    pilot.lastSeatbeltTarget = target.id;
    s.night.buckled[target.id] ??= 'pilot';
    addLog(s, now, [pilot.id], 'seatbelt', `You turned on the seatbelt sign for ${target.name} (${target.seat}).`);
    addLog(s, now, [target.id], 'buckled', 'Ding. The seatbelt sign lit up over your seat. You are stuck here tonight and cannot use an ability.');
    addLog(s, now, 'end', 'seatbelt', `Night ${n}: Pilot ${pilot.name} buckled in ${target.name}.`);
  }

  const claims = new Map<SeatId, PlayerState[]>();
  for (const p of activePlayers(s)) {
    const to = s.night.moves[p.id];
    if (!to || to === 'stay' || s.night.buckled[p.id]) continue;
    if (checkMove(s, p, to) !== null) continue;
    claims.set(to, [...(claims.get(to) ?? []), p]);
  }
  for (const seat of [...claims.keys()].sort((a, b) => seatOrder(a) - seatOrder(b))) {
    const claimants = claims.get(seat)!;
    const winner = claimants.length === 1 ? claimants[0] : pick(s, claimants);
    const from = winner.seat;
    winner.seat = seat;
    addLog(s, now, 'end', 'move', `Night ${n}: ${winner.name} moved from ${from} to ${seat}.`, { player: winner.id, from, to: seat });
    for (const loser of claimants) {
      if (loser !== winner) addLog(s, now, [loser.id], 'bumped', `Someone beat you to ${seat}. You stayed in ${loser.seat}.`);
    }
  }
}

/** Look under your own seat. Only an earlier occupant can have left a bomb there, so the answer is final. */
export function searchSeat(s: GameState, p: PlayerState, now: number): void {
  const n = s.phase.night;
  s.night.searched[p.id] = true;
  const found = s.bombs.filter((b) => !b.exploded && b.location.kind === 'seat' && b.location.seat === p.seat);
  for (const b of found) if (!p.knownBombIds.includes(b.id)) p.knownBombIds.push(b.id);
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

  // 1b. Handcuffs: the Air Marshal's target is out before anyone acts, and does nothing tonight.
  const cuffed = new Set<string>();
  for (const { actor, action } of acts) {
    if (action.kind !== 'cuff' || cuffed.has(actor.id)) continue;
    const t = playerById(action.target);
    if (!isActive(t)) continue;
    const seat = t.seat;
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

  // 2. Treatments.
  const treated = new Set<string>();
  for (const { actor, action } of acts) {
    if (action.kind !== 'treat') continue;
    const t = playerById(action.target);
    treated.add(t.id);
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
    addLog(s, now, [actor.id], 'serve', `You served ${t.name} (${t.seat}) a poisoned drink.`);
    if (treated.has(t.id)) {
      addLog(s, now, [t.id], 'saved', 'Someone slipped poison into your drink, but the treatment you got tonight neutralized it.');
      addLog(s, now, 'end', 'poison', `Night ${n}: ${actor.name} poisoned ${t.name}, but the Nurse's treatment neutralized it.`);
    } else {
      if (t.poisonedNight === null) t.poisonedNight = n;
      addLog(s, now, 'end', 'poison', `Night ${n}: ${actor.name} poisoned ${t.name}.`);
    }
  }

  // 5. Investigations (the cart is where it stood during night_act).
  const live = s.bombs.filter((b) => !b.exploded);
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
    const text =
      found.length === 0
        ? `You checked ${what}. No bombs.`
        : `You checked ${what} and found ${found.length === 1 ? 'a bomb' : `${found.length} bombs`}: ${found
            .map((b) => `${describeLocation(b.location)}, ${fuseText(b, n)}`)
            .join('; ')}.`;
    addLog(s, now, [actor.id], action.kind, text, { bombs: found.map((b) => b.id) });
    addLog(s, now, 'end', action.kind, `Night ${n}: Investigator ${actor.name} checked ${what}${found.length ? ' and found a bomb' : ''}.`);
  }

  // 6. Loyal results, then the cart rolls to each served row.
  for (const { actor, action } of acts) {
    if (action.kind !== 'serve') continue;
    const t = playerById(action.target);
    if (actor.role === 'stewardess_loyal') {
      const team = apparentTeam(t.role);
      addLog(
        s,
        now,
        [actor.id],
        'serve',
        `You served ${t.name} (${t.seat}). They are on the ${team === 'saboteurs' ? 'Saboteur' : 'Passenger'} team.`,
        { player: t.id, team },
      );
      addLog(s, now, 'end', 'serve', `Night ${n}: Stewardess ${actor.name} checked ${t.name}.`);
    }
    if (!s.cabin.cartDestroyed) s.cabin.cartRow = cellOf(t).row;
  }
  if (s.night.anomaly === 'runaway_cart' && !s.cabin.cartDestroyed) {
    s.cabin.cartRow = 1 + nextInt(s, rows);
    addLog(s, now, 'all', 'anomaly', `In the dark, the drink cart broke loose and rolled to row ${s.cabin.cartRow}.`, { anomaly: 'runaway_cart' });
  } else if (s.cabin.cartRow !== cartRowAtAct) {
    addLog(s, now, 'all', 'cart', `The drink cart is now at row ${s.cabin.cartRow}.`);
  }

  // 7. Explosions.
  for (const bomb of s.bombs) {
    if (bomb.exploded || bomb.detonateNight !== n) continue;
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
    const blast = new Set(seatsWithin(centers, BLAST_RADIUS, rows));
    const victims: PlayerState[] = [];
    for (const p of activePlayers(s)) {
      if (!p.seat || !blast.has(p.seat)) continue;
      if (treated.has(p.id)) {
        addLog(s, now, [p.id], 'saved', 'You were caught in the blast, but the treatment you got tonight kept you alive.');
      } else {
        removeFromPlay(s, p, 'explosion', n);
        victims.push(p);
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
        p.poisonedNight = null;
        addLog(s, now, [p.id], 'cured', "The Nurse's treatment worked. Your poisoning is cured.");
      } else {
        removeFromPlay(s, p, 'poison', n);
        s.incidentAtDawn = true;
        addLog(s, now, 'all', 'death', `${label(p)} died of poisoning.`, { player: p.id, cause: 'poison' });
        readNote(s, p, now);
      }
    } else {
      addLog(s, now, [p.id], 'sick', 'You feel sick. Your drink was poisoned. Unless the Nurse treats you tomorrow night, you will not survive.');
    }
  }

  // 9. Twists and the quiet-night note.
  if (s.night.anomaly === 'blackout') {
    s.blackoutNight = n;
    addLog(s, now, 'all', 'anomaly', 'The cabin lights failed. The seat map is offline today.', { anomaly: 'blackout' });
  }
  if (!s.incidentAtDawn) addLog(s, now, 'all', 'info', 'The night passed quietly.');
}
