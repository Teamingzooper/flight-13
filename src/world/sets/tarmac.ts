import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { PlayerSummary, PlayerView } from '../../engine';
import { cabinAudio } from '../audio';
import { People } from '../scene/people';
import { flameTexture, glowTexture, smokeTexture } from '../textures';
import { buildAirliner, type Airliner } from './airliner';

/**
 * The saboteurs' getaway: out of the door, down the air stairs and across the apron at dusk, the camera
 * running with them. Then the plane goes up behind them and everything drops into slow motion, their
 * names hanging over them as they run. Drawn from a local time, like the other sets.
 */

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const span = (t: number, a: number, b: number) => smooth(clamp01((t - a) / (b - a)));

/** When the plane goes up, in seconds of the shot. */
export const TARMAC_BLAST_AT = 3.3;
/** How long the shot lasts (real seconds, slow motion included). */
export const TARMAC_LENGTH = 7.6;
/** Slow motion: scene seconds per real second, from the blast on. */
const SLOW = 0.22;
const RUN = 4.4;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
  }
  return texture;
}

/** Scene time for a real time into the shot: normal speed, then slow motion from the blast. */
function sceneTime(t: number): number {
  if (t <= TARMAC_BLAST_AT) return t;
  const after = t - TARMAC_BLAST_AT;
  // Ease back towards normal speed near the end of the shot.
  const easeBack = Math.max(0, after - 3.2);
  return TARMAC_BLAST_AT + after * SLOW + easeBack * easeBack * 0.35;
}

interface Chunk {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: THREE.Euler;
  w: THREE.Vector3;
  s: number;
  resting: boolean;
}

/** An airliner going up: flash, fireball, shockwave, flying wreckage, a column of smoke, fires. */
class BigBlast {
  readonly group = new THREE.Group();
  private readonly balls: { sprite: THREE.Sprite; delay: number; size: number; offset: THREE.Vector3 }[] = [];
  private readonly flash: THREE.Sprite;
  private readonly light = new THREE.PointLight('#ffae5a', 0, 220, 1.4);
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly smoke: { sprite: THREE.Sprite; v: THREE.Vector3; delay: number; grow: number }[] = [];
  private readonly fires: { sprite: THREE.Sprite; base: THREE.Vector3; seed: number }[] = [];
  private readonly chunks: Chunk[] = [];
  private readonly debris: THREE.InstancedMesh;
  private readonly tmp = new THREE.Object3D();

  constructor(private readonly at: THREE.Vector3) {
    const glow = glowTexture();
    const smoke = smokeTexture();
    const flame = flameTexture();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#fff8e6', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.position.copy(at);
    this.group.add(this.flash);
    for (let i = 0; i < 22; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glow, color: i % 3 === 0 ? '#ffd27a' : i % 3 === 1 ? '#ff8a2e' : '#ff5a1f', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      const offset = new THREE.Vector3(rand(-14, 14), rand(-1, 7), rand(-7, 7));
      this.balls.push({ sprite, delay: rand(0, 0.35), size: rand(16, 32), offset });
      this.group.add(sprite);
    }
    this.light.position.copy(at).add(new THREE.Vector3(0, 4, 0));
    this.group.add(this.light);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 64),
      new THREE.MeshBasicMaterial({ color: '#ffe0b0', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(at.x, 0.1, at.z);
    this.group.add(this.ring);
    for (let i = 0; i < 46; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smoke, color: i % 2 ? '#2b2724' : '#403a35', transparent: true, opacity: 0, depthWrite: false }));
      sprite.position.copy(at).add(new THREE.Vector3(rand(-10, 10), rand(0, 4), rand(-6, 6)));
      this.smoke.push({ sprite, v: new THREE.Vector3(rand(-1.5, 1.5), rand(2.5, 6), rand(-1.5, 1.5)), delay: rand(0.2, 1.4), grow: rand(8, 16) });
      this.group.add(sprite);
    }
    for (let i = 0; i < 14; i++) {
      const base = at.clone().add(new THREE.Vector3(rand(-14, 14), rand(-2.5, 1), rand(-3, 3)));
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flame, color: '#ffb066', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      sprite.position.copy(base);
      this.fires.push({ sprite, base, seed: rand(0, 100) });
      this.group.add(sprite);
    }
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#2a2a2c', roughness: 0.8, metalness: 0.3 }), 70);
    this.debris.castShadow = true;
    this.debris.frustumCulled = false;
    for (let i = 0; i < 70; i++) {
      this.chunks.push({
        p: at.clone().add(new THREE.Vector3(rand(-10, 10), rand(0, 3), rand(-3, 3))),
        v: new THREE.Vector3(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1)).multiplyScalar(rand(10, 34)),
        r: new THREE.Euler(rand(0, 3), rand(0, 3), rand(0, 3)),
        w: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)),
        s: rand(0.25, 1.4),
        resting: false,
      });
      this.tmp.scale.setScalar(0);
      this.tmp.updateMatrix();
      this.debris.setMatrixAt(i, this.tmp.matrix);
    }
    this.group.add(this.debris);
  }

  /** Scene seconds since the blast (negative before it). */
  update(age: number, dt: number): void {
    const on = age >= 0;
    this.group.visible = on;
    if (!on) return;
    // The flash, then the fireball rolling outwards and up, fading to smoke.
    this.flash.material.opacity = Math.max(0, 1 - age / 0.35);
    this.flash.scale.setScalar(20 + age * 120);
    this.light.intensity = 900 * Math.exp(-age * 1.2) + 90 * clamp01(1 - (age - 2) / 6);
    for (const b of this.balls) {
      const a = age - b.delay;
      const k = clamp01(a / 1.6);
      b.sprite.visible = a > 0;
      b.sprite.position.copy(this.at).addScaledVector(b.offset, 0.4 + k * 0.8).add(new THREE.Vector3(0, a * 2.2, 0));
      b.sprite.scale.setScalar(b.size * (0.2 + smooth(k) * 1.2));
      b.sprite.material.opacity = a < 0 ? 0 : Math.min(1, a * 6) * Math.max(0, 1 - Math.max(0, a - 0.8) / 1.8);
    }
    const r = 2 + age * 70;
    this.ring.scale.setScalar(r);
    this.ring.material.opacity = Math.max(0, 0.6 - age * 0.55);
    for (const s of this.smoke) {
      const a = age - s.delay;
      s.sprite.visible = a > 0;
      if (a <= 0) continue;
      s.sprite.position.addScaledVector(s.v, dt);
      s.sprite.scale.setScalar(4 + s.grow * Math.min(1, a / 5));
      s.sprite.material.opacity = Math.min(0.85, a * 0.5) * Math.max(0.35, 1 - a / 18);
    }
    for (const f of this.fires) {
      const flicker = 0.75 + Math.sin(age * 9 + f.seed) * 0.15 + Math.sin(age * 23 + f.seed * 2) * 0.1;
      f.sprite.visible = age > 0.4;
      f.sprite.position.set(f.base.x, f.base.y + 1.6 * flicker, f.base.z);
      f.sprite.scale.set(3 * flicker, 5 * flicker, 1);
      f.sprite.material.opacity = Math.min(1, (age - 0.4) * 1.5) * 0.9;
    }
    this.chunks.forEach((c, i) => {
      if (!c.resting) {
        c.v.y -= 9.8 * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt;
        c.r.y += c.w.y * dt;
        c.r.z += c.w.z * dt;
        if (c.p.y < c.s / 2) {
          c.p.y = c.s / 2;
          c.v.multiplyScalar(0.3);
          c.v.y = Math.abs(c.v.y) * 0.3;
          if (c.v.length() < 1) c.resting = true;
        }
      }
      this.tmp.position.copy(c.p);
      this.tmp.rotation.copy(c.r);
      this.tmp.scale.set(c.s, c.s * 0.4, c.s * 0.7);
      this.tmp.updateMatrix();
      this.debris.setMatrixAt(i, this.tmp.matrix);
    });
    this.debris.instanceMatrix.needsUpdate = true;
  }
}

export class TarmacSet {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.05, 900);
  private readonly people = new People();
  private readonly plane: Airliner;
  private readonly blast: BigBlast;
  private readonly runners: { id: string; start: THREE.Vector3; end: THREE.Vector3 }[] = [];
  private readonly youIndex: number;
  private readonly look = new THREE.Vector3();
  private lastScene = 0;
  private charred = false;
  private boomed = false;

  constructor(renderer: THREE.WebGLRenderer, game: PlayerView, runnerIds: string[], faces: ReadonlyMap<string, string> | null) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    pmrem.dispose();
    this.buildWorld();
    this.plane = buildAirliner();
    this.scene.add(this.plane.group);
    // Air stairs down from the front left door (part of the plane, so they burn with it).
    const door = this.plane.door;
    const metal = new THREE.MeshStandardMaterial({ color: '#b9bdc4', roughness: 0.5, metalness: 0.4 });
    const run = Math.hypot(4.4, door.y);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(run, 0.12, 1.4), metal);
    ramp.position.set(door.x - 2.2, door.y / 2, door.z);
    ramp.rotation.z = Math.atan2(door.y, 4.4);
    ramp.castShadow = ramp.receiveShadow = true;
    this.plane.group.add(ramp);
    for (const side of [-0.72, 0.72]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(run, 0.05, 0.05), metal);
      rail.position.set(door.x - 2.2, door.y / 2 + 0.9, door.z + side);
      rail.rotation.z = ramp.rotation.z;
      this.plane.group.add(rail);
    }
    this.blast = new BigBlast(this.plane.heart.clone());
    this.scene.add(this.blast.group);

    // You run out first; the others come down the stairs behind you.
    const you = game.you?.id ?? null;
    const order = [...runnerIds].sort((a, b) => (a === you ? -1 : b === you ? 1 : 0));
    this.youIndex = you ? order.indexOf(you) : -1;
    const foot = new THREE.Vector3(door.x - 4.8, 0, door.z);
    order.forEach((id, i) => {
      const start = foot.clone().add(new THREE.Vector3(-(order.length - i) * 2.4 + 2, 0, (i % 2 ? 1 : -1) * 0.9));
      const end = start.clone().add(new THREE.Vector3(-RUN * TARMAC_LENGTH * 1.1, 0, (i % 2 ? 1 : -1) * 2.5));
      this.runners.push({ id, start, end });
    });
    const everyone: PlayerSummary[] = game.players
      .filter((p) => order.includes(p.id))
      .map((p) => ({ ...p, seat: null, status: 'alive', cause: null }));
    this.people.sync(everyone, null, () => new THREE.Vector3(), faces);
    for (const r of this.runners) {
      const actor = this.people.actor(r.id);
      if (!actor) continue;
      actor.root.position.copy(r.start);
      actor.standing = true;
      actor.hidden = r.id === you;
    }
    this.scene.add(this.people.group, this.camera);
  }

  /** Where each runner's head is (for their name tags), you excepted. */
  heads(): { id: string; at: THREE.Vector3 }[] {
    const out: { id: string; at: THREE.Vector3 }[] = [];
    for (const r of this.runners) {
      const actor = this.people.actor(r.id);
      if (actor && !actor.hidden) out.push({ id: r.id, at: actor.eyes().add(new THREE.Vector3(0, 0.45, 0)) });
    }
    return out;
  }

  show(t: number, time: number): void {
    const now = sceneTime(t);
    const sdt = Math.max(0, now - this.lastScene);
    this.lastScene = now;
    const run = (r: { start: THREE.Vector3; end: THREE.Vector3 }, extra = 0) => {
      const k = clamp01((now + extra) / (TARMAC_LENGTH * 1.1));
      return r.start.clone().lerp(r.end, k);
    };
    for (const r of this.runners) {
      const actor = this.people.actor(r.id);
      if (!actor) continue;
      const at = run(r);
      const ahead = run(r, 0.1);
      actor.drive({ x: at.x, z: at.z, yaw: Math.atan2(-(ahead.x - at.x), -(ahead.z - at.z)), walk: 1.8, phase: now * 12 + r.start.z });
    }
    this.people.update(sdt, time);

    // Your eyes: running, then looking back over your shoulder as the plane goes up.
    const me = this.runners[Math.max(0, this.youIndex)];
    const eye = run(me).add(new THREE.Vector3(0, 1.62 + Math.abs(Math.sin(now * 11)) * 0.05, 0));
    this.camera.position.copy(eye);
    const back = span(t, 1.4, 2.3);
    const forward = eye.clone().add(new THREE.Vector3(-10, -0.4, 0));
    const toPlane = this.plane.heart.clone().add(new THREE.Vector3(0, 1.5, 0));
    this.look.lerpVectors(forward, toPlane, back);
    this.camera.lookAt(this.look);
    // The blast shakes the world.
    const age = now - TARMAC_BLAST_AT;
    if (age > 0) {
      const shake = 0.25 * Math.exp(-age * 2);
      this.camera.position.add(new THREE.Vector3(rand(-shake, shake), rand(-shake, shake), rand(-shake, shake)));
      if (!this.boomed) {
        this.boomed = true;
        cabinAudio.boom(2);
        setTimeout(() => cabinAudio.rumble(1.5), 300);
      }
      if (!this.charred && age > 0.25) this.char();
    }
    this.blast.update(age, sdt);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.fov = width < height ? 76 : 62;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.people.dispose();
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Sprite)) return;
      o.geometry?.dispose();
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of materials) {
        for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
        m.dispose();
      }
    });
    this.scene.environment?.dispose();
  }

  /** What is left of the plane: blackened, broken-backed, burning. */
  private char(): void {
    this.charred = true;
    this.plane.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshStandardMaterial;
      m.color.set('#1b1918');
      m.map = null;
      m.roughness = 1;
      m.needsUpdate = true;
    });
    this.plane.group.rotation.z = 0.05;
    this.plane.group.position.y = -0.8;
  }

  private buildWorld(): void {
    const scene = this.scene;
    const asphalt = new THREE.MeshStandardMaterial({
      roughness: 0.95,
      map: canvasTexture(
        512,
        512,
        (g) => {
          g.fillStyle = '#4c4f53';
          g.fillRect(0, 0, 512, 512);
          let r = 3;
          for (let i = 0; i < 12000; i++) {
            r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
            g.fillStyle = `rgba(${(r >> 8) % 2 ? 90 : 30},${(r >> 8) % 2 ? 92 : 32},${(r >> 8) % 2 ? 96 : 36},0.35)`;
            g.fillRect(r % 512, (r >> 9) % 512, 2, 2);
          }
          g.strokeStyle = 'rgba(40,40,40,0.4)';
          g.strokeRect(0, 0, 512, 512);
        },
        [60, 60],
      ),
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), asphalt);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    // Taxi-line markings and edge lights.
    const paint = new THREE.MeshBasicMaterial({ color: '#e8c24a' });
    for (let x = -200; x < 200; x += 8) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.3), paint);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.02, 14);
      scene.add(dash);
    }
    const blue = new THREE.MeshBasicMaterial({ color: '#4d7cff' });
    for (let x = -200; x < 200; x += 12) {
      for (const z of [-40, 40]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), blue);
        lamp.position.set(x, 0.3, z);
        scene.add(lamp);
      }
    }
    // The terminal far off, windows lit.
    const terminal = new THREE.Mesh(
      new THREE.BoxGeometry(260, 22, 30),
      new THREE.MeshStandardMaterial({
        roughness: 0.6,
        map: canvasTexture(1024, 128, (g) => {
          g.fillStyle = '#2d3440';
          g.fillRect(0, 0, 1024, 128);
          for (let x = 8; x < 1024; x += 14) {
            for (let y = 20; y < 110; y += 22) {
              g.fillStyle = Math.random() < 0.7 ? '#f6d9a0' : '#3a4250';
              g.fillRect(x, y, 9, 12);
            }
          }
        }),
        emissive: '#ffffff',
        emissiveIntensity: 0.25,
      }),
    );
    (terminal.material as THREE.MeshStandardMaterial).emissiveMap = (terminal.material as THREE.MeshStandardMaterial).map;
    terminal.position.set(-120, 11, -150);
    scene.add(terminal);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 45, 16), new THREE.MeshStandardMaterial({ color: '#39414e', roughness: 0.6 }));
    tower.position.set(40, 22.5, -170);
    scene.add(tower);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(7, 6, 6, 16), new THREE.MeshStandardMaterial({ color: '#8fb7d9', emissive: '#6d8fb0', emissiveIntensity: 0.4, roughness: 0.2 }));
    cab.position.set(40, 47, -170);
    scene.add(cab);
    // Dusk sky.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(700, 32, 16),
      new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        map: canvasTexture(512, 256, (g) => {
          const grad = g.createLinearGradient(0, 0, 0, 256);
          grad.addColorStop(0, '#1a1f3d');
          grad.addColorStop(0.4, '#4b3b6b');
          grad.addColorStop(0.6, '#e26d4a');
          grad.addColorStop(0.7, '#ffc27a');
          grad.addColorStop(1, '#3b3530');
          g.fillStyle = grad;
          g.fillRect(0, 0, 512, 256);
        }),
      }),
    );
    scene.add(sky);
    scene.add(new THREE.HemisphereLight('#b7c3e0', '#4a3f38', 0.9));
    const sun = new THREE.DirectionalLight('#ffb070', 2.4);
    sun.position.set(-80, 30, 60);
    sun.target.position.set(-10, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -40;
    cam.right = 40;
    cam.top = 40;
    cam.bottom = -40;
    cam.far = 250;
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
  }
}
