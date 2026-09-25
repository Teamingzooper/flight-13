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
import { isEmoteId, type EmoteId } from './emotes';
import { cleanFace } from './face';

export const PROTOCOL_VERSION = 1;
export const NAME_MAX_LENGTH = 16;

/** Options per look slot; the avatar and 3D palettes are sized to match. */
export const LOOK_LIMITS: Readonly<Record<keyof Look, number>> = { body: 3, skin: 8, hair: 10, hairColor: 12, top: 12, topStyle: 4, bottom: 8 };

export interface LobbyPlayer {
  id: string;
  name: string;
  look: Look;
  bot: boolean;
  connected: boolean;
  host: boolean;
}

/** Where a passenger is looking, and whether they are using their screen. Not secret. */
export interface Pose {
  yaw: number;
  pitch: number;
  lean: boolean;
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
  /** Who has voice chat on: network peer id → player id (for matching incoming voices to people). */
  voice?: Record<string, string>;
  /** The Pilot while he is talking on the PA (everyone hears him, through the cabin speakers). */
  pa?: string | null;
}

export type HostCommand =
  | { kind: 'settings'; settings: Settings }
  | { kind: 'takeoff' }
  | { kind: 'kick'; playerId: string }
  | { kind: 'addBot' }
  | { kind: 'boardAgain' };

export type ClientMessage =
  | { t: 'join'; v: number; token: string; name: string; look: Look; face: string; tower: boolean }
  | { t: 'intent'; seq: number; intent: Intent }
  | { t: 'lobbyChat'; seq: number; text: string }
  | { t: 'command'; seq: number; command: HostCommand }
  | { t: 'pose'; yaw: number; pitch: number; lean: boolean }
  /** A gesture for everyone to see (daytime only; the host checks). */
  | { t: 'emote'; emote: EmoteId }
  /** You turned voice chat on or off. */
  | { t: 'voice'; on: boolean }
  /** The Pilot pressed (or let go of) the PA button. */
  | { t: 'pa'; on: boolean };

export type HostMessage =
  | { t: 'hello'; v: number; code: string }
  | { t: 'state'; state: ClientState }
  | { t: 'ack'; seq: number; ok: boolean; error?: string }
  | { t: 'refused'; reason: string }
  /** Everyone's latest pose: player id → [yaw, pitch, lean 0/1]. */
  | { t: 'poses'; poses: Record<string, [number, number, number]> }
  /** Everyone's painted face (player id → face text); sent on joining and whenever one changes. */
  | { t: 'faces'; faces: Record<string, string> }
  /** Someone gestured. */
  | { t: 'emote'; from: string; emote: EmoteId };

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
  // Before top styles existed, the top's colour decided the sleeves (colours 4-7 were T-shirts).
  const topStyle = isInt(src.topStyle) ? slot('topStyle') : isInt(src.top) && src.top >= 4 && src.top < 8 ? 1 : 0;
  return {
    body: slot('body'),
    skin: slot('skin'),
    hair: slot('hair'),
    hairColor: slot('hairColor'),
    top: slot('top'),
    topStyle,
    bottom: slot('bottom'),
  };
}

export function randomLook(random: () => number): Look {
  const r = (key: keyof Look) => Math.floor(random() * LOOK_LIMITS[key]);
  return {
    body: r('body'),
    skin: r('skin'),
    hair: r('hair'),
    hairColor: r('hairColor'),
    top: r('top'),
    topStyle: r('topStyle'),
    bottom: r('bottom'),
  };
}

/** Rebuild Settings from untrusted input, keeping only known fields (validate separately). */
export function cleanSettings(raw: unknown): Settings | null {
  if (!isObj(raw) || !isObj(raw.cards)) return null;
  const cards = {} as Cards;
  for (const card of SPECIAL_CARDS) {
    // Cards added in later versions may be missing from older clients: treat them as none.
    const v = raw.cards[card] ?? 0;
    if (!isInt(v) || v < 0 || v > 16) return null;
    cards[card] = v;
  }
  const { destination, maxPassengers, rolesMode, stewardessRogueChance, timers, revealRoles, voteMode, anonymousVotes, whispers } = raw;
  const pilotMustFly = raw.pilotMustFly ?? false;
  const pilotRogueChance = raw.pilotRogueChance ?? 0.3;
  if (typeof destination !== 'string' || !(destination in DESTINATIONS)) return null;
  if (!isInt(maxPassengers)) return null;
  if (rolesMode !== 'auto' && rolesMode !== 'custom') return null;
  if (typeof stewardessRogueChance !== 'number') return null;
  if (typeof timers !== 'string' || !(timers in TIMERS)) return null;
  if (voteMode !== 'daily' && voteMode !== 'afterIncident') return null;
  if (typeof revealRoles !== 'boolean' || typeof anonymousVotes !== 'boolean' || typeof whispers !== 'boolean') return null;
  if (typeof pilotMustFly !== 'boolean') return null;
  if (typeof pilotRogueChance !== 'number') return null;
  return {
    destination: destination as Settings['destination'],
    maxPassengers,
    rolesMode,
    cards,
    stewardessRogueChance,
    pilotRogueChance,
    timers: timers as Settings['timers'],
    revealRoles,
    voteMode,
    anonymousVotes,
    whispers,
    pilotMustFly,
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
        face: cleanFace(raw.face),
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
    case 'pose': {
      const { yaw, pitch } = raw;
      if (typeof yaw !== 'number' || typeof pitch !== 'number' || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
      return {
        t: 'pose',
        yaw: Math.max(-Math.PI, Math.min(Math.PI, yaw)),
        pitch: Math.max(-1.3, Math.min(1.3, pitch)),
        lean: raw.lean === true,
      };
    }
    case 'emote':
      return isEmoteId(raw.emote) ? { t: 'emote', emote: raw.emote } : null;
    case 'voice':
      return typeof raw.on === 'boolean' ? { t: 'voice', on: raw.on } : null;
    case 'pa':
      return typeof raw.on === 'boolean' ? { t: 'pa', on: raw.on } : null;
    default:
      return null;
  }
}
