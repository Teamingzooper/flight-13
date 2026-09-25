import * as THREE from 'three';
import type { Look } from '../engine';
import { People } from './scene/people';

/** Close on the face, the head from three-quarters (to show the hair), or the whole passenger. */
export type Framing = 'face' | 'hair' | 'body';

const ID = 'you';
const TURN = Math.PI * 2;
/** Camera height, distance and aim, and how far the passenger stands turned from facing you. */
const SHOTS: Record<Framing, { height: number; distance: number; target: number; turn: number }> = {
  face: { height: 1.56, distance: 1.1, target: 1.5, turn: 0 },
  hair: { height: 1.62, distance: 1.15, target: 1.52, turn: 0.75 },
  body: { height: 1.05, distance: 4, target: 0.86, turn: 0.3 },
};
const approach = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));

/** A soft round shadow for the floor. */
function shadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Your passenger on a turntable, built from the same parts as the cabin, for the wardrobe. Drag to turn them;
 * left alone, they sway gently and come back round to face you.
 */
export class CharacterStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.05, 30);
  private readonly people = new People();
  private readonly timer = new THREE.Timer();
  private readonly resizeObserver: ResizeObserver;
  private readonly shadow: THREE.Mesh;
  private readonly shot = { ...SHOTS.face };
  private turn = 0;
  private framing: Framing = 'face';
  private spin = 0;
  private velocity = 0;
  private drag: { x: number; at: number } | null = null;
  private lastTouch = -10;
  private time = 0;
  private settled = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Studio light: a warm key from the front, a cool rim from behind, and a soft fill.
    const fill = new THREE.HemisphereLight('#dde6ff', '#2b2420', 1.5);
    const key = new THREE.DirectionalLight('#fff0da', 2.4);
    key.position.set(-1.4, 2.6, -2.2);
    const rim = new THREE.DirectionalLight('#9dbcff', 2);
    rim.position.set(1.6, 2.2, 2.4);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.95),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.002;
    this.scene.add(fill, key, rim, this.shadow, this.people.group);

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.timer.connect(document);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Dress the passenger (and paint their face). */
  set(look: Look, face: string): void {
    this.people.sync(
      [{ id: ID, name: '', look, seat: null, status: 'alive', cause: null, outNight: null, role: null, team: null }],
      null,
      () => new THREE.Vector3(),
      new Map([[ID, face]]),
    );
    if (!this.settled) {
      // Start on their feet rather than rising from an invisible seat.
      this.settled = true;
      this.pose(0);
      for (let i = 0; i < 45; i++) this.people.update(1 / 30, i / 30);
    }
  }

  setFraming(framing: Framing, instant = false): void {
    this.framing = framing;
    if (instant) {
      Object.assign(this.shot, SHOTS[framing]);
      this.turn = SHOTS[framing].turn;
    }
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.timer.dispose();
    this.people.dispose();
    const material = this.shadow.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
    this.shadow.geometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private readonly onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, at: performance.now() };
    this.velocity = 0;
    this.lastTouch = this.time;
  };

  private readonly onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const now = performance.now();
    const turn = (e.clientX - this.drag.x) * 0.012;
    this.spin += turn;
    this.velocity = turn / Math.max(0.008, (now - this.drag.at) / 1000);
    this.drag = { x: e.clientX, at: now };
    this.lastTouch = this.time;
  };

  private readonly onUp = () => {
    this.drag = null;
    this.lastTouch = this.time;
  };

  private resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private pose(yaw: number): void {
    this.people.actor(ID)?.drive({ x: 0, z: 0, yaw, walk: 0, phase: 0 });
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(0.1, this.timer.getDelta());
    this.time = this.timer.getElapsed();
    // A flick keeps turning for a moment; left alone they sway, then come back round to face you.
    if (!this.drag) {
      this.spin += this.velocity * dt;
      this.velocity *= Math.exp(-4 * dt);
    }
    const idle = Math.min(1, Math.max(0, (this.time - this.lastTouch - 2.5) / 2));
    if (idle > 0) this.spin = approach(this.spin, Math.round(this.spin / TURN) * TURN, 1.5 * idle, dt);
    const target = SHOTS[this.framing] ?? SHOTS.face;
    this.turn = approach(this.turn, target.turn, 4, dt);
    this.pose(this.spin + this.turn + Math.sin(this.time * 0.6) * 0.35 * idle);
    this.people.update(dt, this.time);

    for (const k of ['height', 'distance', 'target'] as const) this.shot[k] = approach(this.shot[k], target[k], 5, dt);
    // The character faces -z, so the camera stands on that side.
    this.camera.position.set(0, this.shot.height, -this.shot.distance);
    this.camera.lookAt(0, this.shot.target, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
