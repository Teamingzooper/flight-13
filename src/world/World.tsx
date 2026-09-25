import { useEffect, useRef, useState } from 'preact/hooks';
import type { OpenFlight } from '../app/sessions';
import { grid, isNightPhase, type PlayerView } from '../engine';
import type { ClientSnapshot } from '../net/client';
import { EMOTES, canEmote } from '../net/emotes';
import { CoursePicker, PaPanel } from '../tv/PilotPanels';
import type { ClientState } from '../net/protocol';
import { canPa } from '../net/voiceRules';
import { captainName, clock, phaseTitle } from '../tv/format';
import { IconSound } from '../tv/icons';
import { PhaseOverlay, reopenPhaseCard, usePhaseOverlayOpen } from '../tv/Overlays';
import { usePacking } from '../tv/packing';
import { LeaveDialog, TV, useTVContext } from '../tv/TV';
import { VoiceButton, useVoice } from '../tv/VoiceButton';
import { cabinAudio } from './audio';
import { Cabin3D, type SceneKind } from './Cabin3D';
import { CockpitConsole } from './CockpitConsole';
import { RecorderScreen } from './RecorderScreen';
import { CONTROLS, atTheControls, controlAction, controlStatus, tapeReady, type ConsoleMode, type ControlId } from './cockpit';
import { PackingHud } from './PackingHud';
import { TutorialCoach, tutorialWaits } from '../tutorial/Coach';

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

/** How you are, drawn over the whole view (worst first): a ghost's white haze, restraints, a drugged sleep closing in, out cold, poison, the seatbelt sign. */
function statusFx(game: PlayerView): string | null {
  const you = game.you;
  if (!you) return null;
  if (you.status === 'dead') return 'dead';
  if (you.status === 'restrained') return 'restrained';
  if (you.asleep) return 'asleep';
  if (you.knockedOut) return 'knockedout';
  if (you.poisoned) return 'poisoned';
  if (you.buckled && isNightPhase(game.phase.kind)) return 'buckled';
  return null;
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
  const [skipped, setSkipped] = useState(false);
  /** The ending cutscene is playing: the end screen waits for it. */
  const [ending, setEnding] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [caption, setCaption] = useState<{ text: string; who: string; id: number } | null>(null);
  /** The captain's controls: the one the crosshair is on, the camera console, and the course and PA cards. */
  const [aimControl, setAimControl] = useState<ControlId | null>(null);
  const [consoleMode, setConsoleMode] = useState<ConsoleMode | null>(null);
  const [deckCard, setDeckCard] = useState<'course' | 'pa' | null>(null);
  /** The flight recorder, played in the cabin after landing. */
  const [recorderOpen, setRecorderOpen] = useState(false);
  const onControl = useRef<(id: ControlId) => void>(() => {});
  const [muted, toggleMute] = useMuted();
  const { ctx, toast } = useTVContext(flight, snap, state);
  const game = state.game!;
  const kind = game.phase.kind;
  /** You are the one on the PA right now. */
  const onAir = !!game.you && state.pa === game.you.id;
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
  // (The morning report also waits while you are still under your seat.)
  // The flight just ended here: its cutscene plays before any end card, from the very first render of the end
  // (the cabin only starts it after this render, and the card must not show ahead of it).
  const cutscene = ending || (kind === 'ended' && !!cabin.current?.endingAhead(game));
  const cardOpen = usePhaseOverlayOpen(game) && !holdReport && !cutscene && scene !== 'search';
  // Any window (the TV, a phase card, the leave dialog) frees the mouse; closing the last one captures it again.
  const windowOpen = leaning || cardOpen || leavingOpen || consoleMode !== null || deckCard !== null || recorderOpen;
  const mouseFree = windowOpen || preflight || cutscene;

  useEffect(() => {
    try {
      const c = new Cabin3D(host.current!, {
        onScreenClick: openScreen,
        onLockChange: setLocked,
        onAimChange: setAim,
        onPose: (pose) => flight.client.sendPose(pose),
        onCaption: (text, who = 'Captain') => setCaption({ text, who, id: Date.now() }),
        onScene: (kind, active) => {
          sceneRef.current = active ? kind : null;
          setScene(active ? kind : null);
        },
        onPack: (item) => packingRef.current.add(item),
        onUnpack: (slot) => packingRef.current.remove(slot),
        onEnding: setEnding,
        onControl: (id) => onControl.current(id),
        onAimControl: setAimControl,
      });
      c.setPoseSource(flight.client.poses);
      c.setFaceSource(flight.client.faces);
      c.setEmoteSource(flight.client.emotes);
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
  // Put the screen away for the ending (it would hide the cutscene behind its own end card).
  useEffect(() => {
    if (cutscene) setLeaning(false);
  }, [cutscene]);

  // The hotel room shows what you own and what is in the bag; you pick things up once your pass is read.
  useEffect(() => {
    if (kind === 'packing') cabin.current?.setPacking(packing.owned, packing.packed, !cardOpen && !leavingOpen && !packing.ready);
  });
  useEffect(() => {
    if (kind === 'packing' && !cardOpen) cabin.current?.startPacking();
  }, [kind, cardOpen]);

  // Boarding plays by itself; Space, Enter or Esc (or the button) skips straight to your seat.
  const skipBoarding = () => {
    setSkipped(true);
    cabin.current?.skipBoarding();
  };
  useEffect(() => {
    setSkipped(false);
    if (kind !== 'boarding') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        skipBoarding();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [kind]);
  // The ending can be skipped the same way.
  useEffect(() => {
    if (!ending) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        cabin.current?.skipEnding();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [ending]);

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

  const deckOpen = consoleMode !== null || deckCard !== null || recorderOpen;
  const closeRecorder = () => {
    setRecorderOpen(false);
    reopenPhaseCard();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (preflight) return;
      // Esc puts away whatever the captain has open on the flight deck (even from the PA text box).
      if (deckOpen && e.key === 'Escape') {
        setConsoleMode(null);
        setDeckCard(null);
        if (recorderOpen) closeRecorder();
        return;
      }
      if (typing || deckOpen) return;
      // Esc also hangs up the PA handset.
      if (onAir && !leaning && e.key === 'Escape') {
        flight.client.sendPa(false);
        return;
      }
      if (!leaning && (e.key === 'e' || e.key === 'E' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        openScreen();
      } else if (leaning && e.key === 'Escape') {
        setLeaning(false);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [leaning, preflight, deckOpen, onAir, recorderOpen]);

  // A new phase puts the console and the cards away (the calls they make belong to the phase before).
  useEffect(() => {
    setConsoleMode(null);
    setDeckCard(null);
    setRecorderOpen(false);
  }, [kind, game.phase.night]);

  // Voice chat plays from where people sit in the 3D cabin; M mutes you.
  const voice = useVoice(flight);
  useEffect(() => {
    cabin.current?.setVoice(voice);
    return () => cabin.current?.setVoice(null);
  }, [voice]);
  useEffect(() => {
    if (!voice || voice.status !== 'on') return undefined;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (typing || e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'm' && e.key !== 'M')) return;
      voice.setMuted(!voice.muted);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [voice, voice?.status]);

  // Gestures by day: the bar at the bottom, or keys 1 to 5.
  const emoting = !!game.you && canEmote(kind, game.you.status) && !leaning && !scene && !ending && !cardOpen && !leavingOpen && !deckOpen;
  useEffect(() => {
    if (!emoting) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      const emote = EMOTES.find((x) => x.key === e.key);
      if (typing || !emote || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      flight.client.sendEmote(emote.id);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [emoting]);

  // The PA by day: the Pilot holds P (or the PA button) and the whole plane hears him.
  const paReady = voice?.status === 'on' && !voice.muted && !!game.you && canPa(game.you.role, game.you.status, kind) && !ending;
  const paName = state.pa && !onAir ? game.players.find((p) => p.id === state.pa)?.name : undefined;
  useEffect(() => {
    if (!paReady) return undefined;
    let held = false;
    const hold = (on: boolean) => {
      if (held === on) return;
      held = on;
      flight.client.sendPa(on);
    };
    const down = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (typing || e.repeat || e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'p' && e.key !== 'P')) return;
      e.preventDefault();
      hold(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'p' || e.key === 'P') hold(false);
    };
    // Letting go anywhere (or leaving the tab) takes you off the air.
    const release = () => hold(false);
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', release);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('blur', release);
      release();
    };
  }, [paReady]);

  // The captain's controls: open the console or a card, pick up the PA, or say why not.
  const freshTape = tapeReady(game);
  onControl.current = (id) => {
    const use = controlAction(game, id, freshTape);
    if (use.kind === 'console') setConsoleMode(use.mode);
    else if (use.kind === 'course') setDeckCard('course');
    else if (use.kind === 'pa') {
      if (paReady) flight.client.sendPa(!onAir);
      else setDeckCard('pa');
    } else setCaption({ text: use.why, who: CONTROLS[id].name, id: Date.now() });
  };

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
  const fx = statusFx(game);
  // What the vignette means, said once in the hint line.
  const fxHint =
    fx === 'asleep'
      ? 'Someone slipped you a sleeping pill. You are drifting off…'
      : fx === 'knockedout'
        ? 'You are out cold until morning.'
        : fx === 'dead' && !scene
          ? 'You are a ghost: watch on, and talk with the other ghosts.'
          : null;
  // The captain's own reminders: which control wants him now.
  const captain = atTheControls(game) && !scene && !you?.buckled && !you?.knockedOut;
  const deckHint = !captain
    ? null
    : kind === 'night_move' && game.mine?.seatbelt === null
      ? 'Your call: look up and flip the seatbelt switch overhead'
      : kind === 'night_act' && !game.mine?.acted
        ? 'Aim the cabin cameras: click the monitor on the pedestal'
        : freshTape && (kind === 'dawn' || kind === 'day_discuss')
          ? 'Last night’s tape is ready: click the camera monitor'
          : null;
  const idleHint = TOUCH
    ? 'Use screen · drag to look around'
    : locked
      ? 'Aim at your screen and click to use it · Esc frees the mouse'
      : 'Click to look around · click your screen (or press E) to use it';
  const crewRow = grid.aisleRow(you?.seat);
  const hint =
    scene === 'walk'
      ? crewRow !== null
        ? `Walking the cart to row ${crewRow}…`
        : grid.isCockpit(you?.seat)
          ? 'Walking to the flight deck…'
          : `Walking to seat ${you?.seat ?? ''}…`
      : scene === 'search'
        ? you?.inWashroom
          ? 'Searching the lavatory…'
          : 'Looking under your seat…'
        : fxHint
          ? fxHint
          : deckHint
            ? deckHint
            : needsInput
            ? `Your move: ${useIt}`
            : idleHint;
  const hasScreen = !!you?.seat && !scene;

  return (
    <div class={`world${leaning ? ' leaning' : ''}`}>
      <div class="world-canvas" ref={host} />
      {fx && !cutscene && <div class={`status-fx ${fx}`} aria-hidden="true" />}
      {!leaning && (
        <div class="world-hud">
          {kind === 'boarding' && you && !skipped && (
            <button class="hud-chip hud-button boarding-skip" onClick={skipBoarding}>
              Skip to your seat ›
            </button>
          )}
          {ending && (
            <button class="hud-chip hud-button boarding-skip" onClick={() => cabin.current?.skipEnding()}>
              Skip ›
            </button>
          )}
          <div class={`hud-top${(kind === 'boarding' && !skipped) || ending ? ' hidden' : ''}`}>
            <div class="hud-chip hud-phase">
              <span class="hud-title">{phaseTitle(game)}</span>
              {kind !== 'ended' && !tutorialWaits(state) && <span class={`hud-clock${ctx.left < 10_000 ? ' urgent' : ''}`}>{clock(ctx.left)}</span>}
            </div>
            <div class="hud-actions">
              <button class="hud-chip hud-button hud-icon" onClick={toggleMute} aria-label={muted ? 'Sound off' : 'Sound on'} title={muted ? 'Sound off' : 'Sound on'}>
                <IconSound muted={muted} />
              </button>
              <VoiceButton flight={flight} className="hud-chip hud-button" />
              <button class="hud-chip hud-button" onClick={onUse2D}>
                2D screen
              </button>
              <button class="hud-chip hud-button" onClick={() => setLeavingOpen(true)}>
                Leave
              </button>
            </div>
          </div>
          {!TOUCH && !preflight && !ending && <div class={`crosshair${aim ? ' on' : ''}`} />}
          {!ending && !cardOpen && <TutorialCoach state={state} className="hud-coach" />}
          {aimControl && !deckOpen && !ending && (
            <div class="hud-aim-label" aria-hidden="true">
              <b>{CONTROLS[aimControl].name}</b>
              <span>{controlStatus(game, aimControl, onAir, freshTape)}</span>
            </div>
          )}
          {consoleMode && cabin.current && (
            <div class="hud-overlay deck-overlay">
              <CockpitConsole ctx={ctx} cabin={cabin.current} mode={consoleMode} onClose={() => setConsoleMode(null)} />
            </div>
          )}
          {recorderOpen && kind === 'ended' && cabin.current && (
            <div class="hud-overlay deck-overlay">
              <RecorderScreen ctx={ctx} cabin={cabin.current} onClose={closeRecorder} />
            </div>
          )}
          {deckCard && (
            <div class="hud-overlay deck-overlay">
              <div class="deck-card">
                {deckCard === 'course' ? <CoursePicker ctx={ctx} /> : <PaPanel ctx={ctx} />}
                <div class="row">
                  <button type="button" class="btn small" onClick={() => setDeckCard(null)}>
                    Done (Esc)
                  </button>
                </div>
              </div>
            </div>
          )}
          {kind === 'packing' && you && !cardOpen && <PackingHud game={game} packing={packing} onRole={reopenPhaseCard} />}
          {caption && (
            <div class="hud-caption" key={caption.id} role="status">
              <span class="who">{caption.who}</span>
              {caption.text}
            </div>
          )}
          {paReady && (
            <button
              type="button"
              class={`hud-chip hud-button pa-button${onAir ? ' on-air' : ''}`}
              title="Hold to talk to the whole plane"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                flight.client.sendPa(true);
              }}
              onPointerUp={() => flight.client.sendPa(false)}
              onPointerCancel={() => flight.client.sendPa(false)}
              onLostPointerCapture={() => flight.client.sendPa(false)}
            >
              {onAir ? (
                <>
                  <i class="rec" aria-hidden="true" /> On air
                </>
              ) : (
                <>
                  <span aria-hidden="true">📢</span> Hold for PA{!TOUCH && <kbd>P</kbd>}
                </>
              )}
            </button>
          )}
          {paName && (
            <div class="hud-chip pa-live" role="status">
              <i class="rec" aria-hidden="true" /> {captainName(paName)} on the PA
            </div>
          )}
          {emoting && (
            <div class="emote-bar" role="toolbar" aria-label="Gestures">
              {EMOTES.map((e) => (
                <button key={e.id} type="button" title={`${e.name}${TOUCH ? '' : ` (${e.key})`}`} aria-label={e.name} onClick={() => flight.client.sendEmote(e.id)}>
                  {e.icon}
                  {!TOUCH && <kbd>{e.key}</kbd>}
                </button>
              ))}
            </div>
          )}
          {preflight || ending || deckOpen ? null : TOUCH && hasScreen ? (
            <button class={`hud-hint hud-use${needsInput ? ' urgent' : ''}`} onClick={openScreen}>
              {hint}
            </button>
          ) : (
            <div class={`hud-hint${needsInput ? ' urgent' : ''}`}>{hint}</div>
          )}
          {!holdReport && !cutscene && scene !== 'search' && (
            <div class="hud-overlay">
              <PhaseOverlay ctx={ctx} onLeave={() => setLeavingOpen(true)} onRecorder={() => setRecorderOpen(true)} />
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
      {leaning && !cutscene && (
        <div class="world-tv">
          <TV flight={flight} snap={snap} state={state} embedded onClose={() => setLeaning(false)} />
        </div>
      )}
    </div>
  );
}
