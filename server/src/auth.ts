import type { Accounts, AuthResult } from './accounts';

/**
 * Sign-in and account routes. Email and password work out of the box, and so does Steam (OpenID 2.0, no keys needed).
 * Google, Discord and Epic Games appear once the server has the provider's app credentials, set by the owner with
 * `npx wrangler secret put GOOGLE_CLIENT_ID` (and _CLIENT_SECRET; likewise DISCORD_, EPIC_). See the README.
 *
 * POST /auth/email/signup {email, password, token?, profile?, bag?}  ·  POST /auth/email/login {email, password}
 * GET /auth/:provider/start?return=URL → the provider → /auth/:provider/callback → URL#/account?ticket=…
 * POST /auth/ticket {ticket}  ·  POST /auth/logout  ·  GET|PUT|DELETE /me   (signed in: Authorization: Bearer <session>)
 */

export interface AuthEnv {
  ACCOUNTS: DurableObjectNamespace<Accounts>;
  /** Where sign-ins may return to (the game's origins), comma separated. */
  ALLOWED_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  EPIC_CLIENT_ID?: string;
  EPIC_CLIENT_SECRET?: string;
  /** Optional: shows your Steam name instead of just "Steam". */
  STEAM_API_KEY?: string;
}

type Identity = { subject: string; label: string };

interface OAuthProvider {
  name: string;
  authorize: string;
  token: string;
  scope: string;
  /** The token endpoint wants the app's credentials as HTTP Basic auth (Epic) rather than in the form. */
  basic?: boolean;
  extra?: Record<string, string>;
  who(access: string, token: Record<string, unknown>): Promise<Identity>;
}

async function getJson(url: string, access: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${access}`, 'user-agent': 'Flight13' } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

const str = (x: unknown, fallback = ''): string => (typeof x === 'string' && x ? x : fallback);

const OAUTH: Record<string, OAuthProvider> = {
  google: {
    name: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid profile',
    extra: { prompt: 'select_account' },
    async who(access) {
      const me = await getJson('https://openidconnect.googleapis.com/v1/userinfo', access);
      return { subject: str(me.sub), label: str(me.given_name, str(me.name, 'Google')) };
    },
  },
  discord: {
    name: 'Discord',
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    scope: 'identify',
    async who(access) {
      const me = await getJson('https://discord.com/api/users/@me', access);
      return { subject: str(me.id), label: str(me.global_name, str(me.username, 'Discord')) };
    },
  },
  epic: {
    name: 'Epic Games',
    authorize: 'https://www.epicgames.com/id/authorize',
    token: 'https://api.epicgames.dev/epic/oauth/v2/token',
    scope: 'basic_profile',
    basic: true,
    async who(access, token) {
      const subject = str(token.account_id);
      try {
        const me = await getJson('https://api.epicgames.dev/epic/oauth/v2/userInfo', access);
        return { subject: subject || str(me.sub), label: str(me.preferred_username, 'Epic Games') };
      } catch {
        return { subject, label: 'Epic Games' };
      }
    },
  },
};

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const STEAM_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const DEFAULT_ORIGINS = 'https://teamingzooper.github.io,http://localhost:5173,http://127.0.0.1:5173';

function credentials(env: AuthEnv, provider: string): { id: string; secret: string } | null {
  const key = provider.toUpperCase() as 'GOOGLE' | 'DISCORD' | 'EPIC';
  const id = env[`${key}_CLIENT_ID`];
  const secret = env[`${key}_CLIENT_SECRET`];
  return id && secret ? { id, secret } : null;
}

/** The sign-in methods this server offers. */
export function providers(env: AuthEnv): string[] {
  return ['email', 'steam', ...Object.keys(OAUTH).filter((p) => credentials(env, p))];
}

function accounts(env: AuthEnv): DurableObjectStub<Accounts> {
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'));
}

/** Where a sign-in may send you back to: a page of the game itself. */
function allowedReturn(env: AuthEnv, raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const origins = (env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS).split(',').map((o) => o.trim());
    if (!origins.includes(url.origin)) return null;
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function back(to: string, params: Record<string, string>): Response {
  return Response.redirect(`${to}#/account?${new URLSearchParams(params)}`, 302);
}

function bearer(request: Request): string {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
}

/** Handle an /auth or /me request; null if it is not one. `json` adds the CORS headers. */
export async function handleAuth(request: Request, env: AuthEnv, json: (body: unknown, status?: number) => Response): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const store = accounts(env);
  const answer = (result: AuthResult) => json(result, result.ok ? 200 : 400);
  const body = async (): Promise<Record<string, unknown>> => {
    try {
      const b: unknown = await request.json();
      return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  if (path === '/auth/providers' && method === 'GET') return json({ ok: true, providers: providers(env) });
  if (path === '/auth/email/signup' && method === 'POST') {
    const b = await body();
    return answer(await store.signup(str(b.email), str(b.password), typeof b.token === 'string' ? b.token : null, b.profile, b.bag));
  }
  if (path === '/auth/email/login' && method === 'POST') {
    const b = await body();
    return answer(await store.login(str(b.email), str(b.password)));
  }
  if (path === '/auth/ticket' && method === 'POST') return answer(await store.redeem(str((await body()).ticket)));
  if (path === '/auth/logout' && method === 'POST') {
    await store.logout(bearer(request));
    return json({ ok: true });
  }
  if (path === '/me') {
    const session = bearer(request);
    if (method === 'GET') {
      const account = await store.me(session);
      return account ? json({ ok: true, account }) : json({ ok: false, error: 'Signed out.' }, 401);
    }
    if (method === 'PUT') {
      const b = await body();
      const account = await store.update(session, { profile: b.profile, bag: b.bag, token: b.token });
      return account ? json({ ok: true, account }) : json({ ok: false, error: 'Signed out.' }, 401);
    }
    if (method === 'DELETE') return (await store.remove(session)) ? json({ ok: true }) : json({ ok: false, error: 'Signed out.' }, 401);
  }

  const route = path.match(/^\/auth\/(google|discord|epic|steam)\/(start|callback)$/);
  if (!route || method !== 'GET') return null;
  const [, provider, step] = route;
  const callback = `${url.origin}/auth/${provider}/callback`;

  if (step === 'start') {
    const to = allowedReturn(env, url.searchParams.get('return'));
    if (!to) return new Response('Sign-in must start from the game.', { status: 400 });
    const state = await store.remember('oauth', JSON.stringify({ provider, to }));
    if (provider === 'steam') {
      const params = new URLSearchParams({
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'checkid_setup',
        'openid.return_to': `${callback}?state=${state}`,
        'openid.realm': url.origin,
        'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
        'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
      });
      return Response.redirect(`${STEAM_OPENID}?${params}`, 302);
    }
    const app = credentials(env, provider);
    const oauth = OAUTH[provider];
    if (!app) return back(to, { error: `${oauth.name} sign-in is not set up on this server yet.` });
    const params = new URLSearchParams({ client_id: app.id, redirect_uri: callback, response_type: 'code', scope: oauth.scope, state, ...oauth.extra });
    return Response.redirect(`${oauth.authorize}?${params}`, 302);
  }

  // The provider sent you back.
  const saved = await store.recall('oauth', url.searchParams.get('state') ?? '');
  const { provider: started, to } = saved ? (JSON.parse(saved) as { provider: string; to: string }) : { provider: '', to: '' };
  if (!to || started !== provider) return new Response('This sign-in has expired. Go back to the game and try again.', { status: 400 });
  try {
    const who = provider === 'steam' ? await steamIdentity(url, callback, env) : await oauthIdentity(provider, url, callback, env);
    if (!who) return back(to, { error: 'Sign-in was cancelled.' });
    return back(to, { ticket: await store.external(provider, who.subject, who.label) });
  } catch {
    return back(to, { error: 'Sign-in did not work. Try again.' });
  }
}

async function oauthIdentity(provider: string, url: URL, callback: string, env: AuthEnv): Promise<Identity | null> {
  const code = url.searchParams.get('code');
  const app = credentials(env, provider);
  if (!code || !app) return null;
  const oauth = OAUTH[provider];
  const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callback });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (oauth.basic) headers.authorization = `Basic ${btoa(`${app.id}:${app.secret}`)}`;
  else {
    form.set('client_id', app.id);
    form.set('client_secret', app.secret);
  }
  const res = await fetch(oauth.token, { method: 'POST', headers, body: form });
  if (!res.ok) throw new Error(`token: ${res.status}`);
  const token = (await res.json()) as Record<string, unknown>;
  const access = str(token.access_token);
  if (!access) throw new Error('no access token');
  const who = await oauth.who(access, token);
  if (!who.subject) throw new Error('no subject');
  return who;
}

/** Steam's OpenID 2.0: ask Steam whether it really signed this answer, and read the Steam id from it. */
async function steamIdentity(url: URL, callback: string, env: AuthEnv): Promise<Identity | null> {
  const q = url.searchParams;
  if (q.get('openid.mode') !== 'id_res') return null;
  if (q.get('openid.op_endpoint') !== STEAM_OPENID || !q.get('openid.return_to')?.startsWith(callback)) throw new Error('not from Steam');
  const id = q.get('openid.claimed_id')?.match(STEAM_ID)?.[1];
  if (!id) throw new Error('no Steam id');
  const check = new URLSearchParams();
  for (const [key, value] of q) if (key.startsWith('openid.')) check.set(key, value);
  check.set('openid.mode', 'check_authentication');
  const res = await fetch(STEAM_OPENID, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: check });
  if (!/is_valid\s*:\s*true/.test(await res.text())) throw new Error('Steam did not confirm');
  let label = 'Steam';
  if (env.STEAM_API_KEY) {
    try {
      const summary = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${env.STEAM_API_KEY}&steamids=${id}`);
      const players = ((await summary.json()) as { response?: { players?: { personaname?: string }[] } }).response?.players;
      label = str(players?.[0]?.personaname, label);
    } catch {
      // Just "Steam".
    }
  }
  return { subject: id, label };
}
