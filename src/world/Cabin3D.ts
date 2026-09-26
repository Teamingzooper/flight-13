import { type Effect, EffectComposer } from 'postprocessing';
import type { N8AOPostPass } from 'n8ao';
import { buildPostChain, disposePostChain } from './post';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { destinationOf, grid, hasTwist, isNightPhase, phaseDurationMs, type Cell, type PlaneId, type ItemId, type PlayerView, type SeatId } from '../engine';
import { msLeft, type ClientSnapshot } from '../net/client';
import { EMOTE_BY_ID, type EmoteId } from '../net/emotes';
import type { VoiceChat } from '../net/voice';
import type { ClientState, Pose } from '../net/protocol';
import { getPrefs, subscribePrefs } from '../app/prefs';
import { graphicsProfile, setDetail, type GraphicsProfile } from './graphics';
import { WindowShafts } from './shafts';
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
import { auroraSkyTexture, cloudySkyTexture, dawnSkyTexture, runwayTexture, stormSkyTexture, sunsetSkyTexture } from './textures';
import { skyFor, type SkyKind } from './weather';
import { WindowView } from './windows';
import { personality } from '../bots/personality';
import { proximityGain } from '../net/voiceRules';
import { planBabble } from './babble';
import { atTheControls, deckLook, type ControlId } from './cockpit';
import { buildStaircase } from './scene/staircase';
import { buildGalley } from './scene/galley';
import { Trays } from './scene/trays';
import { CrewRig } from './crew';
import { SKIN, TOP } from '../app/Avatar';
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

export type SceneKind = 'walk' | 'search' | 'glance' | 'tend';

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
  /** Sunbeams (and dust) through the windows, on the graphics settings that have them. */
  shafts: WindowShafts;
  effects: Effects;
  skies: Record<SkyKind, THREE.Texture>;
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
  /** What the graphics setting turns on (see graphics.ts); changed live from the settings screen. */
  private profile: GraphicsProfile;
  /** The cabin's reflections (kept while a lower setting goes without them). */
  private readonly envMap: THREE.Texture;
  private shownCamera: THREE.Camera;
  private aoPass: N8AOPostPass | null = null;
  private passEffects: Effect[] = [];
  private readonly controls: SeatControls;
  private readonly timer = new THREE.Timer();
  private readonly liveScreen = new LiveScreen();
  private readonly liveMesh: THREE.Mesh;
  private readonly people = new People();
  /** Lunch trays, on the day it is served. */
  private readonly trays = new Trays();
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
  /** Your own hands as crew (on the cart, holding the tablet, the night's work), and the row you work. */
  private readonly crew = new CrewRig();
  private crewRow: number | null = null;
  /** You are walking the cart to a new row: it rolls where your hands push it. */
  private cartWalk = false;
  /** The night's work last acted out (so each choice plays once). */
  private crewActionKey: string | null = null;
  private crewLook = '';
  private lastCrewSeat: SeatId | null = null;
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
  /** The door was just shoved open (it flies open and bangs against the wall). */
  private cockpitBurst = false;
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
  private readonly timers: { at: number; fn: () => void; wall: number | null }[] = [];
  private captionAt = 0;
  private flash = 0;
  private readonly flashEl = document.createElement('div');
  private readonly offPrefs: () => void;
  private turbulentNight: number | null = null;
  private nextBump = 0;
  /** Storm lightning, 0..1, and when the next strike comes. */
  private lightning = 0;
  private nextLightning = 0;
  /** A sleepy cabin at night: when each passenger last moved their head, and when the next snore, stretch and light come. */
  private readonly poseMovedAt = new Map<string, number>();
  private readonly lastPoses = new Map<string, Pose>();
  private nextZzz = 0;
  private nextStretch = 0;
  private nextLamp = 0;
  private gearUp = false;
  /** The takeoff roll has started (its runway rumble is playing). */
  private rolling = false;
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
  private lastPaDing = -Infinity;
  /** A blast is about to play: the damage it does (scorch, a cart or lavatory gone) waits for it. */
  private blastPending = false;
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
    // Graphics quality (the settings screen): Basic to Ultra, applied now and whenever it changes.
    this.profile = graphicsProfile(getPrefs().quality, TOUCH);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.profile.pixelRatio));
    this.renderer.shadowMap.enabled = this.profile.shadows;
    // Not PCFSoftShadowMap: three.js dropped it and swaps in PCF at the first shadow pass, but shaders compiled
    // before then keep the old shadow code, and draws with them go dark (the camera monitor was nearly black).
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = this.profile.post === 'none' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('world-gl');

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.profile.environment ? this.envMap : null;
    this.scene.environmentIntensity = 0.3;
    this.scene.background = new THREE.Color('#05070c');
    pmrem.dispose();

    this.liveMesh = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), this.liveScreen.material);
    this.liveMesh.matrixAutoUpdate = false;
    this.liveMesh.visible = false;
    this.scene.add(this.liveMesh, this.people.group, this.cart.group, this.camera, this.cctv.nightVision, this.trays.group, this.crew.group);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: this.profile.multisampling });
    this.shownScene = this.scene;
    this.shownCamera = this.camera;
    this.buildPasses();
    setDetail(this.profile.detail, this.profile.anisotropy);
    this.offPrefs = subscribePrefs((prefs) => {
      if (prefs.quality !== this.profile.quality) this.applyGraphics(graphicsProfile(prefs.quality, TOUCH));
      else this.resize();
    });

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
    // Ding-dong before the captain speaks on the PA (once in a while: not every press of the key).
    if (state.pa && state.pa !== this.onAir && performance.now() - this.lastPaDing > 20_000) {
      this.lastPaDing = performance.now();
      cabinAudio.ding();
    }
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
      if (game.you) {
        this.enterHotel();
        const look = game.players.find((p) => p.id === game.you!.id)?.look;
        if (look) this.hotel?.setLook(look);
      } else this.fade(1, 0, 'The passengers are packing their bags');
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
    // The weather: storms on turbulent nights (and now and then anyway), cloudy days, a sunset over the verdict.
    const sky = skyFor(game, bermuda);
    windows.show(skies[sky], fresh || grounded ? 0 : 1.4);
    // Through the windscreen: the same sky.
    this.viewMode = sky;
    if (kind !== 'ended') this.landingView = false;
    // The captain's controls show tonight's calls (and the handset is up while he is on the PA).
    this.built!.flightDeck.setLook(deckLook(game, !!game.you && state.pa === game.you.id));
    this.noteNightSeats(game);
    if (night && game.log.some((e) => e.tag === 'turbulence' && e.night === game.phase.night)) this.turbulentNight = game.phase.night;

    this.youId = game.you?.id ?? null;
    this.syncPeople(game);
    this.serveLunch(game);
    this.aimVotes(game);
    // Known bombs show as devices (planters, investigators, and anyone who found one under their seat).
    effects.devices.set(
      game.bombs
        .filter((b) => !b.exploded && !b.defused)
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
    // Crew: the row you work, and whether the drink cart is there with you (after this update).
    const crewRow = seat && !away && game.you?.status === 'alive' ? grid.aisleRow(seat) : null;
    const withCart = crewRow !== null && !game.cabin.cartDestroyed && game.cabin.cartRow === crewRow;
    const hadCart = this.tabletFollows;
    this.crewRow = crewRow;
    this.tabletFollows = withCart;
    if (key !== this.seatKey) {
      const wasAway = /^(wc|deck):/.test(this.seatKey ?? '');
      const first = this.seatKey === null;
      const animate = !first && !away && !wasAway && seat !== null && this.seatKey !== 'aft' && this.seatKey !== 'tower';
      this.seatKey = key;
      const led = key === 'aft' && !first && this.seatKey !== 'aft' && this.seatKey !== 'tower';
      if (led) {
        // Restrained: led away to the rear galley.
        this.fade(1, 0.5, 'You are led to the rear galley.');
        this.later(1.3, () => {
          if (this.seatKey !== key) return;
          this.placeCamera(seat, false, away);
          this.fade(0, 0.8);
        });
      } else if ((away || wasAway) && !first) {
        // Off for the night (or back to your seat at dawn) behind a quick fade.
        const text = away === 'wc' ? 'You slip into the lavatory and lock the door.' : away === 'deck' ? 'The captain calls you up to the flight deck.' : '';
        this.fade(1, 0.45, text);
        this.later(away ? 1.2 : 0.5, () => {
          if (this.seatKey !== key) return;
          this.placeCamera(seat, false, away);
          this.fade(0, 0.7);
        });
      } else {
        // Walking the cart to your new row: it rolls where your hands push (or pull) it.
        this.cartWalk = animate && withCart && hadCart;
        if (this.cartWalk) {
          this.crew.cancel();
          const from = grid.aisleRow(this.lastCrewSeat ?? '') ?? crewRow!;
          cabinAudio.roll(Math.abs(crewRow! - from) * 0.75 + 1.4, 0.75);
        }
        this.placeCamera(seat, animate, away);
      }
    }
    this.lastCrewSeat = crewRow !== null ? seat : null;
    // Your hands as crew wear your own skin and sleeves.
    const mine = game.players.find((p) => p.id === game.you?.id);
    const lookKey = mine ? JSON.stringify(mine.look) : '';
    if (mine && lookKey !== this.crewLook) {
      this.crewLook = lookKey;
      this.crew.setLook(SKIN[mine.look.skin] ?? SKIN[0], TOP[mine.look.top] ?? TOP[0], mine.look.topStyle === 1 || mine.look.topStyle === 3);
    }
    this.actOutCrewWork(game, !!prev, withCart);
    const runaway = cues.some((c) => c.kind === 'cartRoll' && c.runaway);
    if (cues.some((c) => c.kind === 'explosion')) this.blastPending = true;
    // (What a blast destroys stays whole until the blast has played.)
    this.cart.setRow(game.cabin.cartRow, game.cabin.cartDestroyed && !this.blastPending, runaway);
    if (!this.blastPending) cabin.lavatoryDoor.visible = !game.cabin.lavatoryDestroyed;

    // Only your own seatbelt sign lights up for you (who else is buckled stays secret; crew have none).
    const buckledSeat = seat && game.you?.buckled ? grid.parseSeat(seat) : null;
    cabin.lightSeatbelt(buckledSeat ? `${buckledSeat.row}${buckledSeat.col < grid.AISLE_COL ? 'L' : 'R'}` : null);

    // The ending tells its own story: no end-of-flight announcements over it.
    const narrated = kind === 'ended' && !!prev && !this.endingSettled;
    for (const cue of cues) if (!(narrated && cue.kind === 'pa')) this.play(cue, game);
    if (prev && prev !== game) this.hearOwn(prev, game);
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
    if (!this.blastPending) effects.setScorched(game.cabin.scorched, (cell) => this.cellPoint(cell));
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
        setCockpitDoor: (open, burst = false) => {
          this.cockpitDoor = open;
          if (burst) this.cockpitBurst = true;
        },
        doorHandle: (side) => built.flightDeck.handle(side),
        cart: { z: () => this.cart.aisleZ, hold: (x, z, yaw) => this.cart.hold(x, z, yaw) },
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
    // (Whatever the ending left the engines at, back to the level the flight wants.)
    this.engine = -1;
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
    this.offPrefs();
    cabinAudio.stop();
    removeEventListener('pointerdown', this.unlockAudio);
    removeEventListener('keydown', this.unlockAudio);
    this.flashEl.remove();
    this.fadeEl.remove();
    this.bubbles.remove();
    this.trays.dispose();
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
    this.envMap.dispose();
    this.aoPass?.dispose();
    for (const effect of this.passEffects) effect.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private build(rows: number, cols: readonly number[], plane: PlaneId): void {
    if (this.built) {
      this.scene.remove(this.built.group);
      this.built.lighting.dispose();
      this.built.shafts.dispose();
    }
    const group = new THREE.Group();
    const cabin = buildCabin(rows);
    const seats = buildSeats(rows, cols, plane === 'jet');
    const skies: Record<SkyKind, THREE.Texture> = {
      day: cabin.skyDay,
      night: cabin.skyNight,
      dawn: dawnSkyTexture(),
      aurora: auroraSkyTexture(),
      runway: runwayTexture(),
      storm: stormSkyTexture(),
      cloudy: cloudySkyTexture(),
      sunset: sunsetSkyTexture(),
    };
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
    group.add(buildGalley(plane));
    this.scene.add(group);
    const lighting = new Lighting(this.scene, cabin, seats, windows, this.profile.shadows);
    lighting.setShadows(this.profile.shadows, this.profile.shadowMapSize, this.profile.shadowRadius);
    lighting.setEnvironment(this.profile.environment);
    const shafts = new WindowShafts(cabin.windows);
    shafts.dustOn = this.profile.dust;
    group.add(shafts.group);
    this.built = { rows, plane, cabin, seats, lavatory, flightDeck, lighting, windows, shafts, effects, skies, group };
    this.seatKey = null;
  }

  /**
   * Crew, in the dark: the check you chose (under the three seats on one side of your row) or the drink you are
   * serving is acted out by your own hands, once per choice. (Only with the cart there to work from.)
   */
  private actOutCrewWork(game: PlayerView, live: boolean, withCart: boolean): void {
    const action = game.mine?.action;
    const work = game.phase.kind === 'night_act' && withCart && (action?.kind === 'check' || action?.kind === 'serve') ? action : null;
    const key = work ? `${game.gameId}:${game.phase.night}:${JSON.stringify(work)}` : null;
    if (key === this.crewActionKey) return;
    this.crewActionKey = key;
    const seat = game.you?.seat;
    const row = seat ? grid.aisleRow(seat) : null;
    if (!work || !live || row === null || this.crew.busy || this.controls.scriptClock) return;
    const e = eyePosition(seat!);
    const eye = new THREE.Vector3(e.x, e.y, e.z);
    if (work.kind === 'check') {
      const script = this.crew.check(row, work.side === 'left' ? -1 : 1, eye);
      this.controls.runScript('tend', script.keys, script.marks);
      return;
    }
    if (work.kind !== 'serve') return;
    const targetSeat = game.players.find((p) => p.id === work.target)?.seat;
    if (!targetSeat || grid.isAisleSpot(targetSeat)) return;
    const pose = seatPose(targetSeat);
    const script = this.crew.serve(row, eye, new THREE.Vector3(pose.x, 0, pose.z), this.people.actor(work.target) ?? null);
    this.controls.runScript('tend', script.keys, script.marks);
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
      // (Crew without the cart hold the tablet in their hands.)
      const handheld = row !== null && !this.tabletFollows;
      const eye = new THREE.Vector3(e.x, e.y, e.z);
      const screen = grid.isCockpit(seat)
        ? flightDeck.captainScreen
        : row === null
          ? seats.screenMatrix(seat)
          : handheld
            ? CrewRig.handheldAt(eye)
            : Cart.tabletAt(row);
      this.controls.setSeat(eye, screen, animate, 0, row !== null, this.cartWalk);
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
    this.camera.fov = (width < height ? 76 : 68) + getPrefs().fov;
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
      cabinAudio.setRoomTone(true);
    }
  }

  /** Point the effects chain at a set's scene and camera. */
  private show(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.shownScene === scene) return;
    this.shownScene = scene;
    this.shownCamera = camera;
    this.composer.setMainScene(scene);
    this.composer.setMainCamera(camera);
    if (this.aoPass) {
      this.aoPass.scene = scene;
      this.aoPass.camera = camera;
    }
  }

  /** Draw the frame: through the effects chain, or (on Basic) straight to the screen. */
  private present(dt: number): void {
    if (this.profile.post === 'none') this.renderer.render(this.shownScene, this.shownCamera);
    else this.composer.render(dt);
  }

  /** The effects chain for the graphics setting (post.ts), aimed at whatever is showing. */
  private buildPasses(): void {
    disposePostChain({ ao: this.aoPass, effects: this.passEffects });
    const chain = buildPostChain(this.composer, this.shownScene, this.shownCamera, this.profile, this.container.clientWidth || 1, this.container.clientHeight || 1);
    this.aoPass = chain.ao;
    this.passEffects = chain.effects;
  }

  /** Switch graphics setting while running: resolution, shadows, reflections, surface detail, effects, sunbeams. */
  private applyGraphics(profile: GraphicsProfile): void {
    const before = this.profile;
    this.profile = profile;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, profile.pixelRatio));
    this.renderer.toneMapping = profile.post === 'none' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = profile.shadows;
    this.built?.lighting.setShadows(profile.shadows, profile.shadowMapSize, profile.shadowRadius);
    this.scene.environment = profile.environment ? this.envMap : null;
    this.built?.lighting.setEnvironment(profile.environment);
    setDetail(profile.detail, profile.anisotropy);
    if (this.built) this.built.shafts.dustOn = profile.dust;
    // Shadows on or off (or tone mapping moving into the renderer) changes every material's shader.
    if (before.shadows !== profile.shadows || (before.post === 'none') !== (profile.post === 'none')) {
      for (const scene of new Set([this.scene, this.shownScene])) {
        scene.traverse((o) => {
          const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true;
        });
      }
    }
    this.buildPasses();
    this.resize();
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
    cabinAudio.setRoomTone(false);
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
        this.present(dt);
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
        cabinAudio.setRoomTone(true);
        this.show(this.gate.scene, this.gate.camera);
        this.gate.show(moment.shot, moment.t, dt, time);
        this.present(dt);
        return true;
      }
      case 'aisle': {
        this.dropHotel();
        this.dropGate();
        this.showing = 'cabin';
        cabinAudio.setRoomTone(false);
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
      if (due.wall !== null && performance.now() - due.wall > 2500) continue;
      due.fn();
    }
    if (this.lastView?.phase.kind === 'boarding' && this.snap && this.boardingFrame(dt, time)) return;
    if (this.showing === 'hotel' && this.hotel) {
      this.hotel.update(dt, time);
      this.present(dt);
      return;
    }
    const built = this.built;
    if (built) {
      // The lights stay off after a blast for a moment, and until you are back up from under your seat.
      const mode = this.wantedMode !== 'night' && (time < this.darkUntil || this.searching) ? 'night' : this.wantedMode;
      built.lighting.setMode(mode);
      this.flight(time, built, dt);
      this.flyDeck(dt, time, built);
      built.lighting.update(dt);
      built.windows.update(dt);
      built.effects.update(dt, time, this.cart.group.position.z);
      built.cabin.curtain.update(dt, this.people.movers());
      // Sunbeams (or moonbeams) through the windows, as strong as the light outside.
      const beams = this.profile.shafts && this.showing === 'cabin' ? built.lighting.shaftStrength() : 0;
      built.shafts.update(dt, time, built.lighting.lightDirection, beams, built.lighting.key.color, this.renderer.getPixelRatio());
    }
    this.flash *= Math.exp(-dt * 5);
    // (Fewer flashes: a blast still shows, but only as a soft glow.)
    const flash = getPrefs().fewerFlashes ? Math.min(this.flash, 0.2) : this.flash;
    this.flashEl.style.opacity = flash > 0.01 ? String(flash) : '0';
    if (this.ending) {
      // The ending drives everyone and the camera; no seat controls, no network poses.
      this.cart.update(dt, time);
      this.people.update(dt, time);
      this.ending.update(this.time - this.endingFrom, dt, time);
      if (this.endingShake > 0.001) {
        // A jolt that rolls through the body (layered waves, not frame-to-frame jitter); none with reduced motion.
        const s = getPrefs().reduceMotion ? 0 : this.endingShake;
        this.camera.position.add(
          new THREE.Vector3(
            s * (Math.sin(time * 31.7 + 1.3) * 0.6 + Math.sin(time * 57.1) * 0.4),
            s * (Math.sin(time * 27.3 + 0.7) * 0.6 + Math.sin(time * 49.9 + 2.1) * 0.4),
            s * Math.sin(time * 23.1 + 0.4) * 0.5,
          ),
        );
        this.camera.rotateZ(s * 0.9 * Math.sin(time * 19.3));
        this.endingShake *= Math.exp(-dt * 3);
      }
      this.present(dt);
      if (this.ending.done) this.finishEnding();
      return;
    }
    this.controls.update(dt, time);
    // Your own body follows the camera down the aisle, and keeps out of the way while you search.
    const me = this.youId ? this.people.actor(this.youId) : undefined;
    // Crew see their own hands (and not the rest of their body, which their hands would double up with).
    this.crew.active = this.crewRow !== null && this.showing === 'cabin' && !this.ending;
    if (me) {
      me.drive(this.controls.body());
      me.hidden = this.searching || this.crew.active;
    }
    this.cart.update(dt, time);
    // Pushing the cart to a new row: it goes where your hands take it, and stays there when they stop.
    const walking = this.cartWalk && this.controls.scriptClock?.kind === 'walk';
    if (this.cartWalk && !walking) {
      this.cartWalk = false;
      this.cart.release();
    }
    this.crew.update(dt, this.controls.headBase, this.tabletFollows ? this.cart : null, walking);
    if (this.tabletFollows && this.liveMesh.visible) {
      this.cart.tabletMatrix(this.liveMesh.matrix);
      this.liveMesh.matrixWorldNeedsUpdate = true;
    } else if (this.crew.active && this.liveMesh.visible) {
      this.liveMesh.matrix.copy(this.crew.screenMatrix);
      this.liveMesh.matrixWorldNeedsUpdate = true;
    }
    this.applyPoses(time);
    this.doze(time);
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
    this.present(dt);
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
      if (emote === 'clap') cabinAudio.clap(clamp01(1.1 - this.camera.position.distanceTo(actor.root.position) / 9));
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
      const pose = this.poseSource?.get(p.id) ?? null;
      if (actor) actor.pose = pose;
      // When they last looked about (a passenger who keeps still at night nods off).
      const last = this.lastPoses.get(p.id);
      if (pose && (!last || Math.abs(last.yaw - pose.yaw) > 0.05 || Math.abs(last.pitch - pose.pitch) > 0.05)) {
        this.lastPoses.set(p.id, pose);
        this.poseMovedAt.set(p.id, time);
      }
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

  /**
   * A sleepy cabin at night: whoever keeps still nods off (bots always do), someone snores now and then, someone
   * stretches, and reading lights click on and off.
   */
  private doze(time: number): void {
    const game = this.lastView;
    const built = this.built;
    if (!game || !built || !isNightPhase(game.phase.kind) || this.ending) return;
    const dozers: string[] = [];
    for (const p of game.players) {
      if (p.id === this.youId || p.status !== 'alive') continue;
      const actor = this.people.actor(p.id);
      if (!actor || actor.walking || actor.away || actor.hidden || actor.crew) continue;
      if (time - (this.poseMovedAt.get(p.id) ?? -Infinity) < 6) continue;
      const seed = (p.id.charCodeAt(p.id.length - 1) % 17) * 0.7;
      actor.pose = { yaw: Math.sin(time * 0.13 + seed) * 0.25, pitch: -0.62 + Math.sin(time * 0.37 + seed) * 0.05, lean: false };
      dozers.push(p.id);
    }
    const anyone = () => dozers[Math.floor(Math.random() * dozers.length)];
    if (time >= this.nextZzz) {
      this.nextZzz = time + rand(4, 9);
      if (dozers.length) this.showBubble(anyone(), '💤', 'Asleep', 3);
    }
    if (time >= this.nextStretch) {
      this.nextStretch = time + rand(12, 26);
      const actor = dozers.length ? this.people.actor(anyone()) : undefined;
      if (actor && !actor.handsUp) {
        actor.handsUp = true;
        this.later(1.5, () => (actor.handsUp = false));
      }
    }
    if (time >= this.nextLamp) {
      this.nextLamp = time + rand(5, 11);
      built.lighting.toggleReadingLight();
    }
  }

  /** A little bubble over someone's head for a few seconds (a gesture, or a snore). */
  private showBubble(id: string, icon: string, title: string, seconds: number): void {
    let bubble = this.bubbleEls.get(id);
    if (!bubble) {
      bubble = { el: document.createElement('div'), until: 0 };
      bubble.el.className = 'emote-bubble';
      bubble.el.hidden = true;
      this.bubbles.appendChild(bubble.el);
      this.bubbleEls.set(id, bubble);
    }
    bubble.el.textContent = icon;
    bubble.el.title = title;
    bubble.until = this.time + seconds;
  }

  /** Engine power, the takeoff roll and climb, and turbulence, from the phase clock. */
  private flight(time: number, built: Built, dt = 1 / 60): void {
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
      if (onGround && !this.rolling) {
        this.rolling = true;
        cabinAudio.runway(Math.max(1, (0.64 - p) * (total / 1000)));
      }
      if (p >= 0.74 && !this.gearUp) {
        this.gearUp = true;
        cabinAudio.thunk();
        this.controls.shake(0.015);
      }
    } else if (!this.ending) {
      this.gearUp = false;
      this.rolling = false;
      windows.speed = isNightPhase(kind) ? 0.002 : 0.006;
      windows.lift = 0;
    }
    // (An ending plays its own engines.)
    if (!this.ending && Math.abs(engine - this.engine) > 0.01) {
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

    // A storm: lightning every few seconds (a flicker, a flash, sometimes another), the thunder a moment behind.
    if (this.viewMode === 'storm') {
      if (time >= this.nextLightning) {
        this.nextLightning = time + rand(4, 11);
        const strength = rand(0.55, 1);
        this.lightning = Math.max(this.lightning, strength * 0.5);
        this.later(0.09, () => (this.lightning = Math.max(this.lightning, strength)));
        if (Math.random() < 0.45) this.later(rand(0.25, 0.45), () => (this.lightning = Math.max(this.lightning, strength * 0.7)));
        this.later(rand(0.8, 2.6), () => cabinAudio.thunder(0.35 + strength * 0.4), true);
      }
    } else this.lightning = 0;
    this.lightning *= Math.exp(-dt * 7);
    const bolt = getPrefs().fewerFlashes ? this.lightning * 0.25 : this.lightning;
    windows.flash = bolt;
    built.lighting.lightning.intensity = bolt * 1.8;
    this.forwardView.flash = bolt;
    // (A faint white wash over the whole view, like the blast flash but softer.)
    if (this.lightning > 0.05) this.flash = Math.max(this.flash, this.lightning * 0.1);
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
    built.flightDeck.setDoor(this.cockpitDoor ?? this.people.anyNear(built.flightDeck.doorway, 0.9), this.cockpitBurst);
    this.cockpitBurst = false;
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

  /**
   * A group photo for the landing postcard: the cabin from the front, up by the ceiling looking down the aisle, lights
   * up and your own head back on. It goes through the game's own picture chain into the main canvas and is copied out,
   * and the normal frame is drawn again straight after (all at once, so nothing flickers). Cropped to `aspect` (width
   * over height). Null unless the cabin is on show.
   */
  groupShot(aspect: number): HTMLCanvasElement | null {
    const built = this.built;
    if (!built || this.showing !== 'cabin' || this.shownScene !== this.scene || this.ending) return null;
    const cam = this.camera;
    const saved = { position: cam.position.clone(), quaternion: cam.quaternion.clone(), fov: cam.fov };
    // Up by the ceiling a row or so ahead of the first row a survivor is in (nobody left sits in front of it), looking
    // down the rest.
    const rowsOf = (players: PlayerView['players']) =>
      players.flatMap((p) => {
        // (Not the Pilot: the flight deck is a place on the grid too, ahead of row 1.)
        const cell = p.seat ? grid.parsePlace(p.seat) : null;
        return cell && cell.row >= 1 ? [cell.row] : [];
      });
    const everyone = this.lastView?.players ?? [];
    const survivors = rowsOf(everyone.filter((p) => p.status === 'alive'));
    const rows = survivors.length ? survivors : rowsOf(everyone);
    const first = rows.length ? Math.min(...rows) : 1;
    const last = rows.length ? Math.max(...rows) : built.rows;
    cam.position.set(0, 1.95, Math.max(BULKHEAD_Z + 0.12, rowZ(first) - 1.3));
    cam.lookAt(0, 0.75, rowZ(Math.min(Math.max(last, first + 2), first + 5)));
    // At least 84° across, whatever the window's shape (the picture is cropped to `aspect`).
    const across = Math.tan(THREE.MathUtils.degToRad(42));
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(across / aspect, across / cam.aspect)));
    cam.updateProjectionMatrix();
    const canvas = this.renderer.domElement;
    const shot = document.createElement('canvas');
    shot.width = Math.min(canvas.width, Math.round(canvas.height * aspect));
    shot.height = Math.min(canvas.height, Math.round(canvas.width / aspect));
    try {
      this.people.withHead(this.youId, () =>
        built.lighting.withMode('day', () => {
          this.present(0);
          const { width: w, height: h } = shot;
          shot.getContext('2d')!.drawImage(canvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h, 0, 0, w, h);
        }),
      );
    } finally {
      cam.position.copy(saved.position);
      cam.quaternion.copy(saved.quaternion);
      cam.fov = saved.fov;
      cam.updateProjectionMatrix();
      this.present(0);
    }
    return shot;
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
    // A jammed night: nothing on the tape but static.
    if (this.tape?.plan.jammed) {
      this.staticFeed(view, w, h);
      return;
    }
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
    this.copyFeed(view, r.left - box.left, r.top - box.top, w, h);
    this.placeTags(view, cam, w, h);
  }

  /**
   * The console's own picture: a copy of what was just drawn, into the canvas inside its screen. (The console panel
   * sits over the 3D view and hides it, so the feed has to be in the page itself.) It must happen right after drawing,
   * while the frame is still there to copy.
   */
  private copyFeed(view: ConsoleView, left: number, top: number, w: number, h: number): void {
    const feed = view.screen.querySelector<HTMLCanvasElement>('canvas.cctv-feed');
    const g = feed?.getContext('2d');
    if (!feed || !g) return;
    const ratio = this.renderer.getPixelRatio();
    const fw = Math.round(w * ratio);
    const fh = Math.round(h * ratio);
    if (feed.width !== fw || feed.height !== fh) {
      feed.width = fw;
      feed.height = fh;
    }
    g.drawImage(this.renderer.domElement, Math.round(left * ratio), Math.round(top * ratio), fw, fh, 0, 0, fw, fh);
  }

  private readonly staticNoise = document.createElement('canvas');

  /** Snow on the console, rolling, with NO SIGNAL across it (the cameras were jammed that night). */
  private staticFeed(view: ConsoleView, w: number, h: number): void {
    const feed = view.screen.querySelector<HTMLCanvasElement>('canvas.cctv-feed');
    const g = feed?.getContext('2d');
    if (!feed || !g) return;
    if (feed.width !== w || feed.height !== h) {
      feed.width = w;
      feed.height = h;
    }
    const noise = this.staticNoise;
    noise.width = 160;
    noise.height = 90;
    const n = noise.getContext('2d')!;
    const pixels = n.createImageData(160, 90);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const v = Math.random() * 200;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
      pixels.data[i + 3] = 255;
    }
    n.putImageData(pixels, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(noise, 0, 0, w, h);
    // A darker band rolls slowly down the picture.
    const band = ((this.time * 0.35) % 1.4) * h - 0.2 * h;
    const roll = g.createLinearGradient(0, band, 0, band + 0.25 * h);
    roll.addColorStop(0, 'rgba(0, 0, 0, 0)');
    roll.addColorStop(0.5, 'rgba(0, 0, 0, 0.45)');
    roll.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = roll;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0, 0, 0, 0.6)';
    g.fillRect(w / 2 - 90, h / 2 - 22, 180, 44);
    g.fillStyle = '#e8eefb';
    g.font = '700 22px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('NO SIGNAL', w / 2, h / 2);
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
        // (The seatbelt chime after the announcement, not over its ding-dong.)
        this.later(Math.max(0.4, this.captionAt - this.time + 0.3), () => cabinAudio.chime(), true);
        break;
      case 'cartRoll': {
        if (cue.runaway) cabinAudio.rattle();
        // Someone else walking it (you hear your own push as you go).
        else if (!this.cartWalk) {
          const near = clamp01(1 - Math.abs(this.camera.position.z - rowZ(cue.to)) / 9);
          cabinAudio.roll(Math.min(4, Math.abs(cue.to - cue.from) * 0.75 + 1), 0.25 + near * 0.6);
        }
        break;
      }
      case 'restrained':
        cabinAudio.zip();
        break;
      case 'landing':
        // (The ending tells its own story, sound and all.)
        break;
      case 'poisoned': {
        const actor = this.people.actor(cue.playerId);
        const d = actor ? this.camera.position.distanceTo(actor.root.position) : 6;
        cabinAudio.cough(clamp01(1.1 - d / 9));
        break;
      }
      case 'roughAir': {
        // The plane bucks over three rows: hardest right there, felt all down the cabin.
        const mid = rowZ(cue.rows[1] ?? cue.rows[0] ?? 1);
        const near = clamp01(1 - Math.abs(this.camera.position.z - mid) / 7);
        cabinAudio.rumble(0.5 + near);
        this.controls.shake(0.02 + near * 0.06);
        this.later(0.8, () => cabinAudio.rumble(0.3 + near * 0.6));
        break;
      }
      case 'item':
        this.showBubble(cue.playerId, cue.item === 'bobbypin' ? '🔓' : cue.item === 'ffcard' ? '💳' : '🎒', cue.item === 'bobbypin' ? 'Picked the lock' : 'Used an item', 4);
        if (cue.item === 'bobbypin') cabinAudio.lockpick();
        else cabinAudio.paper();
        break;
      case 'voteOpen':
      case 'defused':
        break;
      case 'pa': {
        // One ding per announcement, captions one after another (after any blast).
        const at = Math.max(this.time + 0.2 + this.batchDelay, this.captionAt);
        this.captionAt = at + 4.5;
        // (Announcements still queued when an ending starts are dropped: the ending tells its own story.)
        this.later(at - this.time, () => !this.ending && cabinAudio.ding(), true);
        this.later(at - this.time + 0.9, () => !this.ending && this.opts.onCaption?.(cue.text, cue.who ?? 'Flight deck'), true);
        break;
      }
    }
  }

  /**
   * Sounds for you alone: the seatbelt sign lighting over your seat, a bomb turning up under you, your own items and
   * the defuser's snip, a whisper or your team's word, votes coming in (yours brighter), doors, and lunch arriving.
   */
  private hearOwn(prev: PlayerView, game: PlayerView): void {
    const you = game.you;
    if (!you) return;
    if (you.buckled && !prev.you?.buckled) cabinAudio.chime();
    // A bomb you did not plant, just found (after the crouch, if you were looking under your seat).
    const known = new Set(prev.bombs.map((b) => b.id));
    if (game.bombs.some((b) => !known.has(b.id) && !b.exploded && !b.defused && b.planterId !== you.id)) this.later(this.searching ? 2 : 0.3, () => cabinAudio.sting(), true);
    const seen = new Set(prev.log.map((e) => e.id));
    for (const e of game.log) {
      if (seen.has(e.id) || !Array.isArray(e.to) || !e.to.includes(you.id) || e.tag !== 'item') continue;
      if (e.text.startsWith('You cut the wires')) cabinAudio.snip();
      else if (e.text.includes('sleeping pill')) cabinAudio.pop();
      else if (e.text.includes('mirror') || e.text.includes('extender')) cabinAudio.click();
    }
    // A whisper to you, or your team's channel.
    const said = new Set(prev.chat.map((m) => m.id));
    if (game.chat.some((m) => !said.has(m.id) && m.from !== you.id && ((m.channel === 'whisper' && m.to === you.id) || m.channel === 'saboteurs'))) cabinAudio.ping();
    // Votes coming in.
    const count = (v: PlayerView) => Object.values(v.votes?.counts ?? {}).reduce((a, b) => a + b, 0);
    if (game.mine?.vote && game.mine.vote !== prev.mine?.vote) cabinAudio.tick(true);
    else if (count(game) > count(prev)) cabinAudio.tick();
    // Someone slipping into the lavatory, or called up to the flight deck: a door opens and shuts.
    if (game.washroom && game.washroom !== prev.washroom) {
      this.later(1.8, () => cabinAudio.door(true), true);
      this.later(2.7, () => cabinAudio.door(false), true);
    }
    if (game.jumpseat && game.jumpseat !== prev.jumpseat) {
      this.later(2.2, () => cabinAudio.door(true), true);
      this.later(3.4, () => cabinAudio.door(false), true);
    }
    // Lunch coming round.
    if (game.meal && !prev.meal) cabinAudio.clink();
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
    // Now the damage shows.
    this.blastPending = false;
    const view = this.lastView;
    if (view) {
      this.cart.setRow(view.cabin.cartRow, view.cabin.cartDestroyed);
      built.cabin.lavatoryDoor.visible = !view.cabin.lavatoryDestroyed;
      built.effects.setScorched(view.cabin.scorched, (cell) => this.cellPoint(cell));
    }
    if (this.youId && victims.includes(this.youId)) this.dieOnScreen();
    this.later(0.35, () => {
      built.effects.masks.drop();
      cabinAudio.masks();
    });
    this.later(1.3, () => this.opts.onScene?.('glance', false));
  }

  /** You died: slump in your seat, then straighten up again as a ghost. */
  private dieOnScreen(): void {
    this.controls.slump(true);
    cabinAudio.heartbeat();
    this.later(4.5, () => {
      this.controls.slump(false);
      cabinAudio.swell();
    });
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

  /** Lunch: trays in front of everyone in a seat, with what they were handed. */
  private serveLunch(game: PlayerView): void {
    const meal = game.meal;
    const orders = meal?.orders ?? {};
    this.trays.set(
      meal
        ? game.players.flatMap((p) => {
            const dish = orders[p.id];
            return dish && p.status === 'alive' && p.seat && grid.parseSeat(p.seat) ? [{ seat: p.seat, dish }] : [];
          })
        : [],
    );
  }

  /**
   * Run `fn` in `seconds` of cabin time. `droppable` for a sound or a caption: if the tab was hidden and it comes due
   * long after it should have (wall clock), it is skipped instead of piling up with the others.
   */
  private later(seconds: number, fn: () => void, droppable = false): void {
    this.timers.push({ at: this.time + seconds, fn, wall: droppable ? performance.now() + seconds * 1000 : null });
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
