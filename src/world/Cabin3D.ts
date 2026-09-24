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
import { DESTINATIONS, grid, isNightPhase, phaseDurationMs, type Cell, type ItemId, type PlayerView, type SeatId } from '../engine';
import { msLeft, type ClientSnapshot } from '../net/client';
import type { ClientState, Pose } from '../net/protocol';
import { cabinAudio } from './audio';
import { SeatControls } from './controls';
import { directorCues, type Cue } from './director';
import { BULKHEAD_Z, colX, eyePosition, rowZ } from './layout';
import { Lighting, type LightMode } from './lighting';
import { buildCabin, type CabinParts } from './scene/cabin';
import { Cart } from './scene/cart';
import { Effects } from './scene/effects';
import { People } from './scene/people';
import { SCREEN_H, SCREEN_W, buildSeats, type SeatParts } from './scene/seats';
import { BOARDING_SHOTS, FADE, boardingMoment } from './boarding';
import { LiveScreen } from './screen';
import { GateSet } from './sets/gate';
import { HotelSet } from './sets/hotel';
import { auroraSkyTexture, dawnSkyTexture, runwayTexture } from './textures';
import { WindowView } from './windows';

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
}

export type SceneKind = 'walk' | 'search' | 'glance';

interface Built {
  rows: number;
  cabin: CabinParts;
  seats: SeatParts;
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
  private lastPose: Pose | null = null;
  private lastPoseAt = 0;
  private youId: string | null = null;
  private readonly cart = new Cart();
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private built: Built | null = null;
  private seatKey: string | null = null;
  private state: ClientState | null = null;
  private snap: ClientSnapshot | null = null;
  private aimOnScreen = false;
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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    this.scene.add(this.liveMesh, this.people.group, this.cart.group, this.camera);

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
        this.flashlight.intensity = on ? 9 : 0;
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
    const game = state.game;
    if (!game) return;
    const fresh = !this.built || this.built.rows !== game.cabin.rows;
    if (fresh) this.build(game.cabin.rows);
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
      if (!game.you) this.fade(1, 0, `Now boarding · Flight 13 to ${DESTINATIONS[game.settings.destination].city}`);
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
    const bermuda = game.settings.destination === 'BDA';
    const grounded = kind === 'packing' || kind === 'boarding' || kind === 'takeoff';
    const sky = grounded ? skies.runway : night ? (bermuda ? skies.aurora : skies.night) : kind === 'dawn' ? skies.dawn : skies.day;
    windows.show(sky, fresh || grounded ? 0 : 1.4);
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
    const key = seat ?? (game.you ? 'aft' : 'tower');
    if (key !== this.seatKey) {
      const animate = this.seatKey !== null && seat !== null && this.seatKey !== 'aft' && this.seatKey !== 'tower';
      this.seatKey = key;
      this.placeCamera(seat, animate);
    }
    const runaway = cues.some((c) => c.kind === 'cartRoll' && c.runaway);
    this.cart.setRow(game.cabin.cartRow, game.cabin.cartDestroyed, runaway);
    cabin.lavatoryDoor.visible = !game.cabin.lavatoryDestroyed;

    // Only your own seatbelt sign lights up for you (who else is buckled stays secret).
    if (seat && game.you?.buckled) {
      const cell = grid.parseSeat(seat)!;
      cabin.lightSeatbelt(`${cell.row}${cell.col < grid.AISLE_COL ? 'L' : 'R'}`);
    } else {
      cabin.lightSeatbelt(null);
    }

    for (const cue of cues) this.play(cue, game);
    if (prev && game.you && seat) {
      // You just looked under your seat: crouch down and see for yourself.
      if (game.you.searched && !prev.you?.searched) this.controls.search();
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
    this.hotel?.dispose();
    this.gate?.dispose();
    this.built?.windows.dispose();
    this.built?.effects.dispose();
    this.controls.dispose();
    this.timer.dispose();
    this.composer.dispose();
    this.liveScreen.dispose();
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

  private build(rows: number): void {
    if (this.built) {
      this.scene.remove(this.built.group);
      this.built.lighting.dispose();
    }
    const group = new THREE.Group();
    const cabin = buildCabin(rows);
    const seats = buildSeats(rows);
    const skies = { day: cabin.skyDay, night: cabin.skyNight, dawn: dawnSkyTexture(), aurora: auroraSkyTexture(), runway: runwayTexture() };
    const windows = new WindowView(cabin.windowGlass, skies.day);
    const lav = cabin.lavatoryDoor.position;
    const effects = new Effects(rows, seats, new THREE.Vector3(lav.x, 1.0, lav.z + 0.7));
    group.add(cabin.group, seats.group, effects.group);
    this.scene.add(group);
    const lighting = new Lighting(this.scene, cabin, seats, windows, this.renderer.shadowMap.enabled);
    this.built = { rows, cabin, seats, lighting, windows, effects, skies, group };
    this.seatKey = null;
  }

  private placeCamera(seat: SeatId | null, animate: boolean): void {
    const { seats, lighting, cabin } = this.built!;
    seats.hideScreen(seat);
    if (seat) {
      const e = eyePosition(seat);
      const screen = seats.screenMatrix(seat);
      this.controls.setSeat(new THREE.Vector3(e.x, e.y, e.z), screen, animate);
      this.liveMesh.matrix.copy(screen);
      this.liveMesh.matrixWorldNeedsUpdate = true;
      this.liveMesh.visible = true;
      const glow = new THREE.Vector3(0, 0, 0.25).applyMatrix4(screen);
      lighting.placeScreenGlow(glow);
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
    if (!this.controls.walking && this.hitsScreen(ndc)) this.opts.onScreenClick();
    else this.controls.requestLock();
  }

  private hitsScreen(ndc: THREE.Vector2): boolean {
    if (!this.liveMesh.visible) return false;
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObject(this.liveMesh, false).length > 0;
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
            this.later(0.9, () => this.opts.onCaption?.(`Flight 13 to ${DESTINATIONS[game.settings.destination].city} is now boarding. Please have your boarding pass ready.`, 'Gate 13'));
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
      const mode = this.wantedMode !== 'night' && time < this.darkUntil ? 'night' : this.wantedMode;
      built.lighting.setMode(mode);
      this.flight(time, built);
      built.lighting.update(dt);
      built.windows.update(dt);
      built.effects.update(dt, time, this.cart.group.position.z);
    }
    this.flash *= Math.exp(-dt * 5);
    this.flashEl.style.opacity = this.flash > 0.01 ? String(this.flash) : '0';
    this.controls.update(dt, time);
    // Your own body follows the camera down the aisle, and keeps out of the way while you search.
    const me = this.youId ? this.people.actor(this.youId) : undefined;
    if (me) {
      me.drive(this.controls.body());
      me.hidden = this.searching;
    }
    this.cart.update(dt, time);
    this.applyPoses(time);
    this.people.update(dt, time);
    this.drawScreen(time);
    const aim = this.controls.locked && this.hitsScreen(new THREE.Vector2(0, 0));
    if (aim !== this.aimOnScreen) {
      this.aimOnScreen = aim;
      this.opts.onAimChange?.(aim);
    }
    this.composer.render(dt);
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
    } else {
      this.gearUp = false;
      windows.speed = isNightPhase(kind) ? 0.002 : 0.006;
      windows.lift = 0;
    }
    if (Math.abs(engine - this.engine) > 0.01) {
      this.engine = engine;
      cabinAudio.setEngine(engine, kind === 'takeoff' ? 2.5 : 4);
    }

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
        this.later(at - this.time, () => cabinAudio.ding());
        this.later(at - this.time + 0.9, () => this.opts.onCaption?.(cue.text));
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
    this.people.sync(players, this.youId, (i) => rearSpot(rows, i), this.faceSource);
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
