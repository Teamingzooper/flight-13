import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BOTTOM, HAIR_COLOR, SKIN, TOP } from '../../app/Avatar';
import type { DeathCause, Look, PlayerSummary, SeatId } from '../../engine';
import type { Pose } from '../../net/protocol';
import { seatPose } from '../layout';

const MAX_ACTORS = 17;
const SOOT = new THREE.Color('#120f0d');
const HALF_PI = Math.PI / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const approach = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));

type Side = 0 | 1;
type JointName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'shoulder0'
  | 'shoulder1'
  | 'elbow0'
  | 'elbow1'
  | 'wrist0'
  | 'wrist1'
  | 'hip0'
  | 'hip1'
  | 'knee0'
  | 'knee1'
  | 'ankle0'
  | 'ankle1';

type Paint = 'top' | 'sleeve' | 'bottom' | 'skin' | 'shoe' | 'eye' | 'hair';

interface PartSpec {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Joints carrying this part; two entries for left/right pairs. */
  joints: JointName[];
  local: THREE.Matrix4[];
  paint: Paint;
  /** Head and neck parts, hidden on your own first-person body so they never block the camera. */
  head?: boolean;
  /** Hair style index this part belongs to. */
  hair?: number;
}

const m = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** Eight hair shapes, built around a head of radius ~0.105 centred at y = 0.1 on the head joint. */
function hairGeometries(): THREE.BufferGeometry[] {
  const cap = (thetaLength: number, scale: [number, number, number], y = 0.112) => {
    const g = new THREE.SphereGeometry(0.112, 20, 12, 0, Math.PI * 2, 0, thetaLength);
    // Tilt back so the hairline sits above the eyes and the nape is covered.
    g.rotateX(0.32);
    g.scale(...scale);
    g.translate(0, y, 0.008);
    return g;
  };
  const merge = (...parts: THREE.BufferGeometry[]) => {
    const list = parts.map((p) => (p.index ? p.toNonIndexed() : p));
    const out = new THREE.BufferGeometry();
    const attrs = ['position', 'normal', 'uv'] as const;
    for (const name of attrs) {
      const arrays = list.map((p) => p.getAttribute(name).array as Float32Array);
      const total = arrays.reduce((n, a) => n + a.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const a of arrays) {
        merged.set(a, offset);
        offset += a.length;
      }
      out.setAttribute(name, new THREE.BufferAttribute(merged, name === 'uv' ? 2 : 3));
    }
    return out;
  };
  const bun = new THREE.SphereGeometry(0.045, 12, 10);
  bun.translate(0, 0.2, 0.07);
  const longBack = new RoundedBoxGeometry(0.2, 0.2, 0.06, 2, 0.03);
  longBack.translate(0, 0.02, 0.085);
  const spikes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const cone = new THREE.ConeGeometry(0.03, 0.07, 6);
    const a = (i / 7) * Math.PI * 2;
    cone.rotateX(-0.5 * Math.cos(a));
    cone.rotateZ(0.5 * Math.sin(a));
    cone.translate(Math.sin(a) * 0.05, 0.2, Math.cos(a) * 0.05);
    spikes.push(cone);
  }
  const curls: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const s = new THREE.SphereGeometry(0.045, 10, 8);
    const a = (i / 10) * Math.PI * 2;
    s.translate(Math.sin(a) * 0.085, 0.12 + Math.cos(a * 2) * 0.02, Math.cos(a) * 0.075 + 0.01);
    curls.push(s);
  }
  const brim = new THREE.CylinderGeometry(0.12, 0.12, 0.012, 20);
  brim.translate(0, 0.16, -0.05);
  return [
    cap(Math.PI * 0.42, [1, 1, 1.02]),
    merge(cap(Math.PI * 0.5, [1.04, 1.04, 1.06]), longBack),
    merge(cap(Math.PI * 0.4, [1, 1, 1]), bun),
    cap(Math.PI * 0.12, [0.9, 0.5, 0.9], 0.2),
    merge(cap(Math.PI * 0.36, [1, 0.95, 1]), ...spikes),
    cap(Math.PI * 0.48, [1.05, 1.08, 1.05]),
    merge(cap(Math.PI * 0.45, [1.06, 1.06, 1.06]), ...curls),
    merge(cap(Math.PI * 0.38, [1.05, 1, 1.05], 0.12), brim),
  ];
}

function buildParts(): PartSpec[] {
  const cloth = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35 });
  const hair = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 });
  const pair = (a: THREE.Matrix4, b: THREE.Matrix4) => [a, b];
  const parts: PartSpec[] = [
    { geometry: new RoundedBoxGeometry(0.32, 0.17, 0.22, 3, 0.06), material: cloth, joints: ['hips'], local: [m(0, 0.03, 0.01)], paint: 'bottom' },
    { geometry: new THREE.CapsuleGeometry(0.155, 0.2, 6, 14), material: cloth, joints: ['spine'], local: [m(0, 0.2, 0, 1, 1, 0.72)], paint: 'top' },
    { geometry: new THREE.CylinderGeometry(0.045, 0.052, 0.1, 12), material: skin, joints: ['neck'], local: [m(0, 0.02, 0)], paint: 'skin', head: true },
    { geometry: new THREE.SphereGeometry(0.105, 24, 18), material: skin, joints: ['head'], local: [m(0, 0.1, 0, 0.92, 1.08, 1)], paint: 'skin', head: true },
    {
      geometry: new THREE.SphereGeometry(0.014, 10, 8),
      material: dark,
      joints: ['head', 'head'],
      local: pair(m(-0.036, 0.115, -0.094, 1, 1.2, 0.6), m(0.036, 0.115, -0.094, 1, 1.2, 0.6)),
      paint: 'eye',
      head: true,
    },
    { geometry: new THREE.CapsuleGeometry(0.05, 0.19, 4, 10), material: cloth, joints: ['shoulder0', 'shoulder1'], local: pair(m(0, -0.13), m(0, -0.13)), paint: 'top' },
    { geometry: new THREE.CapsuleGeometry(0.043, 0.17, 4, 10), material: cloth, joints: ['elbow0', 'elbow1'], local: pair(m(0, -0.12), m(0, -0.12)), paint: 'sleeve' },
    { geometry: new THREE.SphereGeometry(0.045, 12, 10), material: skin, joints: ['wrist0', 'wrist1'], local: pair(m(0, -0.04, 0, 0.8, 1.15, 0.6), m(0, -0.04, 0, 0.8, 1.15, 0.6)), paint: 'skin' },
    { geometry: new THREE.CapsuleGeometry(0.075, 0.27, 4, 12), material: cloth, joints: ['hip0', 'hip1'], local: pair(m(0, -0.2), m(0, -0.2)), paint: 'bottom' },
    { geometry: new THREE.CapsuleGeometry(0.06, 0.3, 4, 10), material: cloth, joints: ['knee0', 'knee1'], local: pair(m(0, -0.2), m(0, -0.2)), paint: 'bottom' },
    {
      geometry: new RoundedBoxGeometry(0.1, 0.07, 0.25, 2, 0.03),
      material: dark,
      joints: ['ankle0', 'ankle1'],
      local: pair(m(0, -0.02, -0.06), m(0, -0.02, -0.06)),
      paint: 'shoe',
    },
  ];
  hairGeometries().forEach((geometry, index) => parts.push({ geometry, material: hair, joints: ['head'], local: [m()], paint: 'hair', head: true, hair: index }));
  return parts;
}

/** One passenger's skeleton plus the animation state that drives it. */
export class Actor {
  readonly joints = {} as Record<JointName, THREE.Object3D>;
  readonly root = new THREE.Object3D();
  look: Look;
  seat: SeatId | null = null;
  dead = false;
  cause: DeathCause | null = null;
  restrained = false;
  hideHead = false;
  /** Where a restrained passenger stands in the rear galley. */
  restSpot: THREE.Vector3 | null = null;
  /** Latest pose from the network (or your own camera). */
  pose: Pose | null = null;
  pointAt: THREE.Vector3 | null = null;
  private stand = 0;
  private walkAmount = 0;
  private walkPhase = 0;
  private reach = 0;
  private point = 0;
  private slump = 0;
  private bind = 0;
  private yaw = 0;
  private pitch = 0;
  private readonly slumpSide = Math.random() < 0.5 ? -1 : 1;
  private readonly idleSeed = Math.random() * 100;
  private path: { curve: THREE.CatmullRomCurve3; t: number; seconds: number } | null = null;
  private readonly aim = new THREE.Quaternion();

  constructor(look: Look) {
    this.look = look;
    const j = this.joints;
    const make = (name: JointName, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      j[name] = o;
      return o;
    };
    const w = 1 + (look.body - 1) * 0.1;
    const hips = make('hips', this.root, 0, 0.5, 0);
    const spine = make('spine', hips, 0, 0.06, 0);
    const chest = make('chest', spine, 0, 0.28, 0);
    const neck = make('neck', chest, 0, 0.14, 0);
    make('head', neck, 0, 0.05, 0);
    for (const side of [0, 1] as Side[]) {
      const sx = side === 0 ? -1 : 1;
      const shoulder = make(`shoulder${side}`, chest, sx * 0.19 * w, 0.07, 0);
      const elbow = make(`elbow${side}`, shoulder, 0, -0.27, 0);
      make(`wrist${side}`, elbow, 0, -0.24, 0);
      const hip = make(`hip${side}`, hips, sx * 0.09 * w, -0.02, 0);
      const knee = make(`knee${side}`, hip, 0, -0.42, 0);
      make(`ankle${side}`, knee, 0, -0.42, 0);
    }
    j.spine.scale.set(w, 1, w);
  }

  /** Sit in a seat, walking there if asked. */
  place(seat: SeatId, animate: boolean): void {
    const { x, z } = seatPose(seat);
    const walk = animate && this.seat !== null && !this.restrained;
    this.seat = seat;
    this.restrained = false;
    this.restSpot = null;
    this.moveTo(new THREE.Vector3(x, 0, z + 0.06), walk);
  }

  /** Stand in the rear galley, hands tied; walks there from the seat when asked. */
  restrainAt(spot: THREE.Vector3, animate: boolean): void {
    const walk = animate && this.seat !== null && !this.restrained;
    this.restrained = true;
    this.seat = null;
    this.restSpot = spot.clone();
    this.moveTo(spot, walk);
  }

  /** Teleport, or walk out to the aisle, along it, and in to the target. */
  private moveTo(target: THREE.Vector3, walk: boolean): void {
    if (!walk) {
      this.root.position.copy(target);
      this.root.rotation.y = 0;
      this.path = null;
      return;
    }
    const from = this.root.position.clone();
    const dir = Math.sign(target.z - from.z) || 1;
    const curve = new THREE.CatmullRomCurve3([
      from,
      new THREE.Vector3(from.x * 0.45, 0, from.z),
      new THREE.Vector3(0, 0, from.z + dir * 0.25),
      new THREE.Vector3(0, 0, target.z - dir * 0.25),
      new THREE.Vector3(target.x * 0.45, 0, target.z),
      target,
    ]);
    this.path = { curve, t: 0, seconds: 1.6 + curve.getLength() / 1.1 };
  }

  get walking(): boolean {
    return this.path !== null;
  }

  update(dt: number, time: number): void {
    // Where the body is: walking a path or sitting still.
    let moving = false;
    if (this.path) {
      const p = this.path;
      p.t = Math.min(1, p.t + dt / p.seconds);
      const u = p.t < 0.5 ? 2 * p.t * p.t : 1 - (-2 * p.t + 2) ** 2 / 2;
      const point = p.curve.getPointAt(u);
      const ahead = p.curve.getPointAt(Math.min(1, u + 0.02));
      this.root.position.copy(point);
      if (ahead.distanceToSquared(point) > 1e-6 && p.t < 0.9) {
        const facing = Math.atan2(-(ahead.x - point.x), -(ahead.z - point.z));
        let d = facing - this.root.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.root.rotation.y += d * Math.min(1, dt * 8);
      } else {
        this.root.rotation.y = approach(this.root.rotation.y, 0, 6, dt);
      }
      moving = p.t > 0.12 && p.t < 0.9;
      if (p.t >= 1) {
        this.path = null;
        this.root.rotation.y = 0;
      }
    }

    const wantsStand = this.restrained || (this.path !== null && this.path.t > 0.04 && this.path.t < 0.96) ? 1 : 0;
    this.stand = approach(this.stand, this.dead ? 0 : wantsStand, 5, dt);
    this.walkAmount = approach(this.walkAmount, moving ? 1 : 0, 6, dt);
    this.walkPhase += dt * 7 * this.walkAmount;
    const wantsReach = !this.dead && !this.restrained && this.stand < 0.2 && this.pose?.lean ? 1 : 0;
    this.reach = approach(this.reach, wantsReach, 5, dt);
    this.point = approach(this.point, this.pointAt && !this.dead && !this.restrained ? 1 : 0, 4, dt);
    this.slump = approach(this.slump, this.dead ? 1 : 0, 2.5, dt);
    this.bind = approach(this.bind, this.restrained ? 1 : 0, 4, dt);

    // Head: follow the network pose, or drift idly.
    const idleYaw = Math.sin(time * 0.21 + this.idleSeed) * 0.45 + Math.sin(time * 0.53 + this.idleSeed * 2) * 0.15;
    const idlePitch = -0.12 + Math.sin(time * 0.37 + this.idleSeed) * 0.08;
    const posed = this.pose && !this.path ? this.pose : null;
    const targetYaw = posed ? Math.max(-1.6, Math.min(1.6, posed.yaw)) : this.path ? 0 : idleYaw;
    const targetPitch = posed ? posed.pitch : this.path ? -0.08 : idlePitch;
    this.yaw = approach(this.yaw, targetYaw, 10, dt);
    this.pitch = approach(this.pitch, targetPitch, 10, dt);

    const j = this.joints;
    const s = this.stand;
    const alive = 1 - this.slump;
    const swing = Math.sin(this.walkPhase) * this.walkAmount;
    j.hips.position.y = lerp(0.5, 0.92, s) + Math.abs(Math.sin(this.walkPhase)) * 0.02 * this.walkAmount;
    j.spine.rotation.set(lerp(0.1, 0.03, s) - this.reach * 0.16 - this.slump * 0.75 - this.bind * 0.05, this.yaw * 0.3 * alive, this.slump * this.slumpSide * 0.25);
    j.chest.scale.y = 1 + Math.sin(time * 1.6 + this.idleSeed) * 0.012 * alive;
    j.head.rotation.set(this.pitch * 0.8 * alive - this.slump * 0.6 - this.bind * 0.25, this.yaw * 0.7 * alive, this.slump * this.slumpSide * 0.3, 'YXZ');

    for (const side of [0, 1] as Side[]) {
      const sign = side === 0 ? 1 : -1;
      j[`hip${side}`].rotation.x = lerp(HALF_PI, 0, s) + swing * 0.5 * sign;
      j[`knee${side}`].rotation.x = lerp(-HALF_PI, 0, s) - Math.max(0, Math.sin(this.walkPhase + (side === 0 ? 0 : Math.PI))) * 0.7 * this.walkAmount;
      j[`ankle${side}`].rotation.x = lerp(0, 0, s);

      const shoulder = j[`shoulder${side}`];
      const elbow = j[`elbow${side}`];
      // Seated: hands rest together on the lap. Standing: arms hang and swing.
      let shoulderX = lerp(0.22, 0.05 - swing * 0.45 * sign, s);
      let elbowX = lerp(1.2, 0.25, s);
      let shoulderZ = sign * 0.06;
      let elbowZ = sign * 0.55 * (1 - s);
      if (side === 1) elbowZ *= 1 - Math.max(this.reach, this.point);
      elbowZ *= 1 - this.slump;
      if (side === 1) {
        shoulderX = lerp(shoulderX, 1.12, this.reach);
        elbowX = lerp(elbowX, 0.6, this.reach);
      }
      // Wrists tied behind the back: upper arms back, forearms folded inward across the small of the back.
      shoulderX = lerp(shoulderX, -0.45, this.bind);
      shoulderZ = lerp(shoulderZ, sign * 0.03, this.bind);
      elbowX = lerp(elbowX, 0, this.bind);
      elbowZ = lerp(elbowZ, sign * 1.35, this.bind);
      shoulderX = lerp(shoulderX, 0.12, this.slump);
      elbowX = lerp(elbowX, 0.35, this.slump);
      shoulder.rotation.set(shoulderX, 0, shoulderZ);
      elbow.rotation.set(elbowX, 0, elbowZ);
    }

    // Point at a vote target with the right arm.
    if (this.point > 0.01 && this.pointAt) {
      this.root.updateMatrixWorld(true);
      const shoulder = j.shoulder1;
      const from = new THREE.Vector3().setFromMatrixPosition(shoulder.matrixWorld);
      const dir = this.pointAt.clone().sub(from).normalize();
      const parentInverse = new THREE.Quaternion().setFromRotationMatrix(shoulder.parent!.matrixWorld).invert();
      dir.applyQuaternion(parentInverse);
      this.aim.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      shoulder.quaternion.slerp(this.aim, this.point);
      j.elbow1.rotation.x = lerp(j.elbow1.rotation.x, 0.05, this.point);
    }
    this.root.updateMatrixWorld(true);
  }
}

/** Every passenger (including your own body), drawn with shared instanced meshes. */
export class People {
  readonly group = new THREE.Group();
  private readonly parts = buildParts();
  private readonly meshes: THREE.InstancedMesh[];
  private readonly actors = new Map<string, Actor>();
  private readonly slots = new Map<string, number>();
  private readonly free: number[] = [];
  /** Stable standing spot per restrained passenger. */
  private readonly rearSlots = new Map<string, number>();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly tmp = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly grey = new THREE.Color();

  constructor() {
    this.group.name = 'people';
    this.meshes = this.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, MAX_ACTORS * part.joints.length);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < mesh.count; i++) {
        mesh.setMatrixAt(i, this.zero);
        mesh.setColorAt(i, this.color.set('#ffffff'));
      }
      this.group.add(mesh);
      return mesh;
    });
    for (let i = MAX_ACTORS - 1; i >= 0; i--) this.free.push(i);
  }

  actor(id: string): Actor | undefined {
    return this.actors.get(id);
  }

  /**
   * Match the cabin to the game: create, seat, walk, kill or restrain passengers.
   * `rearSpot(i)` gives where the i-th restrained passenger stands.
   */
  sync(players: PlayerSummary[], youId: string | null, rearSpot: (index: number) => THREE.Vector3): void {
    const seen = new Set<string>();
    for (const id of [...this.rearSlots.keys()]) {
      if (players.find((p) => p.id === id)?.status !== 'restrained') this.rearSlots.delete(id);
    }
    for (const p of players) {
      seen.add(p.id);
      let actor = this.actors.get(p.id);
      if (!actor) {
        const slot = this.free.pop();
        if (slot === undefined) continue;
        actor = new Actor(p.look);
        this.actors.set(p.id, actor);
        this.slots.set(p.id, slot);
        this.paint(p.id);
      }
      actor.hideHead = p.id === youId;
      if (p.status === 'restrained') {
        let slot = this.rearSlots.get(p.id);
        if (slot === undefined) {
          const used = new Set(this.rearSlots.values());
          slot = 0;
          while (used.has(slot)) slot++;
          this.rearSlots.set(p.id, slot);
        }
        const spot = rearSpot(slot);
        if (!actor.restrained || !actor.restSpot?.equals(spot)) actor.restrainAt(spot, true);
      } else if (p.seat && (actor.seat !== p.seat || actor.restrained)) {
        actor.place(p.seat, true);
      }
      const dead = p.status === 'dead';
      if (dead !== actor.dead || p.cause !== actor.cause) {
        actor.dead = dead;
        actor.cause = p.cause;
        this.paint(p.id);
      }
    }
    for (const id of [...this.actors.keys()]) {
      if (seen.has(id)) continue;
      this.hide(id);
      this.free.push(this.slots.get(id)!);
      this.slots.delete(id);
      this.actors.delete(id);
    }
  }

  update(dt: number, time: number): void {
    for (const [id, actor] of this.actors) {
      actor.update(dt, time);
      this.write(id, actor);
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    const materials = new Set(this.parts.map((p) => p.material));
    for (const material of materials) material.dispose();
  }

  private write(id: string, actor: Actor): void {
    const slot = this.slots.get(id)!;
    // Your camera travels on its own path, so your body only shows once you have arrived.
    const hideBody = actor.hideHead && actor.walking;
    this.parts.forEach((part, index) => {
      const mesh = this.meshes[index];
      part.joints.forEach((joint, k) => {
        const i = slot * part.joints.length + k;
        const hidden = hideBody || (part.head && actor.hideHead) || (part.hair !== undefined && part.hair !== actor.look.hair % 8);
        if (hidden) {
          mesh.setMatrixAt(i, this.zero);
          return;
        }
        this.tmp.multiplyMatrices(actor.joints[joint].matrixWorld, part.local[k]);
        mesh.setMatrixAt(i, this.tmp);
      });
    });
  }

  private hide(id: string): void {
    const slot = this.slots.get(id);
    if (slot === undefined) return;
    this.parts.forEach((part, index) => {
      part.joints.forEach((_, k) => this.meshes[index].setMatrixAt(slot * part.joints.length + k, this.zero));
    });
  }

  private paint(id: string): void {
    const actor = this.actors.get(id)!;
    const slot = this.slots.get(id)!;
    const look = actor.look;
    const shortSleeves = look.top >= 4;
    const palette: Record<Paint, string> = {
      top: TOP[look.top] ?? TOP[0],
      sleeve: shortSleeves ? SKIN[look.skin] ?? SKIN[0] : TOP[look.top] ?? TOP[0],
      bottom: BOTTOM[look.bottom] ?? BOTTOM[0],
      skin: SKIN[look.skin] ?? SKIN[0],
      shoe: '#1c1d22',
      eye: '#141414',
      hair: HAIR_COLOR[look.hairColor] ?? HAIR_COLOR[0],
    };
    this.parts.forEach((part, index) => {
      const mesh = this.meshes[index];
      this.color.set(palette[part.paint]);
      // Blast victims are blackened with soot; other deaths just lose their colour.
      // (Colours are linear, so these factors read about twice as strong as they look.)
      if (actor.dead && actor.cause === 'explosion') this.color.lerp(SOOT, 0.9);
      else if (actor.dead) {
        const luminance = this.color.r * 0.3 + this.color.g * 0.59 + this.color.b * 0.11;
        this.color.lerp(this.grey.setScalar(luminance), 0.6).multiplyScalar(0.45);
      }
      part.joints.forEach((_, k) => mesh.setColorAt(slot * part.joints.length + k, this.color));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }
}
