import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Avatar } from '../app/Avatar';
import { DESTINATIONS, ROLES, type PlayerView } from '../engine';
import type { TVContext } from './context';
import { morningReport, roleName, teamName, whenLabel } from './format';
import { Tally } from './VoteTab';

/** Which phase overlay was dismissed, shared by the 3D view and the TV so it only shows once. */
let dismissed: string | null = null;
const dismissListeners = new Set<() => void>();

function useDismissed(): [string | null, (key: string) => void] {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    dismissListeners.add(fn);
    return () => void dismissListeners.delete(fn);
  }, []);
  return [
    dismissed,
    (key) => {
      dismissed = key;
      for (const fn of [...dismissListeners]) fn();
    },
  ];
}

export function PhaseOverlay({ ctx, onLeave }: { ctx: TVContext; onLeave: () => void }) {
  const { game } = ctx;
  const key = `${game.phase.kind}:${game.phase.night}`;
  const [closed, setClosed] = useDismissed();
  if (closed === key) return null;
  const close = () => setClosed(key);
  switch (game.phase.kind) {
    case 'takeoff':
      return game.you ? <BoardingPass game={game} onClose={close} /> : null;
    case 'dawn':
      return <MorningReport game={game} onClose={close} />;
    case 'verdict':
      return <VerdictCard game={game} onClose={close} />;
    case 'ended':
      return <EndScreen ctx={ctx} onLeave={onLeave} />;
    default:
      return null;
  }
}

function Overlay({ children, onClose, wide = false }: { children: ComponentChildren; onClose?: () => void; wide?: boolean }) {
  return (
    <div class="tv-overlay" role="dialog" aria-modal="true">
      <div class={`tv-card${wide ? ' wide' : ''}`}>
        {children}
        {onClose && (
          <button class="btn primary" onClick={onClose}>
            Got it
          </button>
        )}
      </div>
    </div>
  );
}

function BoardingPass({ game, onClose }: { game: PlayerView; onClose: () => void }) {
  const you = game.you!;
  const info = ROLES[you.role];
  const d = DESTINATIONS[game.settings.destination];
  const allies = game.players.filter((p) => p.team === 'saboteurs' && p.id !== you.id);
  return (
    <Overlay onClose={onClose}>
      <div class={`pass ${you.team}`}>
        <div class="pass-head">
          <span>Boarding pass</span>
          <span>Flight 13 → {d.id}</span>
        </div>
        <div class="pass-body">
          <div>
            <div class="label">Passenger</div>
            <div class="pass-big">{you.name}</div>
          </div>
          <div>
            <div class="label">Seat</div>
            <div class="pass-big">{you.seat}</div>
          </div>
          <div>
            <div class="label">Role</div>
            <div class="pass-big">{info.name}</div>
          </div>
          <div>
            <div class="label">Team</div>
            <div class={`pass-big team ${you.team}`}>{teamName(you.team)}</div>
          </div>
        </div>
        <p class="pass-blurb">{info.blurb}</p>
        <p>{info.howTo}</p>
        {you.team === 'saboteurs' && (
          <p class="pass-allies">
            Your allies: {allies.length ? allies.map((p) => `${p.name} (${p.role ? roleName(p.role) : '?'})`).join(', ') : 'none. You are on your own.'}
          </p>
        )}
      </div>
    </Overlay>
  );
}

function MorningReport({ game, onClose }: { game: PlayerView; onClose: () => void }) {
  const entries = morningReport(game);
  return (
    <Overlay onClose={onClose} wide>
      <div class="label">Morning report · Night {game.phase.night}</div>
      <h2>The lights come back on</h2>
      <ol class="notes">
        {entries.length === 0 && <li class="note">Nothing to report.</li>}
        {entries.map((e) => {
          const secret = Array.isArray(e.to) || e.to === 'saboteurs';
          return (
            <li key={e.id} class={`note tag-${e.tag}${secret ? ' private' : ''}`}>
              {secret && <span class="when">{e.to === 'saboteurs' ? 'Saboteurs' : 'Only you'}</span>}
              {e.text}
            </li>
          );
        })}
      </ol>
    </Overlay>
  );
}

function VerdictCard({ game, onClose }: { game: PlayerView; onClose: () => void }) {
  const v = game.verdict;
  const restrained = v?.restrained ? game.players.find((p) => p.id === v.restrained) : undefined;
  return (
    <Overlay onClose={onClose}>
      <div class="label">Verdict · Day {game.phase.night}</div>
      {restrained ? (
        <>
          <Avatar look={restrained.look} size={72} />
          <h2>{restrained.name} is restrained</h2>
          {restrained.role && restrained.team && (
            <p>
              They were the <b>{roleName(restrained.role)}</b> ({teamName(restrained.team)}).
            </p>
          )}
        </>
      ) : (
        <h2>No one was restrained</h2>
      )}
      {v && <Tally game={game} tally={v.tally} />}
    </Overlay>
  );
}

function EndScreen({ ctx, onLeave }: { ctx: TVContext; onLeave: () => void }) {
  const { game, state, flight } = ctx;
  const [view, setView] = useState<'roles' | 'blackbox'>('roles');
  const r = game.result;
  const summary = game.log.filter((e) => e.tag === 'gameover').at(-1)?.text ?? '';
  const blackBox = game.log.filter((e) => e.to === 'end');
  const outcome = (p: PlayerView['players'][number]) =>
    p.status === 'alive' ? 'Made it' : p.cause === 'restrained' ? 'Restrained' : p.cause === 'poison' ? 'Poisoned' : 'Caught in a blast';
  return (
    <div class="tv-overlay" role="dialog" aria-modal="true">
      <div class="tv-card wide end">
        <div class="label">{r?.reason === 'landed' ? 'Flight 13 has landed' : 'Flight over'}</div>
        <h2 class={`end-title ${r?.winner ?? ''}`}>{r ? (r.winner === 'draw' ? 'No survivors' : `${teamName(r.winner)} win`) : 'Flight over'}</h2>
        {game.you && r && r.winner !== 'draw' && <p class="end-you">{r.winner === game.you.team ? 'Your team won' : 'Your team lost'}</p>}
        <p>{summary}</p>
        <div class="segmented">
          <button class={view === 'roles' ? 'on' : ''} onClick={() => setView('roles')}>
            Everyone's roles
          </button>
          <button class={view === 'blackbox' ? 'on' : ''} onClick={() => setView('blackbox')}>
            Black box
          </button>
        </div>
        {view === 'roles' ? (
          <ul class="role-reveal">
            {game.players.map((p) => (
              <li key={p.id} class={p.team ?? ''}>
                <Avatar look={p.look} size={32} dim={p.status !== 'alive'} />
                <span class="name">{p.name}</span>
                <span class="role">{p.role ? roleName(p.role) : '?'}</span>
                <span class="status">{outcome(p)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <ol class="notes blackbox">
            {blackBox.length === 0 && <li class="note">The black box is empty.</li>}
            {blackBox.map((e) => (
              <li key={e.id} class={`note tag-${e.tag}`}>
                <span class="when">{whenLabel(e)}</span>
                {e.text.replace(/^Night \d+: /, '')}
              </li>
            ))}
          </ol>
        )}
        <div class="row">
          {state.isHost ? (
            <button class="btn primary big" onClick={() => void flight.client.command({ kind: 'boardAgain' })}>
              Board again
            </button>
          ) : (
            <span class="muted">The captain can board everyone again.</span>
          )}
          <button class="btn ghost" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
