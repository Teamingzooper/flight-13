import { Avatar } from '../app/Avatar';
import type { PlayerView } from '../engine';
import { ItemIcon } from '../meta/ItemIcon';
import type { TVContext } from './context';
import { clock, nameOf, roleName, seatPill } from './format';

export function VoteTab({ ctx }: { ctx: TVContext }) {
  const { game, send, left, flight } = ctx;
  if (game.phase.kind !== 'day_vote') {
    // During the discussion the vote opens early once everyone still in play is ready: the button is here too.
    const discussing = game.phase.kind === 'day_discuss' && game.you?.status === 'alive';
    const ready = game.mine?.ready ?? false;
    return (
      <div class="tab">
        {discussing && (
          <div class="callout">
            <span>The vote opens when the discussion ends, or sooner once everyone is ready.</span>
            <button class="btn primary small" disabled={ready} onClick={() => void send({ kind: 'ready' })}>
              {ready ? 'Ready ✓ waiting for the others' : 'Ready to vote'}
            </button>
          </div>
        )}
        <LastVerdict game={game} />
      </div>
    );
  }
  const counts = game.votes?.counts ?? {};
  const byVoter = game.votes?.byVoter ?? null;
  const mine = game.mine?.vote ?? null;
  const canVote = new Set(game.options?.vote ?? []);
  const voting = game.options !== null && game.you?.status === 'alive';
  const voters = (target: string) =>
    byVoter
      ? Object.entries(byVoter)
          .filter(([, t]) => t === target)
          .map(([v]) => nameOf(game, v))
      : [];
  const candidates = game.players.filter((p) => p.status === 'alive');
  // Saboteurs know each other: their teammates are marked, so nobody votes out their own side by mistake.
  const saboteur = game.you?.team === 'saboteurs';
  return (
    <div class="tab vote-tab">
      <div class="panel-title">
        Who should be restrained?
        <span class="muted">They need more votes than Skip. Not voting counts as Skip. {clock(left)} left.</span>
      </div>
      {game.options?.items.some((u) => u.item === 'ffcard') && (
        <div class="callout ffcard">
          <ItemIcon item="ffcard" size={22} />
          <span>Your frequent-flyer card makes your vote count twice today. Everyone will see you flash it.</span>
          <button class="btn primary small" onClick={() => void send({ kind: 'use', item: 'ffcard' })}>
            Flash it
          </button>
        </div>
      )}
      <div class="vote-grid">
        {candidates.map((p) => {
          const ally = saboteur && p.id !== game.you?.id && p.team === 'saboteurs';
          return (
          <button
            key={p.id}
            class={`vote-card${mine === p.id ? ' on' : ''}${ally ? ' ally' : ''}`}
            disabled={!canVote.has(p.id)}
            onClick={() => void send({ kind: 'vote', target: p.id })}
          >
            <Avatar look={p.look} face={flight.client.faces.get(p.id)} size={44} />
            <span class="vote-name">
              {p.name}
              {p.id === game.you?.id ? ' (you)' : ''}
            </span>
            {ally && <span class="vote-ally">Saboteur{p.role ? ` · ${roleName(p.role, game.settings)}` : ''}</span>}
            <span class="vote-seat">{seatPill(p.seat)}</span>
            <span class="vote-count">{counts[p.id] ?? 0}</span>
            {voters(p.id).length > 0 && <span class="vote-voters">{voters(p.id).join(', ')}</span>}
          </button>
          );
        })}
        <button class={`vote-card skip${mine === 'skip' ? ' on' : ''}`} disabled={!voting} onClick={() => void send({ kind: 'vote', target: 'skip' })}>
          <span class="vote-name">Skip</span>
          <span class="vote-seat">Restrain no one</span>
          <span class="vote-count">{counts.skip ?? 0}</span>
          {voters('skip').length > 0 && <span class="vote-voters">{voters('skip').join(', ')}</span>}
        </button>
      </div>
      {!voting && <p class="muted">Only passengers still in play can vote.</p>}
    </div>
  );
}

export function LastVerdict({ game }: { game: PlayerView }) {
  const v = game.verdict;
  if (!v) {
    return (
      <div class="stack">
        <div class="panel-title">Voting</div>
        <p class="muted">The cabin votes during the day. Nothing to vote on yet.</p>
      </div>
    );
  }
  return (
    <div class="stack">
      <div class="panel-title">
        Last verdict <span class="muted">Day {v.night}</span>
      </div>
      <p class="verdict-line">{v.restrained ? `${nameOf(game, v.restrained)} was restrained.` : 'No one was restrained.'}</p>
      <Tally game={game} tally={v.tally} />
    </div>
  );
}

export function Tally({ game, tally }: { game: PlayerView; tally: Record<string, number> }) {
  return (
    <ul class="tally">
      {Object.entries(tally)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => (
          <li key={id}>
            <span>{id === 'skip' ? 'Skip' : nameOf(game, id)}</span>
            <b>{n}</b>
          </li>
        ))}
    </ul>
  );
}
