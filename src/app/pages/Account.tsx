import { useEffect, useState } from 'preact/hooks';
import { ROLES, teamOf, type RoleId, type Team } from '../../engine';
import {
  PROVIDER_NAMES,
  accountsAvailable,
  deleteAccount,
  emailSignIn,
  redeemTicket,
  signInMethods,
  signOut,
  startSignIn,
  useAccount,
  type Account,
  type Provider,
} from '../account';
import { Notice } from '../Notice';
import { navigate } from '../router';

/** Your account: sign in (or make one), and your results by role. Providers send you back here with a ticket. */
export function AccountPage({ ticket, error: returned }: { ticket?: string; error?: string }) {
  const { account, checked } = useAccount();
  const [error, setError] = useState<string | null>(returned ?? null);
  const [redeeming, setRedeeming] = useState(!!ticket);

  useEffect(() => {
    // The ticket and the error in the address are used once: a reload should not try them again.
    if (ticket || returned) history.replaceState(null, '', '#/account');
    if (!ticket) return;
    void redeemTicket(ticket).then((problem) => {
      setError(problem);
      setRedeeming(false);
    });
  }, []);

  if (!accountsAvailable()) {
    return (
      <Notice title="No accounts here">
        <p>This copy of Flight 13 has no game server, so there are no accounts to sign in to.</p>
      </Notice>
    );
  }

  return (
    <div class="page account-page">
      <header class="page-head">
        <button class="btn ghost small" onClick={() => navigate('/')}>
          ← Terminal
        </button>
        <h1>Your account</h1>
        <p class="muted">Your passenger, your Duty Free bag and your results by role, on every device you sign in on.</p>
      </header>
      {error && <p class="error-text">{error}</p>}
      {redeeming || !checked ? (
        <p class="muted">Signing you in…</p>
      ) : account ? (
        <SignedIn account={account} />
      ) : (
        <SignIn onError={setError} />
      )}
    </div>
  );
}

function SignIn({ onError }: { onError: (e: string | null) => void }) {
  const [methods, setMethods] = useState<Provider[] | null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void signInMethods().then(setMethods);
  }, []);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    onError(await emailSignIn(mode, email, password));
    setBusy(false);
  };
  const others = (methods ?? []).filter((m): m is Exclude<Provider, 'email'> => m !== 'email');
  return (
    <div class="account-grid">
      <section class="panel">
        <h2>Sign in</h2>
        {others.length > 0 && (
          <div class="provider-list">
            {others.map((p) => (
              <button key={p} class={`btn provider provider-${p}`} onClick={() => startSignIn(p)}>
                Continue with {PROVIDER_NAMES[p]}
              </button>
            ))}
          </div>
        )}
        <form class="email-form" onSubmit={submit}>
          <div class="segmented" role="group" aria-label="Sign in or make an account">
            <button type="button" class={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
              I have an account
            </button>
            <button type="button" class={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>
              New account
            </button>
          </div>
          <label class="field">
            <span class="label">Email</span>
            <input class="input" type="email" autocomplete="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span class="label">Password</span>
            <input
              class="input"
              type="password"
              autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 8 : undefined}
              required
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </label>
          <button class="btn primary" type="submit" disabled={busy}>
            {mode === 'login' ? 'Sign in' : 'Make my account'}
          </button>
          <small class="hint">
            {mode === 'signup'
              ? 'Your passenger, bag and seat on this device become your account’s. Your email is only kept scrambled, so it cannot be used to reset a forgotten password: pick one you will remember.'
              : 'Signing in brings your passenger and Duty Free bag to this device.'}
          </small>
        </form>
      </section>
      <section class="panel">
        <h2>Why sign in?</h2>
        <ul class="plain-list">
          <li>Play as the same passenger on your laptop, phone and TV.</li>
          <li>Your Duty Free credits and items come with you.</li>
          <li>See how often you win as each role.</li>
        </ul>
      </section>
    </div>
  );
}

const TEAM_NAMES: Record<Team, string> = { passengers: 'Passengers', saboteurs: 'Saboteurs' };

function roleName(role: string): { name: string; team: Team | null } {
  if (role === 'custom-passengers') return { name: 'Custom roles (passengers)', team: 'passengers' };
  if (role === 'custom-saboteurs') return { name: 'Custom roles (saboteurs)', team: 'saboteurs' };
  const info = ROLES[role as RoleId];
  return info ? { name: info.name, team: teamOf(role as RoleId) } : { name: role, team: null };
}

const percent = (won: number, played: number) => (played > 0 ? Math.round((won / played) * 100) : 0);

function SignedIn({ account }: { account: Account }) {
  const [sure, setSure] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const rows = Object.entries(account.stats)
    .map(([role, s]) => ({ role, ...s, ...roleName(role) }))
    .sort((a, b) => b.played - a.played || a.name.localeCompare(b.name));
  const total = rows.reduce((t, r) => ({ played: t.played + r.played, won: t.won + r.won }), { played: 0, won: 0 });
  const byTeam = (team: Team) => rows.filter((r) => r.team === team).reduce((t, r) => ({ played: t.played + r.played, won: t.won + r.won }), { played: 0, won: 0 });
  return (
    <div class="account-grid">
      <section class="panel">
        <h2>Signed in</h2>
        <ul class="plain-list">
          {account.logins.map((l) => (
            <li key={l.provider}>
              <b>{PROVIDER_NAMES[l.provider as Provider] ?? l.provider}</b>
              {l.label && l.label !== PROVIDER_NAMES[l.provider as Provider] ? ` · ${l.label}` : ''}
            </li>
          ))}
        </ul>
        <p class="muted">Account since {new Date(account.created).toLocaleDateString()}.</p>
        <div class="row">
          <button class="btn" onClick={() => void signOut()}>
            Sign out
          </button>
          {sure ? (
            <button
              class="btn danger"
              onClick={() =>
                void deleteAccount().then((e) => {
                  setProblem(e);
                  setSure(false);
                })
              }
            >
              Delete it for good?
            </button>
          ) : (
            <button class="btn ghost" onClick={() => setSure(true)}>
              Delete account
            </button>
          )}
        </div>
        {problem && <p class="error-text">{problem}</p>}
      </section>
      <section class="panel stats-panel">
        <h2>Your flights</h2>
        {total.played === 0 ? (
          <p class="muted">No flights yet. Results count from flights run by the game server (not the tutorial).</p>
        ) : (
          <>
            <div class="stat-totals">
              <Stat label="Flights" value={String(total.played)} />
              <Stat label="Won" value={`${percent(total.won, total.played)}%`} />
              {(['passengers', 'saboteurs'] as const).map((team) => {
                const t = byTeam(team);
                return t.played > 0 ? <Stat key={team} label={`As ${TEAM_NAMES[team].toLowerCase()}`} value={`${percent(t.won, t.played)}%`} /> : null;
              })}
            </div>
            <table class="stats-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Played</th>
                  <th>Won</th>
                  <th>Win rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.role}>
                    <td>
                      <span class={`team-dot ${r.team ?? ''}`} aria-hidden="true" />
                      {r.name}
                    </td>
                    <td>{r.played}</td>
                    <td>{r.won}</td>
                    <td>
                      <span class="rate">
                        <span class="rate-bar" style={{ width: `${percent(r.won, r.played)}%` }} />
                        <span class="rate-text">{percent(r.won, r.played)}%</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div class="stat">
      <span class="stat-value">{value}</span>
      <span class="label">{label}</span>
    </div>
  );
}
