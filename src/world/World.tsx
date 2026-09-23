import { useEffect, useRef, useState } from 'preact/hooks';
import type { OpenFlight } from '../app/sessions';
import type { ClientSnapshot } from '../net/client';
import type { ClientState } from '../net/protocol';
import { clock, phaseTitle } from '../tv/format';
import { PhaseOverlay } from '../tv/Overlays';
import { LeaveDialog, TV, useTVContext } from '../tv/TV';
import { Cabin3D } from './Cabin3D';

const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** The 3D cabin with a minimal HUD; lean into the seatback screen to use the TV. */
export function World({ flight, snap, state, onUse2D }: { flight: OpenFlight; snap: ClientSnapshot; state: ClientState; onUse2D: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const cabin = useRef<Cabin3D | null>(null);
  const [leaning, setLeaning] = useState(false);
  const [locked, setLocked] = useState(false);
  const [aim, setAim] = useState(false);
  const [leavingOpen, setLeavingOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const { ctx, toast } = useTVContext(flight, snap, state);
  const game = state.game!;

  useEffect(() => {
    try {
      const c = new Cabin3D(host.current!, { onScreenClick: () => setLeaning(true), onLockChange: setLocked, onAimChange: setAim });
      cabin.current = c;
      if (import.meta.env.DEV) (globalThis as { cabin3d?: Cabin3D }).cabin3d = c;
      return () => {
        c.dispose();
        cabin.current = null;
      };
    } catch (err) {
      console.error(err);
      setFailed(err instanceof Error ? err.message : 'WebGL is not available.');
      return undefined;
    }
  }, []);

  useEffect(() => {
    cabin.current?.update(state, snap);
  }, [state, snap]);

  useEffect(() => {
    cabin.current?.setLeaning(leaning);
  }, [leaning]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (typing) return;
      if (!leaning && (e.key === 'e' || e.key === 'E' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setLeaning(true);
      } else if (leaning && e.key === 'Escape') {
        setLeaning(false);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [leaning]);

  if (failed) {
    return (
      <div class="world-failed">
        <p>The 3D cabin could not start ({failed}). Switching to the 2D screen.</p>
        <button class="btn primary" onClick={onUse2D}>
          Use the 2D screen
        </button>
      </div>
    );
  }

  const you = game.you;
  const kind = game.phase.kind;
  const needsInput =
    !!you &&
    you.status === 'alive' &&
    !you.buckled &&
    ((kind === 'night_move' && (game.mine?.move === null || (you.role === 'pilot' && game.mine?.seatbelt === null))) ||
      (kind === 'night_act' && !game.mine?.acted) ||
      (kind === 'day_vote' && game.mine?.vote === null));
  const useIt = TOUCH ? 'tap your screen' : 'click your screen or press E';
  const hint = needsInput
    ? `Your move: ${useIt}`
    : TOUCH
      ? 'Drag to look around · tap your screen to use it'
      : locked
        ? 'Aim at your screen and click to use it · Esc frees the mouse'
        : 'Click to look around · click your screen (or press E) to use it';

  return (
    <div class={`world${leaning ? ' leaning' : ''}`}>
      <div class="world-canvas" ref={host} />
      {!leaning && (
        <div class="world-hud">
          <div class="hud-top">
            <div class="hud-chip hud-phase">
              <span class="hud-title">{phaseTitle(game)}</span>
              {kind !== 'ended' && <span class={`hud-clock${ctx.left < 10_000 ? ' urgent' : ''}`}>{clock(ctx.left)}</span>}
            </div>
            <div class="hud-actions">
              <button class="hud-chip hud-button" onClick={onUse2D}>
                2D screen
              </button>
              <button class="hud-chip hud-button" onClick={() => setLeavingOpen(true)}>
                Leave
              </button>
            </div>
          </div>
          {!TOUCH && <div class={`crosshair${aim ? ' on' : ''}`} />}
          <div class={`hud-hint${needsInput ? ' urgent' : ''}`}>{hint}</div>
          <div class="hud-overlay">
            <PhaseOverlay ctx={ctx} onLeave={() => setLeavingOpen(true)} />
          </div>
          {leavingOpen && (
            <div class="hud-overlay">
              <LeaveDialog flight={flight} onStay={() => setLeavingOpen(false)} />
            </div>
          )}
          {toast && (
            <div class="tv-toast" role="alert">
              {toast}
            </div>
          )}
        </div>
      )}
      {leaning && (
        <div class="world-tv">
          <TV flight={flight} snap={snap} state={state} embedded onClose={() => setLeaning(false)} />
        </div>
      )}
    </div>
  );
}
