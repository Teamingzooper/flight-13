import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { destinationOf, grid, hasTwist, isNightPhase, phaseDurationMs, type Cell, type PlaneId, type ItemId, type PlayerView, type SeatId } from '../engine';
import { msLeft, type ClientSnapshot } from '../net/client';
import { EMOTE_BY_ID, type EmoteId } from '../net/emotes';
import type { VoiceChat } from '../net/voice';
import type { ClientState, Pose } from '../net/protocol';
import { cabinAudio } from './audio';
import { SeatControls } from './controls';
import { directorCues, type Cue } from './director';
import { BULKHEAD_Z, colX, eyePosition, rowZ, seatPose } from './layout';
import { Lighting, type LightMode } from './lighting';
import { buildCabin, type CabinParts } from './scene/cabin';
import { Cart } from './scene/cart';
import { Effects } from './scene/effects';
import { ForwardView, type ViewMode } from './forwardview';
import { FlightDisplay, type Attitude } from './instruments';
import { buildFlightDeck, type FlightDeck } from './scene/flightdeck';
import { buildLavatory, type LavatoryInterior } from './scene/lavatory';
import { People } from './scene/people';
import { SCREEN_H, SCREEN_W, buildSeats, type SeatParts } from './scene/seats';
import { BOARDING_SHOTS, FADE, boardingMoment } from './boarding';
import { EndingDirector } from './endings';
import { LiveScreen } from './screen';
import { GateSet } from './sets/gate';
import { HotelSet } from './sets/hotel';
import { auroraSkyTexture, dawnSkyTexture, runwayTexture } from './textures';
import { WindowView } from './windows';
import { personality } from '../bots/personality';
import { proximityGain } from '../net/voiceRules';
import { planBabble } from './babble';
import { atTheControls, deckLook, type ControlId } from './cockpit';
import { buildStaircase } from './scene/staircase';
import { clipAt, type Clip, type Tape } from './tape';
import type { Actor } from './scene/people';

export interface Cabin3DOptions {
  onScreenClick: () => void;
  onLockChange?: (locked: boolean) => void;
  onAimChange?: (onScreen: boolean) => void;
  /** Your look direction and screen use, throttled, for the pose channel. */
  onPose?: (pose: Pose) => void;
  /** An announcement to show as a caption, and who is speaking (the captain unless said otherwise). */
  onCaption?: (text: string, who?: string) => void;
  /** A scripted moment started or finished: walking to a new seat, searching under it, or glancing at a blast. */
  onScene?: (kind: SceneKind, active: boolean) => void;
  /** Packing in the hotel room: an item picked up from the bed, or taken back out of a slot. */
  onPack?: (item: ItemId) => void;
  onUnpack?: (slot: number) => void;
  /** The ending cutscene started (true) or finished (false): hold the end screen until it is over. */
  onEnding?: (playing: boolean) => void;
  /** The captain clicked one of his controls on the flight deck. */
  onControl?: (id: ControlId) => void;
  /** The crosshair moved onto one of the captain's controls (or off them: null). */
  onAimControl?: (id: ControlId | null) => void;
}

/** The camera console: the cabin cameras drawn into `screen` (an element over the canvas), and last night's tape. */
export interface ConsoleView {
  screen: HTMLElement;
  startRow: number;
  tape: Tape | null;
  /**
   * The flight recorder at the end of the flight: shown from any seat, only the reel's stand-ins appear (nobody from
   * the cabin as it is now), and the camera follows each clip's row.
   */
  recorder?: boolean;
}

export type SceneKind = 'walk' | 'search' | 'glance';

/** A cabin camera in the ceiling at the front of `start`'s three rows, looking back down them. */
function aimCabinCamera(cam: THREE.PerspectiveCamera, start: number): void {
  cam.position.set(0.25, 2.05, rowZ(start) - 0.7);
  cam.lookAt(-0.1, 0.55, rowZ(start + 2) + 0.2);
}

/** The console's view of the same rows: steeper, so the three rows fill the big screen. */
function aimConsoleCamera(cam: THREE.PerspectiveCamera, start: number): void {
  cam.position.set(0.3, 2.05, rowZ(start) - 0.6);
  cam.lookAt(-0.05, 0.4, rowZ(start + 1) + 0.3);
}

/** A night away from your seat: in the lavatory, or up on the flight deck. */
type Away = 'wc' | 'deck' | null;

interface Built {
  rows: number;
  plane: PlaneId;
  cabin: CabinParts;
  seats: SeatParts;
  lavatory: LavatoryInterior;
  flightDeck: FlightDeck;
  lighting: Lighting;
  windows: WindowView;
  effects: Effects;
  skies: { day: THREE.Texture; night: THREE.Texture; dawn: THREE.Texture; aurora: THREE.Texture; runway: THREE.Texture };
  group: THREE.Group;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Cruise power for the engine drone. */
const CRUISE = 0.45;
/** Seconds between a bomb starting to beep (and everyone looking at it) and the blast. */
const PREROLL = 1.25;

const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Where the i-th restrained passenger stands: the crew alcove behind the last right-hand row, then the
 * aft aisle, then the gap in front of the lavatory.
 */
function rearSpot(rows: number, i: number): THREE.Vector3 {
  const partition = rowZ(rows) + 0.62;
  if (i < 4) return new THREE.Vector3(0.55 + i * 0.34, 0, partition + 0.14);
  if (i < 7) return new THREE.Vector3(0, 0, partition + 0.42 + (i - 4) * 0.4);
  return new THREE.Vector3(-0.55 - ((i - 7) % 4) * 0.34, 0, partition - 0.13);
}

/** The 3D cabin seen from your seat. Framework-free; the World component drives it. */
export class Cabin3D {
  static supported(): boolean {
    try {
      const canvas = document.createElement('canvas');
      return !!canvas.getContext('webgl2');
    } catch {
      return false;
    }
  }

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(68, 1, 0.03, 60);
  private readonly composer: EffectComposer;
  private readonly controls: SeatControls;
  private readonly timer = new THREE.Timer();
  private readonly liveScreen = new LiveScreen();
  private readonly liveMesh: THREE.Mesh;
  private readonly people = new People();
  private poseSource: Map<string, Pose> | null = null;
  private faceSource: ReadonlyMap<string, string> | null = null;
  /** Everyone's latest gesture (the client's live map), and the last one played for each. */
  private emoteSource: ReadonlyMap<string, { emote: EmoteId; seq: number }> | null = null;
  private readonly emoteSeen = new Map<string, number>();
  /** Emoji bubbles over the heads of people gesturing. */
  private readonly bubbles = document.createElement('div');
  private readonly bubbleEls = new Map<string, { el: HTMLDivElement; until: number }>();
  /** What people said out loud in the cabin, over their heads for a few seconds. */
  private readonly speechEls = new Map<string, { el: HTMLDivElement; until: number }>();
  /** The last chat line heard (the chat already there when you arrive stays quiet). */
  private lastChat: number | null = null;
  /** Voice chat: it listens from your camera, places voices at people's heads, and says who is talking. */
  private voice: VoiceChat | null = null;
  private readonly talkEls = new Map<string, HTMLDivElement>();
  private lastPose: Pose | null = null;
  private lastPoseAt = 0;
  private youId: string | null = null;
  private readonly cart = new Cart();
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private built: Built | null = null;
  private seatKey: string | null = null;
  /** You work the aisle and the cart is at your row: your tablet screen rolls with it. */
  private tabletFollows = false;
  /** The flight deck: the view through the windscreen, the flight displays, and how the plane is flying. */
  private readonly forwardView = new ForwardView();
  private readonly display = new FlightDisplay();
  private attitude: Attitude = { speed: 0, altitude: 0, pitch: 0, roll: 0 };
  private viewMode: ViewMode = 'runway';
  private viewSpeed = 0;
  /** Who was on the PA at the last update (to ding once when someone goes on the air). */
  private onAir: string | null = null;
  /** The cabin camera the Pilot's monitor shows: a small render from the ceiling over three rows. */
  private readonly cctv = {
    target: new THREE.WebGLRenderTarget(256, 160),
    camera: new THREE.PerspectiveCamera(72, 256 / 160, 0.05, 30),
    renderedAt: -Infinity,
    /** The cameras see in the dark: a light that only shines while they render. */
    nightVision: new THREE.AmbientLight('#c8ffd8', 0),
  };
  /** An ending holding the flight deck door open or shut (null: people walking through open it). */
  private cockpitDoor: boolean | null = null;
  /** The endings' landing: the runway comes up to meet the flight deck. */
  private landingView = false;
  private landingFrom = 0;
  private state: ClientState | null = null;
  private snap: ClientSnapshot | null = null;
  private aimOnScreen = false;
  private aimControl: ControlId | null = null;
  /** The camera console, while open, and the tape it plays. */
  private consoleView: ConsoleView | null = null;
  /** The console's own camera (the monitor's keeps its small frame). */
  private readonly consoleCam = new THREE.PerspectiveCamera(62, 1.6, 0.05, 30);
  private tape: { plan: Tape; start: number; cast: Map<string, Actor> } | null = null;
  /** The row the flight recorder's camera is on (the last clip that named one). */
  private followRow: number | null = null;
  /** Where everyone sat on the night the cameras last ran (the tape puts them back there). */
  private nightSeats: { night: number; seats: Map<string, SeatId> } | null = null;
  private disposed = false;
  /** The previous view, for the director to compare against. */
  private lastView: PlayerView | null = null;
  private wantedMode: LightMode = 'day';
  /** After a blast the cabin stays dark for a moment before the lights stutter on. */
  private darkUntil = 0;
  private time = 0;
  private readonly timers: { at: number; fn: () => void }[] = [];
  private captionAt = 0;
  private flash = 0;
  private readonly flashEl = document.createElement('div');
  private turbulentNight: number | null = null;
  private nextBump = 0;
  private gearUp = false;
  private engine = CRUISE;
  /** Your phone flashlight, for looking under your seat. */
  private readonly flashlight = new THREE.SpotLight('#fff1dc', 0, 5, 0.5, 0.55, 1.6);
  private searching = false;
  /** Blast victims stay upright until their bomb actually goes off on screen. */
  private readonly holdAlive = new Set<string>();
  /** Extra delay for announcements when a blast plays first. */
  private batchDelay = 0;
  /** With several blasts at once, the one everyone turns to (the nearest). */
  private glanceAt: THREE.Vector3 | null = null;
  private readonly unlockAudio = () => cabinAudio.unlock();
  /** The hotel room you pack in before the flight (only while packing and zipping up). */
  private hotel: HotelSet | null = null;
  /** Gate 13, for the boarding queue and the boarding pass scan. */
  private gate: GateSet | null = null;
  private showing: 'cabin' | 'hotel' | 'gate' = 'cabin';
  private shownScene: THREE.Scene;
  /** This boarding: your walk down the aisle has started, or you skipped the lot. */
  private walkedIn = false;
  private boardingSkipped = false;
  /** Development: pin the boarding sequence at this many seconds (null follows the phase clock). */
  debugBoardingAt: number | null = null;
  /** The ending playing now, when it started, and whether this game's ending is over (or was skipped). */
  private ending: EndingDirector | null = null;
  private endingFrom = 0;
  private endingSettled = false;
  private endingShake = 0;
  /** Black between scenes. */
  private readonly fadeEl = document.createElement('div');
  private readonly fadeText = document.createElement('div');
  private dark = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: Cabin3DOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.25 : 1.75));
    this.renderer.shadowMap.enabled = !TOUCH;
    // Not PCFSoftShadowMap: three.js dropped it and swaps in PCF at the first shadow pass, but shaders compiled
    // before then keep the old shadow code, and draws with them go dark (the camera monitor was nearly black).
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('world-gl');

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    this.scene.background = new THREE.Color('#05070c');
    pmrem.dispose();

    this.liveMesh = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), this.liveScreen.material);
    this.liveMesh.matrixAutoUpdate = false;
    this.liveMesh.visible = false;
    this.scene.add(this.liveMesh, this.people.group, this.cart.group, this.camera, this.cctv.nightVision);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.shownScene = this.scene;
    const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.82, luminanceSmoothing: 0.2, intensity: 0.75, radius: 0.65 });
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.6 });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY });
    noise.blendMode.opacity.value = 0.07;
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.composer.addPass(new EffectPass(this.camera, bloom, vignette, noise, tone));
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect()));

    this.controls = new SeatControls(this.camera, this.renderer.domElement, {
      onTap: (ndc) => this.tap(ndc),
      onLockChange: (locked) => opts.onLockChange?.(locked),
      onStep: () => cabinAudio.step(),
      onRustle: () => cabinAudio.rustle(),
      onFlashlight: (on) => {
        // (The lit lavatory is tiny: a dimmer beam there.)
        this.flashlight.intensity = on ? (this.seatKey?.startsWith('wc:') ? 1.6 : 9) : 0;
        cabinAudio.click();
      },
      onScript: (kind, active) => {
        if (kind === 'search') this.searching = active;
        opts.onScene?.(kind, active);
      },
    });
    this.flashlight.position.set(0.06, -0.06, 0);
    this.flashlight.target.position.set(0, -0.12, -1);
    this.camera.add(this.flashlight, this.flashlight.target);

    this.flashEl.className = 'world-flash';
    container.appendChild(this.flashEl);
    this.fadeEl.className = 'world-fade';
    this.fadeText.className = 'world-fade-text';
    this.fadeEl.appendChild(this.fadeText);
    this.bubbles.className = 'world-emotes';
    container.appendChild(this.bubbles);
    container.appendChild(this.fadeEl);
    cabinAudio.start();
    addEventListener('pointerdown', this.unlockAudio);
    addEventListener('keydown', this.unlockAudio);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.timer.connect(document);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Apply the latest game state. Cheap to call on every update. */
  update(state: ClientState, snap: ClientSnapshot): void {
    this.state = state;
    this.snap = snap;
    // Ding-dong before the captain speaks on the PA.
    if (state.pa && state.pa !== this.onAir) cabinAudio.ding();
    this.onAir = state.pa ?? null;
    const game = state.game;
    if (!game) return;
    this.hearChat(game, state);
    const plane = game.settings.plane ?? 'airliner';
    const fresh = !this.built || this.built.rows !== game.cabin.rows || this.built.plane !== plane;
    if (fresh) this.build(game.cabin.rows, game.cabin.cols ?? grid.SEAT_COLS, plane);
    const { cabin, lighting, windows, effects, skies } = this.built!;
    const kind = game.phase.kind;
    const night = isNightPhase(kind);
    this.wantedMode = night ? 'night' : game.blackout ? 'blackout' : 'day';
    if (fresh) lighting.setMode(this.wantedMode, true);

    // Before the flight: packing in the hotel room, then boarding. The control tower just waits.
    if (kind === 'packing') {
      if (game.you) this.enterHotel();
      else this.fade(1, 0, 'The passengers are packing their bags');
    } else if (kind === 'boarding') {
      // The boarding sequence plays frame by frame from the phase clock (see boardingFrame).
      this.hotel?.close();
      if (!game.you) this.fade(1, 0, `Now boarding · Flight 13 to ${destinationOf(game.settings).city}`);
    } else {
      this.endPreflight();
      if (this.dark) this.fade(0, 1.4);
    }

    const prev = this.lastView;
    const cues = game === prev ? [] : directorCues(prev, game);
    this.lastView = game;
    const blast = cues.some((c) => c.kind === 'explosion');
    this.batchDelay = blast ? PREROLL + 0.6 : 0;
    this.glanceAt = null;
    if (blast && this.built) {
      let best = Infinity;
      for (const c of cues) {
        if (c.kind !== 'explosion' || c.centers.length === 0) continue;
        const at = this.built.effects.blastPoint(c.centers[0], c.where);
        const d = at.distanceTo(this.camera.position);
        if (d < best) {
          best = d;
          this.glanceAt = at;
        }
      }
    }
    // People caught in a blast stay upright until it goes off on screen.
    for (const c of cues) if (c.kind === 'explosion') for (const id of c.victims) this.holdAlive.add(id);
    // The Bermuda Triangle's nights have aurora skies, wherever the flight is headed.
    const bermuda = hasTwist(destinationOf(game.settings), 'triangle');
    const grounded = kind === 'packing' || kind === 'boarding' || kind === 'takeoff';
    const sky = grounded ? skies.runway : night ? (bermuda ? skies.aurora : skies.night) : kind === 'dawn' ? skies.dawn : skies.day;
    windows.show(sky, fresh || grounded ? 0 : 1.4);
    // Through the windscreen: the runway on the ground, then the sky for the time of day.
    this.viewMode = grounded ? 'runway' : night ? (bermuda ? 'aurora' : 'night') : kind === 'dawn' ? 'dawn' : 'day';
    if (kind !== 'ended') this.landingView = false;
    // The captain's controls show tonight's calls (and the handset is up while he is on the PA).
    this.built!.flightDeck.setLook(deckLook(game, !!game.you && state.pa === game.you.id));
    this.noteNightSeats(game);
    if (night && game.log.some((e) => e.tag === 'turbulence' && e.night === game.phase.night)) this.turbulentNight = game.phase.night;

    this.youId = game.you?.id ?? null;
    this.syncPeople(game);
    this.aimVotes(game);
    // Known bombs show as devices (planters, investigators, and anyone who found one under their seat).
    effects.devices.set(
      game.bombs
        .filter((b) => !b.exploded)
        .map((b) => ({
          id: b.id,
          place: b.location.kind === 'seat' ? { kind: 'seat' as const, cell: grid.parseSeat(b.location.seat)! } : { kind: b.location.kind },
        })),
      (place) => effects.devicePoint(place),
    );

    const seat = game.you?.seat ?? null;
    // A night away from your seat: locked in the lavatory, or up in the Pilot's jump seat.
    const alive = game.you?.status === 'alive';
    const away: Away = alive && game.you?.inWashroom ? 'wc' : alive && game.you?.inJumpSeat ? 'deck' : null;
    const key = seat ? (away ? `${away}:${seat}` : seat) : game.you ? 'aft' : 'tower';
    if (key !== this.seatKey) {
      const wasAway = /^(wc|deck):/.test(this.seatKey ?? '');
      const first = this.seatKey === null;
      const animate = !first && !away && !wasAway && seat !== null && this.seatKey !== 'aft' && this.seatKey !== 'tower';
      this.seatKey = key;
      if ((away || wasAway) && !first) {
        // Off for the night (or back to your seat at dawn) behind a quick fade.
        const text = away === 'wc' ? 'You slip into the lavatory and lock the door.' : away === 'deck' ? 'The captain calls you up to the flight deck.' : '';
        this.fade(1, 0.45, text);
        this.later(away ? 1.2 : 0.5, () => {
          if (this.seatKey !== key) return;
          this.placeCamera(seat, false, away);
          this.fade(0, 0.7);
        });
      } else {
        this.placeCamera(seat, animate, away);
      }
    }
    const crewRow = seat && !away ? grid.aisleRow(seat) : null;
    this.tabletFollows = crewRow !== null && !game.cabin.cartDestroyed && game.cabin.cartRow === crewRow;
    const runaway = cues.some((c) => c.kind === 'cartRoll' && c.runaway);
    this.cart.setRow(game.cabin.cartRow, game.cabin.cartDestroyed, runaway);
    cabin.lavatoryDoor.visible = !game.cabin.lavatoryDestroyed;

    // Only your own seatbelt sign lights up for you (who else is buckled stays secret; crew have none).
    const buckledSeat = seat && game.you?.buckled ? grid.parseSeat(seat) : null;
    cabin.lightSeatbelt(buckledSeat ? `${buckledSeat.row}${buckledSeat.col < grid.AISLE_COL ? 'L' : 'R'}` : null);

    // The ending tells its own story: no end-of-flight announcements over it.
    const narrated = kind === 'ended' && !!prev && !this.endingSettled;
    for (const cue of cues) if (!(narrated && cue.kind === 'pa')) this.play(cue, game);
    // The game is over: play how it ended (unless you only just arrived, on the end screen).
    if (kind === 'ended' && game.result && !this.ending && !this.endingSettled) {
      if (prev) this.startEnding(game);
      else this.endingSettled = true;
    }
    if (kind !== 'ended') this.endingSettled = false;
    if (prev && game.you && seat) {
      // You just looked under your seat: crouch down and see for yourself.
      if (game.you.searched && !prev.you?.searched) {
        if (game.you.inWashroom) this.controls.searchRoom();
        else this.controls.search();
      }
    }
    if (prev?.you?.status === 'alive' && game.you?.status === 'dead' && !this.holdAlive.has(game.you.id)) this.dieOnScreen();
    // Lasting damage comes from the state, so a reload shows the same cabin.
    effects.setScorched(game.cabin.scorched, (cell) => this.cellPoint(cell));
    const blasted = game.bombs.some((b) => b.exploded);
    if (blasted && !effects.masks.down && !cues.some((c) => c.kind === 'explosion')) effects.masks.setDown();
  }

  setLeaning(on: boolean): void {
    this.controls.setLeaning(on);
  }

  /** What you own and what is in the bag, while packing; `interactive` when you may pick things up. */
  setPacking(owned: Record<ItemId, number>, packed: readonly ItemId[], interactive: boolean): void {
    if (!this.hotel) return;
    this.hotel.setInventory(owned);
    this.hotel.setPacked(packed);
    this.hotel.setInteractive(interactive);
  }

  /** Toss the bag onto the bed (once your boarding pass has been read). */
  startPacking(): void {
    this.hotel?.start();
  }

  /**
   * The flight has just ended in front of you and its cutscene is about to play. This is true from the very
   * first render of the end, before `update` has started it, so no end card shows ahead of it.
   */
  endingAhead(game: PlayerView): boolean {
    return game.phase.kind === 'ended' && !!game.result && !this.ending && !this.endingSettled && this.lastView !== null && this.lastView !== game;
  }

  /** Skip the rest of the ending and go to the end screen. */
  skipEnding(): void {
    if (!this.ending) return;
    this.fade(1, 0.25);
    this.finishEnding();
  }

  private startEnding(game: PlayerView): void {
    const built = this.built!;
    this.controls.releaseLock();
    this.controls.suspended = true;
    this.ending = new EndingDirector(
      {
        renderer: this.renderer,
        container: this.container,
        camera: this.camera,
        people: this.people,
        windows: built.windows,
        faces: this.faceSource,
        showRunway: () => {
          built.windows.show(built.skies.runway, 0);
          this.landingView = true;
          this.landingFrom = this.time;
        },
        setCockpitDoor: (open) => (this.cockpitDoor = open),
        setLights: (mode) => (this.wantedMode = mode),
        masksDown: () => built.effects.masks.drop(),
        explode: (at) => built.effects.explode(at),
        shake: (amount) => (this.endingShake = Math.max(this.endingShake, amount)),
        flash: (amount) => (this.flash = Math.max(this.flash, amount)),
        fade: (black, seconds) => {
          this.dark = black > 0.5;
          this.fadeText.textContent = '';
          this.fadeEl.style.transition = `opacity ${seconds}s ease`;
          this.fadeEl.style.opacity = String(black);
        },
        caption: (text, who) => this.opts.onCaption?.(text, who),
        showSet: (scene, camera) => this.show(scene ?? this.scene, camera ?? this.camera),
      },
      game,
    );
    this.endingFrom = this.time;
    this.opts.onEnding?.(true);
  }

  private finishEnding(): void {
    this.ending?.dispose();
    this.ending = null;
    this.cockpitDoor = null;
    this.endingSettled = true;
    this.opts.onEnding?.(false);
  }

  /** Skip the boarding sequence: straight to your seat to wait for takeoff. */
  skipBoarding(): void {
    if (this.boardingSkipped || this.lastView?.phase.kind !== 'boarding') return;
    this.boardingSkipped = true;
    this.endPreflight();
    const seat = this.lastView.you?.seat ?? null;
    if (seat && this.built) this.placeCamera(seat, false);
    this.fade(0, 0.6);
  }

  /** Capture the mouse for looking around (desktop only; the browser may insist on a click first). */
  lockPointer(): void {
    this.controls.requestLock();
  }

  /** Give the mouse back, e.g. while a window is open. */
  unlockPointer(): void {
    this.controls.releaseLock();
  }

  /** Where remote poses come from (the client's live map). */
  setPoseSource(poses: Map<string, Pose>): void {
    this.poseSource = poses;
  }

  /** Where gestures come from (the client's emote map). Gestures made before now are not replayed. */
  setEmoteSource(emotes: ReadonlyMap<string, { emote: EmoteId; seq: number }>): void {
    this.emoteSource = emotes;
    for (const [id, e] of emotes) this.emoteSeen.set(id, e.seq);
  }

  /** Voice chat to position (null when it is not running). */
  setVoice(voice: VoiceChat | null): void {
    this.voice?.setListener(null);
    this.voice?.setPositionSource(null);
    this.voice = voice;
    voice?.setPositionSource((id) => {
      const actor = this.people.actor(id);
      if (!actor || actor.hidden) return null;
      const at = actor.joints.head.getWorldPosition(new THREE.Vector3());
      return [at.x, at.y, at.z];
    });
  }

  /** Where painted faces come from (the client's face map). */
  setFaceSource(faces: ReadonlyMap<string, string>): void {
    this.faceSource = faces;
  }

  /** Development helpers (exposed as window.cabin3d in dev builds). */
  get debug() {
    return { controls: this.controls, camera: this.camera, renderer: this.renderer, scene: this.scene };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    cabinAudio.stop();
    removeEventListener('pointerdown', this.unlockAudio);
    removeEventListener('keydown', this.unlockAudio);
    this.flashEl.remove();
    this.fadeEl.remove();
    this.bubbles.remove();
    this.hotel?.dispose();
    this.gate?.dispose();
    this.ending?.dispose();
    this.built?.windows.dispose();
    this.built?.effects.dispose();
    this.controls.dispose();
    this.timer.dispose();
    this.composer.dispose();
    this.liveScreen.dispose();
    this.forwardView.dispose();
    this.display.dispose();
    this.cctv.target.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) {
          for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
          m.dispose();
        }
      }
    });
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private build(rows: number, cols: readonly number[], plane: PlaneId): void {
    if (this.built) {
      this.scene.remove(this.built.group);
      this.built.lighting.dispose();
    }
    const group = new THREE.Group();
    const cabin = buildCabin(rows);
    const seats = buildSeats(rows, cols, plane === 'jet');
    const skies = { day: cabin.skyDay, night: cabin.skyNight, dawn: dawnSkyTexture(), aurora: auroraSkyTexture(), runway: runwayTexture() };
    const windows = new WindowView(cabin.windowGlass, skies.day);
    const lav = cabin.lavatoryDoor.position;
    const effects = new Effects(rows, seats, new THREE.Vector3(lav.x, 1.0, lav.z + 0.7), cols);
    const lavatory = buildLavatory(cabin.lavatory);
    const flightDeck = buildFlightDeck();
    flightDeck.setView(this.forwardView.texture);
    flightDeck.setDisplay(this.display.texture);
    const monitor = flightDeck.monitor.material as THREE.MeshBasicMaterial;
    monitor.map = this.cctv.target.texture;
    monitor.color.set('#cfe9dc');
    group.add(cabin.group, seats.group, effects.group, lavatory.group, flightDeck.group);
    // The jumbo's spiral staircase up to the upper deck, in the front galley.
    if (plane === 'jumbo') group.add(buildStaircase());
    this.scene.add(group);
    const lighting = new Lighting(this.scene, cabin, seats, windows, this.renderer.shadowMap.enabled);
    this.built = { rows, plane, cabin, seats, lavatory, flightDeck, lighting, windows, effects, skies, group };
    this.seatKey = null;
  }

  private placeCamera(seat: SeatId | null, animate: boolean, away: Away = null): void {
    const { seats, lighting, cabin, lavatory, flightDeck } = this.built!;
    seats.hideScreen(away ? null : seat);
    // The lavatory's inside is only drawn while you are in it.
    lavatory.group.visible = away === 'wc';
    const useScreen = (screen: THREE.Matrix4) => {
      this.liveMesh.matrix.copy(screen);
      this.liveMesh.matrixWorldNeedsUpdate = true;
      this.liveMesh.visible = true;
      lighting.placeScreenGlow(new THREE.Vector3(0, 0, 0.25).applyMatrix4(screen));
    };
    if (seat && away === 'wc') {
      // A night locked in the lavatory: at the mirror, with a little screen beside it.
      this.controls.setSeat(lavatory.eye.clone(), lavatory.screen, false, lavatory.restYaw);
      useScreen(lavatory.screen);
      return;
    }
    if (seat && away === 'deck') {
      // Up in the jump seat behind the first officer, with its own little screen.
      this.controls.setSeat(flightDeck.jumpSeatEye.clone(), flightDeck.guestScreen, false, 0.15);
      useScreen(flightDeck.guestScreen);
      return;
    }
    if (seat) {
      const e = eyePosition(seat);
      // Crew stand behind the drink cart and use the tablet on it; the Pilot has the flight deck's screen.
      const row = grid.aisleRow(seat);
      const screen = grid.isCockpit(seat) ? flightDeck.captainScreen : row === null ? seats.screenMatrix(seat) : Cart.tabletAt(row);
      this.controls.setSeat(new THREE.Vector3(e.x, e.y, e.z), screen, animate, 0, row !== null);
      // The captain can look right up at the overhead panel.
      this.controls.setLookUp(grid.isCockpit(seat) ? 1.05 : undefined);
      useScreen(screen);
      return;
    }
    // Restrained passengers watch from where they stand in the rear galley; the control tower from the front.
    this.liveMesh.visible = false;
    const spot = this.youId ? this.people.actor(this.youId)?.restSpot : null;
    if (this.seatKey === 'aft') {
      const eye = spot ? new THREE.Vector3(spot.x, 1.58, spot.z - 0.02) : new THREE.Vector3(0, 1.58, cabin.rearZ - 0.6);
      this.controls.setSeat(eye, null, false, 0);
    } else {
      this.controls.setSeat(new THREE.Vector3(0, 1.85, BULKHEAD_Z + 0.35), null, false, Math.PI);
    }
  }

  private tap(ndc: THREE.Vector2): void {
    const hit = this.controls.walking ? null : this.aimedAt(ndc);
    if (hit === 'screen') this.opts.onScreenClick();
    else if (hit) this.opts.onControl?.(hit);
    else this.controls.requestLock();
  }

  /** What is under a point of the view: your screen, one of the captain's controls (if you are him), or nothing. */
  private aimedAt(ndc: THREE.Vector2): 'screen' | ControlId | null {
    const targets: THREE.Object3D[] = [];
    if (this.liveMesh.visible) targets.push(this.liveMesh);
    const game = this.lastView;
    if (this.built && this.seatKey === 'Cockpit' && game && atTheControls(game)) targets.push(...this.built.flightDeck.controls);
    if (targets.length === 0) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    // Controls sit within arm's reach; anything further is the windscreen or the cabin.
    const [hit] = this.raycaster.intersectObjects(targets, false);
    if (!hit) return null;
    if (hit.object === this.liveMesh) return 'screen';
    return hit.distance < 1.6 ? (hit.object.userData.control as ControlId) : null;
  }


  private resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = width < height ? 76 : 68;
    this.camera.updateProjectionMatrix();
    this.hotel?.resize(width, height);
    this.gate?.resize(width, height);
  }

  /** Into the hotel room: the mouse is for picking things up, not looking around. */
  private enterHotel(): void {
    if (!this.hotel) {
      this.hotel = new HotelSet(this.renderer, this.renderer.domElement, this.container, {
        onPack: (item) => this.opts.onPack?.(item),
        onUnpack: (slot) => this.opts.onUnpack?.(slot),
      });
      this.resize();
    }
    if (this.showing !== 'hotel') {
      this.showing = 'hotel';
      this.controls.releaseLock();
      this.controls.suspended = true;
      this.show(this.hotel.scene, this.hotel.camera);
      cabinAudio.setEngine(0, 0.5);
    }
  }

  /** Point the effects chain at a set's scene and camera. */
  private show(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.shownScene === scene) return;
    this.shownScene = scene;
    this.composer.setMainScene(scene);
    this.composer.setMainCamera(camera);
  }

  private dropHotel(): void {
    this.hotel?.dispose();
    this.hotel = null;
  }

  private dropGate(): void {
    this.gate?.dispose();
    this.gate = null;
  }

  /** Back in the cabin for good (takeoff, or the boarding skipped): the other sets are packed away. */
  private endPreflight(): void {
    this.dropHotel();
    this.dropGate();
    this.showing = 'cabin';
    this.controls.suspended = false;
    this.show(this.scene, this.camera);
    if (this.lastView?.phase.kind !== 'boarding') {
      this.walkedIn = false;
      this.boardingSkipped = false;
    }
  }

  /**
   * One frame of the boarding sequence, from the phase clock: the bag zipping shut in the hotel, the queue
   * at the gate, your pass on the scanner, then the walk down the aisle. Returns false when the cabin
   * itself should be drawn (the walk, or once the sequence was skipped).
   */
  private boardingFrame(dt: number, time: number): boolean {
    const game = this.lastView!;
    if (this.boardingSkipped || !game.you) return false;
    const total = phaseDurationMs(game.settings, 'boarding') / 1000;
    const moment = boardingMoment(this.debugBoardingAt ?? total - msLeft(this.snap!, Date.now()) / 1000);
    this.fadeEl.style.transition = 'none';
    this.fadeEl.style.opacity = String(moment.black);
    this.fadeText.textContent = '';
    this.dark = moment.black > 0.5;
    switch (moment.shot) {
      case 'pack':
        if (!this.hotel) return true;
        this.showing = 'hotel';
        this.show(this.hotel.scene, this.hotel.camera);
        this.hotel.update(dt, time);
        this.composer.render(dt);
        return true;
      case 'queue':
      case 'scan': {
        this.dropHotel();
        if (!this.gate) {
          this.gate = new GateSet(this.renderer, game, this.faceSource);
          this.resize();
          if (moment.shot === 'queue' && moment.t < 1) {
            this.later(0.9, () => this.opts.onCaption?.(`Flight 13 to ${destinationOf(game.settings).city} is now boarding. Please have your boarding pass ready.`, 'Gate 13'));
          }
        }
        this.showing = 'gate';
        this.show(this.gate.scene, this.gate.camera);
        this.gate.show(moment.shot, moment.t, dt, time);
        this.composer.render(dt);
        return true;
      }
      case 'aisle': {
        this.dropHotel();
        this.dropGate();
        this.showing = 'cabin';
        this.show(this.scene, this.camera);
        const seat = game.you.seat;
        if (!this.walkedIn && seat && this.built) {
          this.walkedIn = true;
          // In past the galley curtain, down the aisle, and into your seat before the picture fades.
          const aisle = BOARDING_SHOTS.find((s) => s.shot === 'aisle')!;
          const seconds = aisle.end - aisle.start - FADE - 0.45;
          this.controls.board(new THREE.Vector3(0, 1.6, BULKHEAD_Z + 0.25), seconds, moment.t);
        }
        return false;
      }
    }
  }

  /** Fade the picture to black (1) or back (0) over `seconds`, with an optional line on the black. */
  private fade(to: 0 | 1, seconds: number, text = ''): void {
    this.dark = to === 1;
    if (text || to === 1) this.fadeText.textContent = text;
    this.fadeEl.style.transition = `opacity ${seconds}s ease`;
    this.fadeEl.style.opacity = String(to);
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(0.1, this.timer.getDelta());
    const time = this.timer.getElapsed();
    this.time = time;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].at > time) continue;
      const [due] = this.timers.splice(i, 1);
      due.fn();
    }
    if (this.lastView?.phase.kind === 'boarding' && this.snap && this.boardingFrame(dt, time)) return;
    if (this.showing === 'hotel' && this.hotel) {
      this.hotel.update(dt, time);
      this.composer.render(dt);
      return;
    }
    const built = this.built;
    if (built) {
      // The lights stay off after a blast for a moment, and until you are back up from under your seat.
      const mode = this.wantedMode !== 'night' && (time < this.darkUntil || this.searching) ? 'night' : this.wantedMode;
      built.lighting.setMode(mode);
      this.flight(time, built);
      this.flyDeck(dt, time, built);
      built.lighting.update(dt);
      built.windows.update(dt);
      built.effects.update(dt, time, this.cart.group.position.z);
    }
    this.flash *= Math.exp(-dt * 5);
    this.flashEl.style.opacity = this.flash > 0.01 ? String(this.flash) : '0';
    if (this.ending) {
      // The ending drives everyone and the camera; no seat controls, no network poses.
      this.cart.update(dt, time);
      this.people.update(dt, time);
      this.ending.update(this.time - this.endingFrom, dt, time);
      if (this.endingShake > 0.001) {
        const s = this.endingShake;
        this.camera.position.add(new THREE.Vector3(rand(-s, s), rand(-s, s), rand(-s, s)));
        this.endingShake *= Math.exp(-dt * 3);
      }
      this.composer.render(dt);
      if (this.ending.done) this.finishEnding();
      return;
    }
    this.controls.update(dt, time);
    // Your own body follows the camera down the aisle, and keeps out of the way while you search.
    const me = this.youId ? this.people.actor(this.youId) : undefined;
    if (me) {
      me.drive(this.controls.body());
      me.hidden = this.searching;
    }
    this.cart.update(dt, time);
    if (this.tabletFollows && this.liveMesh.visible) {
      this.cart.tabletMatrix(this.liveMesh.matrix);
      this.liveMesh.matrixWorldNeedsUpdate = true;
    }
    this.applyPoses(time);
    this.playEmotes(time);
    this.playTape(time);
    this.people.update(dt, time);
    this.placeBubbles(time);
    this.followVoice();
    this.drawScreen(time);
    const aimed = this.controls.locked ? this.aimedAt(new THREE.Vector2(0, 0)) : null;
    const aim = aimed !== null;
    if (aim !== this.aimOnScreen) {
      this.aimOnScreen = aim;
      this.opts.onAimChange?.(aim);
    }
    const control = aimed === 'screen' ? null : aimed;
    if (control !== this.aimControl) {
      this.aimControl = control;
      this.opts.onAimControl?.(control);
    }
    this.composer.render(dt);
    this.drawConsole();
  }

  /** Start any new gestures, with a bubble over the head (yours shows above the gesture bar). */
  private playEmotes(time: number): void {
    if (!this.emoteSource) return;
    for (const [id, { emote, seq }] of this.emoteSource) {
      if ((this.emoteSeen.get(id) ?? 0) >= seq) continue;
      this.emoteSeen.set(id, seq);
      const actor = this.people.actor(id);
      if (!actor) continue;
      const info = EMOTE_BY_ID[emote];
      actor.playEmote(emote, time);
      let bubble = this.bubbleEls.get(id);
      if (!bubble) {
        bubble = { el: document.createElement('div'), until: 0 };
        bubble.el.className = 'emote-bubble';
        // Out of sight until the next frame puts it over the right head.
        bubble.el.hidden = true;
        this.bubbles.appendChild(bubble.el);
        this.bubbleEls.set(id, bubble);
      }
      bubble.el.textContent = info.icon;
      bubble.el.title = info.name;
      bubble.until = time + info.seconds;
    }
  }

  /** Keep each bubble over its head, and drop it when the gesture is done. */
  /** New lines said out loud in the cabin: a bubble over the speaker, and gibberish from a bot. */
  private hearChat(game: PlayerView, state: ClientState): void {
    const newest = game.chat.at(-1)?.id ?? 0;
    if (this.lastChat === null) {
      this.lastChat = newest;
      return;
    }
    for (const m of game.chat) {
      if (m.id <= this.lastChat || m.channel !== 'cabin' || m.from === this.youId) continue;
      this.speak(m.from, m.text);
      if (state.players.find((p) => p.id === m.from)?.bot) this.babble(m.from, m.text);
    }
    this.lastChat = Math.max(this.lastChat, newest);
  }

  private speak(id: string, text: string): void {
    this.speechEls.get(id)?.el.remove();
    const el = document.createElement('div');
    el.className = 'speech-bubble';
    el.textContent = text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
    // Out of sight until the next frame puts it over the right head.
    el.hidden = true;
    this.bubbles.appendChild(el);
    this.speechEls.set(id, { el, until: this.time + Math.min(9, 3.5 + text.length * 0.06) });
  }

  private babble(id: string, text: string): void {
    const actor = this.people.actor(id);
    if (!actor || actor.hidden || this.showing !== 'cabin') return;
    const head = actor.eyes();
    const cam = this.camera.position;
    const gain = proximityGain(head.distanceTo(cam));
    if (gain < 0.02) return;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const pan = head.clone().sub(cam).normalize().dot(right);
    cabinAudio.babble(planBabble(text, personality(id).pitch), { gain, pan });
  }

  private placeBubbles(time: number): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const at = new THREE.Vector3();
    for (const [id, bubble] of this.speechEls) {
      const actor = this.people.actor(id);
      if (!actor || time > bubble.until) {
        bubble.el.remove();
        this.speechEls.delete(id);
        continue;
      }
      // Above the head, and above a gesture bubble if there is one.
      actor.joints.head.getWorldPosition(at).add(new THREE.Vector3(0, this.bubbleEls.has(id) ? 0.78 : 0.36, 0));
      const p = at.project(this.camera);
      const visible = !actor.hidden && !this.dark && this.showing === 'cabin' && p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      bubble.el.hidden = !visible;
      if (visible) bubble.el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -100%)`;
    }
    for (const [id, bubble] of this.bubbleEls) {
      const actor = this.people.actor(id);
      if (!actor || time > bubble.until) {
        bubble.el.remove();
        this.bubbleEls.delete(id);
        continue;
      }
      if (id === this.youId) {
        // Your own arms are mostly out of view: show what you did just above the gesture bar.
        bubble.el.hidden = this.dark;
        bubble.el.style.transform = `translate(${width / 2}px, ${height - 118}px) translate(-50%, -100%)`;
        continue;
      }
      actor.joints.head.getWorldPosition(at).add(new THREE.Vector3(0, 0.36, 0));
      const p = at.project(this.camera);
      const visible = !actor.hidden && !this.dark && p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      bubble.el.hidden = !visible;
      if (visible) bubble.el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -100%)`;
    }
  }

  /** Hear from your camera, and show a sound badge over whoever is talking. */
  private followVoice(): void {
    const voice = this.voice;
    const talking = voice && voice.status !== 'off' && this.showing === 'cabin' ? voice.speaking() : new Set<string>();
    if (voice && voice.status !== 'off') {
      const cam = this.camera;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      voice.setListener({ position: [cam.position.x, cam.position.y, cam.position.z], forward: [forward.x, forward.y, forward.z], up: [up.x, up.y, up.z] });
    }
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const at = new THREE.Vector3();
    for (const [id, el] of this.talkEls) {
      if (talking.has(id) && id !== this.youId) continue;
      el.remove();
      this.talkEls.delete(id);
    }
    for (const id of talking) {
      if (id === this.youId) continue;
      const actor = this.people.actor(id);
      if (!actor) continue;
      let el = this.talkEls.get(id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'talk-badge';
        el.hidden = true;
        el.innerHTML = '<i></i><i></i><i></i>';
        this.bubbles.appendChild(el);
        this.talkEls.set(id, el);
      }
      actor.joints.head.getWorldPosition(at).add(new THREE.Vector3(0, 0.3, 0));
      const p = at.project(this.camera);
      const visible = !actor.hidden && !this.dark && !this.bubbleEls.has(id) && p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      el.hidden = !visible;
      if (visible) el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -100%)`;
    }
  }

  /** During a public vote, each voter points at the passenger they picked. */
  private aimVotes(game: PlayerView): void {
    const byVoter = game.phase.kind === 'day_vote' ? game.votes?.byVoter ?? null : null;
    for (const p of game.players) {
      const actor = this.people.actor(p.id);
      if (!actor) continue;
      const target = byVoter?.[p.id];
      const targetActor = target && target !== 'skip' ? this.people.actor(target) : undefined;
      actor.pointAt = targetActor ? targetActor.joints.head.getWorldPosition(new THREE.Vector3()) : null;
    }
  }

  /** Feed network poses to other passengers and your camera to your own body; share yours. */
  private applyPoses(time: number): void {
    const mine = this.controls.pose();
    for (const p of this.state?.game?.players ?? []) {
      if (p.id === this.youId) continue;
      const actor = this.people.actor(p.id);
      if (actor) actor.pose = this.poseSource?.get(p.id) ?? null;
    }
    if (this.youId) {
      const me = this.people.actor(this.youId);
      if (me) me.pose = mine;
      const last = this.lastPose;
      const changed = !last || last.lean !== mine.lean || Math.abs(last.yaw - mine.yaw) > 0.03 || Math.abs(last.pitch - mine.pitch) > 0.03;
      if (changed && time - this.lastPoseAt > 0.12) {
        this.lastPose = mine;
        this.lastPoseAt = time;
        this.opts.onPose?.(mine);
      }
    }
  }

  /** Engine power, the takeoff roll and climb, and turbulence, from the phase clock. */
  private flight(time: number, built: Built): void {
    const game = this.state?.game;
    const snap = this.snap;
    if (!game || !snap) return;
    const kind = game.phase.kind;
    const { windows } = built;
    let engine = kind === 'ended' ? 0.2 : kind === 'packing' || kind === 'boarding' ? 0 : CRUISE;
    if (kind === 'takeoff') {
      const total = phaseDurationMs(game.settings, 'takeoff');
      const p = clamp01(1 - msLeft(snap, Date.now()) / total);
      // Brakes on while the engines spool up; roll; rotate at 60%; climb away.
      const roll = p < 0.1 ? 0 : p < 0.62 ? ((p - 0.1) / 0.52) ** 1.6 : Math.max(0.25, 1 - (p - 0.62) * 2.2);
      windows.speed = roll * 1.35;
      windows.lift = p < 0.6 ? 0 : Math.min(0.42, (p - 0.6) * 1.2);
      engine = p < 0.08 ? 0.35 : p < 0.7 ? 1 : 0.8;
      const onGround = p > 0.1 && p < 0.64;
      if (onGround) this.controls.shake(0.003 + roll * 0.009);
      if (p >= 0.74 && !this.gearUp) {
        this.gearUp = true;
        cabinAudio.thunk();
        this.controls.shake(0.015);
      }
    } else if (!this.ending) {
      this.gearUp = false;
      windows.speed = isNightPhase(kind) ? 0.002 : 0.006;
      windows.lift = 0;
    }
    if (Math.abs(engine - this.engine) > 0.01) {
      this.engine = engine;
      cabinAudio.setEngine(engine, kind === 'takeoff' ? 2.5 : 4);
    }

    // How the plane is flying, for the flight deck: parked, the takeoff roll and climb, cruise, or landing.
    const sway = (rate: number, amount: number) => Math.sin(time * rate) * amount;
    if (this.landingView) {
      const t = time - this.landingFrom;
      const rollout = clamp01(1 - t / 9);
      this.viewSpeed = rollout;
      this.attitude = { speed: 150 * rollout, altitude: Math.max(0, 300 * (1 - t / 3.6)), pitch: t < 3.6 ? 0.06 : 0.01, roll: 0 };
    } else if (kind === 'packing' || kind === 'boarding') {
      this.viewSpeed = 0;
      this.attitude = { speed: 0, altitude: 0, pitch: 0, roll: 0 };
    } else if (kind === 'takeoff') {
      const p = clamp01(1 - msLeft(snap, Date.now()) / phaseDurationMs(game.settings, 'takeoff'));
      this.viewSpeed = p < 0.1 ? 0 : Math.min(1, ((p - 0.1) / 0.52) ** 1.6);
      this.attitude = {
        speed: p < 0.1 ? 0 : Math.min(160, ((p - 0.1) / 0.52) * 160) + Math.max(0, p - 0.62) * 150,
        altitude: p < 0.64 ? 0 : ((p - 0.64) / 0.36) * 6000,
        pitch: p < 0.6 ? 0 : Math.min(0.21, (p - 0.6) * 1.4),
        roll: 0,
      };
    } else {
      const rough = isNightPhase(kind) && this.turbulentNight === game.phase.night ? 3 : 1;
      this.viewSpeed = isNightPhase(kind) ? 0.2 : 0.35;
      this.attitude = {
        speed: 452 + sway(0.3, 3),
        altitude: 35000 + sway(0.17, 40 * rough),
        pitch: 0.01 + sway(0.23, 0.008 * rough),
        roll: sway(0.21, 0.02 * rough) + sway(1.7, 0.004 * rough),
      };
    }
    // A hijack banks the plane away.
    if (this.ending) this.attitude.roll += this.ending.bank;

    // Turbulent nights: a bump every few seconds.
    if (isNightPhase(kind) && this.turbulentNight === game.phase.night) {
      if (time >= this.nextBump) {
        const strength = rand(0.4, 1.1);
        this.controls.shake(0.015 + 0.03 * strength);
        cabinAudio.rumble(strength);
        this.nextBump = time + rand(3.5, 9);
      }
    }
  }

  /** The flight deck: the windscreen view and the displays (only while you are up there), and its door. */
  private flyDeck(dt: number, time: number, built: Built): void {
    const you = this.lastView?.you;
    const onDeck = /^(Cockpit|deck:)/.test(this.seatKey ?? '') || (!!this.ending && !!you && grid.isCockpit(you.seat));
    if (onDeck) {
      this.forwardView.update(dt, this.landingView ? 'runway' : this.viewMode, this.viewSpeed, this.attitude.pitch, time, this.attitude.roll);
      this.display.draw(this.attitude, time);
    }
    // The Pilot's camera monitor, about eight times a second (not while the console covers it).
    if (this.seatKey === 'Cockpit' && !this.ending && !this.consoleView && time - this.cctv.renderedAt > 0.125) {
      this.cctv.renderedAt = time;
      this.renderCameras(time, built);
    }
    // Held by an ending, or open while someone is in the doorway.
    built.flightDeck.setDoor(this.cockpitDoor ?? this.people.anyNear(built.flightDeck.doorway, 0.9));
    built.flightDeck.update(dt);
  }

  /** Three rows on the cabin cameras: the ones the Pilot is watching tonight, or each section in turn. */
  private renderCameras(time: number, built: Built): void {
    const game = this.lastView;
    if (!game) return;
    const action = game.mine?.action;
    const sections: number[] = [];
    for (let row = 1; row <= built.rows - 2; row += 3) sections.push(row);
    const start = game.phase.kind === 'night_act' && action?.kind === 'watch' ? action.startRow : sections[Math.floor(time / 6) % sections.length];
    const last = Math.min(built.rows, start + 2);
    built.flightDeck.setMonitorLabel(`CAM ${Math.ceil(start / 3)}  ·  ROWS ${start}–${last}`);
    const cam = this.cctv.camera;
    aimCabinCamera(cam, start);
    const renderer = this.renderer;
    const target = renderer.getRenderTarget();
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    this.cctv.nightVision.intensity = isNightPhase(game.phase.kind) ? 3.2 : 0.8;
    renderer.setRenderTarget(this.cctv.target);
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(target);
    this.cctv.nightVision.intensity = 0;
    renderer.shadowMap.autoUpdate = shadows;
  }

  /** Open the camera console (or close it: null). A new tape starts playing from the top. */
  setConsole(view: ConsoleView | null): void {
    const tape = view?.tape ?? null;
    if (tape !== (this.tape?.plan ?? null)) this.loadTape(tape, !!view?.recorder);
    this.consoleView = view;
  }

  /** Play the tape on the console again from the top (or from `at` seconds in). */
  replayTape(at = 0): void {
    if (this.tape) this.tape.start = this.time - at;
  }

  /** Seconds into the tape on the console, or null when none plays. */
  get tapeTime(): number | null {
    return this.tape ? this.time - this.tape.start : null;
  }

  /** Where everyone sat on a night, as this view saw it (null if it did not see that night). */
  seatsOn(night: number): ReadonlyMap<string, SeatId> | null {
    return this.nightSeats?.night === night ? this.nightSeats.seats : null;
  }

  /** In the dark, note who sits where (the Pilot's tape puts them back there, even after the dead are gone). */
  private noteNightSeats(game: PlayerView): void {
    if (game.phase.kind !== 'night_act') return;
    const seats = new Map<string, SeatId>();
    for (const p of game.players) {
      if (p.status !== 'alive' || !p.seat || grid.isCockpit(p.seat) || p.id === game.washroom || p.id === game.jumpseat) continue;
      seats.set(p.id, p.seat);
    }
    this.nightSeats = { night: game.phase.night, seats };
  }

  /** Put the tape's cast back in their seats as stand-ins only the cameras see (or clear them away). */
  private loadTape(plan: Tape | null, everyone = false): void {
    if (this.tape) for (const id of this.tape.cast.keys()) this.people.dropExtra(`tape:${id}`);
    this.people.setCameraHide([]);
    this.tape = null;
    this.followRow = null;
    if (!plan) return;
    const players = new Map((this.lastView?.players ?? []).map((p) => [p.id, p]));
    const cast = new Map<string, Actor>();
    for (const { id, seat } of plan.cast) {
      const p = players.get(id);
      if (!p) continue;
      const at = seatPose(seat);
      const actor = this.people.extra(`tape:${id}`, p.look, new THREE.Vector3(at.x, 0, at.z), this.faceSource?.get(id) ?? '', true);
      if (!actor) continue;
      actor.standing = false;
      // On the flight recorder, whoever changed seats that night walks there from where they sat the night before.
      const before = plan.from?.get(id);
      if (before && before !== seat && !grid.isCockpit(before)) {
        actor.place(before, false);
        actor.place(seat, true);
      } else actor.place(seat, false);
      cast.set(id, actor);
    }
    // The flight recorder shows that night alone: nobody from the cabin as it is now (the dead, the restrained).
    this.people.setCameraHide(everyone ? (this.lastView?.players ?? []).map((p) => p.id) : cast.keys());
    this.tape = { plan, start: this.time, cast };
  }

  /** Act out the clip playing now: everyone dozes, and the one the camera caught does what it saw. */
  private playTape(time: number): void {
    const tape = this.tape;
    if (!tape) return;
    const t = time - tape.start;
    for (const actor of tape.cast.values()) {
      actor.duck = false;
      actor.handsUp = false;
      actor.pointAt = null;
      actor.gaze = null;
      actor.standing = false;
      actor.pose = { yaw: 0, pitch: -0.45, lean: false };
    }
    // The flight recorder's dead fall as the reel reaches them, and stay down.
    const fallen = new Map<string, 'explosion' | 'poison'>();
    for (const c of tape.plan.clips) {
      if (!c.victims || t < c.at + 0.6) continue;
      for (const id of c.victims) fallen.set(id, c.kind === 'blast' ? 'explosion' : 'poison');
    }
    for (const id of tape.cast.keys()) {
      const cause = fallen.get(id) ?? null;
      this.people.setDead(`tape:${id}`, cause !== null, cause);
    }
    const clip = clipAt(tape.plan, t);
    const into = clip ? t - clip.at : 0;
    if (clip?.row) this.followRow = clip.row;
    // Each clip settles in and out, so one person's move reads before the next begins.
    if (clip && into > 0.35 && into < clip.dur - 0.45) this.actOut(clip, into);
  }

  private actOut(clip: Clip, into: number): void {
    const tape = this.tape!;
    const actor = tape.cast.get(clip.actor);
    if (!actor) return;
    // The day's verdict: on their feet, hands up, as they are led away.
    if (clip.kind === 'restrained') {
      actor.standing = true;
      actor.handsUp = true;
      actor.pose = null;
      return;
    }
    const seatAt = (id: string | undefined, y: number) => {
      const seat = id ? tape.plan.seats.get(id) : undefined;
      if (!seat) return null;
      const p = seatPose(seat);
      return new THREE.Vector3(p.x, y, p.z);
    };
    const self = actor.root.position.clone();
    const other = clip.target && clip.target !== clip.actor ? clip.target : undefined;
    const target = seatAt(other, 0.95);
    const face = (p: THREE.Vector3) => p.clone().setY(1.15);
    actor.pose = null;
    switch (clip.kind) {
      case 'under_seat':
        actor.duck = true;
        actor.pointAt = self.clone().add(new THREE.Vector3(0, 0.08, -0.32));
        break;
      case 'lean':
        if (target) {
          actor.pointAt = target;
          actor.gaze = face(target);
        } else {
          // Treating yourself: rummaging in a bag at your feet.
          actor.duck = true;
          actor.pointAt = self.clone().add(new THREE.Vector3(0.22, 0.2, -0.12));
        }
        break;
      case 'drink':
      case 'pills':
        if (target) {
          actor.pointAt = target.clone().setY(clip.kind === 'drink' ? 1.05 : 0.8);
          actor.gaze = face(target);
        }
        break;
      case 'check':
        actor.duck = true;
        actor.pointAt = self.clone().add(new THREE.Vector3(into < clip.dur / 2 ? -0.75 : 0.75, 0.15, 0));
        break;
      case 'look_around':
        actor.standing = true;
        actor.gaze = self.clone().add(new THREE.Vector3(Math.sin(into * 1.9) * 2, 1.5, 0.6));
        break;
      case 'cuff':
        actor.standing = true;
        if (target) {
          actor.pointAt = target;
          actor.gaze = face(target);
        }
        if (other) {
          const held = tape.cast.get(other);
          if (held) held.handsUp = true;
        }
        break;
      case 'flashlight': {
        const seat = clip.seat ? seatPose(clip.seat) : null;
        const spot = seat ? new THREE.Vector3(seat.x, 0.12, seat.z - 0.15) : self.clone().add(new THREE.Vector3(0, 0.1, -0.45));
        actor.pointAt = spot;
        actor.gaze = spot;
        break;
      }
      case 'cart':
        actor.pointAt = new THREE.Vector3(0, 0.95, self.z);
        actor.gaze = actor.pointAt.clone();
        break;
      case 'lavatory':
        actor.standing = true;
        actor.gaze = new THREE.Vector3(0, 1.5, rowZ(this.built?.rows ?? 8) + 1.4);
        break;
    }
  }

  /** The camera console: the cabin cameras over the chosen rows, full size in their frame, with name tags over heads. */
  private drawConsole(): void {
    const view = this.consoleView;
    const built = this.built;
    if (!view || !built || (!view.recorder && this.seatKey !== 'Cockpit')) return;
    const box = this.renderer.domElement.getBoundingClientRect();
    const r = view.screen.getBoundingClientRect();
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w < 8 || h < 8) return;
    const x = Math.round(r.left - box.left);
    const y = Math.round(box.bottom - r.bottom);
    const cam = this.consoleCam;
    // The flight recorder cuts to wherever the clip happens (a row ahead, so it is in the middle of the picture).
    const start = view.recorder && this.followRow !== null ? this.followRow - 1 : view.startRow;
    aimConsoleCamera(cam, Math.max(1, Math.min(start, built.rows - 2)));
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    const renderer = this.renderer;
    const shadows = renderer.shadowMap.autoUpdate;
    const autoClear = renderer.autoClear;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    // Night vision in the dark (and on last night's tape). This draws straight to the screen, with no tone mapping
    // to tame it, so it needs far less light than the little monitor's render.
    this.cctv.nightVision.intensity = isNightPhase(this.lastView?.phase.kind ?? 'day_discuss') || this.tape ? 1.3 : 0.25;
    this.people.cameraView(this.tape !== null);
    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.clear();
    // The flight recorder shows the cabin before any of it happened: no dropped masks, no scorch marks yet.
    const effects = built.effects.group;
    const effectsShown = effects.visible;
    if (view.recorder) effects.visible = false;
    const draw = () => renderer.render(this.scene, cam);
    // Last night's tape looks like night, whatever the time now: lights down, dark windows.
    if (this.tape && !isNightPhase(this.lastView?.phase.kind ?? 'day_discuss')) {
      built.lighting.withMode('night', () => built.windows.withShade(0.06, draw));
    } else draw();
    effects.visible = effectsShown;
    renderer.setScissorTest(false);
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setViewport(0, 0, size.x, size.y);
    this.people.cameraView(false);
    this.cctv.nightVision.intensity = 0;
    renderer.autoClear = autoClear;
    renderer.shadowMap.autoUpdate = shadows;
    this.placeTags(view, cam, w, h);
  }

  /** Name tags (the console's `[data-cctv-tag]` elements) float over the heads the cameras see. */
  private placeTags(view: ConsoleView, cam: THREE.PerspectiveCamera, w: number, h: number): void {
    const head = new THREE.Vector3();
    for (const tag of view.screen.querySelectorAll<HTMLElement>('[data-cctv-tag]')) {
      const id = tag.dataset.cctvTag!;
      const actor = this.tape?.cast.get(id) ?? this.people.actor(id);
      if (!actor || actor.hidden) {
        tag.hidden = true;
        continue;
      }
      actor.eyes(head);
      head.y += 0.25;
      head.project(cam);
      // Someone right under the camera has their tag held just inside the top of the picture.
      const inView = head.z < 1 && Math.abs(head.x) < 0.98 && head.y > -0.98;
      tag.hidden = !inView;
      const y = Math.min(head.y, 0.84);
      if (inView) tag.style.transform = `translate(${((head.x + 1) / 2) * w}px, ${((1 - y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }

  /** Play one cue from the director. */
  private play(cue: Cue, game: PlayerView): void {
    const built = this.built!;
    switch (cue.kind) {
      case 'takeoff':
        built.effects.reset();
        this.gearUp = false;
        this.turbulentNight = null;
        break;
      case 'lightsOut':
        cabinAudio.clunk();
        break;
      case 'lightsOn':
        this.later(cue.afterBlast ? PREROLL + 1.6 : 0, () => cabinAudio.clunk());
        break;
      case 'explosion': {
        // A cart or lavatory blast covers several cells but is one explosion.
        const points = (cue.where === 'seat' ? cue.centers : cue.centers.slice(0, 1)).map((c) => built.effects.blastPoint(c, cue.where));
        if (points.length === 0) break;
        // First the (nearest) device beeps faster and faster and every head turns to it...
        const focus = this.glanceAt && points.some((p) => p.equals(this.glanceAt!)) ? this.glanceAt : null;
        if (focus) {
          built.effects.arm(focus);
          this.controls.glance(focus.clone().add(new THREE.Vector3(0, 0.15, 0)), PREROLL + 1.3);
          this.opts.onScene?.('glance', true);
          for (let i = 0; i < 7; i++) this.later(PREROLL * (1 - 0.7 ** i) - 0.05, () => cabinAudio.beep(i / 6));
        }
        // ...then it goes off, and the lights stay dark a moment longer.
        this.darkUntil = this.time + PREROLL + 1.6;
        this.later(PREROLL, () => this.detonate(points, cue.victims));
        break;
      }
      case 'turbulence':
        this.turbulentNight = game.phase.night;
        this.nextBump = this.time + 2.5;
        this.later(0.4, () => cabinAudio.chime());
        break;
      case 'cartRoll':
        if (cue.runaway) cabinAudio.rattle();
        break;
      case 'restrained':
        this.later(0.6, () => cabinAudio.zip());
        break;
      case 'landing':
        this.later(1.2, () => cabinAudio.chime());
        break;
      case 'pa': {
        // One ding per announcement, captions one after another (after any blast).
        const at = Math.max(this.time + 0.2 + this.batchDelay, this.captionAt);
        this.captionAt = at + 4.5;
        // (Announcements still queued when an ending starts are dropped: the ending tells its own story.)
        this.later(at - this.time, () => !this.ending && cabinAudio.ding());
        this.later(at - this.time + 0.9, () => !this.ending && this.opts.onCaption?.(cue.text, cue.who ?? 'Flight deck'));
        break;
      }
    }
  }

  /** The blast itself: effects, sound, shake, the victims fall, the masks drop. */
  private detonate(points: THREE.Vector3[], victims: string[]): void {
    const built = this.built;
    if (!built) return;
    built.effects.disarm();
    for (const at of points) {
      built.effects.explode(at);
      const distance = this.camera.position.distanceTo(at);
      cabinAudio.boom(distance);
      this.controls.shake(0.03 + 0.14 * clamp01(1 - distance / 10));
      this.flash = Math.max(this.flash, clamp01(1.15 - distance / 9) * 0.9 + 0.1);
    }
    for (const id of victims) this.holdAlive.delete(id);
    if (this.lastView) this.syncPeople(this.lastView);
    if (this.youId && victims.includes(this.youId)) this.dieOnScreen();
    this.later(0.35, () => built.effects.masks.drop());
    this.later(1.3, () => this.opts.onScene?.('glance', false));
  }

  /** You died: slump in your seat, then straighten up again as a ghost. */
  private dieOnScreen(): void {
    this.controls.slump(true);
    this.later(4.5, () => this.controls.slump(false));
  }

  /** Seat, walk, slump or restrain everyone, keeping blast victims upright until their blast. */
  private syncPeople(game: PlayerView): void {
    const rows = game.cabin.rows;
    const players = this.holdAlive.size
      ? game.players.map((p) => (this.holdAlive.has(p.id) ? { ...p, status: 'alive' as const, cause: null } : p))
      : game.players;
    // Nights away from a seat: the lavatory, or the flight deck's jump seat.
    const away: { id: string; door: THREE.Vector3; sit?: THREE.Vector3 }[] = [];
    if (this.built && game.washroom) away.push({ id: game.washroom, door: this.built.lavatory.door });
    if (this.built && game.jumpseat) away.push({ id: game.jumpseat, door: this.built.flightDeck.door, sit: this.built.flightDeck.jumpSeat });
    this.people.sync(players, this.youId, (i) => rearSpot(rows, i), this.faceSource, away);
  }

  private later(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.time + seconds, fn });
  }

  /** The floor under a grid cell. */
  private cellPoint(cell: Cell): THREE.Vector3 {
    return new THREE.Vector3(colX(cell.col), 0, rowZ(cell.row));
  }

  private drawScreen(time: number): void {
    const game: PlayerView | null | undefined = this.state?.game;
    if (!game || !this.snap || !this.liveMesh.visible) return;
    const hint = TOUCH ? 'TAP TO USE' : this.controls.locked ? 'CLICK TO USE' : 'CLICK THE SCREEN OR PRESS E';
    this.liveScreen.draw(game, this.state!.code, msLeft(this.snap, Date.now()), hint, Math.sin(time * 4) > 0);
  }
}
