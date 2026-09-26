import * as THREE from 'three';
import { SKIN, TOP } from '../../app/Avatar';
import type { Look, SeatId } from '../../engine';
import { FACE_TEMPLATES } from '../../net/face';
import { BOT_LOOKS, TUTORIAL_BOTS } from '../../tutorial/script';
import type { LessonId } from '../../tutorial/lessons';
import { cabinAudio } from '../audio';
import type { GraphicsProfile } from '../graphics';
import { eyePosition } from '../layout';
import { Lighting } from '../lighting';
import { buildCabin, type CabinParts } from '../scene/cabin';
import { People } from '../scene/people';
import { POCKET, SAFETY_CARD, buildSeats, type SeatParts } from '../scene/seats';
import { WindowShafts } from '../shafts';
import { Spring } from '../spring';
import { WindowView } from '../windows';
import { Arms, PINCH_POINT, handFacing, indexTip, type Arm } from './arms';
import { SECTIONS, cardBackTexture, cardFrontTexture, sectionAt, sectionPoint } from './safetyCardArt';

/**
 * Choosing a lesson, first person, in seat 3A. You turn from the window to the seat ahead, glance down at its pocket
 * and lean in; your right hand pinches the top of the safety card and draws it up out of the pocket, and you sit back
 * with it. Your left hand takes its other edge while the right shifts its hold to the right edge, then the left lets
 * go and points at a panel: whichever the pointer (or a button) is on. Pick one and your hand brings the card up
 * close while you lean in and your eyes settle on that panel.
 *
 * Nothing moves unless a hand moves it: the card is in the pocket, or it is wherever the hand holding it is.
 */

export type CardStage = 'pan' | 'glance' | 'reach' | 'pull' | 'raise' | 'regrip' | 'choose' | 'zoom' | 'done';

export interface SafetyCardEvents {
  /** The finger has moved to another panel. */
  onHover?: (lesson: LessonId) => void;
  /** The card is up and open: panels can be picked. */
  onReady?: () => void;
  /** The chosen panel fills your view. */
  onPicked?: (lesson: LessonId) => void;
}

const SEAT: SeatId = '3A';
/** Tutorial bots in the seats around you (the ones you are about to fly with). */
const NEIGHBOURS: [SeatId, number][] = [
  ['2B', 0],
  ['2E', 1],
  ['1D', 2],
  ['3E', 3],
];
const W = SAFETY_CARD.w;
const H = SAFETY_CARD.h;
/** How far the card slides up before its bottom edge clears the pocket's lip. */
const FREE = POCKET.y + POCKET.h / 2 - SAFETY_CARD.bottom + 0.004;
const ZERO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Where the hands take hold, in the card's frame (its bottom edge's centre, x right, y up, z out of its face). */
const HOLD = {
  top: new THREE.Vector3(0.09, H - 0.014, 0),
  right: new THREE.Vector3(W / 2 - 0.012, H * 0.44, 0),
  left: new THREE.Vector3(-W / 2 + 0.012, H * 0.47, 0),
};
/** How each hand faces the card for those holds (in the card's frame). */
const GRIP = {
  // From above and in front: fingers down over the edge, palm towards the card.
  top: handFacing(new THREE.Vector3(0, -1, -0.3), new THREE.Vector3(0, 0.3, -1)),
  // From the side: fingers up the edge, palm towards the middle, the thumb on the front.
  right: handFacing(new THREE.Vector3(-0.3, 1, 0), new THREE.Vector3(-1, -0.3, 0.25)),
  left: handFacing(new THREE.Vector3(0.3, 1, 0), new THREE.Vector3(1, -0.3, 0.25)),
};

const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

export class SafetyCardSet {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(68, 1, 0.02, 60);
  stage: CardStage = 'pan';
  /** The panel the finger is on. */
  hovered: LessonId = 'passenger';
  private readonly arms = new Arms();
  private readonly cabin: CabinParts;
  private readonly seats: SeatParts;
  private readonly lighting: Lighting;
  private readonly windows: WindowView;
  private readonly shafts: WindowShafts;
  private readonly people = new People();
  private readonly card: THREE.Mesh;
  private readonly cardMatrix = new THREE.Matrix4();
  /** The card in its pocket (its bottom edge), and the way it slides out. */
  private readonly pocket: THREE.Matrix4;
  private readonly pocketUp = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private holder: 'pocket' | 'right' | 'left' = 'pocket';
  /** The card in the holding hand's frame. */
  private readonly offset = new THREE.Matrix4();
  private slide = 0;
  /** Where the pinch first closed on the card (the slide is measured from there). */
  private grabbedAt: THREE.Vector3 | null = null;
  private readonly eye: THREE.Vector3;
  private readonly yaw = new Spring(0.72);
  private readonly pitch = new Spring(-0.1);
  private readonly lean = new Spring(0);
  private readonly zoomFov = new Spring(1);
  private stageTime = 0;
  private time = 0;
  private aspect = 16 / 9;
  private baseFov = 68;
  private picked: LessonId | null = null;
  private pickedSent = false;
  private readySent = false;
  private pixelRatio = 1;
  private readonly fired = new Set<string>();

  constructor(private readonly events: SafetyCardEvents = {}) {
    this.scene.background = new THREE.Color('#05070c');
    const rows = 8;
    this.cabin = buildCabin(rows);
    this.seats = buildSeats(rows);
    this.windows = new WindowView(this.cabin.windowGlass, this.cabin.skyDay);
    this.scene.add(this.cabin.group, this.seats.group);
    this.lighting = new Lighting(this.scene, this.cabin, this.seats, this.windows, true);
    this.lighting.setMode('day', true);
    this.shafts = new WindowShafts(this.cabin.windows);
    this.scene.add(this.shafts.group);

    // A few of the bots already in their seats around you.
    const faces = new Map<string, string>();
    this.people.sync(
      NEIGHBOURS.map(([seat, i]) => {
        const id = `n${i}`;
        faces.set(id, FACE_TEMPLATES[i % FACE_TEMPLATES.length].face);
        return { id, name: TUTORIAL_BOTS[i], look: BOT_LOOKS[TUTORIAL_BOTS[i]], seat, status: 'alive' as const, cause: null, outNight: null, role: null, team: null };
      }),
      null,
      () => new THREE.Vector3(),
      faces,
    );
    for (let i = 0; i < 60; i++) this.people.update(1 / 30, i / 30);
    this.scene.add(this.people.group);

    // The card: laminated, front and back printed, white at the edges.
    const edge = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.4 });
    const face = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, roughness: 0.3, metalness: 0, alphaTest: 0.5 });
    const geometry = new THREE.BoxGeometry(W, H, 0.0016);
    geometry.translate(0, H / 2, 0);
    this.card = new THREE.Mesh(geometry, [edge, edge, edge, edge, face(cardFrontTexture()), face(cardBackTexture())]);
    this.card.matrixAutoUpdate = false;
    this.card.castShadow = this.card.receiveShadow = true;
    this.scene.add(this.card);
    this.seats.hideCard(SEAT);
    this.pocket = this.seats.pocketCard(SEAT)!;
    this.pocketUp.setFromMatrixColumn(this.pocket, 1).normalize();
    this.setCard(this.pocket);

    const e = eyePosition(SEAT);
    this.eye = new THREE.Vector3(e.x, e.y, e.z);
    this.scene.add(this.camera, this.arms.group);
    this.placeHands();
    this.applyCamera(0);
  }

  /** Your hands and sleeves. */
  setLook(look: Look): void {
    this.arms.setLook(SKIN[look.skin] ?? SKIN[0], TOP[look.top] ?? TOP[0], look.topStyle === 1 || look.topStyle === 3);
  }

  /** Shadows, reflections, sunbeams: from the graphics setting. */
  applyProfile(profile: GraphicsProfile, pixelRatio: number): void {
    this.lighting.setShadows(profile.shadows, profile.shadowMapSize, profile.shadowRadius);
    this.lighting.setEnvironment(profile.environment);
    this.shafts.dustOn = profile.dust;
    this.shafts.group.visible = profile.shafts;
    this.pixelRatio = pixelRatio;
  }

  resize(width: number, height: number, fovBonus = 0): void {
    this.aspect = width / Math.max(1, height);
    // (Wider on a tall screen: the card could only fit by holding it out past the seat in front.)
    this.baseFov = (width < height ? 92 : 68) + fovBonus;
    this.applyCamera(0);
  }

  /** The pointer, in normalised device coordinates (null: off the view): the finger follows it across the card. */
  pointer(ndc: THREE.Vector2 | null): LessonId | null {
    if (!ndc || this.stage !== 'choose') return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.card, false).find((h) => h.face?.materialIndex === 4 && h.uv);
    const section = hit?.uv ? sectionAt(hit.uv.x, hit.uv.y) : null;
    if (section) this.hover(section.id);
    return section?.id ?? null;
  }

  /** Point at a panel (from a button, or the keyboard). */
  hover(lesson: LessonId): void {
    if (this.hovered === lesson) return;
    this.hovered = lesson;
    this.events.onHover?.(lesson);
  }

  /** Take this lesson: the card comes up close on its panel. */
  pick(lesson: LessonId = this.hovered): void {
    if (this.stage !== 'choose') return;
    this.hover(lesson);
    this.picked = lesson;
    this.goto('zoom');
  }

  /** Straight to the card held up and open (reduced motion, or a click during the sequence). */
  skip(): void {
    if (this.stage === 'choose' || this.stage === 'zoom' || this.stage === 'done') return;
    this.goto('choose');
    const reading = this.readingPose();
    this.lean.snap(0);
    this.setCard(reading);
    const right = this.handPose(reading, 'right');
    this.arms.right.snap(right.pos, right.quat);
    this.arms.right.targetPinch = this.arms.right.pinch = 1;
    this.holdWith('right');
    this.arms.left.snap(this.restPoint('left'), this.restQuat());
    this.aimAt(this.lookPoint(reading), true);
  }

  update(dt: number): void {
    this.time += dt;
    this.stageTime += dt;
    this.runStage(dt);
    this.applyCamera(dt);
    const facing = new THREE.Vector3();
    this.camera.getWorldDirection(facing);
    this.arms.update(dt, this.camera.position, facing);
    this.applyHold();
    this.lighting.update(dt);
    this.windows.update(dt);
    this.cabin.curtain.update(dt, []);
    this.people.update(dt, this.time);
    this.shafts.update(dt, this.time, this.lighting.lightDirection, this.lighting.shaftStrength(), this.lighting.key.color, this.pixelRatio);
  }

  dispose(): void {
    this.lighting.dispose();
    this.shafts.dispose();
    this.windows.dispose();
    this.arms.dispose();
    this.people.dispose();
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
    });
  }

  // ---------- The sequence ----------

  private goto(stage: CardStage): void {
    this.stage = stage;
    this.stageTime = 0;
    this.fired.clear();
  }

  private once(cue: string, play: () => void): void {
    if (this.fired.has(cue)) return;
    this.fired.add(cue);
    play();
  }

  private runStage(dt: number): void {
    const t = this.stageTime;
    const right = this.arms.right;
    const left = this.arms.left;
    switch (this.stage) {
      case 'pan': {
        // Turning from the window to the seat ahead, as the Terminal slides away.
        this.lean.step(0, 1.2, 1, dt);
        this.aimAt(this.eye.clone().add(new THREE.Vector3(0, -0.3, -0.62)));
        this.restHands();
        if (t > 1.25) this.goto('glance');
        break;
      }
      case 'glance': {
        // Eyes down to the pocket; you start to lean in.
        this.aimAt(this.pocketPoint(0.1));
        this.lean.step(t > 0.35 ? 0.5 : 0, 1.1, 1, dt);
        this.restHands();
        if (t > 0.75) this.goto('reach');
        break;
      }
      case 'reach': {
        this.aimAt(this.pocketPoint(0.16));
        this.lean.step(1, 1.3, 1, dt);
        right.stiffness = 70;
        const grab = this.handPose(this.cardMatrix, 'top');
        // In over the lip from in front, then down onto the edge.
        const approach = 1 - smooth((t - 0.35) / 0.45);
        const out = new THREE.Vector3().setFromMatrixColumn(this.pocket, 2).normalize();
        right.reach(grab.pos.clone().addScaledVector(out, 0.06 * approach).addScaledVector(this.pocketUp, 0.05 * approach), grab.quat, ZERO);
        right.targetPinch = t > 0.72 ? 1 : 0;
        right.targetGrip = 0;
        left.stiffness = 60;
        left.reach(this.restPoint('left'), this.restQuat());
        if (t > 0.95) {
          this.grabbedAt = right.point(PINCH_POINT);
          this.goto('pull');
        }
        break;
      }
      case 'pull': {
        // Straight up out of the pocket (the pocket only lets it go that way), then back towards you.
        this.aimAt(this.pocketPoint(0.2 + this.slide * 0.6));
        this.lean.step(t > 0.45 ? 0.55 : 1, 1.2, 1, dt);
        this.once('rustle', () => cabinAudio.rustle());
        right.stiffness = 55;
        right.targetPinch = 1;
        const k = smooth(t / 0.8);
        const grab = this.handPose(this.pocket, 'top');
        right.reach(grab.pos.clone().addScaledVector(this.pocketUp, (FREE + 0.03) * k), grab.quat, ZERO);
        if (this.holder !== 'pocket' && t > 0.85) this.goto('raise');
        break;
      }
      case 'raise': {
        // Sitting back with it, at chest height, turning it to face you.
        const low = this.lowPose();
        this.aimAt(this.lookPoint(this.cardMatrix));
        this.lean.step(0, 1.0, 1, dt);
        right.stiffness = 45;
        const hand = this.heldPose(low);
        right.reach(hand.pos, hand.quat, ZERO);
        left.reach(this.restPoint('left'), this.restQuat());
        if (t > 0.95) this.goto('regrip');
        break;
      }
      case 'regrip': {
        const reading = this.readingPose();
        // (Eyes on the card as it comes up.)
        this.aimAt(this.lookPoint(this.cardMatrix));
        this.lean.step(0, 1.0, 1, dt);
        // The left hand takes the other edge and lifts it up to read...
        left.stiffness = 90;
        const leftHold = this.handPose(this.cardMatrix, 'left');
        left.reach(leftHold.pos, leftHold.quat, ZERO);
        left.targetPinch = t > 0.42 ? 1 : 0;
        left.targetGrip = 0;
        if (t > 0.55 && this.holder === 'right') {
          this.holdWith('left');
          this.once('shift', () => cabinAudio.rustle());
        }
        // ...while the right lets go of the top and takes hold of the right edge.
        if (this.holder === 'right') {
          const hand = this.heldPose(this.lowPose());
          right.reach(hand.pos, hand.quat, ZERO);
        } else {
          const hand = this.heldPose(reading);
          left.stiffness = 45;
          left.reach(hand.pos, hand.quat, ZERO);
          right.targetPinch = t > 1.25 ? 1 : 0;
          // (Fingers relaxed on the way, not spread flat.)
          right.targetGrip = t > 1.25 ? 0 : 0.75;
          right.stiffness = 90;
          const rightHold = this.handPose(this.cardMatrix, 'right');
          const lift = 1 - smooth((t - 0.65) / 0.5);
          right.reach(rightHold.pos.clone().addScaledVector(this.facing(), 0.05 * lift), rightHold.quat, ZERO);
          if (t > 1.45) {
            this.holdWith('right');
            this.goto('choose');
          }
        }
        break;
      }
      case 'choose': {
        if (!this.readySent) {
          this.readySent = true;
          this.events.onReady?.();
        }
        const reading = this.readingPose();
        this.aimAt(this.lookPoint(reading));
        this.lean.step(0, 1.0, 1, dt);
        right.stiffness = 50;
        right.targetPinch = 1;
        const hand = this.heldPose(reading);
        right.reach(hand.pos, hand.quat, ZERO);
        left.targetPinch = 0;
        left.stiffness = 120;
        left.targetPointing = 1;
        const aim = this.fingerPose(this.hovered);
        left.reach(aim.pos, aim.quat, indexTip('left'));
        break;
      }
      case 'zoom': {
        const lesson = this.picked ?? this.hovered;
        // The hand brings the card up close, the chosen panel in front of your eyes; you lean in and look.
        this.lean.step(0.22, 1.1, 1, dt);
        const close = this.closePose(lesson);
        right.stiffness = 42;
        const hand = this.heldPose(close);
        right.reach(hand.pos, hand.quat, ZERO);
        if (t < 0.2) {
          const aim = this.fingerPose(lesson);
          left.reach(aim.pos, aim.quat, indexTip('left'));
        } else {
          left.targetPointing = 0;
          left.stiffness = 50;
          left.reach(this.restPoint('left'), this.restQuat());
        }
        this.aimAt(this.panelPoint(lesson, this.cardMatrix));
        if (t > 1.4 && !this.pickedSent) {
          this.pickedSent = true;
          this.goto('done');
          this.events.onPicked?.(lesson);
        }
        break;
      }
      case 'done':
        break;
    }
    // Your eyes narrow on the panel as you pick it.
    this.zoomFov.step(this.stage === 'zoom' || this.stage === 'done' ? 0.42 : 1, 0.9, 1, dt);
  }

  // ---------- The card and the hands ----------

  private setCard(m: THREE.Matrix4): void {
    this.cardMatrix.copy(m);
    this.card.matrix.copy(m);
    this.card.matrixWorldNeedsUpdate = true;
  }

  /** From now on the card goes wherever this hand goes. */
  private holdWith(side: 'right' | 'left'): void {
    this.holder = side;
    this.offset.copy(this.arms[side].matrix().invert().multiply(this.cardMatrix));
  }

  /** After the hands move: the card follows the hand holding it (or slides in its pocket as the pinch pulls it). */
  private applyHold(): void {
    if (this.holder === 'pocket') {
      if (this.grabbedAt && this.arms.right.pinch > 0.6) {
        const pulled = this.arms.right.point(PINCH_POINT).sub(this.grabbedAt).dot(this.pocketUp);
        this.slide = Math.max(this.slide, Math.min(FREE, pulled));
        this.setCard(this.pocket.clone().premultiply(new THREE.Matrix4().makeTranslation(this.pocketUp.clone().multiplyScalar(this.slide))));
        if (this.slide >= FREE) this.holdWith('right');
      }
      return;
    }
    this.setCard(this.arms[this.holder].matrix().multiply(this.offset));
  }

  /** Where a hand's wrist goes, and how it turns, to take one of the holds on a card at `card`. */
  private handPose(card: THREE.Matrix4, hold: keyof typeof HOLD): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const cardQuat = new THREE.Quaternion().setFromRotationMatrix(card);
    const quat = cardQuat.clone().multiply(GRIP[hold]);
    const point = HOLD[hold].clone().applyMatrix4(card);
    return { pos: point.sub(PINCH_POINT.clone().applyQuaternion(quat)), quat };
  }

  /** The holding hand's pose that puts the card at `card`. */
  private heldPose(card: THREE.Matrix4): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const hand = card.clone().multiply(this.offset.clone().invert());
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    hand.decompose(pos, quat, new THREE.Vector3());
    return { pos, quat };
  }

  /** The left forefinger on a panel: coming in from below and in front, the back of the hand towards you. */
  private fingerPose(lesson: LessonId): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const section = SECTIONS.find((s) => s.id === lesson)!;
    const { u } = sectionPoint(section);
    const card = this.cardMatrix;
    const x = new THREE.Vector3().setFromMatrixColumn(card, 0).normalize();
    const y = new THREE.Vector3().setFromMatrixColumn(card, 1).normalize();
    const z = new THREE.Vector3().setFromMatrixColumn(card, 2).normalize();
    // A little breathing in the finger, so it rests rather than freezes.
    const drift = new THREE.Vector3().addScaledVector(x, Math.sin(this.time * 1.3) * 0.002).addScaledVector(y, Math.sin(this.time * 0.9 + 1) * 0.002);
    // Up from below the card rather than across it, so the hand hides as little of it as it can.
    const forward = new THREE.Vector3().addScaledVector(x, 0.28 + (u - 0.5) * 0.45).addScaledVector(y, 0.82).addScaledVector(z, -0.5).normalize();
    const palm = new THREE.Vector3().addScaledVector(y, -0.75).addScaledVector(z, -0.6).addScaledVector(x, 0.15).normalize();
    const pos = this.panelPoint(lesson, card).addScaledVector(z, 0.006).add(drift);
    return { pos, quat: handFacing(forward, palm) };
  }

  /** A panel's middle on the card, in the world. */
  private panelPoint(lesson: LessonId, card: THREE.Matrix4): THREE.Vector3 {
    const { u, v } = sectionPoint(SECTIONS.find((s) => s.id === lesson)!);
    return new THREE.Vector3((u - 0.5) * W, v * H, 0.001).applyMatrix4(card);
  }

  /** Resting on your thigh. */
  private restPoint(side: 'left' | 'right'): THREE.Vector3 {
    const s = side === 'right' ? 1 : -1;
    const f = this.facing();
    const r = new THREE.Vector3().crossVectors(f, UP).normalize();
    return this.eye.clone().addScaledVector(r, 0.17 * s).add(new THREE.Vector3(0, -0.56, 0)).addScaledVector(f, 0.24);
  }

  /** Palm down on the thigh, fingers along it and turned a little inwards. */
  private restQuat(side: 'left' | 'right' = 'left'): THREE.Quaternion {
    const r = new THREE.Vector3().crossVectors(this.facing(), UP).normalize();
    return handFacing(this.facing().addScaledVector(r, side === 'right' ? -0.3 : 0.3), new THREE.Vector3(0, -1, 0));
  }

  private restHands(): void {
    for (const arm of [this.arms.right, this.arms.left] as Arm[]) {
      arm.stiffness = 60;
      arm.targetPinch = 0;
      arm.targetPointing = 0;
      arm.targetGrip = 0.55;
      arm.reach(this.restPoint(arm.side), this.restQuat(arm.side));
    }
  }

  private placeHands(): void {
    this.camera.position.copy(this.eye);
    this.arms.right.snap(this.restPoint('right'), this.restQuat('right'));
    this.arms.left.snap(this.restPoint('left'), this.restQuat());
  }

  // ---------- Where things are ----------

  /** The way your seat faces (towards the front). */
  private facing(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1);
  }

  /** A point on the card in its pocket, `up` metres above its bottom edge. */
  private pocketPoint(up: number): THREE.Vector3 {
    return new THREE.Vector3(0, up, 0).applyMatrix4(this.pocket);
  }

  /**
   * The card held up to read: in front of your eyes, as close as lets you see all of it (further on a narrow
   * screen), tilted back to face you.
   */
  private readingPose(): THREE.Matrix4 {
    const vfov = THREE.MathUtils.degToRad(this.baseFov);
    const tanV = Math.tan(vfov / 2);
    const tanH = tanV * this.aspect;
    const distance = Math.min(0.36, Math.max(0.27, (H * 1.55) / 2 / tanV, (W * 1.12) / 2 / tanH));
    // A slow sway: the hand holding it breathes.
    const sway = new THREE.Vector3(Math.sin(this.time * 0.7) * 0.003, Math.sin(this.time * 1.1) * 0.0025, 0);
    const center = this.eye.clone().addScaledVector(this.facing(), distance).add(new THREE.Vector3(0, -0.02 - distance * 0.1, 0)).add(sway);
    return this.facingPose(center, this.eye);
  }

  /** Just out of the pocket: hanging from your fingers in front of your chest, upright, its face to you. */
  private lowPose(): THREE.Matrix4 {
    const center = this.eye.clone().addScaledVector(this.facing(), 0.3).add(new THREE.Vector3(0.02, -0.44, 0));
    return this.facingPose(center, new THREE.Vector3(this.eye.x, center.y, this.eye.z));
  }

  /** Up close on a panel: its middle straight ahead of your eyes. */
  private closePose(lesson: LessonId): THREE.Matrix4 {
    const { u, v } = sectionPoint(SECTIONS.find((s) => s.id === lesson)!);
    const eye = this.headPosition(0.22);
    const target = eye.clone().addScaledVector(this.facing(), 0.2).add(new THREE.Vector3(0, -0.05, 0));
    const pose = this.facingPose(target, eye);
    // Shift it so the panel (not the card's middle) sits there.
    const shift = new THREE.Vector3(-(u - 0.5) * W, -(v - 0.5) * H, 0);
    return pose.multiply(new THREE.Matrix4().makeTranslation(shift));
  }

  /** A card whose middle is at `center`, facing `eye`, upright (as a pose of its bottom edge). */
  private facingPose(center: THREE.Vector3, eye: THREE.Vector3): THREE.Matrix4 {
    const z = eye.clone().sub(center).normalize();
    const x = new THREE.Vector3().crossVectors(UP, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    const origin = center.clone().addScaledVector(y, -H / 2);
    return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
  }

  /** Where to look at a card: a little below its middle, so it sits high in the view (the buttons are below). */
  private lookPoint(card: THREE.Matrix4): THREE.Vector3 {
    // (On a tall screen the buttons take more of it.)
    return new THREE.Vector3(0, this.aspect < 1 ? H * 0.05 : H * 0.4, 0).applyMatrix4(card);
  }

  private headPosition(lean: number): THREE.Vector3 {
    // Leaning in from the hips: forward and down.
    return this.eye.clone().add(new THREE.Vector3(0, -0.13 * lean, 0)).addScaledVector(this.facing(), 0.3 * lean);
  }

  // ---------- The head ----------

  private lookTarget = new THREE.Vector3();

  private aimAt(point: THREE.Vector3, instant = false): void {
    this.lookTarget.copy(point);
    if (instant) {
      const { yaw, pitch } = this.anglesTo(point);
      this.yaw.snap(yaw);
      this.pitch.snap(pitch);
    }
  }

  private anglesTo(point: THREE.Vector3): { yaw: number; pitch: number } {
    const d = point.clone().sub(this.camera.position);
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
  }

  private applyCamera(dt: number): void {
    const lean = this.lean.x;
    const breath = Math.sin(this.time * 1.6) * 0.0022;
    this.camera.position.copy(this.headPosition(lean)).add(new THREE.Vector3(0, breath, 0));
    if (dt > 0) {
      const { yaw, pitch } = this.anglesTo(this.lookTarget);
      const hz = this.stage === 'pan' ? 0.75 : this.stage === 'choose' ? 0.8 : 1.3;
      this.yaw.step(yaw, hz, 1, dt);
      this.pitch.step(pitch, hz, 1, dt);
    }
    this.camera.rotation.set(this.pitch.x, this.yaw.x, 0, 'YXZ');
    this.camera.aspect = this.aspect;
    this.camera.fov = this.baseFov * this.zoomFov.x;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}
