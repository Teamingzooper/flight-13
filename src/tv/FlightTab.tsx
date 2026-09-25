import { destinationOf, isNightPhase, type PlayerView } from '../engine';
import type { TVContext } from './context';
import { whenLabel } from './format';

export function FlightTab({ ctx }: { ctx: TVContext }) {
  const { game } = ctx;
  const d = destinationOf(game.settings);
  const log = game.log.filter((e) => e.to === 'all').slice().reverse();
  return (
    <div class="tab flight-tab">
      <FlightMap progress={flightProgress(game)} city={d.city} code={d.code} />
      <div class="flight-facts">
        <span>
          <b>{d.city}</b> ({d.code})
        </span>
        <span>{game.phase.night > 0 ? `Night ${game.phase.night} of ${game.phase.nights}` : 'Just took off'}</span>
        <span class="muted">{d.blurb}</span>
      </div>
      <div class="panel-title">Cabin log</div>
      <ol class="notes">
        {log.map((e) => (
          <li key={e.id} class={`note tag-${e.tag}`}>
            <span class="when">{whenLabel(e)}</span>
            {e.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

function flightProgress(game: PlayerView): number {
  if (game.phase.kind === 'ended') return 1;
  if (game.phase.night === 0) return 0.02;
  const done = game.phase.night - (isNightPhase(game.phase.kind) ? 1 : 0.5);
  return Math.min(0.98, Math.max(0.02, done / game.phase.nights));
}

function FlightMap({ progress, city, code }: { progress: number; city: string; code: string }) {
  // Quadratic arc from (40, 150) through control point (300, 30) to (560, 150).
  const t = progress;
  const x = (1 - t) ** 2 * 40 + 2 * (1 - t) * t * 300 + t ** 2 * 560;
  const y = (1 - t) ** 2 * 150 + 2 * (1 - t) * t * 30 + t ** 2 * 150;
  const dx = 2 * (1 - t) * 260 + 2 * t * 260;
  const dy = 2 * (1 - t) * -120 + 2 * t * 120;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <svg class="flight-map" viewBox="0 0 600 190" role="img" aria-label={`Flight progress: ${Math.round(progress * 100)}% of the way to ${city}`}>
      <defs>
        <linearGradient id="fm-trail" x1="0" x2="1">
          <stop offset="0" stop-color="#ffb547" stop-opacity="0.15" />
          <stop offset="1" stop-color="#ffb547" />
        </linearGradient>
      </defs>
      <path d="M40 150 Q300 30 560 150" class="fm-route" />
      <path d="M40 150 Q300 30 560 150" class="fm-done" pathLength={1} stroke-dasharray={`${progress} 1`} />
      <circle cx="40" cy="150" r="6" class="fm-dot" />
      <circle cx="560" cy="150" r="6" class="fm-dot dest" />
      <text x="40" y="180" class="fm-label" text-anchor="middle">
        Departure
      </text>
      <text x="560" y="180" class="fm-label dest" text-anchor="middle">
        {code}
      </text>
      <g transform={`translate(${x} ${y}) rotate(${angle + 90})`}>
        <path
          class="fm-plane"
          d="M0-14c1.3 0 2.2 1.8 2.2 4.5v4.6l8.8 5v2.6l-8.8-2.4v5.2l3 2.4V10L0 8.6-5.2 10V7.9l3-2.4V.3l-8.8 2.4V.1l8.8-5v-4.6C-2.2-12.2-1.3-14 0-14z"
        />
      </g>
    </svg>
  );
}
