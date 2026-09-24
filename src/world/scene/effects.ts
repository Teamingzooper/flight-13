import * as THREE from 'three';
import { grid, type Cell } from '../../engine';
import { CABIN_HALF_WIDTH, colX, rowZ } from '../layout';
import { flameTexture, glowTexture, scorchTexture, smokeTexture } from '../textures';
import type { SeatParts } from './seats';

const GRAVITY = 9.8;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Service panels hang under the bins; the smoke pools just under the ceiling. */
const PSU_Y = 1.6;
const CEILING = 2.08;

interface Puff {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  peak: number;
  from: number;
  to: number;
  spin: number;
}

/** Lights live for the whole flight: adding one mid-game would recompile every shader and stall. */
interface BlastLights {
  flash: THREE.PointLight;
  fire: THREE.PointLight;
}

/** One explosion: flash, fireball, sparks, debris, smoke and a fire that burns out. */
class Blast {
  readonly group = new THREE.Group();
  done = false;
  private age = 0;
  private readonly ball: THREE.Sprite;
  private readonly sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly sparkVelocity: Float32Array;
  private readonly sparkLife: Float32Array;
  private readonly puffs: Puff[] = [];
  private readonly flames: { sprite: THREE.Sprite; seed: number; base: THREE.Vector3 }[] = [];
  private readonly debris: THREE.InstancedMesh;
  private readonly debrisState: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; s: number; resting: boolean }[] = [];
  private readonly tmp = new THREE.Object3D();

  constructor(
    readonly at: THREE.Vector3,
    textures: { smoke: THREE.Texture; flame: THREE.Texture; glow: THREE.Texture },
    private readonly lights: BlastLights,
  ) {
    lights.flash.position.copy(at).add(new THREE.Vector3(0, 0.3, 0));
    lights.fire.position.copy(at).add(new THREE.Vector3(0, 0.25, 0));

    this.ball = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: '#fff0c8', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ball.position.copy(at).add(new THREE.Vector3(0, 0.25, 0));
    this.ball.scale.setScalar(0.1);

    // Sparks: additive points whose colour fades to black (= invisible).
    const count = 160;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.sparkVelocity = new Float32Array(count * 3);
    this.sparkLife = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions.set([at.x, at.y + 0.1, at.z], i * 3);
      const dir = new THREE.Vector3(rand(-1, 1), rand(0.1, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(2, 7));
      this.sparkVelocity.set([dir.x, dir.y, dir.z], i * 3);
      this.sparkLife[i] = rand(0.4, 1.5);
      colors.set([1, 0.8, 0.45], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.sparks = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.sparks.frustumCulled = false;

    // Bits of seat, tray and panel that fly out and stay where they land.
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.8 }), 18);
    this.debris.castShadow = true;
    for (let i = 0; i < 18; i++) {
      this.debrisState.push({
        p: at.clone().add(new THREE.Vector3(0, 0.2, 0)),
        v: new THREE.Vector3(rand(-1, 1), rand(0.5, 1.6), rand(-1, 1)).multiplyScalar(rand(1.5, 4)),
        r: new THREE.Euler(rand(0, 3), rand(0, 3), rand(0, 3)),
        w: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
        s: rand(0.025, 0.08),
        resting: false,
      });
    }

    for (let i = 0; i < 44; i++) {
      const material = new THREE.SpriteMaterial({ map: textures.smoke, color: i % 3 === 0 ? '#6e6862' : '#4a4540', transparent: true, opacity: 0, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(at).add(new THREE.Vector3(rand(-0.25, 0.25), rand(0, 0.3), rand(-0.25, 0.25)));
      this.puffs.push({
        sprite,
        velocity: new THREE.Vector3(rand(-0.5, 0.5), rand(0.4, 1.1), rand(-0.9, 0.9)),
        age: -rand(0, 1.2),
        life: rand(8, 14),
        peak: rand(0.6, 0.9),
        from: rand(0.4, 0.7),
        to: rand(2.2, 3.4),
        spin: rand(-0.3, 0.3),
      });
      this.group.add(sprite);
    }

    for (let i = 0; i < 9; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.flame, color: '#ffb066', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const base = at.clone().add(new THREE.Vector3(rand(-0.22, 0.22), 0.05, rand(-0.22, 0.22)));
      sprite.position.copy(base);
      this.flames.push({ sprite, seed: Math.random() * 100, base });
      this.group.add(sprite);
    }

    this.group.add(this.ball, this.sparks, this.debris);
  }

  update(dt: number, time: number): void {
    this.age += dt;
    const t = this.age;

    // Flash: a blinding instant that dies away in a fraction of a second.
    this.lights.flash.intensity = t < 0.03 ? (t / 0.03) * 140 : 140 * Math.exp(-(t - 0.03) / 0.16);
    // Fireball: swells fast, then burns out.
    const grow = 1 - Math.exp(-t / 0.07);
    this.ball.scale.setScalar(0.1 + 2.8 * grow);
    this.ball.material.opacity = clamp01(1 - t / 0.6);
    this.ball.material.color.setRGB(1, clamp01(0.95 - t * 1.2), clamp01(0.75 - t * 2));
    this.ball.visible = t < 0.6;

    this.updateSparks(dt);
    this.updateDebris(dt);

    let puffsLeft = false;
    for (const puff of this.puffs) {
      puff.age += dt;
      if (puff.age < 0) continue;
      const k = puff.age / puff.life;
      if (k >= 1) {
        puff.sprite.visible = false;
        continue;
      }
      puffsLeft = true;
      puff.velocity.multiplyScalar(Math.exp(-dt * 0.6));
      puff.sprite.position.addScaledVector(puff.velocity, dt);
      // Smoke pools under the ceiling and spreads along the cabin.
      if (puff.sprite.position.y > CEILING) {
        puff.sprite.position.y = CEILING;
        puff.velocity.y = 0;
        puff.velocity.z += Math.sign(puff.velocity.z || 1) * dt * 0.4;
      }
      puff.sprite.scale.setScalar(puff.from + (puff.to - puff.from) * Math.sqrt(k));
      const material = puff.sprite.material;
      material.opacity = puff.peak * Math.min(1, puff.age / 0.5) * (1 - k) ** 1.5;
      material.rotation += puff.spin * dt;
    }

    // Fire: flickering tongues that shrink and go out after a few seconds.
    const fire = clamp01(1 - (t - 4) / 3);
    for (const f of this.flames) {
      const flicker = 0.75 + 0.25 * Math.sin(time * 17 + f.seed) * Math.sin(time * 7.3 + f.seed * 2);
      const size = 0.28 * fire * flicker;
      f.sprite.visible = size > 0.01 && t > 0.1;
      f.sprite.scale.set(size * 0.7, size * 1.5, 1);
      f.sprite.position.set(f.base.x, f.base.y + size * 0.6, f.base.z);
      f.sprite.material.opacity = 0.85 * fire;
    }
    this.lights.fire.intensity = t > 0.1 ? 3.2 * fire * (0.8 + 0.2 * Math.sin(time * 21)) : 0;

    this.done = t > 2 && !puffsLeft && fire <= 0;
    if (this.done) this.lights.flash.intensity = this.lights.fire.intensity = 0;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.ball.material.dispose();
    this.sparks.geometry.dispose();
    this.sparks.material.dispose();
    for (const p of this.puffs) p.sprite.material.dispose();
    for (const f of this.flames) f.sprite.material.dispose();
  }

  /** The debris stays on the floor after the smoke clears. */
  takeDebris(): THREE.InstancedMesh {
    this.debris.removeFromParent();
    return this.debris;
  }

  private updateSparks(dt: number): void {
    const position = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = this.sparks.geometry.getAttribute('color') as THREE.BufferAttribute;
    const p = position.array as Float32Array;
    const v = this.sparkVelocity;
    const c = color.array as Float32Array;
    for (let i = 0; i < this.sparkLife.length; i++) {
      const life = this.sparkLife[i] - dt;
      this.sparkLife[i] = life;
      const o = i * 3;
      if (life <= 0) {
        c[o] = c[o + 1] = c[o + 2] = 0;
        continue;
      }
      v[o + 1] -= GRAVITY * dt;
      const drag = Math.exp(-dt * 1.2);
      v[o] *= drag;
      v[o + 1] *= drag;
      v[o + 2] *= drag;
      p[o] += v[o] * dt;
      p[o + 1] += v[o + 1] * dt;
      p[o + 2] += v[o + 2] * dt;
      if (p[o + 1] < 0.01) {
        p[o + 1] = 0.01;
        v[o + 1] *= -0.3;
        v[o] *= 0.5;
        v[o + 2] *= 0.5;
      }
      if (p[o + 1] > CEILING + 0.1) v[o + 1] = -Math.abs(v[o + 1]) * 0.3;
      if (Math.abs(p[o]) > CABIN_HALF_WIDTH - 0.05) v[o] *= -0.4;
      const glow = Math.min(1, life * 1.5);
      c[o] = glow;
      c[o + 1] = glow * 0.7;
      c[o + 2] = glow * 0.35;
    }
    position.needsUpdate = true;
    color.needsUpdate = true;
  }

  private updateDebris(dt: number): void {
    this.debrisState.forEach((d, i) => {
      if (!d.resting) {
        d.v.y -= GRAVITY * dt;
        d.p.addScaledVector(d.v, dt);
        d.r.x += d.w.x * dt;
        d.r.y += d.w.y * dt;
        d.r.z += d.w.z * dt;
        if (Math.abs(d.p.x) > CABIN_HALF_WIDTH - 0.1) {
          d.p.x = Math.sign(d.p.x) * (CABIN_HALF_WIDTH - 0.1);
          d.v.x *= -0.3;
        }
        if (d.p.y < d.s / 2) {
          d.p.y = d.s / 2;
          if (Math.abs(d.v.y) < 0.6) {
            d.resting = true;
            d.r.x = 0;
            d.r.z = 0;
          } else {
            d.v.y *= -0.35;
            d.v.x *= 0.6;
            d.v.z *= 0.6;
            d.w.multiplyScalar(0.5);
          }
        }
      }
      this.tmp.position.copy(d.p);
      this.tmp.rotation.copy(d.r);
      this.tmp.scale.set(d.s, d.s * 0.35, d.s * 0.7);
      this.tmp.updateMatrix();
      this.debris.setMatrixAt(i, this.tmp.matrix);
    });
    this.debris.instanceMatrix.needsUpdate = true;
  }
}

/** The yellow masks that drop from the panel above every seat after a blast. */
class OxygenMasks {
  readonly group = new THREE.Group();
  private readonly cups: THREE.InstancedMesh;
  private readonly tubes: THREE.InstancedMesh;
  private readonly masks: { anchor: THREE.Vector3; length: number; drop: number; speed: number; swingX: number; swingZ: number; vx: number; vz: number; seed: number }[] = [];
  private state: 'stowed' | 'dropping' | 'down' = 'stowed';
  private readonly tmp = new THREE.Object3D();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(rows: number) {
    for (let row = 1; row <= rows; row++) {
      for (const col of [0, 1, 2, 4, 5, 6]) {
        const side = col < grid.AISLE_COL ? -1 : 1;
        const fromAisle = side < 0 ? 2 - col : col - 4;
        // Hang from the service panel above the row (where the reading lights are), in front of the face.
        this.masks.push({
          anchor: new THREE.Vector3(side * (0.97 + fromAisle * 0.22), PSU_Y, rowZ(row) - 0.2),
          length: rand(0.36, 0.46),
          drop: 0,
          speed: 0,
          swingX: 0,
          swingZ: 0,
          vx: 0,
          vz: 0,
          seed: Math.random() * 100,
        });
      }
    }
    const cup = new THREE.CylinderGeometry(0.034, 0.045, 0.05, 16);
    cup.rotateX(Math.PI / 2);
    this.cups = new THREE.InstancedMesh(cup, new THREE.MeshStandardMaterial({ color: '#f2c12e', roughness: 0.55 }), this.masks.length);
    const tube = new THREE.CylinderGeometry(0.005, 0.005, 1, 6);
    tube.translate(0, -0.5, 0);
    this.tubes = new THREE.InstancedMesh(tube, new THREE.MeshStandardMaterial({ color: '#dfe6ee', roughness: 0.3, transparent: true, opacity: 0.8 }), this.masks.length);
    for (let i = 0; i < this.masks.length; i++) {
      this.cups.setMatrixAt(i, this.zero);
      this.tubes.setMatrixAt(i, this.zero);
    }
    this.cups.castShadow = true;
    this.group.add(this.cups, this.tubes);
  }

  get down(): boolean {
    return this.state !== 'stowed';
  }

  /** Drop every mask with a bounce and a swing. */
  drop(): void {
    if (this.state !== 'stowed') return;
    this.state = 'dropping';
    for (const m of this.masks) {
      m.drop = 0;
      m.speed = 0;
      m.vx = rand(-1.5, 1.5);
      m.vz = rand(-1.5, 1.5);
    }
  }

  /** Already hanging (after a reload). */
  setDown(): void {
    if (this.state !== 'stowed') return;
    this.state = 'down';
    for (const m of this.masks) {
      m.drop = m.length;
      m.speed = m.swingX = m.swingZ = m.vx = m.vz = 0;
    }
  }

  /** Back in the panels for a new flight. */
  stow(): void {
    this.state = 'stowed';
    for (let i = 0; i < this.masks.length; i++) {
      this.cups.setMatrixAt(i, this.zero);
      this.tubes.setMatrixAt(i, this.zero);
    }
    this.cups.instanceMatrix.needsUpdate = true;
    this.tubes.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    if (this.state === 'stowed') return;
    this.masks.forEach((m, i) => {
      // A spring pulls the mask to the end of its tube; it bounces once or twice.
      const stretch = m.length - m.drop;
      m.speed += (stretch * 140 - m.speed * 7) * dt;
      m.drop = Math.max(0, m.drop + m.speed * dt);
      // A damped pendulum plus a gentle draught.
      const g = GRAVITY / Math.max(0.1, m.drop);
      m.vx += (-g * m.swingX - m.vx * 0.9) * dt;
      m.vz += (-g * m.swingZ - m.vz * 0.9) * dt;
      m.swingX += m.vx * dt;
      m.swingZ += m.vz * dt;
      const draughtX = Math.sin(time * 0.9 + m.seed) * 0.05;
      const draughtZ = Math.sin(time * 0.7 + m.seed * 2) * 0.04;
      this.tmp.position.copy(m.anchor);
      this.tmp.rotation.set(m.swingX + draughtX, 0, m.swingZ + draughtZ);
      this.tmp.scale.set(1, Math.max(0.001, m.drop), 1);
      this.tmp.updateMatrix();
      this.tubes.setMatrixAt(i, this.tmp.matrix);
      this.tmp.translateY(-m.drop);
      this.tmp.scale.set(1, 1, 1);
      this.tmp.updateMatrix();
      this.cups.setMatrixAt(i, this.tmp.matrix);
    });
    this.cups.instanceMatrix.needsUpdate = true;
    this.tubes.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.cups, this.tubes]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}

/** Where a device sits for each kind of bomb. */
export type DevicePlace = { kind: 'seat'; cell: Cell } | { kind: 'cart' } | { kind: 'lavatory' };

/** A home-made bomb: a box, two pipes, wires and a red light that blinks faster as it gets close. */
class Devices {
  readonly group = new THREE.Group();
  private readonly proto = new THREE.Group();
  private readonly led = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.35, 0.25) });
  private readonly shown = new Map<string, { node: THREE.Group; place: DevicePlace | null; urgent: boolean }>();

  constructor() {
    const dark = new THREE.MeshStandardMaterial({ color: '#23262c', roughness: 0.6 });
    const pipe = new THREE.MeshStandardMaterial({ color: '#6e5238', roughness: 0.5, metalness: 0.3 });
    const red = new THREE.MeshStandardMaterial({ color: '#b3261e', roughness: 0.5 });
    const blue = new THREE.MeshStandardMaterial({ color: '#2456b3', roughness: 0.5 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.09), dark);
    const pipes = [-0.03, 0.03].map((z) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.19, 10), pipe);
      m.rotation.z = Math.PI / 2;
      m.position.set(0, 0.045, z);
      return m;
    });
    const wires = [red, blue].map((material, i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.004, 6, 12, Math.PI), material);
      m.position.set(-0.02 + i * 0.03, 0.05, 0);
      m.rotation.y = Math.PI / 2;
      return m;
    });
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), this.led);
    light.name = 'led';
    light.position.set(0.05, 0.03, 0.035);
    this.proto.add(box, ...pipes, ...wires, light);
  }

  /** Show exactly these devices (the ones you know about). */
  set(list: { id: string; place: DevicePlace }[], point: (place: DevicePlace) => THREE.Vector3 | null): void {
    const keep = new Set(list.map((d) => d.id));
    for (const [id, d] of this.shown) {
      if (keep.has(id) || id === 'arming') continue;
      d.node.removeFromParent();
      this.shown.delete(id);
    }
    for (const d of list) {
      if (this.shown.has(d.id)) continue;
      const at = point(d.place);
      if (!at) continue;
      const node = this.proto.clone();
      node.position.copy(at);
      node.rotation.y = Math.random() * Math.PI;
      this.group.add(node);
      this.shown.set(d.id, { node, place: d.place, urgent: false });
    }
  }

  /** A device about to go off at `at`, blinking frantically. */
  arm(at: THREE.Vector3): void {
    this.disarm();
    const node = this.proto.clone();
    node.position.copy(at);
    this.group.add(node);
    this.shown.set('arming', { node, place: null, urgent: true });
  }

  disarm(): void {
    this.shown.get('arming')?.node.removeFromParent();
    this.shown.delete('arming');
  }

  update(time: number, cartZ: number): void {
    for (const d of this.shown.values()) {
      if (d.place?.kind === 'cart') d.node.position.set(0.17, 0.16, cartZ);
      const led = d.node.getObjectByName('led');
      if (led) led.visible = Math.sin(time * (d.urgent ? 44 : 5)) > (d.urgent ? -0.2 : 0.6);
    }
  }
}

/** Every blast, cinematic or not; plus what they leave behind. */
export class Effects {
  readonly group = new THREE.Group();
  readonly masks: OxygenMasks;
  readonly devices = new Devices();
  private readonly lights: BlastLights = { flash: new THREE.PointLight('#ffd49a', 0, 16, 1.6), fire: new THREE.PointLight('#ff8a3c', 0, 6, 1.8) };
  private readonly blasts = new Set<Blast>();
  /** A bomb in its last second: its light throbs red on everything around it. */
  private arming: THREE.Vector3 | null = null;
  private readonly textures = { smoke: smokeTexture(), flame: flameTexture(), glow: glowTexture() };
  private readonly scorch = scorchTexture();
  private readonly marks = new Map<string, THREE.Mesh>();
  private readonly debris: THREE.InstancedMesh[] = [];
  private tinted = new Map<string, number>();

  constructor(
    private readonly rows: number,
    private readonly seats: SeatParts,
    private readonly lavatory: THREE.Vector3,
  ) {
    this.group.name = 'effects';
    this.masks = new OxygenMasks(rows);
    this.group.add(this.masks.group, this.devices.group, this.lights.flash, this.lights.fire);
  }

  /** Where a known bomb's device sits (null: out of sight, e.g. inside the lavatory). */
  devicePoint(place: DevicePlace): THREE.Vector3 | null {
    if (place.kind === 'seat') return new THREE.Vector3(colX(place.cell.col), 0.12, rowZ(place.cell.row) + 0.02);
    if (place.kind === 'cart') return new THREE.Vector3(0.17, 0.16, 0);
    return null;
  }

  /** A new flight: clear smoke, debris and masks (scorch marks follow the game state). */
  reset(): void {
    for (const blast of this.blasts) blast.dispose();
    this.blasts.clear();
    this.lights.flash.intensity = this.lights.fire.intensity = 0;
    for (const d of this.debris) {
      d.removeFromParent();
      d.geometry.dispose();
      (d.material as THREE.Material).dispose();
      d.dispose();
    }
    this.debris.length = 0;
    this.masks.stow();
    this.disarm();
  }

  /** Where a blast happens: under a seat, on the cart in the aisle, or inside the lavatory. */
  blastPoint(center: Cell, where: 'seat' | 'cart' | 'lavatory'): THREE.Vector3 {
    if (where === 'lavatory') return this.lavatory.clone();
    return new THREE.Vector3(colX(center.col), where === 'cart' ? 0.8 : 0.32, rowZ(center.row));
  }

  /** Show a device about to go off at `at`, blinking and throbbing red. */
  arm(at: THREE.Vector3): void {
    this.devices.arm(at);
    this.arming = at.clone();
    this.lights.fire.color.set('#ff2a1c');
    this.lights.fire.position.copy(at).add(new THREE.Vector3(0, 0.1, 0));
  }

  disarm(): void {
    this.devices.disarm();
    if (this.arming) this.lights.fire.intensity = 0;
    this.arming = null;
    this.lights.fire.color.set('#ff8a3c');
  }

  explode(at: THREE.Vector3): void {
    this.disarm();
    const blast = new Blast(at, this.textures, this.lights);
    this.blasts.add(blast);
    this.group.add(blast.group);
  }

  /** Lasting damage: blackened seats within two cells of each blast and a mark on the floor. */
  setScorched(cells: Cell[], where: (cell: Cell) => THREE.Vector3): void {
    const shades = new Map<string, number>();
    for (const seat of grid.allSeats(this.rows)) {
      const cell = grid.parseSeat(seat)!;
      let shade = 1;
      for (const c of cells) {
        const d = Math.max(Math.abs(c.row - cell.row), Math.abs(c.col - cell.col));
        if (d <= 2) shade = Math.min(shade, [0.22, 0.45, 0.7][d]);
      }
      if (shade < 1 || this.tinted.has(seat)) shades.set(seat, shade);
    }
    for (const [seat, shade] of shades) {
      if (this.tinted.get(seat) === shade) continue;
      this.seats.tint(seat, shade);
    }
    this.tinted = new Map([...shades].filter(([, shade]) => shade < 1));

    const keep = new Set(cells.map((c) => `${c.row}:${c.col}`));
    for (const [key, mark] of this.marks) {
      if (keep.has(key)) continue;
      mark.removeFromParent();
      mark.geometry.dispose();
      (mark.material as THREE.Material).dispose();
      this.marks.delete(key);
    }
    for (const c of cells) {
      const key = `${c.row}:${c.col}`;
      if (this.marks.has(key)) continue;
      const mark = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 2.2),
        new THREE.MeshStandardMaterial({ map: this.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1 }),
      );
      const at = where(c);
      mark.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
      mark.position.set(at.x, 0.004, at.z);
      mark.receiveShadow = true;
      this.marks.set(key, mark);
      this.group.add(mark);
    }
  }

  update(dt: number, time: number, cartZ = 0): void {
    this.devices.update(time, cartZ);
    if (this.arming) this.lights.fire.intensity = Math.sin(time * 44) > -0.2 ? 2.6 : 0.15;
    for (const blast of this.blasts) {
      blast.update(dt, time);
      if (blast.done) {
        const debris = blast.takeDebris();
        this.debris.push(debris);
        this.group.add(debris);
        blast.dispose();
        this.blasts.delete(blast);
      }
    }
    this.masks.update(dt, time);
  }

  dispose(): void {
    for (const blast of this.blasts) blast.dispose();
    this.blasts.clear();
    this.masks.dispose();
    for (const mark of this.marks.values()) {
      mark.geometry.dispose();
      (mark.material as THREE.Material).dispose();
    }
    for (const d of this.debris) {
      d.geometry.dispose();
      (d.material as THREE.Material).dispose();
      d.dispose();
    }
    this.textures.smoke.dispose();
    this.textures.flame.dispose();
    this.textures.glow.dispose();
    this.scorch.dispose();
    this.group.removeFromParent();
  }
}
