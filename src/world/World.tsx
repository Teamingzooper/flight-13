import { useEffect, useRef, useState } from 'preact/hooks';
import type { OpenFlight } from '../app/sessions';
import type { ClientSnapshot } from '../net/client';
import type { ClientState } from '../net/protocol';
import { clock, phaseTitle } from '../tv/format';
import { IconSound } from '../tv/icons';
import { PhaseOverlay, reopenPhaseCard, usePhaseOverlayOpen } from '../tv/Overlays';
import { usePacking } from '../tv/packing';
import { LeaveDialog, TV, useTVContext } from '../tv/TV';
import { cabinAudio } from './audio';
import { Cabin3D, type SceneKind } from './Cabin3D';
import { PackingHud } from './PackingHud';

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
  /** A scripted moment in progress: walking to a seat, looking under it, glancing at a blast. */
  const [scene, setScene] = useState<SceneKind | null>(null);
  const sceneRef = useRef<SceneKind | null>(null);
  const [locked, setLocked] = useState(false);
  const [aim, setAim] = useState(false);
  const [leavingOpen, setLeavingOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [caption, setCaption] = useState<{ text: string; id: number } | null>(null);
  const [muted, toggleMute] = useMuted();
  const { ctx, toast } = useTVContext(flight, snap, state);
  const game = state.game!;
  const kind = game.phase.kind;
  /** Packing in the hotel room and boarding: no seat, no screen, the mouse stays free. */
  const preflight = kind === 'packing' || kind === 'boarding';
  const packing = usePacking(ctx);
  const packingRef = useRef(packing);
  packingRef.current = packing;
  /** Use the seatback screen, unless you are halfway down the aisle (or under your seat). */
  const openScreen = () => {
    if (!sceneRef.current) setLeaning(true);
  };

  // Let the lights come up (and a blast play out) before the morning report covers the cabin.
  const blastAtDawn = kind === 'dawn' && game.bombs.some((b) => b.exploded && b.detonateNight === game.phase.night);
  const holdReport = useHold(`${kind}:${game.phase.night}`, kind === 'dawn' ? (blastAtDawn ? 5200 : 1500) : 0);
  const cardOpen = usePhaseOverlayOpen(game) && !holdReport;
  // Any window (the TV, a phase card, the leave dialog) frees the mouse; closing the last one captures it again.
  const windowOpen = leaning || cardOpen || leavingOpen;
  const mouseFree = windowOpen || preflight;

  useEffect(() => {
    try {
      const c = new Cabin3D(host.current!, {
        onScreenClick: openScreen,
        onLockChange: setLocked,
        onAimChange: setAim,
        onPose: (pose) => flight.client.sendPose(pose),
        onCaption: (text) => setCaption({ text, id: Date.now() }),
        onScene: (kind, active) => {
          sceneRef.current = active ? kind : null;
          setScene(active ? kind : null);
        },
        onPack: (item) => packingRef.current.add(item),
        onUnpack: (slot) => packingRef.current.remove(slot),
      });
      c.setPoseSource(flight.client.poses);
      c.setFaceSource(flight.client.faces);
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

  // The hotel room shows what you own and what is in the bag; you pick things up once your pass is read.
  useEffect(() => {
    if (kind === 'packing') cabin.current?.setPacking(packing.owned, packing.packed, !cardOpen && !leavingOpen && !packing.ready);
  });
  useEffect(() => {
    if (kind === 'packing' && !cardOpen) cabin.current?.startPacking();
  }, [kind, cardOpen]);

  const wasOpen = useRef(mouseFree);
  useEffect(() => {
    if (wasOpen.current === mouseFree) return;
    wasOpen.current = mouseFree;
    if (mouseFree) cabin.current?.unlockPointer();
    else cabin.current?.lockPointer();
  }, [mouseFree]);

  // A scripted moment (changing seats, searching, a blast): put the screen away and capture the mouse;
  // after a walk or a search, open the screen again where you are now.
  const reopen = useRef(false);
  useEffect(() => {
    if (scene) {
      reopen.current = leaning && scene !== 'glance';
      if (leaning) setLeaning(false);
      else if (!windowOpen) cabin.current?.lockPointer();
    } else if (reopen.current) {
      reopen.current = false;
      setLeaning(true);
    }
  }, [scene]);

  useEffect(() => {
    if (!caption) return undefined;
    const id = setTimeout(() => setCaption(null), CAPTION_MS);
    return () => clearTimeout(id);
  }, [caption]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (typing || preflight) return;
      if (!leaning && (e.key === 'e' || e.key === 'E' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        openScreen();
      } else if (leaning && e.key === 'Escape') {
        setLeaning(false);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [leaning, preflight]);

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
  const needsInput =
    !scene &&
    !!you &&
    you.status === 'alive' &&
    !you.buckled &&
    ((kind === 'night_move' && (game.mine?.move === null || (you.role === 'pilot' && game.mine?.seatbelt === null))) ||
      (kind === 'night_act' && !game.mine?.acted) ||
      (kind === 'day_vote' && game.mine?.vote === null));
  const useIt = TOUCH ? 'use your screen' : 'click your screen or press E';
  const idleHint = TOUCH
    ? 'Use screen · drag to look around'
    : locked
      ? 'Aim at your screen and click to use it · Esc frees the mouse'
      : 'Click to look around · click your screen (or press E) to use it';
  const hint =
    scene === 'walk'
      ? `Walking to seat ${you?.seat ?? ''}…`
      : scene === 'search'
        ? 'Looking under your seat…'
        : needsInput
          ? `Your move: ${useIt}`
          : idleHint;
  const hasScreen = !!you?.seat && !scene;

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
          {!TOUCH && !preflight && <div class={`crosshair${aim ? ' on' : ''}`} />}
          {kind === 'packing' && you && !cardOpen && <PackingHud game={game} packing={packing} onRole={reopenPhaseCard} />}
          {caption && (
            <div class="hud-caption" key={caption.id} role="status">
              <span class="who">Captain</span>
              {caption.text}
            </div>
          )}
          {preflight ? null : TOUCH && hasScreen ? (
            <button class={`hud-hint hud-use${needsInput ? ' urgent' : ''}`} onClick={openScreen}>
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
