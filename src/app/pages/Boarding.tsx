import { useEffect, useRef, useState } from 'preact/hooks';
import { CHAT_MAX_LENGTH, ROLES, checkTakeoff, customRoleId, destinationOf, type IntentResult, type RoleId } from '../../engine';
import { TutorialCoach } from '../../tutorial/Coach';
import { formatCode } from '../../net/code';
import type { ClientState } from '../../net/protocol';
import { Avatar } from '../Avatar';
import { useToast } from '../hooks';
import { NetworkNote, useNetwork } from '../Notice';
import { loadProfile, saveProfile, type Profile } from '../profile';
import { ProfileEditor } from '../ProfileEditor';
import { MoveDevice } from '../MoveDevice';
import { VoiceButton } from '../../tv/VoiceButton';
import { SettingsPanel } from '../SettingsPanel';
import { flightLink, navigate } from '../router';
import { endFlight, type OpenFlight } from '../sessions';
import { SettingsForm, describeRules } from '../SettingsForm';

/** What the host can pick for themselves, by team. */
const ROLE_CHOICES: { team: string; roles: RoleId[] }[] = [
  { team: 'Passengers', roles: ['passenger', 'nurse', 'investigator', 'marshal', 'stewardess_loyal', 'pilot'] },
  { team: 'Saboteurs', roles: ['bomber', 'mastermind', 'stewardess_rogue', 'pilot_rogue'] },
];

export function Boarding({ flight, state }: { flight: OpenFlight; state: ClientState }) {
  const { client } = flight;
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filling, setFilling] = useState(false);
  /** Every empty seat gets a bot, all at once. */
  const fillWithBots = async () => {
    setFilling(true);
    const empty = state.settings.maxPassengers - state.players.length;
    const results = await Promise.all(Array.from({ length: empty }, () => client.command({ kind: 'addBot' })));
    setFilling(false);
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) showToast(failed.error);
  };
  const [toast, showToast] = useToast();
  const network = useNetwork();
  const run = async (request: Promise<IntentResult>) => {
    const result = await request;
    if (!result.ok) showToast(result.error);
  };
  const dest = destinationOf(state.settings);
  // The host's own roles in this flight's deck can be picked too.
  const ownRoles =
    state.settings.rolesMode === 'custom' ? state.settings.customRoles.map((def, i) => ({ def, id: customRoleId(i, def.team) })).filter(({ def }) => def.count > 0) : [];
  const me = state.players.find((p) => p.id === state.you) ?? null;
  const takeoffError = checkTakeoff(
    state.settings,
    state.players.map(({ id, name, look }) => ({ id, name, look })),
  );

  if (editing && state.isHost) {
    return (
      <div class="page">
        <header class="page-head">
          <button class="btn ghost small" onClick={() => setEditing(false)}>
            ← Back to the gate
          </button>
          <h1>Flight settings</h1>
        </header>
        <SettingsForm
          initial={state.settings}
          submitLabel="Save changes"
          playerCount={state.players.length}
          onSubmit={async (settings) => {
            const result = await client.command({ kind: 'settings', settings });
            if (result.ok) setEditing(false);
            return result.ok ? null : result.error;
          }}
        />
      </div>
    );
  }

  return (
    <div class="page boarding">
      <TutorialCoach state={state} className="lobby-coach" />
      <header class="gate">
        <div class="gate-info">
          <div class="label">Now boarding · Gate 13</div>
          <h1 class="flight-no">{formatCode(state.code)}</h1>
          <div class="route">
            <span>Destination</span>
            <b>{dest.city}</b>
            <span class="muted">
              {dest.code} · {dest.nights} nights
            </span>
          </div>
          <p class="muted">{dest.blurb}</p>
        </div>
        <div class="stack">
          <ShareBox code={state.code} />
          <NetworkNote kind={network} />
        </div>
      </header>

      <div class="boarding-grid">
        <section class="panel">
          <div class="panel-head">
            <h2>Passenger manifest</h2>
            <span class="muted">
              {state.players.length} / {state.settings.maxPassengers} seats
            </span>
          </div>
          <ul class="manifest">
            {state.players.map((p) => (
              <li key={p.id} class={p.connected ? '' : 'offline'}>
                <Avatar look={p.look} face={client.faces.get(p.id)} size={38} dim={!p.connected} />
                <span class="name">{p.name}</span>
                <span class="tags">
                  {p.host && <span class="badge amber">Host</span>}
                  {p.bot && <span class="badge">Bot</span>}
                  {p.id === state.you && <span class="badge cyan">You</span>}
                  {!p.connected && <span class="badge red">Offline</span>}
                </span>
                {state.isHost && !p.host && !state.tutorial && (
                  <button class="btn ghost tiny" onClick={() => run(client.command({ kind: 'kick', playerId: p.id }))}>
                    Remove
                  </button>
                )}
              </li>
            ))}
            {state.players.length === 0 && <li class="muted">Nobody aboard yet.</li>}
          </ul>
          {state.isHost && !state.tutorial && (
            <div class="row">
              <button
                class="btn ghost small"
                disabled={state.players.length >= state.settings.maxPassengers}
                onClick={() => run(client.command({ kind: 'addBot' }))}
              >
                + Add a bot passenger
              </button>
              <button
                class="btn ghost small"
                disabled={filling || state.players.length >= state.settings.maxPassengers}
                onClick={() => void fillWithBots()}
              >
                {filling ? 'Filling…' : 'Fill the empty seats with bots'}
              </button>
            </div>
          )}
        </section>

        <div class="stack">
          <LobbyChat flight={flight} state={state} />
          <section class="panel">
            <div class="panel-head">
              <h2>Flight rules</h2>
              {state.isHost && (
                <button class="btn ghost tiny" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
            </div>
            <ul class="rule-list">
              {describeRules(state.settings).map((line) => (
                <li key={line}>{line}</li>
              ))}
              {state.hostPicksRole && <li>The captain picked their own role (nobody else is told which).</li>}
            </ul>
            {state.isHost && !!state.you && !state.controlTower && !state.tutorial && (
              <label class="field my-role">
                <span class="label">Your role</span>
                <select
                  class="input"
                  value={state.myRole ?? 'random'}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    void run(client.command({ kind: 'myRole', role: value === 'random' ? null : (value as RoleId) }));
                  }}
                >
                  <option value="random">Random, like everyone else</option>
                  {ROLE_CHOICES.map(({ team, roles }) => (
                    <optgroup key={team} label={team}>
                      {roles.map((id) => (
                        <option key={id} value={id}>
                          {ROLES[id].name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  {ownRoles.length > 0 && (
                    <optgroup label="Made up for this flight">
                      {ownRoles.map(({ def, id }) => (
                        <option key={id} value={id}>
                          {def.name} ({def.team === 'saboteurs' ? 'Saboteurs' : 'Passengers'})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <small class="hint">
                  Only you see this; the others just hear that you picked. If it cannot fit this flight (a rogue Pilot with too few aboard), you
                  are dealt a random role instead.
                </small>
              </label>
            )}
          </section>
          {me && <MyPass flight={flight} />}
        </div>
      </div>

      <footer class="boarding-bar">
        <VoiceButton flight={flight} className="small" />
        {state.isHost ? (
          <>
            <EndButton code={state.code} />
            {!flight.host && (
              <button class="btn ghost small" onClick={() => setMoving(true)}>
                Move to another device
              </button>
            )}
            <button class="btn ghost small" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
            <span class="muted grow">{takeoffError ?? 'Everyone aboard? Close the doors to take off.'}</span>
            <button class="btn primary big" disabled={takeoffError !== null} onClick={() => run(client.command({ kind: 'takeoff' }))}>
              Close doors & take off
            </button>
          </>
        ) : (
          <>
            <button class="btn ghost small" onClick={() => navigate('/')}>
              Leave
            </button>
            <button class="btn ghost small" onClick={() => setMoving(true)}>
              Move to another device
            </button>
            <button class="btn ghost small" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
            <span class="muted grow">Waiting for the captain to close the doors…</span>
          </>
        )}
      </footer>
      {moving && <MoveDevice flight={flight} onClose={() => setMoving(false)} fixed />}
      {settingsOpen && (
        <div class="tv-overlay fixed" role="dialog" aria-modal="true" aria-label="Settings">
          <div class="tv-card wide">
            <h2>Settings</h2>
            <SettingsPanel state={state} />
            <button class="btn primary" onClick={() => setSettingsOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div class="toast" role="alert">
          {toast}
        </div>
      )}
    </div>
  );
}

function ShareBox({ code }: { code: string }) {
  const link = flightLink(code);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div class="share">
      <div class="label">Invite your friends</div>
      <p>
        Share the flight number <b>{formatCode(code)}</b> or this link:
      </p>
      <div class="share-link">
        <input class="input" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <button class="btn" onClick={copy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function LobbyChat({ flight, state }: { flight: OpenFlight; state: ClientState }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.lobbyChat.length]);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!text.trim()) return;
    const result = await flight.client.sendLobbyChat(text);
    if (result.ok) {
      setText('');
      setError(null);
    } else {
      setError(result.error);
    }
  };
  return (
    <section class="panel lobby-chat">
      <div class="panel-head">
        <h2>Gate chat</h2>
      </div>
      <ol class="chat-log" ref={listRef}>
        {state.lobbyChat.length === 0 && <li class="muted empty">Say hi while you wait.</li>}
        {state.lobbyChat.map((m) => (
          <li key={m.id} class="msg">
            <b>{m.name}</b> {m.text}
          </li>
        ))}
      </ol>
      {state.you !== null && (
        <form class="chat-input" onSubmit={submit}>
          <input
            class="input"
            value={text}
            maxLength={CHAT_MAX_LENGTH}
            placeholder="Message the gate…"
            aria-label="Message"
            onInput={(e) => setText(e.currentTarget.value)}
          />
          <button class="btn" type="submit" disabled={!text.trim()}>
            Send
          </button>
        </form>
      )}
      {error && <p class="error-text">{error}</p>}
    </section>
  );
}

function MyPass({ flight }: { flight: OpenFlight }) {
  const [profile, setProfile] = useState(loadProfile);
  const change = (next: Profile) => {
    setProfile(next);
    saveProfile(next);
    if (next.name.trim()) flight.client.updateProfile(next.name.trim(), next.look, next.face);
  };
  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Your boarding pass</h2>
      </div>
      <ProfileEditor profile={profile} onChange={change} />
    </section>
  );
}

function EndButton({ code }: { code: string }) {
  const [sure, setSure] = useState(false);
  if (!sure) {
    return (
      <button class="btn ghost small" onClick={() => setSure(true)}>
        End flight
      </button>
    );
  }
  return (
    <button
      class="btn danger small"
      onClick={() => {
        endFlight(code);
        navigate('/');
      }}
    >
      Really end the flight?
    </button>
  );
}
