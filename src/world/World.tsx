import { useEffect, useRef, useState } from 'preact/hooks';
import type { OpenFlight } from '../app/sessions';
import type { ClientSnapshot } from '../net/client';
import type { ClientState } from '../net/protocol';
import { clock, phaseTitle } from '../tv/format';
import { IconSound } from '../tv/icons';
import { PhaseOverlay } from '../tv/Overlays';
import { LeaveDialog, TV, useTVContext } from '../tv/TV';
import { cabinAudio } from './audio';
import { Cabin3D } from './Cabin3D';

const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const CAPTION_MS = 5200;

/** True for `ms` after `key` first shows up (0 = never held). */
function useHold(key: string, ms: number): boolean {
  const [released, setReleased] = useState<string | null>(null);
  useEffect(() => {
    if (ms <= 0) return undefined;
    const id = setTimeout(() => setReleased(key), ms);
    return () => clearTimeout(id);
  }, [key, ms]);
  return ms > 0 && released !== key;
}

function useMuted(): [boolean, () => void] {
  const [muted, setMuted] = useState(cabinAudio.muted);
  useEffect(() => cabinAudio.subscribe(() => setMuted(cabinAudio.muted)), []);
  return [muted, () => cabinAudio.setMuted(!cabinAudio.muted)];
}

/** The 3D cabin with a minimal HUD; lean into the seatback screen to use the TV. */
export function World({ flight, snap, state, onUse2D }: { flight: OpenFlight; snap: ClientSnapshot; state: ClientState; onUse2D: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const cabin = useRef<Cabin3D | null>(null);
  const [leaning, setLeaning] = useState(false);
  const [locked, setLocked] = useState(false);
  const [aim, setAim] = useState(false);
  const [leavingOpen, setLeavingOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [caption, setCaption] = useState<{ text: string; id: number } | null>(null);
  const [muted, toggleMute] = useMuted();
  const { ctx, toast } = useTVContext(flight, snap, state);
  const game = state.game!;

  useEffect(() => {
    try {
      const c = new Cabin3D(host.current!, {
        onScreenClick: () => setLeaning(true),
        onLockChange: setLocked,
        onAimChange: setAim,
        onPose: (pose) => flight.client.sendPose(pose),
        onCaption: (text) => setCaption({ text, id: Date.now() }),
      });
      c.setPoseSource(flight.client.poses);
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
    if (!caption) return undefined;
    const id = setTimeout(() => setCaption(null), CAPTION_MS);
    return () => clearTimeout(id);
  }, [caption]);

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
  // Let the lights come up (and a blast play out) before the morning report covers the cabin.
  const blastAtDawn = kind === 'dawn' && game.bombs.some((b) => b.exploded && b.detonateNight === game.phase.night);
  const holdReport = useHold(`${kind}:${game.phase.night}`, kind === 'dawn' ? (blastAtDawn ? 3800 : 1500) : 0);
  const needsInput =
    !!you &&
    you.status === 'alive' &&
    !you.buckled &&
    ((kind === 'night_move' && (game.mine?.move === null || (you.role === 'pilot' && game.mine?.seatbelt === null))) ||
      (kind === 'night_act' && !game.mine?.acted) ||
      (kind === 'day_vote' && game.mine?.vote === null));
  const useIt = TOUCH ? 'use your screen' : 'click your screen or press E';
  const hint = needsInput
    ? `Your move: ${useIt}`
    : TOUCH
      ? 'Use screen · drag to look around'
      : locked
        ? 'Aim at your screen and click to use it · Esc frees the mouse'
        : 'Click to look around · click your screen (or press E) to use it';
  const hasScreen = !!you?.seat;

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
              <button class="hud-chip hud-button hud-icon" onClick={toggleMute} aria-label={muted ? 'Sound off' : 'Sound on'} title={muted ? 'Sound off' : 'Sound on'}>
                <IconSound muted={muted} />
              </button>
              <button class="hud-chip hud-button" onClick={onUse2D}>
                2D screen
              </button>
              <button class="hud-chip hud-button" onClick={() => setLeavingOpen(true)}>
                Leave
              </button>
            </div>
          </div>
          {!TOUCH && <div class={`crosshair${aim ? ' on' : ''}`} />}
          {caption && (
            <div class="hud-caption" key={caption.id} role="status">
              <span class="who">Captain</span>
              {caption.text}
            </div>
          )}
          {TOUCH && hasScreen ? (
            <button class={`hud-hint hud-use${needsInput ? ' urgent' : ''}`} onClick={() => setLeaning(true)}>
              {hint}
            </button>
          ) : (
            <div class={`hud-hint${needsInput ? ' urgent' : ''}`}>{hint}</div>
          )}
          {!holdReport && (
            <div class="hud-overlay">
              <PhaseOverlay ctx={ctx} onLeave={() => setLeavingOpen(true)} />
            </div>
          )}
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
