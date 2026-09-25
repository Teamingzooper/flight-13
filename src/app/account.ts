import { useEffect, useState } from 'preact/hooks';
import { cleanBag } from '../meta/bag';
import { getBag, subscribeBag, updateBag } from '../meta/store';
import { cleanFace } from '../net/face';
import { cleanLook, cleanName } from '../net/protocol';
import { relayHttpUrl } from '../net/relay';
import { loadProfile, onProfileSaved, saveProfile } from './profile';

/**
 * Your Flight 13 account, kept on the game server (server/src/accounts.ts): sign in with email, Google, Discord, Steam
 * or Epic Games, and your passenger, Duty Free bag and results by role follow you to every device you sign in on.
 *
 * Signing in on a device takes the account's player token (so your seats come with you) and its passenger and bag;
 * whatever the account does not have yet, it takes from the device. Changes you make are sent up as you make them.
 */

export interface Account {
  id: string;
  created: number;
  logins: { provider: string; label: string }[];
  /** Flights played and won, by role ('custom-passengers', 'custom-saboteurs' for roles made up for a flight). */
  stats: Record<string, { played: number; won: number }>;
  token: string | null;
  profile: unknown;
  bag: unknown;
}

export type Provider = 'email' | 'google' | 'discord' | 'steam' | 'epic';

export const PROVIDER_NAMES: Record<Provider, string> = {
  email: 'Email',
  google: 'Google',
  discord: 'Discord',
  steam: 'Steam',
  epic: 'Epic Games',
};

/** `?p=2` gives a tab its own identity (see profile.ts), and its own sign-in. */
const SLOT = typeof location === 'undefined' ? '' : (new URLSearchParams(location.search).get('p') ?? '');
const SESSION_KEY = `flight13.session${SLOT ? `.${SLOT}` : ''}`;
const PUSH_MS = 1500;

interface State {
  account: Account | null;
  /** The server has answered at least once (or there is no session to ask about). */
  checked: boolean;
}

let state: State = { account: null, checked: false };
const listeners = new Set<(s: State) => void>();

function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const fn of [...listeners]) fn(state);
}

function session(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function keepSession(value: string | null): void {
  try {
    if (value) localStorage.setItem(SESSION_KEY, value);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Signed in for this page only.
  }
}

/** Accounts live on the game server: builds without one have none. */
export function accountsAvailable(): boolean {
  return relayHttpUrl() !== null;
}

type Answer = { ok: true; account?: Account; session?: string; providers?: Provider[] } | { ok: false; error: string };

async function call(path: string, init: RequestInit = {}): Promise<Answer & { status: number }> {
  const base = relayHttpUrl();
  if (!base) return { ok: false, error: 'Accounts need the game server.', status: 0 };
  const token = session();
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const body = (await res.json()) as Answer;
    return { ...body, status: res.status };
  } catch {
    return { ok: false, error: 'Could not reach the Flight 13 server. Check your connection.', status: 0 };
  }
}

// ---------- Keeping the account and this device in step ----------

let pending: { profile?: unknown; bag?: unknown } = {};
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let adopting = false;

function push(now = false): void {
  if (!state.account || (!pending.profile && !pending.bag)) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  const send = () => {
    const body = JSON.stringify(pending);
    pending = {};
    void call('/me', { method: 'PUT', body, keepalive: body.length < 60_000 });
  };
  if (now) send();
  else pushTimer = setTimeout(send, PUSH_MS);
}

/** The account's passenger, bag and token become this device's; it gets whatever it does not have yet. */
function adopt(account: Account): void {
  const local = loadProfile();
  let next = local;
  if (account.token && account.token !== local.token) next = { ...next, token: account.token };
  const p = account.profile as { name?: unknown; look?: unknown; face?: unknown } | null;
  if (p && typeof p === 'object') next = { ...next, name: cleanName(p.name), look: cleanLook(p.look), face: cleanFace(p.face) };
  if (next !== local) saveProfile(next, true);
  if (account.bag) {
    adopting = true;
    updateBag(() => cleanBag(account.bag));
    adopting = false;
  }
  const missing: Record<string, unknown> = {};
  if (!account.token) missing.token = local.token;
  if (!p) missing.profile = { name: next.name, look: next.look, face: next.face };
  if (!account.bag) missing.bag = getBag();
  set({ account, checked: true });
  if (Object.keys(missing).length > 0) {
    void call('/me', { method: 'PUT', body: JSON.stringify(missing) }).then((r) => {
      if (r.ok && r.account) set({ account: r.account });
    });
  }
}

let started = false;

/** Start keeping this device and your account in step (once, when the app starts). */
export function startAccountSync(): void {
  if (started || !accountsAvailable()) return;
  started = true;
  onProfileSaved((profile) => {
    pending.profile = { name: profile.name, look: profile.look, face: profile.face };
    push();
  });
  subscribeBag((bag) => {
    if (adopting) return;
    pending.bag = bag;
    push();
  });
  addEventListener('pagehide', () => push(true));
  void refreshAccount();
}

/** Ask the server who you are (and take your latest passenger and bag from it). */
export async function refreshAccount(): Promise<void> {
  if (!session()) {
    set({ account: null, checked: true });
    return;
  }
  const r = await call('/me');
  if (r.ok && r.account) adopt(r.account);
  else {
    // Signed out elsewhere, or the session expired (a network error keeps you signed in).
    if (r.status === 401) keepSession(null);
    set({ account: null, checked: true });
  }
}

function signedIn(r: Answer): string | null {
  if (!r.ok) return r.error;
  if (!r.session || !r.account) return 'Something went wrong. Try again.';
  keepSession(r.session);
  adopt(r.account);
  return null;
}

/** Sign in or make an account with email and password; returns an error to show, or null. */
export async function emailSignIn(mode: 'login' | 'signup', email: string, password: string): Promise<string | null> {
  const profile = loadProfile();
  const body =
    mode === 'signup'
      ? { email, password, token: profile.token, profile: { name: profile.name, look: profile.look, face: profile.face }, bag: getBag() }
      : { email, password };
  return signedIn(await call(`/auth/email/${mode}`, { method: 'POST', body: JSON.stringify(body) }));
}

/** Off to Google, Discord, Steam or Epic Games; they send you back to #/account with a ticket. */
export function startSignIn(provider: Exclude<Provider, 'email'>): void {
  const base = relayHttpUrl();
  if (!base) return;
  const back = `${location.origin}${location.pathname}${location.search}`;
  location.href = `${base}/auth/${provider}/start?return=${encodeURIComponent(back)}`;
}

/** Back from a provider with a one-time ticket: swap it for a session. */
export async function redeemTicket(ticket: string): Promise<string | null> {
  return signedIn(await call('/auth/ticket', { method: 'POST', body: JSON.stringify({ ticket }) }));
}

/** The sign-in methods this server offers. */
export async function signInMethods(): Promise<Provider[]> {
  const r = await call('/auth/providers');
  return r.ok && r.providers ? r.providers : ['email'];
}

export async function signOut(): Promise<void> {
  push(true);
  await call('/auth/logout', { method: 'POST' });
  keepSession(null);
  set({ account: null, checked: true });
}

/** Delete your account on the server (this device keeps its passenger and bag). */
export async function deleteAccount(): Promise<string | null> {
  const r = await call('/me', { method: 'DELETE' });
  if (!r.ok) return r.error;
  keepSession(null);
  set({ account: null, checked: true });
  return null;
}

export function useAccount(): State {
  const [s, setS] = useState(state);
  useEffect(() => {
    setS(state);
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);
  return s;
}
