import type { ComponentChildren } from 'preact';
import { DESTINATIONS } from '../engine';
import { formatCode } from '../net/code';
import type { TVContext } from './context';
import { clock, phaseHint, phaseTitle } from './format';

export function Header({
  ctx,
  onLeave,
  closeLabel = 'Leave the flight',
  onUse3D,
  tools,
}: {
  ctx: TVContext;
  onLeave: () => void;
  closeLabel?: string;
  onUse3D?: () => void;
  /** Extra buttons beside the 3D switch (voice chat). */
  tools?: ComponentChildren;
}) {
  const { game, state, left } = ctx;
  const d = DESTINATIONS[game.settings.destination];
  const ended = game.phase.kind === 'ended';
  return (
    <header class="tv-header">
      <div class="tv-logo">
        <span class="tv-logo-mark">
          FLIGHT <b>13</b>
        </span>
        <span class="tv-logo-sub">
          {formatCode(state.code)} → {d.id}
        </span>
      </div>
      <div class="tv-phase">
        <div class="tv-phase-title">{phaseTitle(game)}</div>
        <div class="tv-phase-hint">{phaseHint(game)}</div>
      </div>
      <div class="tv-clock">
        {!ended && <div class={`tv-time${left < 10_000 ? ' urgent' : ''}`}>{clock(left)}</div>}
        <div class="label">{game.phase.night > 0 ? `Night ${game.phase.night} of ${game.phase.nights}` : 'Climbing'}</div>
      </div>
      <div class="tv-tools">
        {tools}
        {onUse3D && (
          <button class="tv-view" onClick={onUse3D} title="Switch to the 3D cabin">
            3D
          </button>
        )}
      </div>
      <button class="tv-leave" onClick={onLeave} aria-label={closeLabel} title={closeLabel}>
        {closeLabel.startsWith('Back') ? '↩' : '✕'}
      </button>
    </header>
  );
}
