import type { Look } from '../engine';
import { cleanFace } from '../net/face';
import { cleanLook, randomLook } from '../net/protocol';

export interface Profile {
  token: string;
  name: string;
  look: Look;
  /** Painted face ('' for the plain one). */
  face: string;
}

/** `?p=2` gives a tab its own identity, so one browser can test several passengers. */
const SLOT = new URLSearchParams(location.search).get('p') ?? '';
const PROFILE_KEY = `flight13.profile${SLOT ? `.${SLOT}` : ''}`;
const LAST_KEY = `flight13.last${SLOT ? `.${SLOT}` : ''}`;

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function loadProfile(): Profile {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Partial<Profile> | null;
    if (raw && typeof raw.token === 'string' && raw.token.length >= 16) {
      return { token: raw.token, name: typeof raw.name === 'string' ? raw.name : '', look: cleanLook(raw.look), face: cleanFace(raw.face) };
    }
  } catch {
    // Corrupt or blocked storage: start fresh.
  }
  const fresh: Profile = { token: randomToken(), name: '', look: randomLook(Math.random), face: '' };
  saveProfile(fresh);
  return fresh;
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Storage unavailable: the profile lives for this page only.
  }
}

export function rememberFlight(code: string): void {
  try {
    localStorage.setItem(LAST_KEY, code);
  } catch {
    // Not important enough to surface.
  }
}

export function lastFlight(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
