import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { SeatId } from '../engine';
import type { CabinParts } from './scene/cabin';
import type { SeatParts } from './scene/seats';
import type { WindowView } from './windows';

/** `blackout`: the Bermuda Triangle knocked the cabin lights out for a day; only daylight and path lights. */
export type LightMode = 'day' | 'night' | 'blackout';

interface Preset {
  hemi: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  ambient: number;
  key: number;
  keyColor: THREE.Color;
  /** Direction the sun or moon shines (through the windows on one side). */
  keyDir: THREE.Vector3;
  ceiling: number;
  cove: number;
  floor: number;
  screens: number;
  glow: number;
  /** Strength of the reflection environment (it would light the cabin at night otherwise). */
  env: number;
  /** How bright the view through the windows is. */
  windows: number;
}

const PRESETS: Record<LightMode, Preset> = {
  day: {
    hemi: 0.5,
    hemiSky: new THREE.Color('#eef3ff'),
    hemiGround: new THREE.Color('#6d5c4a'),
    ambient: 0.1,
    key: 1.7,
    keyColor: new THREE.Color('#ffe0b3'),
    keyDir: new THREE.Vector3(-1, -0.42, 0.22).normalize(),
    ceiling: 2.2,
    cove: 1.3,
    floor: 0.05,
    screens: 0.85,
    glow: 0,
    env: 0.18,
    windows: 1,
  },
  night: {
    hemi: 0.09,
    hemiSky: new THREE.Color('#5a72c2'),
    hemiGround: new THREE.Color('#0d0a07'),
    ambient: 0.025,
    key: 0.5,
    keyColor: new THREE.Color('#9db4ff'),
    keyDir: new THREE.Vector3(1, -0.5, -0.18).normalize(),
    ceiling: 0,
    cove: 0.06,
    floor: 2.6,
    screens: 1.8,
    glow: 0.12,
    env: 0.015,
    windows: 0.55,
  },
  blackout: {
    hemi: 0.32,
    hemiSky: new THREE.Color('#dfe8ff'),
    hemiGround: new THREE.Color('#3a3129'),
    ambient: 0.05,
    key: 1.5,
    keyColor: new THREE.Color('#ffe7c4'),
    keyDir: new THREE.Vector3(-1, -0.42, 0.22).normalize(),
    ceiling: 0,
    cove: 0.05,
    floor: 1.8,
    screens: 0.9,
    glow: 0.05,
    env: 0.09,
    windows: 1,
  },
};

const TRANSITION_S = 2.4;
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The main cabin lights do not fade: they clunk off with a stutter, or flicker on like fluorescent
 * tubes. Returns how far (0..1) the switch has got at transition time t.
 */
function switchCurve(t: number, on: boolean): number {
  if (on) {
    if (t < 0.06) return 0;
    if (t < 0.085) return 0.7;
    if (t < 0.12) return 0.05;
    if (t < 0.14) return 0.9;
    if (t < 0.17) return 0.3;
    return Math.min(1, 0.85 + (t - 0.17) * 2);
  }
  if (t < 0.02) return 0;
  if (t < 0.045) return 0.7;
  if (t < 0.07) return 0.3;
  return 1;
}

export class Lighting {
  readonly hemi = new THREE.HemisphereLight();
  readonly ambient = new THREE.AmbientLight();
  readonly key = new THREE.DirectionalLight();
  readonly ceiling: THREE.RectAreaLight;
  /** Your own screen lighting your face and hands at night. */
  readonly screenGlow = new THREE.PointLight('#8db3ff', 0, 1.0, 2);
  /** Lightning through the windows: a cold white light over everything, for an instant. */
  readonly lightning = new THREE.HemisphereLight('#dfe8ff', '#1c2433', 0);
  mode: LightMode = 'day';
  private from: Preset = PRESETS.day;
  private to: Preset = PRESETS.day;
  private t = 1;
  private readonly litSeats = new Set<SeatId>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly cabin: CabinParts,
    private readonly seats: SeatParts,
    private readonly windows: WindowView,
    shadows: boolean,
  ) {
    RectAreaLightUniformsLib.init();
    const length = cabin.rearZ - cabin.frontZ;
    const midZ = (cabin.frontZ + cabin.rearZ) / 2;
    this.ceiling = new THREE.RectAreaLight('#f3f6ff', 0, 1.1, length);
    this.ceiling.position.set(0, 2.17, midZ);
    this.ceiling.lookAt(0, 0, midZ);

    this.key.castShadow = shadows;
    if (shadows) {
      this.key.shadow.mapSize.set(2048, 2048);
      const cam = this.key.shadow.camera;
      cam.left = -length / 2 - 1;
      cam.right = length / 2 + 1;
      cam.top = 3;
      cam.bottom = -3;
      cam.near = 0.1;
      cam.far = 14;
      this.key.shadow.bias = -0.0004;
      this.key.shadow.normalBias = 0.02;
    }
    this.key.target.position.set(0, 0.8, midZ);
    scene.add(this.hemi, this.ambient, this.key, this.key.target, this.ceiling, this.screenGlow, this.lightning);
    this.apply(PRESETS.day);
  }

  /** Safe to call every frame: only a change of mode starts a transition. */
  setMode(mode: LightMode, instant = false): void {
    if (mode === this.mode) {
      if (instant && this.t < 1) {
        this.t = 1;
        this.apply(this.to);
      }
      return;
    }
    this.from = this.snapshot();
    this.to = PRESETS[mode];
    this.mode = mode;
    this.t = instant ? 1 : 0;
    if (mode === 'night') this.pickReadingLights();
    else this.clearReadingLights();
    if (instant) this.apply(this.to);
  }

  dispose(): void {
    this.clearReadingLights();
    for (const light of [this.hemi, this.ambient, this.key, this.key.target, this.ceiling, this.screenGlow, this.lightning]) light.removeFromParent();
    this.key.shadow.map?.dispose();
  }

  /**
   * Draw once lit as `mode` (the cabin cameras' tape of last night, by day), then put the lights back. The sun keeps
   * its direction, so the shadow map drawn for this frame still fits.
   */
  withMode(mode: LightMode, draw: () => void): void {
    const saved = this.snapshot();
    this.apply({ ...PRESETS[mode], keyDir: this.keyDir.clone() });
    try {
      draw();
    } finally {
      this.apply(saved);
    }
  }

  /** At night, someone switches their reading light on or off (fewer than one in five stay on). */
  toggleReadingLight(): void {
    if (this.mode !== 'night') return;
    const seats = this.cabin.readingLights.seats;
    if (seats.length === 0) return;
    const lit = [...this.litSeats];
    const off = lit.length > seats.length * 0.18 || (lit.length > 0 && Math.random() < 0.5);
    const seat = off ? lit[Math.floor(Math.random() * lit.length)] : seats[Math.floor(Math.random() * seats.length)];
    const on = !this.litSeats.has(seat);
    if (on) this.litSeats.add(seat);
    else this.litSeats.delete(seat);
    this.cabin.readingLights.set(seat, on);
  }

  /** Put your screen's glow in front of your face. */
  placeScreenGlow(position: THREE.Vector3): void {
    this.screenGlow.position.copy(position);
  }

  update(dt: number): void {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / TRANSITION_S);
      const p = this.blend(this.from, this.to, smooth(this.t));
      // Main lights switch rather than fade.
      const turningOn = this.to.ceiling > this.from.ceiling;
      const k = switchCurve(this.t, turningOn);
      p.ceiling = this.from.ceiling + (this.to.ceiling - this.from.ceiling) * k;
      p.cove = this.from.cove + (this.to.cove - this.from.cove) * k;
      this.apply(p);
    }
  }

  private pickReadingLights(): void {
    this.clearReadingLights();
    for (const seat of this.cabin.readingLights.seats) if (Math.random() < 0.12) this.litSeats.add(seat);
    for (const seat of this.litSeats) this.cabin.readingLights.set(seat, true);
  }

  private clearReadingLights(): void {
    for (const seat of this.litSeats) this.cabin.readingLights.set(seat, false);
    this.litSeats.clear();
  }

  private snapshot(): Preset {
    return {
      hemi: this.hemi.intensity,
      hemiSky: this.hemi.color.clone(),
      hemiGround: this.hemi.groundColor.clone(),
      ambient: this.ambient.intensity,
      key: this.key.intensity,
      keyColor: this.key.color.clone(),
      keyDir: this.keyDir.clone(),
      ceiling: this.ceiling.intensity,
      cove: this.cabin.cove.emissiveIntensity,
      floor: this.cabin.floorLights.emissiveIntensity,
      screens: this.seats.screenMaterial.emissiveIntensity,
      glow: this.screenGlow.intensity,
      env: this.scene.environmentIntensity,
      windows: this.windows.brightness,
    };
  }

  private keyDir = PRESETS.day.keyDir.clone();

  private blend(a: Preset, b: Preset, t: number): Preset {
    const n = (x: number, y: number) => x + (y - x) * t;
    return {
      hemi: n(a.hemi, b.hemi),
      hemiSky: a.hemiSky.clone().lerp(b.hemiSky, t),
      hemiGround: a.hemiGround.clone().lerp(b.hemiGround, t),
      ambient: n(a.ambient, b.ambient),
      key: n(a.key, b.key),
      keyColor: a.keyColor.clone().lerp(b.keyColor, t),
      keyDir: a.keyDir.clone().lerp(b.keyDir, t).normalize(),
      ceiling: n(a.ceiling, b.ceiling),
      cove: n(a.cove, b.cove),
      floor: n(a.floor, b.floor),
      screens: n(a.screens, b.screens),
      glow: n(a.glow, b.glow),
      env: n(a.env, b.env),
      windows: n(a.windows, b.windows),
    };
  }

  private apply(p: Preset): void {
    this.hemi.intensity = p.hemi;
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.ambient.intensity = p.ambient;
    this.key.intensity = p.key;
    this.key.color.copy(p.keyColor);
    this.keyDir.copy(p.keyDir);
    this.key.position.copy(this.key.target.position).addScaledVector(p.keyDir, -6);
    this.ceiling.intensity = p.ceiling;
    this.cabin.cove.emissiveIntensity = p.cove;
    this.cabin.floorLights.emissiveIntensity = p.floor;
    this.seats.screenMaterial.emissiveIntensity = p.screens;
    this.screenGlow.intensity = p.glow;
    this.scene.environmentIntensity = p.env;
    this.windows.brightness = p.windows;
  }
}
