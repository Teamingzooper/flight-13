import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Your own arms, first person: shoulders just below your eyes, an elbow that bends (two-bone IK), and a hand with
 * fingers that curl to grip or pinch. Each hand is driven by a spring towards a target, so every move eases in and
 * settles with a little weight. Anything a hand holds is moved by that hand and nothing else.
 *
 * The hand's own frame: the wrist at the origin, the fingers pointing along -z, the palm facing -y.
 */

export type Side = 'left' | 'right';

const UPPER = 0.3;
const FORE = 0.28;
/** Where a held thing sits in the hand: under the palm for a grab, between thumb and forefinger for a pinch. */
export const GRAB_POINT = new THREE.Vector3(0, -0.034, -0.06);
export const PINCH_POINT = new THREE.Vector3(-0.012, -0.018, -0.108);

/** The tip of the forefinger held out straight (pointing), in the hand's frame. */
export function indexTip(side: Side): THREE.Vector3 {
  return new THREE.Vector3(side === 'right' ? -0.028 : 0.028, -0.012, -0.142);
}

/** The rotation that points the fingers along `forward` with the palm facing `palm` (both world directions). */
export function handFacing(forward: THREE.Vector3, palm: THREE.Vector3): THREE.Quaternion {
  const z = forward.clone().normalize().negate();
  const y = palm.clone().normalize().negate();
  // Keep the palm direction exactly; make the fingers as close to `forward` as it allows.
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const zz = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, zz));
}

interface Finger {
  base: THREE.Group;
  mid: THREE.Group;
  /** How far this finger curls in a pinch (the forefinger most, the little finger tucks away). */
  pinch: number;
  /** The forefinger: it stays out straight to point. */
  fore: boolean;
}

function capsule(radius: number, length: number, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.CapsuleGeometry(radius, length, 4, 10);
  // Along -z, starting at the joint.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, -length / 2 - radius * 0.4);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

export class Arm {
  readonly group = new THREE.Group();
  readonly hand = new THREE.Group();
  /** Where the wrist is, and which way the hand faces. */
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  /** Targets the springs pull towards. */
  readonly target = new THREE.Vector3();
  readonly targetQuat = new THREE.Quaternion();
  grip = 0;
  pinch = 0;
  /** Pointing: the forefinger out straight, the others curled into the palm and the thumb over them. */
  pointing = 0;
  targetGrip = 0;
  targetPinch = 0;
  targetPointing = 0;
  /** Spring stiffness (higher: snappier) and how much the spring is damped (1: no overshoot). */
  stiffness = 110;
  damping = 0.9;
  private readonly vel = new THREE.Vector3();
  private readonly upper: THREE.Mesh;
  private readonly fore: THREE.Mesh;
  private readonly fingers: Finger[] = [];
  private readonly thumb: { base: THREE.Group; tip: THREE.Group };
  private readonly elbow = new THREE.Vector3();
  private readonly sign: number;

  constructor(
    readonly side: Side,
    private readonly skin: THREE.MeshStandardMaterial,
    private readonly sleeve: THREE.MeshStandardMaterial,
    private readonly foreSkin: { value: boolean },
  ) {
    this.sign = side === 'right' ? 1 : -1;
    // Bones of fixed length with rounded ends (the IK keeps each the same length). The upper arm is left out of
    // the picture, as in most first-person games: it would sit right in front of your eyes.
    const upperGeo = new THREE.CapsuleGeometry(0.045, UPPER - 0.09, 4, 14);
    upperGeo.translate(0, UPPER / 2, 0);
    this.upper = new THREE.Mesh(upperGeo, sleeve);
    this.upper.visible = false;
    const foreGeo = new THREE.CapsuleGeometry(0.036, FORE - 0.05, 4, 14);
    // Slimmer towards the wrist.
    const pos = foreGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const taper = 1 - 0.22 * ((y + FORE / 2) / FORE);
      pos.setX(i, pos.getX(i) * taper);
      pos.setZ(i, pos.getZ(i) * taper);
    }
    foreGeo.computeVertexNormals();
    foreGeo.translate(0, FORE / 2 - 0.012, 0);
    this.fore = new THREE.Mesh(foreGeo, sleeve);
    this.upper.castShadow = this.fore.castShadow = true;

    // The hand: a palm, four fingers of two joints each, and a thumb.
    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.078, 0.026, 0.09, 3, 0.012), skin);
    palm.position.set(0, -0.012, -0.05);
    palm.castShadow = true;
    this.hand.add(palm);
    const spread = [-0.028, -0.0095, 0.0095, 0.028];
    const lengths = [0.036, 0.042, 0.04, 0.032];
    spread.forEach((x, i) => {
      const base = new THREE.Group();
      base.position.set(x * this.sign, -0.012, -0.093 + Math.abs(i - 1.5) * 0.004);
      base.add(capsule(0.0085, lengths[i] * 0.55, skin));
      const mid = new THREE.Group();
      mid.position.set(0, 0, -lengths[i] * 0.55 - 0.008);
      mid.add(capsule(0.0078, lengths[i] * 0.45, skin));
      base.add(mid);
      this.hand.add(base);
      // (Counted from the thumb's side on either hand: the spread is mirrored, so the first is the forefinger.)
      this.fingers.push({ base, mid, pinch: [0.55, 1.05, 1.25, 1.35][i], fore: i === 0 });
    });
    const thumbBase = new THREE.Group();
    thumbBase.position.set(-0.036 * this.sign, -0.014, -0.028);
    thumbBase.rotation.set(0, 0.5 * this.sign, 0);
    thumbBase.add(capsule(0.0098, 0.026, skin));
    const thumbTip = new THREE.Group();
    thumbTip.position.set(0, 0, -0.036);
    thumbTip.add(capsule(0.0088, 0.02, skin));
    thumbBase.add(thumbTip);
    this.hand.add(thumbBase);
    this.thumb = { base: thumbBase, tip: thumbTip };

    this.group.add(this.upper, this.fore, this.hand);
  }

  /** Jump straight to a pose (no spring). */
  snap(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.pos.copy(pos);
    this.target.copy(pos);
    this.quat.copy(quat);
    this.targetQuat.copy(quat);
    this.vel.set(0, 0, 0);
  }

  /** Aim the hand so that its grab (or pinch) point lands on `point`, facing `quat`. */
  reach(point: THREE.Vector3, quat: THREE.Quaternion, at: THREE.Vector3 = GRAB_POINT): void {
    this.targetQuat.copy(quat);
    this.target.copy(point).sub(at.clone().applyQuaternion(quat));
  }

  /** The grab (or pinch) point where it is now, in the world. */
  point(at: THREE.Vector3 = GRAB_POINT): THREE.Vector3 {
    return at.clone().applyQuaternion(this.quat).add(this.pos);
  }

  /** Where the forefinger's tip is now, in the world (from the finger itself). */
  fingerTip(): THREE.Vector3 {
    const fore = this.fingers.find((f) => f.fore)!;
    this.hand.updateMatrixWorld(true);
    return fore.mid.localToWorld(new THREE.Vector3(0, 0, -0.0271));
  }

  /** The hand's frame now (for holding things rigidly). */
  matrix(): THREE.Matrix4 {
    return new THREE.Matrix4().compose(this.pos, this.quat, new THREE.Vector3(1, 1, 1));
  }

  /** The hand's speed right now (m/s). */
  get velocity(): THREE.Vector3 {
    return this.vel;
  }

  update(dt: number, shoulder: THREE.Vector3, pole: THREE.Vector3): void {
    // A damped spring, stepped finely so it stays smooth at any frame rate.
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    const c = 2 * Math.sqrt(this.stiffness) * this.damping;
    const acc = new THREE.Vector3();
    for (let i = 0; i < steps; i++) {
      acc.copy(this.target).sub(this.pos).multiplyScalar(this.stiffness).addScaledVector(this.vel, -c);
      this.vel.addScaledVector(acc, h);
      this.pos.addScaledVector(this.vel, h);
    }
    const turn = 1 - Math.exp(-dt * Math.sqrt(this.stiffness) * 1.6);
    this.quat.slerp(this.targetQuat, turn);
    const ease = 1 - Math.exp(-dt * 16);
    this.grip += (this.targetGrip - this.grip) * ease;
    this.pinch += (this.targetPinch - this.pinch) * ease;
    this.pointing += (this.targetPointing - this.pointing) * ease;

    // The elbow, from the shoulder and the wrist (leaning the shoulder in when the wrist is out of reach).
    const s = shoulder.clone();
    const reachMax = (UPPER + FORE) * 0.97;
    const toWrist = this.pos.clone().sub(s);
    const far = toWrist.length();
    if (far > reachMax) s.addScaledVector(toWrist.divideScalar(far), far - reachMax);
    const axis = this.pos.clone().sub(s);
    const d = Math.min(UPPER + FORE - 1e-4, Math.max(Math.abs(UPPER - FORE) + 1e-4, axis.length()));
    axis.normalize();
    const along = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d);
    const out = Math.sqrt(Math.max(0, UPPER * UPPER - along * along));
    const bend = pole.clone().sub(axis.clone().multiplyScalar(pole.dot(axis))).normalize();
    this.elbow.copy(s).addScaledVector(axis, along).addScaledVector(bend, out);
    const wrist = s.clone().addScaledVector(axis, d);
    this.bone(this.upper, s, this.elbow);
    this.bone(this.fore, this.elbow, wrist);
    this.fore.material = this.foreSkin.value ? this.skin : this.sleeve;

    this.hand.position.copy(this.pos);
    this.hand.quaternion.copy(this.quat);
    // (Fingers point along -z and the palm faces -y, so curling in towards the palm is a negative turn about x.)
    for (const f of this.fingers) {
      const held = Math.max(this.grip, this.pinch * f.pinch * 0.9);
      const curl = f.fore ? held * (1 - this.pointing) : Math.max(held, this.pointing * 1.3);
      f.base.rotation.x = -curl * 1.0;
      f.mid.rotation.x = -curl * 1.15;
    }
    const thumb = Math.max(this.grip * 0.8, this.pinch, this.pointing * 0.8);
    this.thumb.base.rotation.set(-thumb * 0.35, (0.5 - thumb * 0.25) * this.sign, thumb * 0.4 * this.sign);
    this.thumb.tip.rotation.x = -thumb * 0.6;
  }

  /** Lay a bone (built along +y from its base) from `a` towards `b`. */
  private bone(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    const dir = b.clone().sub(a).normalize();
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }
}

/** Both arms, with your skin and sleeves. */
export class Arms {
  readonly group = new THREE.Group();
  readonly right: Arm;
  readonly left: Arm;
  private readonly skin = new THREE.MeshStandardMaterial({ color: '#c68a5e', roughness: 0.62 });
  private readonly sleeve = new THREE.MeshStandardMaterial({ color: '#34495e', roughness: 0.88 });
  private readonly bareForearms = { value: false };

  constructor() {
    this.right = new Arm('right', this.skin, this.sleeve, this.bareForearms);
    this.left = new Arm('left', this.skin, this.sleeve, this.bareForearms);
    this.group.add(this.right.group, this.left.group);
  }

  /** Your skin, and your top's colour (a T-shirt or tank top leaves the forearms bare). */
  setLook(skin: string, sleeve: string, bareForearms: boolean): void {
    this.skin.color.set(skin);
    this.sleeve.color.set(sleeve);
    this.bareForearms.value = bareForearms;
  }

  /** Move both arms on, with shoulders placed from where your head is and which way you face (level, not tilted). */
  update(dt: number, head: THREE.Vector3, facing: THREE.Vector3): void {
    const forward = new THREE.Vector3(facing.x, 0, facing.z);
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    for (const arm of [this.right, this.left]) {
      const sign = arm.side === 'right' ? 1 : -1;
      const shoulder = head.clone().addScaledVector(right, 0.17 * sign).add(new THREE.Vector3(0, -0.23, 0)).addScaledVector(forward, -0.05);
      // Elbows out to the side and down, a little behind.
      const pole = right.clone().multiplyScalar(0.8 * sign).add(new THREE.Vector3(0, -1, 0)).addScaledVector(forward, -0.3);
      arm.update(dt, shoulder, pole);
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.skin.dispose();
    this.sleeve.dispose();
  }
}
