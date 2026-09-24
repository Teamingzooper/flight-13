import * as THREE from 'three';

const YAW_LIMIT = 2.4;
const PITCH_MIN = -1.05;
const PITCH_MAX = 0.8;
const LEAN_SECONDS = 0.75;
/** How far in front of the screen the camera stops when leaning in. */
const LEAN_DISTANCE = 0.2;
const TAP_SLOP_PX = 7;
/** Resting gaze: slightly down, so your screen and the cabin ahead are both in view. */
const REST_PITCH = -0.26;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface ControlEvents {
  /** A click or tap that did not turn into a drag, in normalised device coordinates. */
  onTap(ndc: THREE.Vector2): void;
  onLockChange(locked: boolean): void;
}

interface Walk {
  curve: THREE.CatmullRomCurve3;
  t: number;
  seconds: number;
}

/** First-person camera for someone strapped into a seat. */
export class SeatControls {
  locked = false;
  private yaw = 0;
  private pitch = REST_PITCH;
  private targetYaw = 0;
  private targetPitch = REST_PITCH;
  private restYaw = 0;
  private lean = 0;
  private leanTarget = 0;
  private readonly eye = new THREE.Vector3(0, 1.12, 0);
  private readonly leanPosition = new THREE.Vector3();
  private readonly leanQuaternion = new THREE.Quaternion();
  private hasScreen = false;
  private walk: Walk | null = null;
  private shakeAmount = 0;
  private drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean; mouse: boolean } | null = null;
  private readonly offs: (() => void)[] = [];
  private readonly seated = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly position = new THREE.Vector3();

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
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, mouse: e.pointerType === 'mouse' };
    });
    listen<PointerEvent>(dom, 'pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId || this.locked) return;
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > TAP_SLOP_PX) d.moved = true;
      if (d.moved) this.turn(e.clientX - d.x, e.clientY - d.y, d.mouse ? 0.004 : 0.006);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    listen<PointerEvent>(dom, 'pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.id !== e.pointerId || d.moved) return;
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
      if (this.locked && this.lean === 0) this.turn(e.movementX, e.movementY, 0.0022);
    });
  }

  /** Lock the mouse for looking around (desktop only; needs a user gesture). */
  requestLock(): void {
    if (this.locked || !matchMedia('(pointer: fine)').matches) return;
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
   * When `animate` is set the camera stands up, walks the aisle and sits down again.
   */
  setSeat(eye: THREE.Vector3, screen: THREE.Matrix4 | null, animate: boolean, restYaw = 0): void {
    const leaning = this.lean > 0;
    const from = this.walk ? this.walk.curve.getPointAt(this.walk.t) : leaning ? this.camera.position.clone() : this.eye.clone();
    // Moving (or losing your screen) ends any lean at once; a walk sets off from wherever the camera is.
    if (animate || !screen) {
      if (leaning) {
        this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
        this.targetYaw = this.yaw = this.euler.y;
        this.targetPitch = this.pitch = this.euler.x;
      }
      this.lean = 0;
      this.leanTarget = 0;
    }
    if (animate) {
      const standFrom = new THREE.Vector3(from.x * 0.55, 1.55, from.z);
      const standTo = new THREE.Vector3(eye.x * 0.55, 1.55, eye.z);
      const curve = new THREE.CatmullRomCurve3([
        from,
        standFrom,
        new THREE.Vector3(0, 1.6, from.z + Math.sign(eye.z - from.z) * 0.2),
        new THREE.Vector3(0, 1.6, eye.z - Math.sign(eye.z - from.z) * 0.2),
        standTo,
        eye.clone(),
      ]);
      this.walk = { curve, t: 0, seconds: 1.4 + curve.getLength() / 1.1 };
    } else {
      this.walk = null;
    }
    this.eye.copy(eye);
    this.restYaw = restYaw;
    if (!animate) {
      this.targetYaw = this.yaw = restYaw;
    }
    this.hasScreen = screen !== null;
    if (screen) {
      const center = new THREE.Vector3().setFromMatrixPosition(screen);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(screen)).normalize();
      this.leanPosition.copy(center).addScaledVector(normal, LEAN_DISTANCE);
      const look = new THREE.Matrix4().lookAt(this.leanPosition, center, new THREE.Vector3(0, 1, 0));
      this.leanQuaternion.setFromRotationMatrix(look);
    }
  }

  setLeaning(on: boolean): void {
    // No using the screen halfway down the aisle.
    if (on && this.walk) return;
    this.leanTarget = on && this.hasScreen ? 1 : 0;
    if (on) this.releaseLock();
  }

  /** Where you are looking relative to your seat, and whether you are using your screen. */
  pose(): { yaw: number; pitch: number; lean: boolean } {
    // Using the screen reads as sitting at rest; the lean flag (dropped at night) shows the reach.
    if (this.leanTarget === 1) return { yaw: 0, pitch: REST_PITCH, lean: true };
    return { yaw: this.yaw - this.restYaw, pitch: this.pitch, lean: false };
  }

  /** Development helper: aim the camera directly. */
  debugLook(yaw: number, pitch: number): void {
    this.targetYaw = this.yaw = yaw;
    this.targetPitch = this.pitch = pitch;
  }

  /** Development helper: current look angles. */
  debugState(): { yaw: number; pitch: number; lean: number; walking: boolean; locked: boolean } {
    return { yaw: this.yaw, pitch: this.pitch, lean: this.lean, walking: this.walk !== null, locked: this.locked };
  }

  /** Jolt the camera (turbulence, explosions). */
  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  get walking(): boolean {
    return this.walk !== null;
  }

  update(dt: number, time: number): void {
    const k = 1 - Math.exp(-dt * 14);
    this.lean = clamp(this.lean + Math.sign(this.leanTarget - this.lean) * (dt / LEAN_SECONDS), 0, 1);
    const l = easeInOut(this.lean);

    if (this.walk) {
      const w = this.walk;
      w.t = Math.min(1, w.t + dt / w.seconds);
      const eased = easeInOut(w.t);
      this.position.copy(w.curve.getPointAt(eased));
      const tangent = w.curve.getTangentAt(Math.min(0.999, eased));
      if (Math.hypot(tangent.x, tangent.z) > 0.2 && w.t < 0.85) this.targetYaw = Math.atan2(-tangent.x, -tangent.z);
      else this.targetYaw = this.restYaw;
      this.targetPitch = -0.12;
      this.position.y += Math.sin(time * 9) * 0.018 * Math.sin(Math.PI * w.t);
      if (w.t >= 1) {
        this.walk = null;
        this.targetYaw = this.restYaw;
        this.targetPitch = REST_PITCH;
      }
    } else {
      this.position.copy(this.eye);
      this.position.y += Math.sin(time * 1.5) * 0.004;
      this.position.x += Math.sin(time * 0.6) * 0.0025;
      // Twisting to look behind you means leaning out toward the aisle and sitting up.
      const back = Math.min(1, Math.max(0, (Math.abs(this.yaw - this.restYaw) - 1.2) / 1.1));
      if (back > 0 && this.hasScreen) {
        const eased = back * back * (3 - 2 * back);
        this.position.x += -Math.sign(this.eye.x || 1) * 0.2 * eased;
        this.position.y += 0.1 * eased;
        this.position.z += 0.08 * eased;
      }
    }

    // Shortest way round when the walk flips direction.
    let dyaw = this.targetYaw - this.yaw;
    if (this.walk) dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.yaw += dyaw * k;
    this.pitch += (this.targetPitch - this.pitch) * k;

    if (this.shakeAmount > 0.0005) {
      this.position.x += (Math.random() - 0.5) * this.shakeAmount;
      this.position.y += (Math.random() - 0.5) * this.shakeAmount;
      this.shakeAmount *= Math.exp(-dt * 3);
    }

    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.seated.setFromEuler(this.euler);
    if (l > 0) {
      this.camera.position.lerpVectors(this.position, this.leanPosition, l);
      this.camera.quaternion.slerpQuaternions(this.seated, this.leanQuaternion, l);
    } else {
      this.camera.position.copy(this.position);
      this.camera.quaternion.copy(this.seated);
    }
  }

  dispose(): void {
    this.releaseLock();
    for (const off of this.offs) off();
  }

  private turn(dx: number, dy: number, speed: number): void {
    if (this.walk) return;
    this.targetYaw = clamp(this.targetYaw - dx * speed, this.restYaw - YAW_LIMIT, this.restYaw + YAW_LIMIT);
    this.targetPitch = clamp(this.targetPitch - dy * speed, PITCH_MIN, PITCH_MAX);
  }
}
