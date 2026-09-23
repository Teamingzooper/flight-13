import { useState } from 'preact/hooks';
import { ROLES, grid, type NightAction, type PlayerView } from '../engine';
import type { TVContext } from './context';
import { describeAction, nameWithSeat, roleName, teamName, whenLabel } from './format';
import { SeatMap } from './SeatMap';

type TargetAction = Extract<NightAction, { target: string }>;
type Check = 'sweep' | 'cart' | 'lavatory';
type BombSpot = 'seat' | 'cart' | 'lavatory';

export function ActionTab({ ctx }: { ctx: TVContext }) {
  const { game } = ctx;
  const you = game.you;
  if (!you) {
    return (
      <div class="tab">
        <TowerPanel />
      </div>
    );
  }
  if (you.status !== 'alive') {
    return (
      <div class="tab">
        <GhostPanel game={game} />
      </div>
    );
  }
  const kind = game.phase.kind;
  return (
    <div class="tab action-tab">
      <RoleStrip game={game} />
      {kind === 'night_move' && (you.buckled ? <Buckled game={game} /> : <MovePanel ctx={ctx} />)}
      {kind === 'night_act' && (you.buckled ? <Buckled game={game} /> : <AbilityPanel ctx={ctx} />)}
      {kind !== 'night_move' && kind !== 'night_act' && <Notes game={game} />}
    </div>
  );
}

function RoleStrip({ game }: { game: PlayerView }) {
  const you = game.you!;
  const info = ROLES[you.role];
  return (
    <div class={`role-strip ${you.team}`}>
      <div>
        <div class="label">Your role</div>
        <div class="role-name">{info.name}</div>
        <div class="role-meta">
          <span class={`team-tag ${you.team}`}>{teamName(you.team)}</span>
          <span>Seat {you.seat ?? '—'}</span>
        </div>
      </div>
      <p class="role-how">{info.howTo}</p>
      {you.poisoned && (
        <div class="callout red">
          <b>You were poisoned.</b> Get the Nurse to sit next to you and treat you tonight, or you will not survive the next dawn.
        </div>
      )}
    </div>
  );
}

function Buckled({ game }: { game: PlayerView }) {
  return (
    <div class="callout amber">
      <b>Ding.</b> The seatbelt sign is on over your seat{game.you!.buckled === 'turbulence' ? ' because of turbulence' : ''}. You cannot move
      or use an ability tonight.
    </div>
  );
}

function MovePanel({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const you = game.you!;
  const chosen = game.mine?.move ?? null;
  const options = new Set(game.options?.seats ?? []);
  return (
    <div class="stack">
      <div class="panel-title">
        Change seats?
        <span class="muted">Tap an empty seat, or stay in {you.seat}.</span>
      </div>
      <SeatMap
        game={game}
        seatPick={{ options, selected: chosen && chosen !== 'stay' ? chosen : null, onPick: (seat) => void send({ kind: 'move', to: seat }) }}
      />
      <div class="row">
        <button class={`btn${chosen === 'stay' ? ' primary' : ''}`} onClick={() => void send({ kind: 'move', to: 'stay' })}>
          Stay in {you.seat}
        </button>
        <span class="muted">
          {chosen === null ? 'Choose before time runs out, or you stay put.' : chosen === 'stay' ? 'You will stay put.' : `You will move to ${chosen}.`}
        </span>
      </div>
      {you.role === 'pilot' && <SeatbeltPicker ctx={ctx} />}
    </div>
  );
}

function SeatbeltPicker({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const chosen = game.mine?.seatbelt ?? null;
  const targets = game.options?.seatbelt ?? [];
  const last = game.you?.lastSeatbeltTarget;
  return (
    <div class="ability-card">
      <div class="ability-title">Seatbelt sign</div>
      <p class="muted">
        Lock one passenger in tonight: no moving and no ability.{last ? ` You cannot pick ${nameWithSeat(game, last)} two nights running.` : ''}
      </p>
      <div class="chips">
        {targets.map((id) => (
          <button key={id} class={`chip${chosen === id ? ' on' : ''}`} onClick={() => void send({ kind: 'seatbelt', target: id })}>
            {nameWithSeat(game, id)}
          </button>
        ))}
        <button class={`chip${chosen === 'none' ? ' on' : ''}`} onClick={() => void send({ kind: 'seatbelt', target: 'none' })}>
          No one
        </button>
      </div>
    </div>
  );
}

function AbilityPanel({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const you = game.you!;
  const mine = game.mine!;
  const actions = game.options?.actions ?? [];
  let body;
  switch (you.role) {
    case 'nurse':
      body = <TargetPicker ctx={ctx} title="Treat someone" actions={actions} empty="Nobody is within reach. Sit next to someone tomorrow night." />;
      break;
    case 'stewardess_loyal':
    case 'stewardess_rogue':
      body = (
        <TargetPicker ctx={ctx} title={you.role === 'stewardess_rogue' ? 'Serve a poisoned drink' : 'Serve a drink'} actions={actions} empty="Nobody to serve." />
      );
      break;
    case 'investigator':
      body = <InvestigatorPicker ctx={ctx} actions={actions} />;
      break;
    case 'bomber':
    case 'mastermind':
      body = <BombPicker ctx={ctx} actions={actions} />;
      break;
    case 'pilot':
      body = <p class="muted">Your seatbelt call is in. Nothing else to do tonight.</p>;
      break;
    default:
      body = <p class="muted">You have no ability. Close your eyes and listen.</p>;
  }
  return (
    <div class="stack">
      {body}
      <div class="done-row">
        <span>
          {mine.acted
            ? mine.action
              ? `Tonight you will ${describeAction(game, mine.action)}.`
              : 'You are resting tonight.'
            : 'Press Done when you are finished. Everyone has to.'}
        </span>
        <button class={`btn${mine.acted ? '' : ' primary'}`} onClick={() => void send({ kind: 'act', action: mine.acted ? mine.action : null })}>
          {mine.acted ? 'Done ✓' : 'Done'}
        </button>
      </div>
    </div>
  );
}

function TargetPicker({ ctx, title, actions, empty }: { ctx: TVContext; title: string; actions: NightAction[]; empty: string }) {
  const { game, send } = ctx;
  const targeted = actions.filter((a): a is TargetAction => 'target' in a);
  const byTarget = new Map(targeted.map((a) => [a.target, a]));
  const current = game.mine?.action;
  const selected = current && 'target' in current ? current.target : null;
  const choose = (id: string) => {
    const action = byTarget.get(id);
    if (action) void send({ kind: 'act', action });
  };
  if (targeted.length === 0) return <p class="muted">{empty}</p>;
  return (
    <div class="stack">
      <div class="panel-title">{title}</div>
      <div class="chips">
        {targeted.map((a) => (
          <button key={a.target} class={`chip${selected === a.target ? ' on' : ''}`} onClick={() => choose(a.target)}>
            {a.target === game.you?.id ? 'Yourself' : nameWithSeat(game, a.target)}
          </button>
        ))}
      </div>
      <SeatMap game={game} playerPick={{ options: new Set(byTarget.keys()), selected, onPick: choose }} />
    </div>
  );
}

function InvestigatorPicker({ ctx, actions }: { ctx: TVContext; actions: NightAction[] }) {
  const { game, send } = ctx;
  const [hover, setHover] = useState<Check | null>(null);
  const you = game.you!;
  const rows = game.cabin.rows;
  const current = game.mine?.action ?? null;
  const find = (key: Check) => actions.find((a) => (key === 'sweep' ? a.kind === 'sweep' : a.kind === 'inspect' && a.what === key));
  const isCurrent = (key: Check) => !!current && (key === 'sweep' ? current.kind === 'sweep' : current.kind === 'inspect' && current.what === key);
  const areas: Record<Check, Set<string>> = {
    sweep: new Set(grid.seatsWithin([grid.parseSeat(you.seat!)!], grid.SWEEP_RADIUS, rows)),
    cart: new Set(grid.seatsWithin([grid.cartCell(game.cabin.cartRow)], 1, rows)),
    lavatory: new Set(grid.seatsWithin(grid.lavatoryCells(rows), 1, rows)),
  };
  const shown: Check = hover ?? (current?.kind === 'inspect' ? current.what : 'sweep');
  const options: { key: Check; title: string; sub: string }[] = [
    { key: 'sweep', title: 'Sweep nearby seats', sub: 'Every seat within 1 of you, diagonals included.' },
    {
      key: 'cart',
      title: 'Inspect the drink cart',
      sub: find('cart')
        ? `It is right next to you (row ${game.cabin.cartRow}).`
        : game.cabin.cartDestroyed
          ? 'The cart is gone.'
          : 'Sit in an aisle seat next to the cart first (highlighted).',
    },
    {
      key: 'lavatory',
      title: 'Inspect the lavatory',
      sub: find('lavatory') ? 'You are right next to it.' : game.cabin.lavatoryDestroyed ? 'The lavatory is destroyed.' : `Sit in row ${rows}, seats A–C, first.`,
    },
  ];
  return (
    <div class="stack">
      <div class="panel-title">
        Check for bombs <span class="muted">Highlighted seats show where each check reaches.</span>
      </div>
      <div class="option-grid">
        {options.map((o) => {
          const action = find(o.key);
          return (
            <button
              key={o.key}
              class={`option${isCurrent(o.key) ? ' on' : ''}`}
              disabled={!action}
              onMouseEnter={() => setHover(o.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(o.key)}
              onBlur={() => setHover(null)}
              onClick={() => action && void send({ kind: 'act', action })}
            >
              <b>{o.title}</b>
              <span>{o.sub}</span>
            </button>
          );
        })}
      </div>
      <SeatMap game={game} preview={areas[shown]} />
    </div>
  );
}

function BombPicker({ ctx, actions }: { ctx: TVContext; actions: NightAction[] }) {
  const { game, send } = ctx;
  const you = game.you!;
  const current = game.mine?.action ?? null;
  const planned = current?.kind === 'plant' ? current : null;
  const [where, setWhere] = useState<BombSpot>(planned?.where ?? 'seat');
  const [fuse, setFuse] = useState<1 | 2>(planned?.fuse ?? 2);
  if (you.bombUsed) return <p class="muted">Your bomb is already planted. Stay hidden, and stay out of the blast.</p>;
  const can = (w: BombSpot) => actions.some((a) => a.kind === 'plant' && a.where === w);
  const rows = game.cabin.rows;
  const centers = where === 'seat' ? [grid.parseSeat(you.seat!)!] : where === 'cart' ? [grid.cartCell(game.cabin.cartRow)] : grid.lavatoryCells(rows);
  const blast = new Set(grid.seatsWithin(centers, grid.BLAST_RADIUS, rows));
  const labels: Record<BombSpot, string> = { seat: `Under ${you.seat}`, cart: 'Drink cart', lavatory: 'Lavatory' };
  const note =
    where === 'cart'
      ? 'A cart bomb goes off wherever the cart is when the fuse runs out, and it reaches both sides of the aisle.'
      : where === 'lavatory'
        ? 'A lavatory bomb destroys the lavatory and hits the back rows.'
        : 'You are sitting on it. Move away before it goes off, and hope the Pilot does not buckle you in.';
  return (
    <div class="stack">
      <div class="panel-title">
        Plant your bomb <span class="muted">One per game. Red seats are caught in the blast.</span>
      </div>
      <div class="row">
        <div class="segmented">
          {(['seat', 'cart', 'lavatory'] as const).map((w) => (
            <button key={w} class={where === w ? 'on' : ''} disabled={!can(w)} onClick={() => setWhere(w)}>
              {labels[w]}
            </button>
          ))}
        </div>
        <div class="segmented">
          {([1, 2] as const).map((f) => (
            <button key={f} class={fuse === f ? 'on' : ''} onClick={() => setFuse(f)}>
              Fuse: {f} night{f > 1 ? 's' : ''}
            </button>
          ))}
        </div>
      </div>
      <p class="hint">
        {note} It explodes at the end of night {game.phase.night + fuse}, after everyone changes seats.
      </p>
      <SeatMap game={game} preview={blast} />
      <div class="row">
        <button class="btn danger" disabled={!can(where)} onClick={() => void send({ kind: 'act', action: { kind: 'plant', where, fuse } })}>
          {planned ? 'Update the plan' : 'Plant bomb'}
        </button>
        {planned && <span class="muted">Planned: {describeAction(game, planned)}.</span>}
        {planned && (
          <button class="btn ghost small" onClick={() => void send({ kind: 'act', action: null })}>
            Not tonight
          </button>
        )}
      </div>
    </div>
  );
}

function Notes({ game }: { game: PlayerView }) {
  const notes = game.log.filter((e) => Array.isArray(e.to) || e.to === 'saboteurs').slice().reverse();
  return (
    <div class="stack">
      <div class="panel-title">
        Your notes <span class="muted">Private results and messages only you can see.</span>
      </div>
      {notes.length === 0 ? (
        <p class="muted">Nothing yet. Your night results will show up here.</p>
      ) : (
        <ol class="notes">
          {notes.map((e) => (
            <li key={e.id} class={`note tag-${e.tag}`}>
              <span class="when">{whenLabel(e)}</span>
              {e.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GhostPanel({ game }: { game: PlayerView }) {
  const you = game.you!;
  const cause = game.players.find((p) => p.id === you.id)?.cause;
  const how =
    cause === 'restrained' ? 'The passengers restrained you.' : cause === 'poison' ? 'The poison got you.' : 'You were caught in an explosion.';
  return (
    <div class="stack">
      <div class="ghost-card">
        <div class="label">You are out</div>
        <h2>{how}</h2>
        <p>
          You were the <b>{roleName(you.role)}</b> ({teamName(you.team)}). Keep watching, and talk with the other ghosts in Chat.
        </p>
      </div>
      <Notes game={game} />
    </div>
  );
}

function TowerPanel() {
  return (
    <div class="ghost-card">
      <div class="label">Control tower</div>
      <h2>You are running this flight</h2>
      <p>You see only what the whole cabin can see. Follow along on the Map and Flight tabs.</p>
    </div>
  );
}
