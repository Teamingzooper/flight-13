import * as THREE from 'three';

const YAW_LIMIT = 2.4;
const PITCH_MIN = -1.05;
const PITCH_MAX = 0.8;
/** How far in front of the screen the camera stops when leaning in. */
const LEAN_DISTANCE = 0.2;
const TAP_SLOP_PX = 7;
/** Resting gaze: slightly down, so your screen and the cabin ahead are both in view. */
const REST_PITCH = -0.26;
/** Eye height standing in the aisle. */
const STAND_EYE = 1.6;
/** Walking pace and stride in the aisle. */
const WALK_SPEED = 1.1;
const STRIDE = 0.64;
/** From the neck to the eyes: turning and nodding swing the eyes around the neck, as a real head does. */
const NECK = new THREE.Vector3(0, 0.09, -0.07);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Critically damped spring (a la SmoothDamp): moves `value` toward `target`, returns [value, velocity]. */
function damp(value: number, velocity: number, target: number, smoothTime: number, dt: number): [number, number] {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = value - target;
  const temp = (velocity + omega * change) * dt;
  return [target + (change + temp) * decay, (velocity - omega * temp) * decay];
}

export interface ControlEvents {
  /** A click or tap that did not turn into a drag, in normalised device coordinates. */
  onTap(ndc: THREE.Vector2): void;
  onLockChange(locked: boolean): void;
  /** A footfall while walking (for footstep sounds). */
  onStep?(): void;
  /** The phone flashlight used while searching. */
  onFlashlight?(on: boolean): void;
  /** Standing up or sitting down (cloth rustle). */
  onRustle?(): void;
  /** A scripted move (walking to a seat, searching) started or finished. */
  onScript?(kind: ScriptKind, active: boolean): void;
}

export type ScriptKind = 'walk' | 'search';

export interface Sample {
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  /** 0..1: how much the gait (bob, sway, footsteps) shows. */
  gait: number;
}

/** A scripted camera move, sampled by time. */
export interface Script {
  kind: ScriptKind;
  t: number;
  duration: number;
  /** How far the player may look around while it plays (left/right, up, down). */
  freeYaw: number;
  freeUp: number;
  freeDown: number;
  sample(t: number, out: Sample): void;
  /** Cues at given times (flashlight on/off, rustles). */
  marks: { t: number; fn: () => void; done?: boolean }[];
}

/**
 * A smooth curve through keyed values (monotone cubic: no overshoot, no pause at in-between keys,
 * at rest at the first and last key), held beyond the ends.
 */
export function smoothKeys(input: readonly (readonly [number, number])[]): (x: number) => number {
  const keys = input.filter((k, i) => i === 0 || k[0] > input[i - 1][0] + 1e-3);
  const n = keys.length;
  if (n === 1) return () => keys[0][1];
  const slope = keys.slice(1).map((k, i) => (k[1] - keys[i][1]) / (k[0] - keys[i][0]));
  const tan = keys.map((_, i) => (i === 0 || i === n - 1 ? 0 : slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tan[i] = tan[i + 1] = 0;
      continue;
    }
    const a = tan[i] / slope[i];
    const b = tan[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      tan[i] = k * a * slope[i];
      tan[i + 1] = k * b * slope[i];
    }
  }
  return (x) => {
    if (x <= keys[0][0]) return keys[0][1];
    if (x >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (x > keys[i + 1][0]) i++;
    const [x0, y0] = keys[i];
    const [x1, y1] = keys[i + 1];
    const w = x1 - x0;
    const t = (x - x0) / w;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * w * tan[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * w * tan[i + 1];
  };
}

/**
 * Stand up, walk the aisle and sit down again: one smooth path with a gentle start and finish.
 * You rise facing forward, turn toward the aisle and then down it, walk, turn into the new row, and
 * face forward again before you sit, the way people actually get in and out of airline seats.
 */
export function walkScript(from: THREE.Vector3, to: THREE.Vector3, fromYaw: number, fromPitch: number, restYaw: number): Script {
  const sameRow = Math.abs(to.z - from.z) < 0.3;
  const dir = Math.sign(to.z - from.z) || 1;
  const points = sameRow
    ? [
        from.clone(),
        new THREE.Vector3(from.x * 0.94, from.y - 0.06, from.z - 0.12),
        new THREE.Vector3(from.x * 0.7, STAND_EYE, from.z - 0.1),
        new THREE.Vector3(to.x * 0.7, STAND_EYE, to.z - 0.1),
        new THREE.Vector3(to.x * 0.94, to.y - 0.05, to.z - 0.1),
        to.clone(),
      ]
    : [
        from.clone(),
        new THREE.Vector3(from.x * 0.94, from.y - 0.06, from.z - 0.12),
        new THREE.Vector3(from.x * 0.55, STAND_EYE, from.z - 0.08),
        new THREE.Vector3(0, STAND_EYE, from.z + dir * 0.2),
        new THREE.Vector3(0, STAND_EYE, to.z - dir * 0.2),
        new THREE.Vector3(to.x * 0.55, STAND_EYE, to.z - 0.08),
        new THREE.Vector3(to.x * 0.94, to.y - 0.05, to.z - 0.1),
        to.clone(),
      ];
  return pathScript(
    points,
    (d, at, length, last) => {
      // Headings as unwrapped angles (each turn takes the short way from the one before).
      // Yaw 0 faces the front of the plane, +PI/2 faces left (-x), -PI/2 right (+x), PI the back.
      const near = (a: number, ref: number) => ref + wrap(a - ref);
      const facing = (towardPlusX: boolean) => (towardPlusX ? -Math.PI / 2 : Math.PI / 2);
      const toward = (fromAngle: number, target: number, share: number) => fromAngle + wrap(target - fromAngle) * share;
      let yawKeys: [number, number][];
      if (sameRow) {
        // Shuffle along the row half-turned the way you go, then face forward to sit.
        const side = toward(fromYaw, facing(to.x > from.x), 0.55);
        yawKeys = [
          [d(1.2), fromYaw],
          [d(2.3), side],
          [d(2.7), side],
          [d(3.6), near(restYaw, side)],
        ];
      } else if (at[4] - at[3] < 1.3) {
        // A row or two: mostly face forward, glancing toward the aisle and then the new row.
        const out = toward(fromYaw, facing(from.x < 0), 0.45);
        const end = near(restYaw, out);
        const into = toward(end, facing(to.x > 0), 0.45);
        yawKeys = [
          [d(1.2), fromYaw],
          [d(2.4), out],
          [d(4.4), into],
          [d(5.6), end],
        ];
      } else {
        // A real walk: face the aisle, turn down it, walk, turn to the row, face forward to sit.
        const aisle = near(facing(from.x < 0), fromYaw);
        const walk = near(dir > 0 ? Math.PI : 0, aisle);
        const row = near(facing(to.x > 0), walk);
        const end = near(restYaw, row);
        const mid = (at[3] + at[4]) / 2;
        yawKeys = [
          [d(1.2), fromYaw],
          [Math.min(at[2] + 0.25, mid - 0.1), aisle],
          [Math.min(at[3] + 0.7, mid), walk],
          [Math.max(at[4] - 0.7, mid), walk],
          [d(4.6), row],
          [d(5.6), end],
        ];
      }
      // Glance down while getting up, level while walking, down at the seat while sitting.
      const pitchKeys: [number, number][] = [
        [0, fromPitch],
        [d(1.1), -0.34],
        [d(2), -0.12],
        [d(last - 2), -0.12],
        [d(last - 1), -0.38],
        [length, REST_PITCH],
      ];
      return { yaw: yawKeys, pitch: pitchKeys };
    },
    { rampIn: 0.95, rampOut: 1.05 },
  );
}

/**
 * Crew walk the aisle: turn to face the way you go, walk straight along it, and turn back to face
 * forward over the cart.
 */
export function aisleScript(from: THREE.Vector3, to: THREE.Vector3, fromYaw: number, fromPitch: number, restYaw: number): Script {
  const dir = Math.sign(to.z - from.z) || 1;
  const points = [from.clone(), new THREE.Vector3(0, STAND_EYE, (from.z + to.z) / 2), to.clone()];
  return pathScript(
    points,
    (_d, _at, length) => {
      const heading = fromYaw + wrap((dir > 0 ? Math.PI : 0) - fromYaw);
      const end = heading + wrap(restYaw - heading);
      const turn = Math.min(0.5, length * 0.3);
      return {
        yaw: [
          [0, fromYaw],
          [turn, heading],
          [length - turn, heading],
          [length, end],
        ],
        pitch: [
          [0, fromPitch],
          [turn, -0.1],
          [length, REST_PITCH],
        ],
      };
    },
    { rampIn: 0.5, rampOut: 0.6 },
  );
}

/**
 * Boarding: in at the front of the cabin already walking, down the aisle past everyone already sitting
 * there, into your row, and down into your seat facing forward. Walks faster if it has to fit `seconds`.
 */
export function boardScript(from: THREE.Vector3, to: THREE.Vector3, restYaw: number, seconds: number): Script {
  const dir = Math.sign(to.z - from.z) || 1;
  if (Math.abs(to.x) < 0.05) {
    // Crew: straight down the aisle to the cart, then turn to face forward over it.
    const walk = dir > 0 ? Math.PI : 0;
    return pathScript(
      [from.clone(), new THREE.Vector3(0, STAND_EYE, (from.z + to.z) / 2), to.clone()],
      (_d, _at, length) => ({
        yaw: [
          [0, walk],
          [Math.max(0.1, length - 0.9), walk],
          [length, walk + wrap(restYaw - walk)],
        ],
        pitch: [
          [0, -0.08],
          [length, REST_PITCH],
        ],
      }),
      { rampIn: 0.35, rampOut: 0.8, seconds },
    );
  }
  // Straight in, then along the aisle to the row (a front row needs no stretch of aisle).
  const aisleEnd = to.z - dir * 0.2;
  const points = [
    from.clone(),
    ...((aisleEnd - from.z) * dir > 0.7 ? [new THREE.Vector3(0, STAND_EYE, from.z + dir * 0.4)] : []),
    new THREE.Vector3(0, STAND_EYE, aisleEnd),
    new THREE.Vector3(to.x * 0.55, STAND_EYE, to.z - 0.08),
    new THREE.Vector3(to.x * 0.94, to.y - 0.05, to.z - 0.1),
    to.clone(),
  ];
  const script = pathScript(
    points,
    (d, at, length, last) => {
      const walk = dir > 0 ? Math.PI : 0;
      const row = walk + wrap((to.x > 0 ? -Math.PI / 2 : Math.PI / 2) - walk);
      const end = row + wrap(restYaw - row);
      const n = points.length;
      return {
        yaw: [
          [0, walk],
          [Math.max(0.1, at[n - 4] - 0.6), walk],
          [d(n - 2.5), row],
          [d(n - 1.4), end],
        ],
        pitch: [
          [0, -0.08],
          [d(2), -0.1],
          [d(last - 1), -0.38],
          [length, REST_PITCH],
        ],
      };
    },
    { rampIn: 0.35, rampOut: 1.05, seconds },
  );
  return script;
}

/**
 * Walk a smooth path through `points` at a steady pace with a gentle start and finish, turning and
 * glancing as `keys` says (keys are by distance walked; `d(i)` is how far along control point i is).
 */
function pathScript(
  points: THREE.Vector3[],
  keys: (d: (index: number) => number, at: number[], length: number, last: number) => { yaw: [number, number][]; pitch: [number, number][] },
  pace: { rampIn: number; rampOut: number; seconds?: number },
): Script {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const length = curve.getLength();
  const last = points.length - 1;
  // Where each control point falls along the path, in metres, so turns are timed by distance walked.
  const at: number[] = points.map((_, i) => (i === 0 ? 0 : length));
  for (let i = 0, k = 1; i <= 400 && k < points.length; i++) {
    const p = curve.getUtoTmapping(i / 400, 0) * last; // (a distance of 0 means "use u")
    while (k < points.length && p >= k - 1e-6) at[k++] = (i / 400) * length;
  }
  const d = (index: number) => {
    const i = Math.min(last - 1, Math.floor(index));
    return at[i] + (at[i + 1] - at[i]) * clamp(index - i, 0, 1);
  };
  const { yaw, pitch } = keys(d, at, length, last);
  const yawAt = smoothKeys(yaw);
  const pitchAt = smoothKeys(pitch);

  // Trapezoid speed: ease off, walk at a steady pace, ease in to stop; faster when time is short.
  const { rampIn, rampOut } = pace;
  const ramps = (rampIn + rampOut) / 2;
  const natural = length / WALK_SPEED + ramps;
  const speed = pace.seconds && natural > pace.seconds ? length / Math.max(0.5, pace.seconds - ramps) : WALK_SPEED;
  const duration = length / speed + ramps;
  const distanceAt = (t: number) => {
    if (t <= rampIn) return (speed * t * t) / (2 * rampIn);
    if (t >= duration - rampOut) return length - (speed * (duration - t) ** 2) / (2 * rampOut);
    return speed * (rampIn / 2 + t - rampIn);
  };
  const tangent = new THREE.Vector3();
  return {
    kind: 'walk',
    t: 0,
    duration,
    // Look around as you go, down to your own feet.
    freeYaw: 0.9,
    freeUp: 0.45,
    freeDown: 1.1,
    marks: [],
    sample(t, out) {
      const u = clamp(distanceAt(clamp(t, 0, duration)) / length, 0, 1);
      curve.getPointAt(u, out.pos);
      curve.getTangentAt(Math.min(0.999, u), tangent);
      const walked = u * length;
      out.yaw = yawAt(walked);
      out.pitch = pitchAt(walked);
      const pace = t < rampIn ? t / rampIn : t > duration - rampOut ? (duration - t) / rampOut : 1;
      out.gait = clamp(pace, 0, 1) * clamp(1 - Math.abs(tangent.y) * 1.6, 0, 1);
    },
  };
}

interface Key {
  t: number;
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
}

/** Keyframed move with smooth easing between keys (used for searching under your seat). */
function keyScript(kind: ScriptKind, keys: Key[], free: [number, number]): Script {
  const duration = keys[keys.length - 1].t;
  return {
    kind,
    t: 0,
    duration,
    freeYaw: free[0],
    freeUp: free[1],
    freeDown: free[1],
    marks: [],
    sample(t, out) {
      let i = 0;
      while (i < keys.length - 2 && t > keys[i + 1].t) i++;
      const a = keys[i];
      const b = keys[i + 1];
      const k = smoother(clamp((t - a.t) / Math.max(1e-4, b.t - a.t), 0, 1));
      out.pos.lerpVectors(a.pos, b.pos, k);
      out.yaw = a.yaw + (b.yaw - a.yaw) * k;
      out.pitch = a.pitch + (b.pitch - a.pitch) * k;
      out.gait = 0;
    },
  };
}

/**
 * First-person camera for someone strapped into a seat: a head on a neck, moved by springs so every
 * transition eases in and out, with scripted moves (walking to a seat, looking under it), glances at
 * events, a slump when you die, and smooth camera shake.
 */
export class SeatControls {
  locked = false;
  // Look (world yaw/pitch) and its springs.
  private yaw = 0;
  private pitch = REST_PITCH;
  private yawVel = 0;
  private pitchVel = 0;
  private targetYaw = 0;
  private targetPitch = REST_PITCH;
  private restYaw = 0;
  private roll = 0;
  private rollVel = 0;
  // Leaning in to the screen.
  private lean = 0;
  private leanVel = 0;
  private leanTarget = 0;
  private readonly leanPosition = new THREE.Vector3();
  private readonly leanQuaternion = new THREE.Quaternion();
  private hasScreen = false;
  // Where you sit, and the smoothed base position.
  private readonly eye = new THREE.Vector3(0, 1.2, 0);
  private readonly base = new THREE.Vector3(0, 1.2, 0);
  private readonly baseVel = new THREE.Vector3();
  // Scripts, glances and the rest.
  private script: Script | null = null;
  private readonly sample: Sample = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, gait: 0 };
  private freeYaw = 0;
  private freePitch = 0;
  private glanceUntil = -1;
  private gaitPhase = 0;
  private gaitAmount = 0;
  private lastFootfall = 0;
  private slumpAmount = 0;
  private slumpVel = 0;
  private slumpTarget = 0;
  private shakeAmount = 0;
  private time = 0;
  private drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean; mouse: boolean } | null = null;
  /** Ignore the pointer entirely (another set, like the hotel room, is using it). */
  suspended = false;
  private readonly offs: (() => void)[] = [];
  private readonly seated = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly neck = new THREE.Vector3();
  private readonly restNeck = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly restEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly events: ControlEvents,
  ) {
    const listen = <T extends Event>(target: EventTarget, type: string, fn: (e: T) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.offs.push(() => target.removeEventListener(type, fn as EventListener));
    };
    listen<PointerEvent>(dom, 'pointerdown', (e) => {
      if (this.suspended) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, mouse: e.pointerType === 'mouse' };
    });
    listen<PointerEvent>(dom, 'pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId || this.locked || this.suspended) return;
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > TAP_SLOP_PX) d.moved = true;
      if (d.moved) this.turn(e.clientX - d.x, e.clientY - d.y, d.mouse ? 0.004 : 0.006);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    listen<PointerEvent>(dom, 'pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.id !== e.pointerId || d.moved || this.suspended) return;
      const rect = dom.getBoundingClientRect();
      const ndc = this.locked
        ? new THREE.Vector2(0, 0)
        : new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.events.onTap(ndc);
    });
    listen(dom, 'pointercancel', () => (this.drag = null));
    listen(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      this.events.onLockChange(this.locked);
    });
    listen<MouseEvent>(document, 'mousemove', (e) => {
      if (this.locked && this.leanTarget === 0) this.turn(e.movementX, e.movementY, 0.0022);
    });
  }

  /** Lock the mouse for looking around (desktop only; needs a user gesture). */
  requestLock(): void {
    if (this.locked || this.suspended || !matchMedia('(pointer: fine)').matches) return;
    const request = this.dom.requestPointerLock?.bind(this.dom) as undefined | (() => Promise<void> | void);
    try {
      const result = request?.();
      if (result && typeof (result as Promise<void>).catch === 'function') (result as Promise<void>).catch(() => {});
    } catch {
      // Some browsers refuse pointer lock (iframes, settings); dragging still works.
    }
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /**
   * Sit in a new place. `screen` is the world matrix of the screen you use (null when standing aside).
   * When `animate` is set you stand up, walk the aisle and sit down again (or, for crew in the `aisle`,
   * just walk along it).
   */
  setSeat(eye: THREE.Vector3, screen: THREE.Matrix4 | null, animate: boolean, restYaw = 0, aisle = false): void {
    const leaning = this.lean > 0.01;
    // Set off from exactly where the head is (leaning in to the screen, or sitting back).
    const from = leaning ? this.camera.position.clone() : this.base.clone();
    if (animate || !screen) {
      // Moving (or losing your screen) ends any lean; the head carries on from where it looked.
      if (leaning) {
        this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
        this.yaw = this.targetYaw = this.euler.y;
        this.pitch = this.targetPitch = this.euler.x;
      }
      this.lean = this.leanTarget = this.leanVel = 0;
    }
    this.eye.copy(eye);
    this.restYaw = restYaw;
    this.hasScreen = screen !== null;
    if (screen) {
      const center = new THREE.Vector3().setFromMatrixPosition(screen);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(screen)).normalize();
      this.leanPosition.copy(center).addScaledVector(normal, LEAN_DISTANCE);
      const look = new THREE.Matrix4().lookAt(this.leanPosition, center, new THREE.Vector3(0, 1, 0));
      this.leanQuaternion.setFromRotationMatrix(look);
    }
    if (animate) {
      this.startScript(aisle ? aisleScript(from, eye, this.yaw, this.pitch, restYaw) : walkScript(from, eye, this.yaw, this.pitch, restYaw));
      this.events.onRustle?.();
    } else {
      this.endScript();
      this.targetYaw = this.yaw = restYaw;
      this.targetPitch = this.pitch = REST_PITCH;
      this.base.copy(eye);
      this.baseVel.set(0, 0, 0);
    }
  }

  setLeaning(on: boolean): void {
    // No using the screen halfway down the aisle or under the seat.
    if (on && this.script) return;
    this.leanTarget = on && this.hasScreen ? 1 : 0;
    if (on) this.releaseLock();
  }

  /** Crouch into the legroom, turn and look under your own seat with a flashlight. Returns its length. */
  search(): number {
    const e = this.eye;
    const side = e.x < 0 ? -1 : 1;
    // Turn toward the aisle, the way you would in a cramped row.
    const turn = this.restYaw + (side < 0 ? -Math.PI : Math.PI);
    const bend = new THREE.Vector3(e.x, 0.88, e.z - 0.26);
    const low = new THREE.Vector3(e.x - side * 0.04, 0.37, e.z - 0.47);
    const script = keyScript(
      'search',
      [
        { t: 0, pos: e.clone(), yaw: this.restYaw, pitch: REST_PITCH },
        { t: 0.75, pos: bend, yaw: this.restYaw + (turn - this.restYaw) * 0.12, pitch: -1.15 },
        { t: 1.75, pos: low, yaw: turn, pitch: -0.52 },
        { t: 3.55, pos: low.clone().add(new THREE.Vector3(0, 0.01, 0.02)), yaw: turn, pitch: -0.58 },
        { t: 4.45, pos: bend.clone(), yaw: this.restYaw + (turn - this.restYaw) * 0.12, pitch: -1.0 },
        { t: 5.3, pos: e.clone(), yaw: this.restYaw, pitch: REST_PITCH },
      ],
      [0.35, 0.25],
    );
    script.marks.push(
      { t: 0.05, fn: () => this.events.onRustle?.() },
      { t: 0.8, fn: () => this.events.onFlashlight?.(true) },
      { t: 4.2, fn: () => this.events.onFlashlight?.(false) },
      { t: 4.5, fn: () => this.events.onRustle?.() },
    );
    this.lean = this.leanTarget = this.leanVel = 0;
    this.startScript(script);
    return script.duration;
  }

  /**
   * Search a small room you are standing in (the lavatory): crouch where you stand, check under the sink
   * ahead with the flashlight, look round behind the toilet on your right, and stand up again.
   */
  searchRoom(): number {
    const e = this.eye;
    const yaw = this.restYaw;
    // Straight ahead, and to the right, of the way you face (yaw 0 faces -z; -PI/2 faces +x).
    const ahead = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const low = e.clone().setY(0.62).addScaledVector(ahead, 0.18);
    const under = e.clone().setY(0.42).addScaledVector(ahead, 0.3);
    const script = keyScript(
      'search',
      [
        { t: 0, pos: e.clone(), yaw, pitch: REST_PITCH },
        { t: 0.8, pos: low, yaw, pitch: -0.95 },
        { t: 1.7, pos: under, yaw, pitch: -0.35 },
        { t: 2.9, pos: under.clone().addScaledVector(right, 0.08), yaw: yaw - 0.95, pitch: -0.45 },
        { t: 3.8, pos: low.clone().addScaledVector(right, 0.05), yaw: yaw - 0.6, pitch: -0.8 },
        { t: 4.7, pos: e.clone(), yaw, pitch: REST_PITCH },
      ],
      [0.35, 0.25],
    );
    script.marks.push(
      { t: 0.05, fn: () => this.events.onRustle?.() },
      { t: 0.7, fn: () => this.events.onFlashlight?.(true) },
      { t: 3.9, fn: () => this.events.onFlashlight?.(false) },
    );
    this.lean = this.leanTarget = this.leanVel = 0;
    this.startScript(script);
    return script.duration;
  }

  /** Snap your eyes to something for a moment (a bomb about to go off). The mouse waits meanwhile. */
  glance(target: THREE.Vector3, seconds: number): void {
    const from = this.camera.position;
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const dz = target.z - from.z;
    const yaw = this.restYaw + clamp(wrap(Math.atan2(-dx, -dz) - this.restYaw), -YAW_LIMIT, YAW_LIMIT);
    this.targetYaw = this.yaw + wrap(yaw - this.yaw);
    this.targetPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), PITCH_MIN, PITCH_MAX);
    this.leanTarget = 0;
    this.glanceUntil = this.time + seconds;
  }

  /** Slump when you die (and straighten up again as a ghost). */
  slump(on: boolean): void {
    this.slumpTarget = on ? 1 : 0;
  }

  /** Where you are looking relative to your seat, and whether you are using your screen. */
  pose(): { yaw: number; pitch: number; lean: boolean } {
    // Using the screen reads as sitting at rest; the lean flag (dropped at night) shows the reach.
    if (this.leanTarget === 1) return { yaw: 0, pitch: REST_PITCH, lean: true };
    if (this.script?.kind === 'search') return { yaw: 0, pitch: -1.2, lean: false };
    return { yaw: this.yaw - this.restYaw, pitch: this.pitch, lean: false };
  }

  /** Your body while a walk plays, so your own legs can walk with you. */
  body(): { x: number; z: number; yaw: number; walk: number; phase: number } | null {
    if (this.script?.kind !== 'walk') return null;
    // Eyes sit in front of the spine: keep the body a little behind them, so looking down shows your legs.
    const yaw = this.sample.yaw;
    return { x: this.base.x + Math.sin(yaw) * 0.15, z: this.base.z + Math.cos(yaw) * 0.15, yaw, walk: this.gaitAmount, phase: this.gaitPhase };
  }

  /** Development helper: aim the camera directly. */
  debugLook(yaw: number, pitch: number): void {
    this.targetYaw = this.yaw = yaw;
    this.targetPitch = this.pitch = pitch;
    this.yawVel = this.pitchVel = 0;
  }

  /** Development helper: current look angles. */
  debugState(): { yaw: number; pitch: number; lean: number; walking: boolean; locked: boolean } {
    return { yaw: this.yaw, pitch: this.pitch, lean: this.lean, walking: this.walking, locked: this.locked };
  }

  /** Jolt the camera (turbulence, explosions). */
  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  get walking(): boolean {
    return this.script?.kind === 'walk';
  }

  /**
   * Board the plane: walk in from `from` (standing at the front of the aisle) to your seat in about
   * `seconds`, starting `startAt` seconds in (so a late join picks up mid-walk).
   */
  board(from: THREE.Vector3, seconds: number, startAt = 0): void {
    const script = boardScript(from, this.eye, this.restYaw, seconds);
    script.t = Math.min(startAt, script.duration);
    script.sample(script.t, this.sample);
    // Start exactly there, already walking: no spring from wherever the camera was.
    this.base.copy(this.sample.pos);
    this.baseVel.set(0, 0, 0);
    this.yaw = this.targetYaw = this.sample.yaw;
    this.pitch = this.targetPitch = this.sample.pitch;
    this.yawVel = this.pitchVel = 0;
    this.lean = this.leanTarget = this.leanVel = 0;
    this.startScript(script);
  }

  /** Any scripted move is playing (walking or searching). */
  get busy(): boolean {
    return this.script !== null;
  }

  update(dt: number, time: number): void {
    this.time = time;
    const script = this.script;
    const glancing = time < this.glanceUntil;

    // 1. Where the body wants the head: a script, or your seat.
    let gaitTarget = 0;
    if (script) {
      script.t = Math.min(script.duration, script.t + dt);
      script.sample(script.t, this.sample);
      for (const m of script.marks) {
        if (!m.done && script.t >= m.t) {
          m.done = true;
          m.fn();
        }
      }
      this.target.copy(this.sample.pos);
      gaitTarget = this.sample.gait;
      // Free look is an offset around where the script points you, drifting back when left alone.
      this.freeYaw *= Math.exp(-dt * 0.8);
      this.freePitch *= Math.exp(-dt * 0.8);
      if (!glancing) {
        this.targetYaw = this.yaw + wrap(this.sample.yaw + this.freeYaw - this.yaw);
        this.targetPitch = clamp(this.sample.pitch + this.freePitch, -1.4, PITCH_MAX);
      }
      if (script.t >= script.duration) {
        const kind = script.kind;
        this.script = null;
        this.freeYaw = this.freePitch = 0;
        // Turns along the way may have wound the yaw a full circle round: unwind it (same direction).
        const turns = Math.round((this.yaw - this.restYaw) / (Math.PI * 2)) * Math.PI * 2;
        this.yaw -= turns;
        this.targetYaw -= turns;
        if (kind === 'walk') this.events.onRustle?.();
        // Settle back to facing forward.
        if (!glancing) {
          this.targetYaw = this.yaw + wrap(this.restYaw - this.yaw);
          this.targetPitch = REST_PITCH;
        }
        this.events.onScript?.(kind, false);
      }
    } else {
      this.target.copy(this.eye);
      // Twisting to look behind you means leaning out toward the aisle and sitting up.
      const back = clamp((Math.abs(this.yaw - this.restYaw) - 1.2) / 1.1, 0, 1);
      if (back > 0 && this.hasScreen) {
        const k = back * back * (3 - 2 * back);
        this.target.x += -Math.sign(this.eye.x || 1) * 0.2 * k;
        this.target.y += 0.1 * k;
        this.target.z += 0.08 * k;
      }
    }

    // 2. Springs: position, look, lean, slump.
    const posTime = script ? 0.05 : 0.14;
    [this.base.x, this.baseVel.x] = damp(this.base.x, this.baseVel.x, this.target.x, posTime, dt);
    [this.base.y, this.baseVel.y] = damp(this.base.y, this.baseVel.y, this.target.y, posTime, dt);
    [this.base.z, this.baseVel.z] = damp(this.base.z, this.baseVel.z, this.target.z, posTime, dt);
    const lookTime = glancing ? 0.16 : script ? 0.12 : 0.055;
    const prevYaw = this.yaw;
    [this.yaw, this.yawVel] = damp(this.yaw, this.yawVel, this.targetYaw, lookTime, dt);
    [this.pitch, this.pitchVel] = damp(this.pitch, this.pitchVel, this.targetPitch, lookTime, dt);
    [this.lean, this.leanVel] = damp(this.lean, this.leanVel, this.leanTarget, 0.2, dt);
    this.lean = clamp(this.lean, 0, 1);
    [this.slumpAmount, this.slumpVel] = damp(this.slumpAmount, this.slumpVel, this.slumpTarget, 0.45, dt);

    // 3. Gait: bob, sway and footfalls, driven by distance walked.
    this.gaitAmount += (gaitTarget - this.gaitAmount) * (1 - Math.exp(-dt * 8));
    const speed = Math.hypot(this.baseVel.x, this.baseVel.z);
    this.gaitPhase += (speed / STRIDE) * Math.PI * dt * (this.gaitAmount > 0.05 ? 1 : 0);
    const footfall = Math.floor(this.gaitPhase / Math.PI);
    if (footfall !== this.lastFootfall) {
      this.lastFootfall = footfall;
      if (this.gaitAmount > 0.3) this.events.onStep?.();
    }
    const g = this.gaitAmount;
    const bob = -Math.abs(Math.sin(this.gaitPhase)) * 0.034 * g + 0.017 * g;
    const sway = Math.sin(this.gaitPhase * 0.5 + 0.3) * 0.022 * g;
    const swayRoll = Math.sin(this.gaitPhase * 0.5) * 0.014 * g;

    // 4. The head: neck pivot, breathing, a lean into fast turns, slumping, shake.
    const yawSpeed = dt > 0 ? wrap(this.yaw - prevYaw) / dt : 0;
    const rollTarget = clamp(-yawSpeed * 0.018, -0.06, 0.06) + swayRoll + this.slumpAmount * 0.38 * (this.eye.x < 0 ? -1 : 1);
    [this.roll, this.rollVel] = damp(this.roll, this.rollVel, rollTarget, 0.12, dt);

    this.euler.set(this.pitch - this.slumpAmount * 0.75, this.yaw, this.roll, 'YXZ');
    this.seated.setFromEuler(this.euler);
    this.neck.copy(NECK).applyQuaternion(this.seated);
    // The neck swings relative to where the body faces: the seat, or the way a script turns you.
    const bodyYaw = this.script ? this.sample.yaw : this.restYaw;
    this.restNeck.copy(NECK).applyEuler(this.restEuler.set(REST_PITCH, bodyYaw, 0, 'YXZ'));

    const pos = this.target.copy(this.base).add(this.neck).sub(this.restNeck);
    const breathe = Math.sin(time * 1.5) * 0.004 * (1 - g);
    pos.y += breathe + bob - this.slumpAmount * 0.2;
    // Sway sideways relative to where the body faces.
    pos.x += Math.cos(this.yaw) * sway;
    pos.z += -Math.sin(this.yaw) * sway;
    pos.x -= Math.sin(this.yaw) * this.slumpAmount * 0.08;
    pos.z -= Math.cos(this.yaw) * this.slumpAmount * 0.08;

    // Smooth shake (layered sines rather than per-frame jitter).
    const s = this.shakeAmount;
    let shakeRoll = 0;
    if (s > 0.0005) {
      pos.x += s * (Math.sin(time * 31.7 + 1.3) * 0.6 + Math.sin(time * 57.1) * 0.4);
      pos.y += s * (Math.sin(time * 27.3 + 0.7) * 0.6 + Math.sin(time * 49.9 + 2.1) * 0.4);
      shakeRoll = s * 0.9 * Math.sin(time * 23.1 + 0.4);
      this.shakeAmount *= Math.exp(-dt * 3);
    }

    // 5. Lean in to the screen along a slight arc, the eyes arriving a moment before the head.
    const l = this.lean;
    if (l > 0.001) {
      const k = smoother(clamp(l, 0, 1));
      const lookK = smoother(clamp(l * 1.25, 0, 1));
      this.camera.position.lerpVectors(pos, this.leanPosition, k);
      this.camera.position.y -= Math.sin(Math.PI * k) * 0.035;
      this.camera.quaternion.slerpQuaternions(this.seated, this.leanQuaternion, lookK);
    } else {
      this.camera.position.copy(pos);
      this.camera.quaternion.copy(this.seated);
    }
    if (shakeRoll !== 0) this.camera.quaternion.multiply(this.tmpQ.setFromAxisAngle(Z_AXIS, shakeRoll));
  }

  dispose(): void {
    this.releaseLock();
    for (const off of this.offs) off();
  }

  private startScript(script: Script): void {
    const previous = this.script;
    this.script = script;
    this.freeYaw = this.freePitch = 0;
    if (previous) this.events.onScript?.(previous.kind, false);
    this.events.onScript?.(script.kind, true);
  }

  private endScript(): void {
    const previous = this.script;
    this.script = null;
    if (previous) {
      this.events.onFlashlight?.(false);
      this.events.onScript?.(previous.kind, false);
    }
  }

  private turn(dx: number, dy: number, speed: number): void {
    if (this.time < this.glanceUntil) return;
    const script = this.script;
    if (script) {
      this.freeYaw = clamp(this.freeYaw - dx * speed, -script.freeYaw, script.freeYaw);
      this.freePitch = clamp(this.freePitch - dy * speed, -script.freeDown, script.freeUp);
      return;
    }
    this.targetYaw = clamp(this.targetYaw - dx * speed, this.restYaw - YAW_LIMIT, this.restYaw + YAW_LIMIT);
    this.targetPitch = clamp(this.targetPitch - dy * speed, PITCH_MIN, PITCH_MAX);
  }
}
