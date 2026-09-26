import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { cabinAudio } from './audio';
import { REST_PITCH } from './controls';
import { CREW_BEHIND, colX, rowZ } from './layout';
import type { Actor } from './scene/people';
import type { Cart } from './scene/cart';
import { SCREEN_H, SCREEN_W } from './scene/seats';
import { Arms, GRAB_POINT, handFacing, type Arm } from './sets/arms';

/**
 * Your own hands when you work the aisle as crew: on the drink cart's handle, pushing or pulling it along the aisle;
 * holding the crew tablet when the cart is not with you; and acting out the night's work in the dark. A loyal
 * Stewardess takes a torch from her apron, crouches by the row and sweeps it under the three seats; a rogue one
 * pours a drink and hands it over, and the passenger takes it.
 *
 * Nothing moves unless a hand moves it: the cart rolls when you push it, the torch, cup and carton are wherever
 * the hand holding them is, and the cup is the passenger's once their hand has it.
 */

type Key = { t: number; pos: THREE.Vector3; yaw: number; pitch: number };

/** What the head does during a cutscene (Cabin3D gives these to the camera), and the cues along the way. */
export interface CrewScript {
  keys: Key[];
  marks: { t: number; fn: () => void }[];
}

type Scene =
  | { kind: 'check'; side: -1 | 1; row: number; t: number; looks: THREE.Vector3[] }
  | { kind: 'serve'; row: number; t: number; target: Actor | null; seat: THREE.Vector3; handover: THREE.Vector3 | null };

const UP = new THREE.Vector3(0, 1, 0);
/** How far the eyes stand behind the cart's middle. */
const EYE_BEHIND = CREW_BEHIND - 0.05;
const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};
const span = (t: number, a: number, b: number) => smooth((t - a) / (b - a));

/** Yaw and pitch to look from `from` at `to` (yaw 0 faces -z; positive turns left). */
function lookAngles(from: THREE.Vector3, to: THREE.Vector3): { yaw: number; pitch: number } {
  const d = to.clone().sub(from);
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}

/** The hand's rotation for holding a torch whose beam goes along `beam` (out of the thumb side of the fist). */
function torchGrip(side: 'left' | 'right', beam: THREE.Vector3): THREE.Quaternion {
  // The thumb is +x on the left hand and -x on the right.
  const x = beam.clone().normalize().multiplyScalar(side === 'left' ? 1 : -1);
  const y = UP.clone().addScaledVector(x, -UP.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export class CrewRig {
  readonly group = new THREE.Group();
  readonly arms = new Arms();
  /** Showing: you are crew, in the cabin. */
  active = false;
  private scene: Scene | null = null;
  private readonly torch = new THREE.Group();
  private readonly beam = new THREE.SpotLight('#fff3dc', 0, 4, 0.42, 0.5, 1.2);
  private readonly cup = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly carton = new THREE.Group();
  private readonly stream: THREE.Mesh;
  private readonly tablet = new THREE.Group();
  /** Where the handheld tablet's screen is (for the live screen), when there is no cart with you. */
  readonly screenMatrix = new THREE.Matrix4();
  /** Who holds each prop: a hand, the cart, a passenger, or nobody (put away). */
  private cupHolder: 'right' | 'cart' | 'passenger' | null = 'cart';
  private cartonHolder: 'left' | 'cart' = 'cart';
  private torchShown = false;
  private readonly cupOffset = new THREE.Matrix4();
  private readonly cartonOffset = new THREE.Matrix4();
  private passengerHand: (() => THREE.Vector3 | null) | null = null;
  private time = 0;
  private cart: Cart | null = null;
  private lastTorch = false;

  constructor() {
    this.group.name = 'crew-rig';
    const black = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.45, metalness: 0.4 });
    const lens = new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#fff1c9', emissiveIntensity: 0 });
    // The torch, along its own +x (the beam's way).
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.13, 14), black);
    body.rotation.z = Math.PI / 2;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.016, 0.035, 16), black);
    head.rotation.z = Math.PI / 2;
    head.position.x = 0.075;
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.019, 16), lens);
    glass.rotation.y = Math.PI / 2;
    glass.position.x = 0.0935;
    this.torch.add(body, head, glass);
    this.beam.position.set(0.09, 0, 0);
    this.beam.target.position.set(1, 0, 0);
    this.torch.add(this.beam, this.beam.target);
    this.torch.visible = false;
    this.torch.userData.lens = lens;

    // A paper cup, and the juice in it as it fills.
    const paper = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.7 });
    const cupMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.026, 0.09, 18, 1, true), paper);
    cupMesh.material.side = THREE.DoubleSide;
    cupMesh.position.y = 0.045;
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.026, 16), paper);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 0.002;
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(0.031, 18), new THREE.MeshStandardMaterial({ color: '#f29a2e', roughness: 0.2 }));
    this.fill.rotation.x = -Math.PI / 2;
    this.fill.visible = false;
    this.cup.add(cupMesh, bottom, this.fill);

    // A juice carton, its spout at the top.
    const carton = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.19, 0.07, 2, 0.006), new THREE.MeshStandardMaterial({ color: '#f5a524', roughness: 0.6 }));
    carton.position.y = 0.095;
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.07, 0.072), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }));
    label.position.y = 0.1;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.014, 12), new THREE.MeshStandardMaterial({ color: '#2f7d4f', roughness: 0.4 }));
    cap.position.set(0.018, 0.197, 0);
    this.carton.add(carton, label, cap);
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 1, 8), new THREE.MeshStandardMaterial({ color: '#f29a2e', roughness: 0.15, transparent: true, opacity: 0.9 }));
    this.stream.visible = false;

    // The crew tablet, held in both hands when the cart is not with you. Its screen is the live screen.
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(SCREEN_W + 0.03, SCREEN_H + 0.03, 0.012, 2, 0.006), black);
    bezel.position.z = -0.007;
    this.tablet.add(bezel);
    this.tablet.visible = false;

    this.group.add(this.arms.group, this.torch, this.cup, this.carton, this.stream, this.tablet);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.group.visible = false;
  }

  /** Where the handheld tablet's screen rests for eyes at `head` (low in front, tipped up to them). */
  static handheldAt(head: THREE.Vector3, breath = 0): THREE.Matrix4 {
    const center = head.clone().add(new THREE.Vector3(0, -0.4 + breath, -0.3));
    const toEye = head.clone().sub(center).normalize();
    const x = new THREE.Vector3().crossVectors(UP, toEye).normalize();
    const y = new THREE.Vector3().crossVectors(toEye, x).normalize();
    return new THREE.Matrix4().makeBasis(x, y, toEye).setPosition(center);
  }

  setLook(skin: string, sleeve: string, bareForearms: boolean): void {
    this.arms.setLook(skin, sleeve, bareForearms);
  }

  /** Playing a cutscene now. */
  get busy(): boolean {
    return this.scene !== null;
  }

  /**
   * The loyal Stewardess checks under the three seats on one side of her row. Returns the head's part (for the
   * camera); the hands follow the same clock.
   */
  check(row: number, side: -1 | 1, eye: THREE.Vector3): CrewScript {
    const cols = side < 0 ? [2, 1, 0] : [4, 5, 6];
    // Under each seat of the row, from behind it (where the next row's feet go), aisle seat first.
    const looks = cols.map((c) => new THREE.Vector3(colX(c), 0.08, rowZ(row) - 0.02));
    this.scene = { kind: 'check', side, row, t: 0, looks };
    // Down on one knee in the aisle, low enough to see under the seat backs.
    const crouch = new THREE.Vector3(side * 0.2, 0.5, rowZ(row) + 0.48);
    const step = new THREE.Vector3(side * 0.12, 1.15, eye.z - 0.03);
    const at = (p: THREE.Vector3, to: THREE.Vector3) => lookAngles(p, to);
    const first = at(crouch, looks[0]);
    const keys: Key[] = [
      { t: 0, pos: eye.clone(), yaw: 0, pitch: REST_PITCH },
      { t: 0.8, pos: step, yaw: first.yaw * 0.6, pitch: -0.55 },
      { t: 1.9, pos: crouch, ...first },
      { t: 3.1, pos: crouch.clone().add(new THREE.Vector3(side * 0.02, 0, 0)), ...at(crouch, looks[1]) },
      { t: 4.3, pos: crouch.clone().add(new THREE.Vector3(side * 0.03, -0.02, 0)), ...at(crouch, looks[2]) },
      { t: 5.0, pos: crouch.clone(), ...at(crouch, looks[1]) },
      { t: 6.1, pos: step.clone().setY(1.5), yaw: first.yaw * 0.3, pitch: -0.4 },
      { t: 6.9, pos: eye.clone(), yaw: 0, pitch: REST_PITCH },
    ];
    const marks = [
      { t: 0.25, fn: () => cabinAudio.rustle() },
      { t: 1.55, fn: () => cabinAudio.click() },
      { t: 5.05, fn: () => cabinAudio.click() },
      { t: 5.7, fn: () => cabinAudio.rustle() },
    ];
    return { keys, marks };
  }

  /**
   * The rogue Stewardess pours a drink and hands it to someone in her row (who reaches out and takes it). `target`
   * is their body (null if nobody is drawn there); `seat` where they sit.
   */
  serve(row: number, eye: THREE.Vector3, seat: THREE.Vector3, target: Actor | null): CrewScript {
    this.scene = { kind: 'serve', row, t: 0, target, seat, handover: null };
    this.cupHolder = 'cart';
    this.cartonHolder = 'cart';
    this.fill.visible = false;
    const face = seat.clone().setY(1.15);
    const toward = lookAngles(eye, face);
    const top = new THREE.Vector3(0, 1.05, rowZ(row) + 0.22);
    const down = lookAngles(eye, top);
    const keys: Key[] = [
      { t: 0, pos: eye.clone(), yaw: 0, pitch: REST_PITCH },
      { t: 0.7, pos: eye.clone().add(new THREE.Vector3(0, -0.06, -0.03)), ...down },
      { t: 3.4, pos: eye.clone().add(new THREE.Vector3(0, -0.07, -0.03)), yaw: down.yaw, pitch: down.pitch + 0.08 },
      { t: 4.3, pos: eye.clone().add(new THREE.Vector3(Math.sign(seat.x) * 0.05, -0.03, -0.02)), yaw: toward.yaw * 0.85, pitch: toward.pitch - 0.05 },
      { t: 6.0, pos: eye.clone().add(new THREE.Vector3(Math.sign(seat.x) * 0.06, -0.03, -0.02)), yaw: toward.yaw * 0.9, pitch: toward.pitch - 0.1 },
      { t: 7.0, pos: eye.clone(), yaw: 0, pitch: REST_PITCH },
    ];
    const marks = [
      { t: 1.35, fn: () => cabinAudio.pop() },
      { t: 1.9, fn: () => cabinAudio.rustle() },
      { t: 5.1, fn: () => cabinAudio.rustle() },
    ];
    return { keys, marks };
  }

  /** Stop any cutscene (a new phase, a new seat); props go back where they belong. */
  cancel(): void {
    const scene = this.scene;
    this.scene = null;
    this.torchShown = false;
    this.beam.intensity = 0;
    this.stream.visible = false;
    if (scene?.kind === 'serve' && scene.target) {
      scene.target.pointAt = null;
      scene.target.reachTo = null;
    }
    if (this.cupHolder === 'right') this.cupHolder = 'cart';
    this.cartonHolder = 'cart';
  }

  /** The drink handed over last night is finished with (a new day). */
  clearCup(): void {
    if (this.cupHolder === 'passenger') {
      this.cupHolder = 'cart';
      this.passengerHand = null;
      this.fill.visible = false;
    }
  }

  /**
   * One frame. `head` is where the eyes are (before shake), `cart` the cart when it is with you (null: you hold the
   * tablet), `walking` while you push or pull it along the aisle.
   */
  update(dt: number, head: THREE.Vector3, cart: Cart | null, walking: boolean): void {
    this.time += dt;
    this.cart = cart;
    this.group.visible = this.active;
    if (!this.active) return;
    const right = this.arms.right;
    const left = this.arms.left;
    // Your body faces forward (the head turns on its own).
    const facing = new THREE.Vector3(0, 0, -1);
    if (cart && walking) cart.hold(0, head.z - EYE_BEHIND, 0);

    const scene = this.scene;
    if (scene) {
      scene.t += dt;
      if (scene.kind === 'check') this.runCheck(scene, head);
      else this.runServe(scene, head);
    } else if (cart) {
      this.onHandle(right, 'right', 90);
      this.onHandle(left, 'left', 90);
    } else {
      this.holdTablet(head);
    }
    this.tablet.visible = !cart && !scene;
    this.arms.update(dt, head, facing);
    this.applyProps(dt);
  }

  dispose(): void {
    this.arms.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }

  // ---------- Hands ----------

  /** A hand on its side of the cart's handle, gripping it. */
  private onHandle(arm: Arm, side: 'left' | 'right', stiffness: number): void {
    const grip = this.cart!.grips()[side === 'left' ? 0 : 1];
    arm.stiffness = stiffness;
    arm.targetGrip = 1;
    arm.targetPinch = 0;
    arm.targetPointing = 0;
    arm.reach(grip, handFacing(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0.1)), GRAB_POINT);
  }

  /** Down at your side (a pocket of the apron): out of sight. */
  private pocket(head: THREE.Vector3, side: 'left' | 'right'): THREE.Vector3 {
    return head.clone().add(new THREE.Vector3((side === 'left' ? -1 : 1) * 0.24, -0.72, 0.08));
  }

  /** The tablet held low in front of you in both hands, its screen tipped up to your eyes. */
  private holdTablet(head: THREE.Vector3): void {
    const pose = CrewRig.handheldAt(head, Math.sin(this.time * 1.4) * 0.004);
    const toEye = new THREE.Vector3().setFromMatrixColumn(pose, 2);
    const x = new THREE.Vector3().setFromMatrixColumn(pose, 0);
    const y = new THREE.Vector3().setFromMatrixColumn(pose, 1);
    this.tablet.matrixAutoUpdate = false;
    this.tablet.matrix.copy(pose);
    this.tablet.matrixWorldNeedsUpdate = true;
    this.screenMatrix.copy(pose);
    const w = (SCREEN_W + 0.03) / 2;
    for (const [arm, s] of [
      [this.arms.left, -1],
      [this.arms.right, 1],
    ] as const) {
      // Each hand behind its side of the tablet, palm up against the back, fingers curling round towards the middle.
      const edge = new THREE.Vector3(s * (w - 0.035), -0.015, -0.03).applyMatrix4(pose);
      const fingers = x.clone().multiplyScalar(-s * 0.8).addScaledVector(y, 0.35).normalize();
      arm.stiffness = 80;
      arm.targetGrip = 0.45;
      arm.targetPinch = 0;
      arm.targetPointing = 0;
      arm.reach(edge, handFacing(fingers, toEye), GRAB_POINT);
    }
  }

  // ---------- The check ----------

  private runCheck(scene: Extract<Scene, { kind: 'check' }>, head: THREE.Vector3): void {
    const t = scene.t;
    const side = scene.side < 0 ? 'left' : 'right';
    const hand = this.arms[side];
    const other = this.arms[side === 'left' ? 'right' : 'left'];
    // The other hand keeps hold of the cart the whole time (steadying you as you crouch).
    if (this.cart) this.onHandle(other, side === 'left' ? 'right' : 'left', 110);
    // Where the beam is aimed: along the seats, aisle one first (in step with the eyes).
    const looks = scene.looks;
    const aimAt =
      t < 3.1 ? looks[0].clone().lerp(looks[1], span(t, 1.9, 3.1)) : t < 4.3 ? looks[1].clone().lerp(looks[2], span(t, 3.1, 4.3)) : looks[2].clone().lerp(looks[1], span(t, 4.3, 5.0));
    const pocket = this.pocket(head, side);
    hand.stiffness = 70;
    if (t < 0.55) {
      // Down to the apron pocket.
      hand.targetGrip = 0.5;
      hand.reach(pocket, handFacing(new THREE.Vector3(0, -1, 0), new THREE.Vector3(side === 'left' ? 1 : -1, 0, 0)));
    } else if (t < 5.4) {
      // Out with the torch, low in front, aimed where you look.
      this.torchShown = true;
      hand.targetGrip = 1;
      const toward = aimAt.clone().sub(head).normalize();
      const hold = head.clone().addScaledVector(toward, 0.3).add(new THREE.Vector3(scene.side * 0.05, -0.08, 0));
      const k = span(t, 0.55, 1.5);
      const at = pocket.clone().lerp(hold, k);
      hand.reach(at, torchGrip(side, aimAt.clone().sub(at)), GRAB_POINT);
    } else if (t < 6.1) {
      // Back in the pocket.
      hand.targetGrip = 1;
      hand.reach(pocket, handFacing(new THREE.Vector3(0, -1, 0), new THREE.Vector3(side === 'left' ? 1 : -1, 0, 0)));
      if (t > 5.95) this.torchShown = false;
    } else if (this.cart) {
      this.onHandle(hand, side, 60);
    }
    this.beam.intensity = t > 1.55 && t < 5.05 ? 16 : 0;
    if (t > 6.9) this.scene = null;
  }

  // ---------- The serve ----------

  private runServe(scene: Extract<Scene, { kind: 'serve' }>, head: THREE.Vector3): void {
    const t = scene.t;
    const right = this.arms.right;
    const left = this.arms.left;
    const cart = this.cart;
    if (!cart) {
      this.scene = null;
      return;
    }
    const cupHome = cart.onTop(0.08, 0.24);
    const cartonHome = cart.onTop(-0.08, 0.2);
    const pourCup = head.clone().add(new THREE.Vector3(0.05, -0.46, -0.3));
    const upright = handFacing(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0));
    // The right hand: to the cup, lift it, hold it for the pour, then hand it over.
    right.stiffness = 75;
    if (t < 0.9) {
      right.targetGrip = 0.2;
      right.reach(cupHome.clone().add(new THREE.Vector3(0, 0.05, 0)), upright, GRAB_POINT);
    } else if (t < 3.9) {
      right.targetGrip = 0.85;
      if (this.cupHolder === 'cart') this.take('cup', right);
      right.reach(cupHome.clone().add(new THREE.Vector3(0, 0.05, 0)).lerp(pourCup, span(t, 0.9, 1.6)), upright, GRAB_POINT);
    } else if (t < 5.2) {
      right.targetGrip = 0.85;
      // Out towards the passenger, as far as a comfortable reach.
      const out = scene.seat.clone().setY(1.0).sub(pourCup);
      const reach = out.clone().setLength(Math.min(out.length() * 0.55, 0.42));
      scene.handover ??= pourCup.clone().add(reach);
      right.reach(pourCup.clone().lerp(scene.handover, span(t, 3.9, 4.9)), upright, GRAB_POINT);
      // The passenger reaches for it (with the hand on the aisle side).
      const target = scene.target;
      if (target && t > 4.2) {
        if (scene.seat.x < 0) target.pointAt = scene.handover.clone().add(new THREE.Vector3(0, -0.02, 0.02));
        else target.reachTo = scene.handover.clone().add(new THREE.Vector3(0, -0.02, 0.02));
      }
    } else {
      // Theirs now: your hand lets go and goes back to the handle.
      if (this.cupHolder === 'right') this.giveCup(scene);
      if (t < 5.6) {
        right.targetGrip = 0;
        right.reach(scene.handover ?? pourCup, upright, GRAB_POINT);
      } else this.onHandle(right, 'right', 60);
      if (t > 5.9 && scene.target) {
        scene.target.pointAt = null;
        scene.target.reachTo = null;
      }
    }
    // The left hand: the carton, the pour, and back.
    left.stiffness = 70;
    const spout = pourCup.clone().add(new THREE.Vector3(-0.1, 0.13, 0));
    const pour = handFacing(new THREE.Vector3(0.2, -0.3, -1), new THREE.Vector3(1, -0.6, 0));
    if (t < 1.2) {
      left.targetGrip = 0.2;
      left.reach(cartonHome.clone().add(new THREE.Vector3(0, 0.12, 0)), handFacing(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)), GRAB_POINT);
    } else if (t < 3.3) {
      left.targetGrip = 0.9;
      if (this.cartonHolder === 'cart') this.take('carton', left);
      const lift = cartonHome.clone().add(new THREE.Vector3(0, 0.12, 0)).lerp(spout, span(t, 1.2, 1.9));
      const tip = new THREE.Quaternion().slerpQuaternions(handFacing(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)), pour, span(t, 1.7, 2.1) * (1 - span(t, 2.9, 3.3)));
      left.reach(lift, tip, GRAB_POINT);
    } else if (t < 3.9) {
      left.targetGrip = 0.9;
      left.reach(cartonHome.clone().add(new THREE.Vector3(0, 0.12, 0)), handFacing(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)), GRAB_POINT);
    } else {
      if (this.cartonHolder === 'left') this.put('carton');
      this.onHandle(left, 'left', 60);
    }
    // The juice runs while the carton is tipped over the cup, and the cup fills.
    const pouring = t > 2.05 && t < 2.95;
    this.stream.visible = pouring;
    if (t > 2.05) {
      this.fill.visible = true;
      const level = 0.012 + 0.06 * span(t, 2.05, 2.95);
      this.fill.position.y = level;
      this.fill.scale.setScalar(0.85 + level * 2.2);
    }
    if (t > 7.0) {
      this.scene = null;
      if (this.cupHolder === 'right') this.cupHolder = 'cart';
    }
  }

  /** A hand takes hold of a prop: it keeps it where it is in the hand from now on. */
  private take(prop: 'cup' | 'carton', arm: Arm): void {
    const object = prop === 'cup' ? this.cup : this.carton;
    object.updateMatrixWorld();
    const offset = arm.matrix().invert().multiply(object.matrixWorld.clone());
    if (prop === 'cup') {
      this.cupOffset.copy(offset);
      this.cupHolder = 'right';
    } else {
      this.cartonOffset.copy(offset);
      this.cartonHolder = 'left';
    }
  }

  private put(prop: 'carton'): void {
    if (prop === 'carton') this.cartonHolder = 'cart';
  }

  /** The passenger's hand closes on the cup: it goes with that hand from now on. */
  private giveCup(scene: Extract<Scene, { kind: 'serve' }>): void {
    const target = scene.target;
    if (!target) {
      this.cupHolder = 'cart';
      return;
    }
    const wrist = target.joints[scene.seat.x < 0 ? 'wrist1' : 'wrist0'];
    this.passengerHand = () => {
      wrist.updateMatrixWorld();
      return new THREE.Vector3().setFromMatrixPosition(wrist.matrixWorld).add(new THREE.Vector3(0, -0.02, -0.03));
    };
    this.cupHolder = 'passenger';
  }

  // ---------- Props ----------

  private applyProps(dt: number): void {
    const cart = this.cart;
    // The torch, in the hand that took it out.
    const scene = this.scene;
    const torchSide = scene?.kind === 'check' ? (scene.side < 0 ? 'left' : 'right') : null;
    this.torch.visible = this.torchShown && torchSide !== null;
    if (this.torch.visible && torchSide) {
      const hand = this.arms[torchSide];
      const at = hand.point(GRAB_POINT);
      // The beam leaves the thumb side of the fist.
      const beam = new THREE.Vector3(torchSide === 'left' ? 1 : -1, 0, 0).applyQuaternion(hand.quat);
      this.torch.position.copy(at);
      this.torch.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), beam);
    }
    const lens = this.torch.userData.lens as THREE.MeshStandardMaterial;
    lens.emissiveIntensity = this.beam.intensity > 0 ? 2.5 : 0;
    if (this.beam.intensity > 0 !== this.lastTorch) this.lastTorch = this.beam.intensity > 0;

    // The cup: on the cart, in your right hand, or in the passenger's.
    this.cup.visible = !!cart || this.cupHolder === 'passenger';
    if (this.cupHolder === 'right') {
      this.cup.matrixAutoUpdate = false;
      this.cup.matrix.copy(this.arms.right.matrix().multiply(this.cupOffset));
      this.cup.matrixWorldNeedsUpdate = true;
    } else if (this.cupHolder === 'passenger' && this.passengerHand) {
      const at = this.passengerHand();
      this.cup.matrixAutoUpdate = true;
      if (at) this.cup.position.copy(at);
      this.cup.quaternion.identity();
    } else if (cart) {
      this.cup.matrixAutoUpdate = true;
      this.cup.position.copy(cart.onTop(0.08, 0.24));
      this.cup.quaternion.identity();
    }
    // The carton: on the cart, or in your left hand.
    this.carton.visible = !!cart;
    if (this.cartonHolder === 'left') {
      this.carton.matrixAutoUpdate = false;
      this.carton.matrix.copy(this.arms.left.matrix().multiply(this.cartonOffset));
      this.carton.matrixWorldNeedsUpdate = true;
    } else if (cart) {
      this.carton.matrixAutoUpdate = true;
      this.carton.position.copy(cart.onTop(-0.08, 0.2));
      this.carton.quaternion.identity();
    }
    // The stream: from the spout straight down into the cup.
    if (this.stream.visible) {
      this.carton.updateMatrixWorld();
      this.cup.updateMatrixWorld();
      const spout = new THREE.Vector3(0.018, 0.2, 0).applyMatrix4(this.carton.matrixWorld);
      const into = new THREE.Vector3(0, 0.05, 0).applyMatrix4(this.cup.matrixWorld);
      const length = Math.max(0.01, spout.distanceTo(into));
      this.stream.position.copy(spout).lerp(into, 0.5);
      this.stream.scale.set(1, length, 1);
      this.stream.quaternion.setFromUnitVectors(UP, spout.clone().sub(into).normalize());
    }
    void dt;
  }
}
