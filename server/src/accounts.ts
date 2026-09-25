import { DurableObject } from 'cloudflare:workers';
import type { FlightResult } from '../../src/net/results';

/**
 * Player accounts (one Durable Object for everyone, SQLite inside): who you are, how you sign in, your passenger and
 * Duty Free bag (so they follow you to any device), and your results by role. The Worker (auth.ts) talks to the sign-in
 * providers and calls these methods.
 *
 * Nothing sensitive is kept in the clear: passwords as PBKDF2 hashes, email addresses as SHA-256 hashes (there is no
 * email service, so they are only ever compared), sessions as hashes of their bearer tokens.
 */

export interface AccountView {
  id: string;
  created: number;
  /** How you sign in: 'email', 'google', 'discord', 'epic', 'steam', with a name to show. */
  logins: { provider: string; label: string }[];
  /** Your passenger ({name, look, face}) and Duty Free bag, as the game last saved them (null until it does). */
  profile: unknown;
  bag: unknown;
  /** Your player token: the game's secret id for you, the same on every device you sign in on. */
  token: string | null;
  /** Flights played and won, by role (custom roles by team: 'custom-passengers', 'custom-saboteurs'). */
  stats: Record<string, { played: number; won: number }>;
}

export type AuthResult = { ok: true; session: string; account: AccountView } | { ok: false; error: string };

const ITERATIONS = 100_000;
const SESSION_MS = 180 * 24 * 60 * 60_000;
const PENDING_MS: Record<string, number> = { oauth: 15 * 60_000, ticket: 3 * 60_000 };
const MAX_PROFILE = 8 * 1024;
const MAX_BAG = 64 * 1024;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

const encoder = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomId(bytes = 24): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(text: string): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, iterations, salt, hash] = stored.split('$');
  if (kind !== 'pbkdf2' || !salt || !hash) return false;
  const expected = unb64(hash);
  const actual = await pbkdf2(password, unb64(salt), Number(iterations));
  return actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
}

/** An email address, as it is kept: hashed. */
function emailKey(email: string): Promise<string> {
  return sha256(`flight13-email:${email.trim().toLowerCase()}`);
}

/** A JSON blob the game saves (profile or bag), if it is small enough. */
function blob(value: unknown, max: number): string | null {
  if (value === undefined || value === null || typeof value !== 'object') return null;
  const text = JSON.stringify(value);
  return text.length <= max ? text : null;
}

type Row = Record<string, SqlStorageValue>;

export class Accounts extends DurableObject {
  private readonly failures = new Map<string, { n: number; since: number }>();

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    void ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, created INTEGER NOT NULL, player_token TEXT UNIQUE, profile TEXT, bag TEXT)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS logins (
        provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL, secret TEXT, label TEXT NOT NULL,
        PRIMARY KEY (provider, subject))`);
      sql.exec(`CREATE INDEX IF NOT EXISTS logins_user ON logins (user_id)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, used INTEGER NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS stats (
        user_id TEXT NOT NULL, role TEXT NOT NULL, played INTEGER NOT NULL, won INTEGER NOT NULL, PRIMARY KEY (user_id, role))`);
      sql.exec(`CREATE TABLE IF NOT EXISTS flights (game TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
    });
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private one(query: string, ...args: SqlStorageValue[]): Row | null {
    return this.sql.exec(query, ...args).toArray()[0] ?? null;
  }

  // ---------- Email and password ----------

  async signup(email: string, password: string, token: string | null, profile: unknown, bag: unknown): Promise<AuthResult> {
    if (typeof email !== 'string' || !EMAIL.test(email.trim()) || email.length > 254) return { ok: false, error: 'That does not look like an email address.' };
    if (typeof password !== 'string' || password.length < 8) return { ok: false, error: 'Use a password of at least 8 characters.' };
    if (password.length > 200) return { ok: false, error: 'That password is too long.' };
    const subject = await emailKey(email);
    if (this.one('SELECT user_id FROM logins WHERE provider = ? AND subject = ?', 'email', subject)) {
      return { ok: false, error: 'There is already an account with that email. Sign in instead.' };
    }
    const secret = await hashPassword(password);
    const userId = this.createUser();
    this.sql.exec('INSERT INTO logins (provider, subject, user_id, secret, label) VALUES (?, ?, ?, ?, ?)', 'email', subject, userId, secret, 'Email');
    this.patch(userId, { token, profile, bag });
    return this.signedIn(userId);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    if (typeof email !== 'string' || typeof password !== 'string') return { ok: false, error: 'Wrong email or password.' };
    const subject = await emailKey(email);
    const now = Date.now();
    const tries = this.failures.get(subject);
    if (tries && now - tries.since < FAILURE_WINDOW_MS && tries.n >= MAX_FAILURES) {
      return { ok: false, error: 'Too many wrong tries. Wait a few minutes, then try again.' };
    }
    const login = this.one('SELECT user_id, secret FROM logins WHERE provider = ? AND subject = ?', 'email', subject);
    if (!login || !(await checkPassword(password, String(login.secret)))) {
      const fresh = !tries || now - tries.since >= FAILURE_WINDOW_MS;
      this.failures.set(subject, fresh ? { n: 1, since: now } : { n: tries.n + 1, since: tries.since });
      return { ok: false, error: 'Wrong email or password.' };
    }
    this.failures.delete(subject);
    return this.signedIn(String(login.user_id));
  }

  // ---------- Google, Discord, Epic Games, Steam (checked with the provider by the Worker first) ----------

  /** Signed in elsewhere as `subject`: find (or make) the account, and give the game a one-time ticket for it. */
  async external(provider: string, subject: string, label: string): Promise<string> {
    const login = this.one('SELECT user_id FROM logins WHERE provider = ? AND subject = ?', provider, subject);
    let userId: string;
    if (login) {
      userId = String(login.user_id);
      this.sql.exec('UPDATE logins SET label = ? WHERE provider = ? AND subject = ?', label, provider, subject);
    } else {
      userId = this.createUser();
      this.sql.exec('INSERT INTO logins (provider, subject, user_id, secret, label) VALUES (?, ?, ?, NULL, ?)', provider, subject, userId, label);
    }
    return this.remember('ticket', userId);
  }

  /** The game hands back its ticket and gets a session. */
  async redeem(ticket: string): Promise<AuthResult> {
    const userId = this.recall('ticket', ticket);
    if (!userId || !this.one('SELECT id FROM users WHERE id = ?', userId)) return { ok: false, error: 'That sign-in link has expired. Try again.' };
    return this.signedIn(userId);
  }

  /** Keep something for a sign-in in progress (an OAuth state, a ticket); returns its id. */
  async remember(kind: string, data: string): Promise<string> {
    const now = Date.now();
    this.sql.exec('DELETE FROM pending WHERE created < ?', now - 60 * 60_000);
    const id = randomId();
    this.sql.exec('INSERT INTO pending (id, kind, data, created) VALUES (?, ?, ?, ?)', id, kind, data, now);
    return id;
  }

  /** Take it back (once), if it has not expired. */
  recall(kind: string, id: string): string | null {
    if (typeof id !== 'string' || id.length > 64) return null;
    const row = this.one('SELECT data, created FROM pending WHERE id = ? AND kind = ?', id, kind);
    this.sql.exec('DELETE FROM pending WHERE id = ?', id);
    if (!row || Date.now() - Number(row.created) > (PENDING_MS[kind] ?? 0)) return null;
    return String(row.data);
  }

  // ---------- Signed in ----------

  async me(session: string): Promise<AccountView | null> {
    const userId = await this.userFor(session);
    return userId ? this.view(userId) : null;
  }

  /** Save your passenger or bag, or give a new account the player token of the device you signed up on. */
  async update(session: string, patch: { profile?: unknown; bag?: unknown; token?: unknown }): Promise<AccountView | null> {
    const userId = await this.userFor(session);
    if (!userId) return null;
    this.patch(userId, patch);
    return this.view(userId);
  }

  async logout(session: string): Promise<void> {
    this.sql.exec('DELETE FROM sessions WHERE hash = ?', await sha256(session));
  }

  /** Delete the account and everything kept about it. */
  async remove(session: string): Promise<boolean> {
    const userId = await this.userFor(session);
    if (!userId) return false;
    for (const table of ['sessions', 'logins', 'stats']) this.sql.exec(`DELETE FROM ${table} WHERE user_id = ?`, userId);
    this.sql.exec('DELETE FROM users WHERE id = ?', userId);
    return true;
  }

  // ---------- Results ----------

  /** A flight the server ran has landed: count it for everyone aboard who has an account (once per flight). */
  async record(game: string, results: FlightResult[]): Promise<void> {
    if (this.one('SELECT game FROM flights WHERE game = ?', game)) return;
    this.sql.exec('INSERT INTO flights (game, at) VALUES (?, ?)', game, Date.now());
    for (const r of results) {
      const user = this.one('SELECT id FROM users WHERE player_token = ?', r.token);
      if (!user) continue;
      this.sql.exec(
        `INSERT INTO stats (user_id, role, played, won) VALUES (?, ?, 1, ?)
         ON CONFLICT (user_id, role) DO UPDATE SET played = played + 1, won = won + excluded.won`,
        String(user.id),
        r.role,
        r.won ? 1 : 0,
      );
    }
  }

  // ---------- Inside ----------

  private createUser(): string {
    const id = randomId(12);
    this.sql.exec('INSERT INTO users (id, created) VALUES (?, ?)', id, Date.now());
    return id;
  }

  private patch(userId: string, patch: { profile?: unknown; bag?: unknown; token?: unknown }): void {
    const profile = blob(patch.profile, MAX_PROFILE);
    if (profile) this.sql.exec('UPDATE users SET profile = ? WHERE id = ?', profile, userId);
    const bag = blob(patch.bag, MAX_BAG);
    if (bag) this.sql.exec('UPDATE users SET bag = ? WHERE id = ?', bag, userId);
    // Only a new account takes a token, and only one nobody else's account has.
    const token = patch.token;
    if (typeof token === 'string' && TOKEN.test(token) && !this.one('SELECT id FROM users WHERE player_token = ?', token)) {
      this.sql.exec('UPDATE users SET player_token = ? WHERE id = ? AND player_token IS NULL', token, userId);
    }
  }

  private async signedIn(userId: string): Promise<AuthResult> {
    const session = randomId(32);
    this.sql.exec('INSERT INTO sessions (hash, user_id, used) VALUES (?, ?, ?)', await sha256(session), userId, Date.now());
    return { ok: true, session, account: this.view(userId) };
  }

  private async userFor(session: string): Promise<string | null> {
    if (typeof session !== 'string' || session.length < 20 || session.length > 80) return null;
    const hash = await sha256(session);
    const row = this.one('SELECT user_id, used FROM sessions WHERE hash = ?', hash);
    if (!row) return null;
    const now = Date.now();
    if (now - Number(row.used) > SESSION_MS) {
      this.sql.exec('DELETE FROM sessions WHERE hash = ?', hash);
      return null;
    }
    if (now - Number(row.used) > 24 * 60 * 60_000) this.sql.exec('UPDATE sessions SET used = ? WHERE hash = ?', now, hash);
    return String(row.user_id);
  }

  private view(userId: string): AccountView {
    const user = this.one('SELECT * FROM users WHERE id = ?', userId);
    const logins = this.sql.exec('SELECT provider, label FROM logins WHERE user_id = ?', userId).toArray();
    const stats: AccountView['stats'] = {};
    for (const row of this.sql.exec('SELECT role, played, won FROM stats WHERE user_id = ?', userId).toArray()) {
      stats[String(row.role)] = { played: Number(row.played), won: Number(row.won) };
    }
    return {
      id: userId,
      created: Number(user?.created ?? 0),
      logins: logins.map((l) => ({ provider: String(l.provider), label: String(l.label) })),
      profile: user?.profile ? JSON.parse(String(user.profile)) : null,
      bag: user?.bag ? JSON.parse(String(user.bag)) : null,
      token: user?.player_token ? String(user.player_token) : null,
      stats,
    };
  }
}
