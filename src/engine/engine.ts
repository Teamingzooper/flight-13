import { computeAwards } from './awards';
import { resolveVote, startDay } from './day';
import { DESTINATIONS } from './destinations';
import { WHISPER_RADIUS, distance } from './grid';
import { MAX_PACKED, checkItemUse, isItemId, useItem } from './items';
import { resolveMoves, resolveNight, searchSeat, startNight } from './night';
import { isPilot, isSaboteur } from './roles';
import { checkAction, checkCourse, checkJumpseat, checkMove, checkRoughAir, checkSeatbelt, flightDeckError } from './rules';
import { CHAT_COOLDOWN_MS, CHAT_HISTORY, CHAT_MAX_LENGTH, EARLY_END_GRACE_MS, NIGHT_ACT_GRACE_MS, NOTE_MAX_LENGTH, PA_COOLDOWN_MS, PA_MAX_LENGTH } from './settings';
import { clearedForTakeoff } from './setup';
import { activePlayers, addLog, cellOf, getPlayer, inWashroom, isActive, newId, setPhase } from './state';
import type { ChatChannel, ChatMessage, GameState, Intent, IntentResult, PhaseKind, PlayerState } from './types';
import { checkWin, landingResult, resultText } from './win';

const OK: IntentResult = { ok: true };
const fail = (error: string): IntentResult => ({ ok: false, error });

export function isNightPhase(kind: PhaseKind): boolean {
  return kind === 'night_move' || kind === 'night_act';
}

export function isWhisperPhase(kind: PhaseKind): boolean {
  return kind === 'day_discuss' || kind === 'day_vote';
}

/** When the current phase ends (early end included). */
export function phaseDue(s: GameState): number {
  return s.phase.earlyEndAt === null ? s.phase.endsAt : Math.min(s.phase.endsAt, s.phase.earlyEndAt);
}

export function applyIntent(s: GameState, playerId: string, intent: Intent, now: number): IntentResult {
  const p = getPlayer(s, playerId);
  if (!p) return fail('You are not on this flight.');
  if (!intent || typeof intent !== 'object') return fail('Bad request.');
  if (intent.kind === 'chat') return postChat(s, p, intent.channel, intent.text, now);
  if (intent.kind === 'whisper') return postWhisper(s, p, intent.to, intent.text, now);
  if (s.phase.kind === 'ended') return fail('The flight is over.');
  if (!isActive(p)) return fail('You are out of the game.');

  switch (intent.kind) {
    case 'pack': {
      if (s.phase.kind !== 'packing') return fail('Your bag is already packed.');
      const items: unknown = intent.items;
      if (!Array.isArray(items) || !items.every(isItemId)) return fail('Unknown item.');
      if (items.length > MAX_PACKED) return fail(`Your carry-on only fits ${MAX_PACKED} items.`);
      p.items = [...items];
      if (intent.ready === true) s.packed[p.id] = true;
      else delete s.packed[p.id];
      break;
    }
    case 'use': {
      const use = { item: intent.item, target: intent.target, seat: intent.seat };
      const error = checkItemUse(s, p, use);
      if (error) return fail(error);
      useItem(s, p, use, now);
      // An extender can free someone who was not expected to act: let them.
      if (s.phase.earlyEndAt !== null && !allSubmitted(s)) s.phase.earlyEndAt = null;
      break;
    }
    case 'move': {
      if (s.phase.kind !== 'night_move') return fail('You can only change seats while the lights are out.');
      if (s.night.buckled[p.id]) return fail('Your seatbelt is locked tonight.');
      const error = checkMove(s, p, intent.to);
      if (error) return fail(error);
      s.night.moves[p.id] = intent.to;
      break;
    }
    case 'seatbelt': {
      if (s.phase.kind !== 'night_move') return fail('The seatbelt sign is set while the lights are out.');
      if (!isPilot(p.role)) return fail('Only the Pilot controls the seatbelt sign.');
      const error = checkSeatbelt(s, p, intent.target);
      if (error) return fail(error);
      s.night.seatbelts[p.id] = intent.target;
      break;
    }
    case 'jumpseat': {
      if (s.phase.kind !== 'night_move') return fail('Call someone up while the lights are out.');
      const error = checkJumpseat(s, p, intent.target);
      if (error) return fail(error);
      s.night.jumpseats[p.id] = intent.target;
      break;
    }
    case 'roughair': {
      if (s.phase.kind !== 'night_move') return fail('Rough air is flown while the lights are out.');
      const error = checkRoughAir(s, p, intent.startRow);
      if (error) return fail(error);
      if (intent.startRow === null) delete s.night.roughair[p.id];
      else s.night.roughair[p.id] = intent.startRow;
      break;
    }
    case 'course': {
      if (s.phase.kind !== 'night_move') return fail('Change course while the lights are out.');
      const error = checkCourse(s, p, intent.change);
      if (error) return fail(error);
      if (intent.change === null) delete s.night.courses[p.id];
      else s.night.courses[p.id] = intent.change;
      break;
    }
    case 'act': {
      if (s.phase.kind !== 'night_act') return fail('Abilities are used at night, after seats change.');
      if (s.night.buckled[p.id]) return fail('You are buckled in tonight.');
      if (s.night.searched[p.id]) return fail(inWashroom(s, p.id) ? 'You already searched the lavatory tonight.' : 'You already spent tonight looking under your seat.');
      if (intent.action) {
        const error = checkAction(s, p, intent.action);
        if (error) return fail(error);
      }
      s.night.actions[p.id] = intent.action ?? null;
      // Looking under your seat (or round the lavatory) is answered on the spot.
      if (intent.action?.kind === 'search') searchSeat(s, p, now);
      break;
    }
    case 'note': {
      if (typeof intent.text !== 'string') return fail('Write your note first.');
      const text = intent.text.trim();
      if (text.length > NOTE_MAX_LENGTH) return fail(`Keep your note under ${NOTE_MAX_LENGTH} characters.`);
      p.note = text;
      return OK;
    }
    case 'ready': {
      if (s.phase.kind !== 'day_discuss') return fail('Nothing to be ready for right now.');
      s.day.ready[p.id] = true;
      break;
    }
    case 'vote': {
      if (s.phase.kind !== 'day_vote') return fail('Voting has not started.');
      if (intent.target !== 'skip') {
        const t = getPlayer(s, intent.target);
        if (!t || !isActive(t)) return fail('Pick someone who is still in play.');
        if (t.id === p.id) return fail('You cannot vote for yourself.');
      }
      s.day.votes[p.id] = intent.target;
      break;
    }
    default:
      return fail('Unknown request.');
  }
  scheduleEarlyEnd(s, now);
  return OK;
}

function allSubmitted(s: GameState): boolean {
  const active = activePlayers(s);
  switch (s.phase.kind) {
    case 'packing':
      return s.players.every((p) => s.packed[p.id] === true);
    case 'night_move':
      // The Pilot never moves: his calls are in once he has picked for the seatbelt sign (or he cannot call tonight).
      return active.every(
        (p) =>
          s.night.buckled[p.id] !== undefined ||
          (isPilot(p.role) ? p.id in s.night.seatbelts || flightDeckError(s, p) !== null : p.id in s.night.moves),
      );
    case 'night_act':
      return active.every(
        (p) => s.night.buckled[p.id] !== undefined || p.id in s.night.actions || (isPilot(p.role) && flightDeckError(s, p) !== null),
      );
    case 'day_discuss':
      return active.every((p) => s.day.ready[p.id] === true);
    case 'day_vote':
      return active.every((p) => p.id in s.day.votes);
    default:
      return false;
  }
}

/** Once every eligible player has submitted, end the phase after a short grace period. */
export function scheduleEarlyEnd(s: GameState, now: number): void {
  if (s.phase.earlyEndAt !== null || !allSubmitted(s)) return;
  const grace = s.phase.kind === 'night_act' ? NIGHT_ACT_GRACE_MS : EARLY_END_GRACE_MS;
  s.phase.earlyEndAt = Math.min(s.phase.endsAt, now + grace);
}

/** Fill in "do nothing" choices for a player who is away, so phases can still end early. */
export function submitDefaults(s: GameState, playerId: string, now: number): void {
  const p = getPlayer(s, playerId);
  if (!p || !isActive(p)) return;
  switch (s.phase.kind) {
    case 'packing':
      s.packed[p.id] = true;
      break;
    case 'night_move':
      s.night.moves[p.id] ??= 'stay';
      if (isPilot(p.role)) s.night.seatbelts[p.id] ??= 'none';
      break;
    case 'night_act':
      if (!(p.id in s.night.actions)) s.night.actions[p.id] = null;
      break;
    case 'day_discuss':
      s.day.ready[p.id] = true;
      break;
    case 'day_vote':
      s.day.votes[p.id] ??= 'skip';
      break;
    default:
      break;
  }
  scheduleEarlyEnd(s, now);
}

/** Advance the phase if its time is up. Returns true when something changed. */
export function tick(s: GameState, now: number): boolean {
  if (s.phase.kind === 'ended' || now < phaseDue(s)) return false;
  advance(s, now);
  return true;
}

function advance(s: GameState, now: number): void {
  switch (s.phase.kind) {
    case 'packing':
      setPhase(s, 'boarding', now);
      break;
    case 'boarding':
      setPhase(s, 'takeoff', now);
      clearedForTakeoff(s, now);
      break;
    case 'takeoff':
      startNight(s, 1, now);
      break;
    case 'night_move':
      resolveMoves(s, now);
      setPhase(s, 'night_act', now);
      break;
    case 'night_act':
      resolveNight(s, now);
      s.result = checkWin(s);
      setPhase(s, 'dawn', now);
      break;
    case 'dawn':
      if (s.result) endGame(s, now);
      else startDay(s, now);
      break;
    case 'day_discuss':
      if (s.settings.voteMode === 'afterIncident' && !s.incidentAtDawn) finishDay(s, now);
      else setPhase(s, 'day_vote', now);
      break;
    case 'day_vote':
      resolveVote(s, now);
      s.result = checkWin(s);
      setPhase(s, 'verdict', now);
      break;
    case 'verdict':
      finishDay(s, now);
      break;
    case 'ended':
      break;
  }
  scheduleEarlyEnd(s, now);
}

function finishDay(s: GameState, now: number): void {
  if (s.result) return endGame(s, now);
  if (s.phase.night >= s.nights) {
    addLog(s, now, 'all', 'landing', `Flight 13 has landed in ${DESTINATIONS[s.settings.destination].city}.`);
    s.result = landingResult(s);
    return endGame(s, now);
  }
  startNight(s, s.phase.night + 1, now);
}

function endGame(s: GameState, now: number): void {
  s.phase = { kind: 'ended', night: s.phase.night, startedAt: now, endsAt: now, earlyEndAt: null };
  if (s.result) {
    s.awards = computeAwards(s, s.result);
    addLog(s, now, 'all', 'gameover', resultText(s, s.result), { ...s.result });
  }
}

function textError(s: GameState, p: PlayerState, text: unknown, now: number): string | null {
  if (typeof text !== 'string' || text.trim().length === 0) return 'Say something first.';
  if (text.trim().length > CHAT_MAX_LENGTH) return `Keep it under ${CHAT_MAX_LENGTH} characters.`;
  if (now - (s.lastChatAt[p.id] ?? -Infinity) < CHAT_COOLDOWN_MS) return 'Slow down a little.';
  return null;
}

function channelError(s: GameState, p: PlayerState, channel: ChatChannel): string | null {
  const kind = s.phase.kind;
  switch (channel) {
    case 'cabin':
      if (kind === 'ended') return null;
      if (!isActive(p)) return 'Ghosts cannot talk to the living. Use the ghost channel.';
      if (isNightPhase(kind)) return 'Lights out. The cabin is silent at night.';
      return null;
    case 'saboteurs':
      if (!isSaboteur(p.role) || !isActive(p)) return 'That channel is not for you.';
      if (!isNightPhase(kind)) return 'The saboteur channel only works at night.';
      return null;
    case 'ghosts':
      return isActive(p) && kind !== 'ended' ? 'Only ghosts can use that channel.' : null;
    case 'pa':
      if (!isPilot(p.role) || !isActive(p)) return 'Only the Pilot can use the PA.';
      return PA_PHASES.has(kind) ? null : 'The PA is for announcements by day.';
    default:
      return 'Unknown channel.';
  }
}

function pushChat(s: GameState, message: Omit<ChatMessage, 'id'>): void {
  s.chat.push({ id: newId(s), ...message });
  if (s.chat.length > CHAT_HISTORY) s.chat.splice(0, s.chat.length - CHAT_HISTORY);
}

function postChat(s: GameState, p: PlayerState, channel: ChatChannel, text: string, now: number): IntentResult {
  const error = textError(s, p, text, now) ?? channelError(s, p, channel) ?? (channel === 'pa' ? paError(s, p, text, now) : null);
  if (error) return fail(error);
  pushChat(s, { t: now, channel, from: p.id, to: null, text: text.trim() });
  s.lastChatAt[p.id] = now;
  if (channel === 'pa') s.lastChatAt[`pa:${p.id}`] = now;
  return OK;
}

const PA_PHASES: ReadonlySet<PhaseKind> = new Set(['dawn', 'day_discuss', 'day_vote', 'verdict']);

/** The PA works by day: announcements from the flight deck, typed or spoken. */
export function isPaPhase(kind: PhaseKind): boolean {
  return PA_PHASES.has(kind);
}

/** Announcements are short, and the PA needs a moment between them. */
function paError(s: GameState, p: PlayerState, text: string, now: number): string | null {
  if (text.trim().length > PA_MAX_LENGTH) return `Keep announcements under ${PA_MAX_LENGTH} characters.`;
  const wait = PA_COOLDOWN_MS - (now - (s.lastChatAt[`pa:${p.id}`] ?? -Infinity));
  return wait > 0 ? `The PA needs a moment: ${Math.ceil(wait / 1000)}s.` : null;
}

function postWhisper(s: GameState, p: PlayerState, to: string, text: string, now: number): IntentResult {
  const error = textError(s, p, text, now);
  if (error) return fail(error);
  if (!s.settings.whispers) return fail('Whispers are turned off on this flight.');
  if (!isWhisperPhase(s.phase.kind)) return fail('You can only whisper during the day.');
  const t = getPlayer(s, to);
  if (!isActive(p) || !t || !isActive(t)) return fail('Only people still in play can whisper.');
  if (t.id === p.id) return fail('Whispering to yourself?');
  if (distance(cellOf(p), cellOf(t)) > WHISPER_RADIUS) return fail(`${t.name} is too far away to whisper to.`);
  pushChat(s, { t: now, channel: 'whisper', from: p.id, to: t.id, text: text.trim() });
  s.lastChatAt[p.id] = now;
  return OK;
}
