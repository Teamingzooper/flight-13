import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Avatar } from '../app/Avatar';
import { Credits } from '../meta/Credits';
import { ITEMS, ROLES, destinationOf, grid, type PlayerView } from '../engine';
import { ACHIEVEMENTS } from '../meta/achievements';
import { settlementFor } from '../meta/bag';
import { ItemIcon } from '../meta/ItemIcon';
import { useBag } from '../meta/store';
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

const overlayKey = (game: PlayerView) => `${game.phase.kind}:${game.phase.night}`;

/** Show the current phase's card again (e.g. your boarding pass while packing). */
export function reopenPhaseCard(): void {
  dismissed = null;
  for (const fn of [...dismissListeners]) fn();
}

/** Whether this moment has a card (boarding pass, morning report, verdict, end screen) not yet dismissed. */
function cardShowing(game: PlayerView, closed: string | null): boolean {
  if (closed === overlayKey(game)) return false;
  switch (game.phase.kind) {
    case 'packing':
      return !!game.you;
    case 'dawn':
    case 'verdict':
    case 'ended':
      return true;
    default:
      return false;
  }
}

/** True while `PhaseOverlay` shows a card, so the 3D view can free the mouse for it. */
export function usePhaseOverlayOpen(game: PlayerView): boolean {
  const [closed] = useDismissed();
  return cardShowing(game, closed);
}

export function PhaseOverlay({ ctx, onLeave }: { ctx: TVContext; onLeave: () => void }) {
  const { game } = ctx;
  const [closed, setClosed] = useDismissed();
  if (!cardShowing(game, closed)) return null;
  const close = () => setClosed(overlayKey(game));
  switch (game.phase.kind) {
    case 'packing':
      return <BoardingPass game={game} onClose={close} />;
    case 'dawn':
      return <MorningReport game={game} onClose={close} />;
    case 'verdict':
      return <VerdictCard game={game} faces={ctx.flight.client.faces} onClose={close} />;
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
  const d = destinationOf(game.settings);
  const allies = game.players.filter((p) => p.team === 'saboteurs' && p.id !== you.id);
  return (
    <Overlay onClose={onClose}>
      <div class={`pass ${you.team}`}>
        <div class="pass-head">
          <span>Boarding pass</span>
          <span>Flight 13 → {d.code}</span>
        </div>
        <div class="pass-body">
          <div>
            <div class="label">Passenger</div>
            <div class="pass-big">{you.name}</div>
          </div>
          <div>
            <div class="label">Seat</div>
            <div class="pass-big">{you.seat && grid.isCockpit(you.seat) ? 'Flight deck' : you.seat && grid.isAisleSpot(you.seat) ? 'Crew' : you.seat}</div>
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
        {game.settings.pilotMustFly && (
          <p class="pass-rule">
            <b>Pilot must fly:</b>{' '}
            {you.role === 'pilot'
              ? 'if the passengers restrain you, nobody can fly the plane and the saboteurs win.'
              : you.team === 'saboteurs'
                ? 'get the passengers to restrain the Pilot and you win.'
                : 'restrain the Pilot by mistake and the saboteurs win.'}
          </p>
        )}
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

function VerdictCard({ game, faces, onClose }: { game: PlayerView; faces: ReadonlyMap<string, string>; onClose: () => void }) {
  const v = game.verdict;
  const restrained = v?.restrained ? game.players.find((p) => p.id === v.restrained) : undefined;
  const note = restrained ? game.log.find((e) => e.tag === 'note' && e.data?.player === restrained.id) : undefined;
  return (
    <Overlay onClose={onClose}>
      <div class="label">Verdict · Day {game.phase.night}</div>
      {restrained ? (
        <>
          <Avatar look={restrained.look} face={faces.get(restrained.id)} size={72} />
          <h2>{restrained.name} is restrained</h2>
          {restrained.role && restrained.team && (
            <p>
              They were the <b>{roleName(restrained.role)}</b> ({teamName(restrained.team)}).
            </p>
          )}
          {note && (
            <blockquote class="blackbox-quote">
              “{String(note.data?.note ?? '')}”<cite>{restrained.name}’s black box note</cite>
            </blockquote>
          )}
        </>
      ) : (
        <h2>No one was restrained</h2>
      )}
      {v && <Tally game={game} tally={v.tally} />}
    </Overlay>
  );
}

/** What this flight paid you: credits, a souvenir, achievements, and the items you used. */
function Earnings({ game }: { game: PlayerView }) {
  const bag = useBag();
  const paid = settlementFor(bag, game.gameId);
  const used = game.you?.usedItems ?? [];
  if (!paid) return null;
  const unlocked = ACHIEVEMENTS.filter((a) => paid.achievements.includes(a.id));
  return (
    <div class="earnings">
      <div class="earnings-head">
        <span class="label">Flight credits</span>
        <Credits amount={paid.credits} />
      </div>
      {paid.lines.length > 0 ? (
        <ul class="earnings-lines">
          {paid.lines.map((l) => (
            <li key={l.label}>
              <span>{l.label}</span>
              <span>+{l.credits}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">No credits this time.</p>
      )}
      {(paid.souvenir || unlocked.length > 0) && (
        <ul class="earnings-gifts">
          {paid.souvenir && (
            <li>
              <ItemIcon item={paid.souvenir} size={22} />
              <span>
                Souvenir for winning: <b>{ITEMS[paid.souvenir].name}</b>
              </span>
            </li>
          )}
          {unlocked.map((a) => (
            <li key={a.id}>
              <ItemIcon item={a.reward} size={22} />
              <span>
                Achievement <b>{a.name}</b>: {ITEMS[a.reward].name}
              </span>
            </li>
          ))}
        </ul>
      )}
      {used.length > 0 && <p class="muted">Used from your bag: {used.map((id) => ITEMS[id].name).join(', ')}</p>}
    </div>
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
        {game.you && <Earnings game={game} />}
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
                <Avatar look={p.look} face={flight.client.faces.get(p.id)} size={32} dim={p.status !== 'alive'} />
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
