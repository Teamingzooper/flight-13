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
import { grid, isNightPhase, type PlayerView, type SeatId } from '../engine';
import { msLeft, type ClientSnapshot } from '../net/client';
import type { ClientState } from '../net/protocol';
import { SeatControls } from './controls';
import { BULKHEAD_Z, eyePosition } from './layout';
import { Lighting } from './lighting';
import { Passengers } from './scene/avatars';
import { buildCabin, type CabinParts } from './scene/cabin';
import { Cart } from './scene/cart';
import { SCREEN_H, SCREEN_W, buildSeats, type SeatParts } from './scene/seats';
import { LiveScreen } from './screen';

export interface Cabin3DOptions {
  onScreenClick: () => void;
  onLockChange?: (locked: boolean) => void;
  onAimChange?: (onScreen: boolean) => void;
}

interface Built {
  rows: number;
  cabin: CabinParts;
  seats: SeatParts;
  lighting: Lighting;
  group: THREE.Group;
}

const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

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
  private readonly passengers = new Passengers();
  private readonly cart = new Cart();
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private built: Built | null = null;
  private seatKey: string | null = null;
  private state: ClientState | null = null;
  private snap: ClientSnapshot | null = null;
  private aimOnScreen = false;
  private disposed = false;

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
    this.scene.add(this.liveMesh, this.passengers.group, this.cart.group, this.camera);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
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
    });

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
    if (!this.built || this.built.rows !== game.cabin.rows) this.build(game.cabin.rows);
    const { cabin, lighting } = this.built!;
    const night = isNightPhase(game.phase.kind);
    lighting.setMode(night ? 'night' : 'day');

    const seat = game.you?.seat ?? null;
    const key = seat ?? (game.you ? 'aft' : 'tower');
    if (key !== this.seatKey) {
      const animate = this.seatKey !== null && seat !== null && this.seatKey !== 'aft' && this.seatKey !== 'tower';
      this.seatKey = key;
      this.placeCamera(seat, animate);
    }

    this.passengers.sync(game.players, game.you?.id ?? null, true);
    this.cart.setRow(game.cabin.cartRow, game.cabin.cartDestroyed);
    cabin.lavatoryDoor.visible = !game.cabin.lavatoryDestroyed;

    // Only your own seatbelt sign lights up for you (who else is buckled stays secret).
    if (seat && game.you?.buckled) {
      const cell = grid.parseSeat(seat)!;
      cabin.lightSeatbelt(`${cell.row}${cell.col < grid.AISLE_COL ? 'L' : 'R'}`);
      if (game.you.buckled === 'turbulence') this.controls.shake(0.05);
    } else {
      cabin.lightSeatbelt(null);
    }
  }

  setLeaning(on: boolean): void {
    this.controls.setLeaning(on);
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
    group.add(cabin.group, seats.group);
    this.scene.add(group);
    const lighting = new Lighting(this.scene, cabin, seats, this.renderer.shadowMap.enabled);
    this.built = { rows, cabin, seats, lighting, group };
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
    // Restrained passengers watch from the rear galley; the control tower from the front.
    this.liveMesh.visible = false;
    if (this.seatKey === 'aft') this.controls.setSeat(new THREE.Vector3(0.9, 1.62, cabin.rearZ - 0.6), null, false, 0);
    else this.controls.setSeat(new THREE.Vector3(0, 1.85, BULKHEAD_Z + 0.35), null, false, Math.PI);
  }

  private tap(ndc: THREE.Vector2): void {
    if (this.hitsScreen(ndc)) this.opts.onScreenClick();
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
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(0.1, this.timer.getDelta());
    const time = this.timer.getElapsed();
    this.controls.update(dt, time);
    this.built?.lighting.update(dt);
    this.cart.update(dt);
    this.passengers.update(dt, time);
    this.drawScreen(time);
    const aim = this.controls.locked && this.hitsScreen(new THREE.Vector2(0, 0));
    if (aim !== this.aimOnScreen) {
      this.aimOnScreen = aim;
      this.opts.onAimChange?.(aim);
    }
    this.composer.render(dt);
  }

  private drawScreen(time: number): void {
    const game: PlayerView | null | undefined = this.state?.game;
    if (!game || !this.snap || !this.liveMesh.visible) return;
    const hint = TOUCH ? 'TAP TO USE' : this.controls.locked ? 'CLICK TO USE' : 'CLICK THE SCREEN OR PRESS E';
    this.liveScreen.draw(game, this.state!.code, msLeft(this.snap, Date.now()), hint, Math.sin(time * 4) > 0);
  }
}
