import {
  DESTINATIONS,
  SPECIAL_CARDS,
  TIMERS,
  type Cards,
  type Intent,
  type Look,
  type PlayerView,
  type Settings,
} from '../engine';

export const PROTOCOL_VERSION = 1;
export const NAME_MAX_LENGTH = 16;

/** Options per look slot; the avatar and 3D palettes are sized to match. */
export const LOOK_LIMITS: Readonly<Record<keyof Look, number>> = { body: 3, skin: 6, hair: 8, hairColor: 6, top: 8, bottom: 5 };

export interface LobbyPlayer {
  id: string;
  name: string;
  look: Look;
  bot: boolean;
  connected: boolean;
  host: boolean;
}

export interface LobbyMessage {
  id: number;
  t: number;
  from: string;
  name: string;
  text: string;
}

/** Everything one client may know. Built by the host for each connection. */
export interface ClientState {
  code: string;
  /** Your player id, or null for the control tower. */
  you: string | null;
  isHost: boolean;
  controlTower: boolean;
  settings: Settings;
  players: LobbyPlayer[];
  lobbyChat: LobbyMessage[];
  game: PlayerView | null;
  rev: number;
}

export type HostCommand =
  | { kind: 'settings'; settings: Settings }
  | { kind: 'takeoff' }
  | { kind: 'kick'; playerId: string }
  | { kind: 'addBot' }
  | { kind: 'boardAgain' };

export type ClientMessage =
  | { t: 'join'; v: number; token: string; name: string; look: Look; tower: boolean }
  | { t: 'intent'; seq: number; intent: Intent }
  | { t: 'lobbyChat'; seq: number; text: string }
  | { t: 'command'; seq: number; command: HostCommand };

export type HostMessage =
  | { t: 'hello'; v: number; code: string }
  | { t: 'state'; state: ClientState }
  | { t: 'ack'; seq: number; ok: boolean; error?: string }
  | { t: 'refused'; reason: string };

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => Number.isInteger(x);

export function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH).trim() : '';
  return name || 'Passenger';
}

export function cleanLook(raw: unknown): Look {
  const src = isObj(raw) ? raw : {};
  const slot = (key: keyof Look) => {
    const v = src[key];
    return isInt(v) && v >= 0 && v < LOOK_LIMITS[key] ? v : 0;
  };
  return { body: slot('body'), skin: slot('skin'), hair: slot('hair'), hairColor: slot('hairColor'), top: slot('top'), bottom: slot('bottom') };
}

export function randomLook(random: () => number): Look {
  const r = (key: keyof Look) => Math.floor(random() * LOOK_LIMITS[key]);
  return { body: r('body'), skin: r('skin'), hair: r('hair'), hairColor: r('hairColor'), top: r('top'), bottom: r('bottom') };
}

/** Rebuild Settings from untrusted input, keeping only known fields (validate separately). */
export function cleanSettings(raw: unknown): Settings | null {
  if (!isObj(raw) || !isObj(raw.cards)) return null;
  const cards = {} as Cards;
  for (const card of SPECIAL_CARDS) {
    const v = raw.cards[card];
    if (!isInt(v) || v < 0 || v > 16) return null;
    cards[card] = v;
  }
  const { destination, maxPassengers, rolesMode, stewardessRogueChance, timers, revealRoles, voteMode, anonymousVotes, whispers } = raw;
  if (typeof destination !== 'string' || !(destination in DESTINATIONS)) return null;
  if (!isInt(maxPassengers)) return null;
  if (rolesMode !== 'auto' && rolesMode !== 'custom') return null;
  if (typeof stewardessRogueChance !== 'number') return null;
  if (typeof timers !== 'string' || !(timers in TIMERS)) return null;
  if (voteMode !== 'daily' && voteMode !== 'afterIncident') return null;
  if (typeof revealRoles !== 'boolean' || typeof anonymousVotes !== 'boolean' || typeof whispers !== 'boolean') return null;
  return {
    destination: destination as Settings['destination'],
    maxPassengers,
    rolesMode,
    cards,
    stewardessRogueChance,
    timers: timers as Settings['timers'],
    revealRoles,
    voteMode,
    anonymousVotes,
    whispers,
  };
}

/** Shape-check an incoming client message. The engine validates intent contents. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isObj(raw)) return null;
  switch (raw.t) {
    case 'join':
      if (typeof raw.token !== 'string' || raw.token.length < 8 || raw.token.length > 64) return null;
      return {
        t: 'join',
        v: isInt(raw.v) ? raw.v : 0,
        token: raw.token,
        name: cleanName(raw.name),
        look: cleanLook(raw.look),
        tower: raw.tower === true,
      };
    case 'intent':
      if (!isInt(raw.seq) || !isObj(raw.intent) || typeof raw.intent.kind !== 'string') return null;
      return { t: 'intent', seq: raw.seq, intent: raw.intent as unknown as Intent };
    case 'lobbyChat':
      if (!isInt(raw.seq) || typeof raw.text !== 'string') return null;
      return { t: 'lobbyChat', seq: raw.seq, text: raw.text };
    case 'command':
      if (!isInt(raw.seq) || !isObj(raw.command) || typeof raw.command.kind !== 'string') return null;
      return { t: 'command', seq: raw.seq, command: raw.command as unknown as HostCommand };
    default:
      return null;
  }
}
