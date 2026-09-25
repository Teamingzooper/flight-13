import { useState } from 'preact/hooks';
import type { OpenFlight } from '../app/sessions';
import type { ClientState, HostCommand } from '../net/protocol';

/** The captain's mid-flight controls: pause (or resume) the clock, add half a minute, or end the phase now. */
export function CaptainMenu({ flight, state, buttonClass }: { flight: OpenFlight; state: ClientState; buttonClass: string }) {
  const [open, setOpen] = useState(false);
  const game = state.game;
  if (!state.isHost || !game || game.phase.kind === 'ended') return null;
  const run = (command: HostCommand) => {
    void flight.client.command(command);
    setOpen(false);
  };
  return (
    <div class="captain-menu">
      <button type="button" class={buttonClass} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {state.paused ? '⏸ Paused' : 'Captain'} ▾
      </button>
      {open && (
        <div class="captain-pop" role="menu">
          <button type="button" role="menuitem" onClick={() => run({ kind: 'pause', on: !state.paused })}>
            {state.paused ? '▶ Resume the flight' : '⏸ Pause the flight'}
          </button>
          <button type="button" role="menuitem" onClick={() => run({ kind: 'addTime', seconds: 30 })}>
            +30 seconds
          </button>
          <button type="button" role="menuitem" onClick={() => run({ kind: 'skipPhase' })}>
            ⏭ Skip this phase
          </button>
        </div>
      )}
    </div>
  );
}

/** Everyone's notice while the flight is paused. */
export function PausedBanner({ state, className = '' }: { state: ClientState; className?: string }) {
  if (!state.paused || !state.game) return null;
  return (
    <div class={`paused-banner ${className}`} role="status">
      ⏸ Paused by the captain
    </div>
  );
}
