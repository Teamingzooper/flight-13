import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BOTTOM, HAIR_COLOR, HAIR_STYLES, SKIN, TOP } from '../../app/Avatar';
import { paintFace } from '../../app/faceImage';
import { grid, type DeathCause, type Look, type PlayerSummary, type SeatId } from '../../engine';
import { EMOTE_BY_ID, type EmoteId } from '../../net/emotes';
import { decodeFace } from '../../net/face';
import type { Pose } from '../../net/protocol';
import { seatPose } from '../layout';

/** Sixteen passengers, and a few more for the police in an ending. */
const MAX_ACTORS = 22;
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

type Paint = 'top' | 'upper' | 'sleeve' | 'bottom' | 'skin' | 'shoe' | 'eye' | 'hair' | 'gun';

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
  /** Top style (Look.topStyle) this part belongs to. */
  outfit?: number;
  /** Only drawn while the actor holds a pistol. */
  armed?: boolean;
  /** An accessory (Look slot and index) this part belongs to, drawn in its own colour. */
  accessory?: { slot: 'hat' | 'eyes' | 'neck'; index: number };
  color?: string;
}

const m = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** One geometry out of several (positions, normals and UVs). */
function merge(...parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
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
}

/**
 * The hair styles of HAIR_STYLES in order, built around a head of radius ~0.105 centred at y = 0.1 on the
 * head joint. Bald has no geometry.
 */
export function hairGeometries(): (THREE.BufferGeometry | null)[] {
  const cap = (thetaLength: number, scale: [number, number, number], y = 0.112, z = 0.008) => {
    const g = new THREE.SphereGeometry(0.112, 20, 12, 0, Math.PI * 2, 0, thetaLength);
    // Tilt back so the hairline sits above the eyes and the nape is covered.
    g.rotateX(0.32);
    g.scale(...scale);
    g.translate(0, y, z);
    return g;
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
    s.translate(Math.sin(a) * 0.085, 0.132 + Math.cos(a * 2) * 0.02, Math.cos(a) * 0.075 + 0.01);
    curls.push(s);
  }
  const brim = new THREE.CylinderGeometry(0.12, 0.12, 0.012, 20);
  brim.translate(0, 0.16, -0.05);
  // A tie at the back of the head and a tail hanging down behind it.
  const tie = new THREE.SphereGeometry(0.024, 10, 8);
  tie.translate(0, 0.15, 0.116);
  const tail = new THREE.CapsuleGeometry(0.03, 0.14, 4, 10);
  tail.scale(0.9, 1, 0.85);
  tail.rotateX(-0.27);
  tail.translate(0, 0.065, 0.142);
  return [
    cap(Math.PI * 0.42, [1, 1, 1.02]),
    merge(cap(Math.PI * 0.5, [1.04, 1.04, 1.06]), longBack),
    merge(cap(Math.PI * 0.4, [1, 1, 1]), bun),
    // Buzz: close-cropped, a few millimetres off the skull all round.
    cap(Math.PI * 0.4, [0.9, 1.04, 0.985], 0.1, 0),
    merge(cap(Math.PI * 0.36, [1, 0.95, 1]), ...spikes),
    cap(Math.PI * 0.48, [1.05, 1.08, 1.05]),
    merge(cap(Math.PI * 0.45, [1.06, 1.06, 1.06]), ...curls),
    // The crown comes down to meet the brim.
    merge(cap(Math.PI * 0.47, [1.05, 1, 1.05], 0.115), brim),
    null,
    merge(cap(Math.PI * 0.46, [1.02, 1.02, 1.04]), tie, tail),
  ];
}

/**
 * Accessories (meta/accessories.ts), as parts in their own colours: hats and eyewear on the head joint (the face
 * looks down -z, the crown is at y ≈ 0.21 and hair reaches y ≈ 0.24), neck things on the chest joint (the collar is
 * at y ≈ 0.15, the chest front at z ≈ -0.09 to -0.11).
 */
function accessoryParts(material: THREE.MeshStandardMaterial): PartSpec[] {
  const out: PartSpec[] = [];
  const add = (slot: 'hat' | 'eyes' | 'neck', index: number, color: string, ...geometries: THREE.BufferGeometry[]) =>
    out.push({
      geometry: merge(...geometries),
      material,
      joints: [slot === 'neck' ? 'chest' : 'head'],
      local: [m()],
      paint: 'skin',
      head: true,
      accessory: { slot, index },
      color,
    });
  /** Geometry, moved: rotations (x, then z) about its own centre, then a translation. */
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0, ry = 0) => {
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return g;
  };
  const flat = (g: THREE.BufferGeometry) => g.rotateX(HALF_PI);
  // Hats sit tilted back a little about the middle of the head, like the hair, so the front edge clears the eyes.
  const tilt = (g: THREE.BufferGeometry) => g.translate(0, -0.12, 0).rotateX(0.18).translate(0, 0.12, 0);

  // 1 Beanie: a knitted dome with a turned-up cuff and a bobble.
  const dome = new THREE.SphereGeometry(0.126, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  dome.scale(0.98, 1.08, 1.05);
  add('hat', 1, '#27406b', tilt(at(dome, 0, 0.12, 0.004)));
  add('hat', 1, '#3a5a8c', tilt(at(flat(new THREE.TorusGeometry(0.118, 0.02, 8, 24)), 0, 0.128, 0.004)));
  add('hat', 1, '#e9eef5', tilt(at(new THREE.SphereGeometry(0.034, 10, 8), 0, 0.262, 0.01)));

  // 2 Captain's hat: a white crown, black band and peak, and a gold badge.
  add('hat', 2, '#f4f4f0', tilt(at(new THREE.CylinderGeometry(0.13, 0.112, 0.075, 24), 0, 0.232, 0)));
  add(
    'hat',
    2,
    '#1d1f24',
    tilt(at(new THREE.CylinderGeometry(0.114, 0.113, 0.03, 24), 0, 0.2, 0)),
    tilt(at(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 20, 1, false, Math.PI / 2, Math.PI), 0, 0.19, -0.035, -0.28)),
  );
  add('hat', 2, '#e0b33a', tilt(at(new THREE.BoxGeometry(0.03, 0.022, 0.01), 0, 0.225, -0.118)));

  // 3 Fedora: a pinched crown, a band and a brim.
  const crown = new THREE.CylinderGeometry(0.1, 0.11, 0.1, 20);
  crown.scale(0.94, 1, 1.05);
  add('hat', 3, '#6b4a2f', tilt(at(crown, 0, 0.235, 0.004)), tilt(at(new THREE.CylinderGeometry(0.175, 0.175, 0.01, 28), 0, 0.186, 0.004)));
  add('hat', 3, '#2a1d14', tilt(at(new THREE.CylinderGeometry(0.106, 0.112, 0.024, 20), 0, 0.2, 0.004)));

  // 4 Party hat: a striped cone with a bobble on top, worn at a jaunty angle.
  add('hat', 4, '#e5534b', at(new THREE.ConeGeometry(0.064, 0.17, 16), 0.012, 0.29, 0.01, 0, -0.14));
  add('hat', 4, '#f2b134', at(flat(new THREE.TorusGeometry(0.05, 0.006, 6, 16)), 0.006, 0.255, 0.01, 0, -0.14));
  add('hat', 4, '#3fb27f', at(new THREE.SphereGeometry(0.022, 10, 8), 0.024, 0.375, 0.01));

  // 5 Cowboy hat: a dented crown and a wide brim curling up at the sides.
  const cowCrown = new THREE.CylinderGeometry(0.095, 0.108, 0.105, 20);
  cowCrown.scale(0.92, 1, 1.08);
  const brimCurl = flat(new THREE.TorusGeometry(0.19, 0.018, 8, 32));
  brimCurl.scale(1, 0.84, 1);
  add(
    'hat',
    5,
    '#c89b62',
    tilt(at(cowCrown, 0, 0.24, 0.004)),
    tilt(at(new THREE.CylinderGeometry(0.2, 0.2, 0.01, 32), 0, 0.186, 0.004)),
    tilt(at(brimCurl, 0, 0.2, 0.004)),
  );
  add('hat', 5, '#6b4a2f', tilt(at(new THREE.CylinderGeometry(0.1, 0.108, 0.022, 20), 0, 0.2, 0.004)));

  // 6 Beret: a soft flat disc, pulled to one side, with its little stalk.
  const beret = new THREE.SphereGeometry(0.13, 20, 12);
  beret.scale(1.05, 0.34, 1.05);
  add('hat', 6, '#c0392b', at(beret, -0.015, 0.215, 0.01, 0.12, 0.16), at(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 6), -0.02, 0.262, 0.01, 0, 0.16));

  // Eyewear at eye level (the eyes are at (±0.036, 0.115, -0.094)), a little in front of the face.
  const EYE_Z = -0.109;
  const temples = () => [-1, 1].map((side) => at(new THREE.BoxGeometry(0.004, 0.005, 0.1), side * 0.086, 0.12, -0.056, 0, 0, side * -0.12));
  const bridge = () => at(new THREE.CylinderGeometry(0.003, 0.003, 0.026, 6), 0, 0.12, EYE_Z, 0, HALF_PI);
  const rims = (r: number, sy = 1) =>
    [-1, 1].map((side) => {
      const g = new THREE.TorusGeometry(r, 0.0042, 6, 20);
      g.scale(1, sy, 1);
      return at(g, side * 0.036, 0.115, EYE_Z);
    });
  const lenses = (r: number, sy = 1, y = 0.115) =>
    [-1, 1].map((side) => {
      const g = new THREE.CylinderGeometry(r, r, 0.003, 20);
      g.rotateX(HALF_PI);
      g.scale(1, sy, 1);
      return at(g, side * 0.036, y, EYE_Z);
    });

  // 1 Round glasses.
  add('eyes', 1, '#15171c', ...rims(0.024), bridge(), ...temples());
  // 2 Sunglasses.
  add('eyes', 2, '#111318', ...lenses(0.026, 0.72), bridge(), ...temples());
  // 3 Aviators: gold wire round dark teardrops.
  add('eyes', 3, '#3b3c46', ...lenses(0.026, 0.9, 0.112));
  add('eyes', 3, '#d9b34a', ...rims(0.027, 0.92), bridge(), ...temples());
  // 4 Sleep mask, pushed up onto the forehead: a band round the head and the mask in front.
  const band = flat(new THREE.TorusGeometry(0.09, 0.008, 6, 28));
  band.scale(0.97, 1.05, 1);
  add('eyes', 4, '#d97aae', at(band, 0, 0.168, 0.004, 0.2));
  add('eyes', 4, '#e58fc0', at(new RoundedBoxGeometry(0.11, 0.04, 0.014, 2, 0.006), 0, 0.172, -0.092, -0.45));
  // 5 Heart glasses.
  const heart = new THREE.Shape();
  heart.moveTo(0, -0.022);
  heart.bezierCurveTo(-0.034, 0.002, -0.022, 0.03, 0, 0.012);
  heart.bezierCurveTo(0.022, 0.03, 0.034, 0.002, 0, -0.022);
  const hearts = [-1, 1].map((side) => at(new THREE.ExtrudeGeometry(heart, { depth: 0.004, bevelEnabled: false, curveSegments: 8 }), side * 0.036, 0.115, EYE_Z - 0.002));
  add('eyes', 5, '#e5534b', ...hearts);
  add('eyes', 5, '#15171c', bridge(), ...temples());

  // Round the neck, on the chest joint.
  // 1 Scarf: wound round the neck, one end hanging down the front.
  add(
    'neck',
    1,
    '#c0392b',
    at(flat(new THREE.TorusGeometry(0.074, 0.03, 10, 24)), 0, 0.15, 0),
    at(new RoundedBoxGeometry(0.052, 0.15, 0.02, 2, 0.008), 0.035, 0.07, -0.09, 0.2),
  );
  // 2 Tie: a knot at the collar and the blade down the shirt.
  // (The chest's front is at z ≈ -0.085 by the collar and -0.112 lower down: the blade leans out to follow it.)
  add(
    'neck',
    2,
    '#1f3a8a',
    at(new RoundedBoxGeometry(0.032, 0.026, 0.02, 2, 0.006), 0, 0.132, -0.088),
    at(new RoundedBoxGeometry(0.044, 0.19, 0.012, 2, 0.005), 0, 0.03, -0.12, 0.17),
  );
  // 3 Bow tie.
  const wing = (side: number) => at(new THREE.ConeGeometry(0.022, 0.042, 4), side * 0.024, 0.135, -0.09, 0, side * HALF_PI);
  add('neck', 3, '#c0392b', wing(-1), wing(1), at(new THREE.SphereGeometry(0.011, 8, 6), 0, 0.135, -0.095));
  // 4 Headphones, resting round the neck: the band behind, the cups on the collarbones.
  add('neck', 4, '#26282e', at(flat(new THREE.TorusGeometry(0.088, 0.008, 6, 20, Math.PI)), 0, 0.165, 0.004, 0, 0, Math.PI));
  add(
    'neck',
    4,
    '#34373f',
    ...[-1, 1].map((side) => at(new THREE.CylinderGeometry(0.036, 0.036, 0.026, 16), side * 0.09, 0.15, -0.02, 0, HALF_PI)),
  );
  // 5 Lei: flowers round the neck, dipping lower in front.
  const flowers: THREE.BufferGeometry[][] = [[], [], []];
  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * Math.PI * 2;
    const front = Math.max(0, -Math.cos(a));
    flowers[i % 3].push(at(new THREE.SphereGeometry(0.02, 8, 6), Math.sin(a) * 0.112, 0.14 - front * 0.05, Math.cos(a) * 0.088 - front * 0.035));
  }
  add('neck', 5, '#e05d8c', ...flowers[0]);
  add('neck', 5, '#f2b134', ...flowers[1]);
  add('neck', 5, '#f4f1ea', ...flowers[2]);
  // 6 Gold chain with a little pendant.
  const chain = flat(new THREE.TorusGeometry(0.084, 0.004, 6, 32));
  chain.scale(1.12, 1, 1.05);
  add('neck', 6, '#e0b33a', at(chain, 0, 0.13, -0.03, -0.32), at(new THREE.SphereGeometry(0.012, 10, 8), 0, 0.09, -0.118));
  return out;
}

/** A hood lying on the upper back, with its collar round the back of the neck (on the chest joint). */
function hoodGeometry(): THREE.BufferGeometry {
  const collar = new THREE.TorusGeometry(0.085, 0.03, 8, 20, Math.PI);
  collar.rotateX(HALF_PI);
  collar.translate(0, 0.15, 0);
  const hood = new THREE.SphereGeometry(0.1, 16, 12);
  hood.scale(1, 0.85, 0.4);
  hood.translate(0, 0.08, 0.108);
  return merge(collar, hood);
}

/** A pistol in the right hand: grip in the fist, barrel along the pointing arm (down the wrist's -y). */
function pistolGeometry(): THREE.BufferGeometry {
  const slide = new THREE.BoxGeometry(0.042, 0.21, 0.055);
  slide.translate(0, -0.06, 0.03);
  const grip = new THREE.BoxGeometry(0.036, 0.05, 0.12);
  grip.rotateX(-0.25);
  grip.translate(0, 0.03, -0.03);
  const guard = new THREE.BoxGeometry(0.01, 0.05, 0.04);
  guard.translate(0, -0.01, -0.015);
  return merge(slide, grip, guard);
}

/** The head's shape on the head joint: a slightly tall sphere. */
export const HEAD_CENTER_Y = 0.1;
export const HEAD_SCALE = new THREE.Vector3(0.92, 1.08, 1);
const HEAD_LOCAL = m(0, HEAD_CENTER_Y, 0, HEAD_SCALE.x, HEAD_SCALE.y, HEAD_SCALE.z);
/** The painted face's shell (before the head's scale): a hair's breadth above the skin. */
export const FACE_RADIUS = 0.105 * 1.012;
/** The face editor draws the head as a circle of this radius, as a fraction of the picture. */
export const FACE_SPAN = 0.49;

/**
 * The front of the head for painted faces. Its UVs are the face editor's front view of the head: a circle
 * filling the picture, the passenger's right on the left.
 */
function faceGeometry(): THREE.BufferGeometry {
  const r = FACE_RADIUS;
  const g = new THREE.SphereGeometry(r, 28, 20, Math.PI, Math.PI);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 - (FACE_SPAN * pos.getX(i)) / r, 0.5 + (FACE_SPAN * pos.getY(i)) / r);
  return g;
}

const sameLook = (a: Look, b: Look) =>
  a.body === b.body &&
  a.skin === b.skin &&
  a.hair === b.hair &&
  a.hairColor === b.hairColor &&
  a.top === b.top &&
  a.topStyle === b.topStyle &&
  a.bottom === b.bottom &&
  (a.hat ?? 0) === (b.hat ?? 0) &&
  (a.eyes ?? 0) === (b.eyes ?? 0) &&
  (a.neck ?? 0) === (b.neck ?? 0);

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
    { geometry: new THREE.SphereGeometry(0.105, 24, 18), material: skin, joints: ['head'], local: [HEAD_LOCAL], paint: 'skin', head: true },
    {
      geometry: new THREE.SphereGeometry(0.014, 10, 8),
      material: dark,
      joints: ['head', 'head'],
      local: pair(m(-0.036, 0.115, -0.094, 1, 1.2, 0.6), m(0.036, 0.115, -0.094, 1, 1.2, 0.6)),
      paint: 'eye',
      head: true,
    },
    { geometry: new THREE.CapsuleGeometry(0.05, 0.19, 4, 10), material: cloth, joints: ['shoulder0', 'shoulder1'], local: pair(m(0, -0.13), m(0, -0.13)), paint: 'upper' },
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
  parts.push({ geometry: hoodGeometry(), material: cloth, joints: ['chest'], local: [m()], paint: 'top', head: true, outfit: 2 });
  parts.push({ geometry: pistolGeometry(), material: dark, joints: ['wrist1'], local: [m(0, -0.06, 0.012)], paint: 'gun', armed: true });
  hairGeometries().forEach((geometry, index) => {
    if (geometry) parts.push({ geometry, material: hair, joints: ['head'], local: [m()], paint: 'hair', head: true, hair: index });
  });
  parts.push(...accessoryParts(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 })));
  return parts;
}

/** One arm's joint angles: shoulder (x forward/up, y turn, z out) and elbow (x fold, z out). */
interface ArmPose {
  sx: number;
  sy: number;
  sz: number;
  ex: number;
  ez: number;
}

/**
 * Where a gesture puts one arm `t` seconds in (side 0 is the left arm, 1 the right), or null to leave it be.
 * `yaw` and `pitch` are where the head is looking, for pointing.
 */
function gesture(id: EmoteId, side: Side, t: number, yaw: number, pitch: number): ArmPose | null {
  // Z rotation that swings this arm away from the body.
  const out = side === 0 ? -1 : 1;
  const right = side === 1;
  switch (id) {
    case 'wave':
      return right ? { sx: 2.75, sy: 0, sz: out * 0.35, ex: 0.3, ez: Math.sin(t * 11) * 0.55 } : null;
    // (Gestures stay above the seatbacks, so the rest of the cabin can see them.)
    case 'point':
      return right ? { sx: HALF_PI + 0.5 + pitch * 0.6, sy: yaw * 0.7, sz: 0, ex: 0.05, ez: 0 } : null;
    case 'shrug':
      return { sx: 0.9, sy: 0, sz: out * 0.6, ex: 1.45, ez: out * 0.55 };
    case 'facepalm':
      return right ? { sx: 1.35, sy: 0, sz: -out * 0.4, ex: 2.3, ez: 0 } : null;
    case 'clap': {
      // Hands meet in front of the chest about three times a second.
      const apart = 0.5 + 0.5 * Math.cos(t * 20);
      return { sx: 1.75, sy: 0, sz: -out * 0.2, ex: 0.95, ez: -out * (0.2 + apart * 0.4) };
    }
  }
}

/** One passenger's skeleton plus the animation state that drives it. */
export class Actor {
  readonly joints = {} as Record<JointName, THREE.Object3D>;
  readonly root = new THREE.Object3D();
  look: Look;
  /** Painted face ('' for the plain one). */
  face = '';
  seat: SeatId | null = null;
  dead = false;
  cause: DeathCause | null = null;
  restrained = false;
  hideHead = false;
  /** Where a restrained passenger stands in the rear galley. */
  restSpot: THREE.Vector3 | null = null;
  /** Not drawn at all (your own body while the camera crouches to search, or someone in the lavatory). */
  hidden = false;
  /** Crew: on their feet in the aisle, hands on the drink cart. */
  crew = false;
  /** Gone to the lavatory for the night (drawn until they reach the door), or up to the flight deck. */
  away = false;
  /** Where they sit while away (the jump seat); null for the lavatory, where they go out of sight. */
  private awaySeat: THREE.Vector3 | null = null;
  /** Moved by your camera instead of its own path (your own walk to a new seat). */
  private driven: { x: number; z: number; yaw: number; walk: number; phase: number } | null = null;
  /** Latest pose from the network (or your own camera). */
  pose: Pose | null = null;
  pointAt: THREE.Vector3 | null = null;
  /** Cutscenes: stay on your feet, look at a point, hold a pistol, hands up, or duck and brace. */
  standing = false;
  gaze: THREE.Vector3 | null = null;
  armed = false;
  handsUp = false;
  duck = false;
  private stand = 0;
  private push = 0;
  private floor = 0;
  private surrender = 0;
  private brace = 0;
  private walkAmount = 0;
  private walkPhase = 0;
  private reach = 0;
  private point = 0;
  private slump = 0;
  private bind = 0;
  private yaw = 0;
  private pitch = 0;
  private readonly slumpSide = Math.random() < 0.5 ? -1 : 1;
  /** A gesture in progress (net/emotes). */
  private emote: { id: EmoteId; from: number; seconds: number } | null = null;
  private readonly idleSeed = Math.random() * 100;
  /** A walk in progress; `free` walks (cutscenes) face where they go all the way and end on their feet. */
  private path: { curve: THREE.CatmullRomCurve3; t: number; seconds: number; free?: boolean; run?: boolean } | null = null;
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
    const hips = make('hips', this.root, 0, 0.5, 0);
    const spine = make('spine', hips, 0, 0.06, 0);
    const chest = make('chest', spine, 0, 0.28, 0);
    const neck = make('neck', chest, 0, 0.14, 0);
    make('head', neck, 0, 0.05, 0);
    for (const side of [0, 1] as Side[]) {
      const shoulder = make(`shoulder${side}`, chest, 0, 0.07, 0);
      const elbow = make(`elbow${side}`, shoulder, 0, -0.27, 0);
      make(`wrist${side}`, elbow, 0, -0.24, 0);
      const hip = make(`hip${side}`, hips, 0, -0.02, 0);
      const knee = make(`knee${side}`, hip, 0, -0.42, 0);
      make(`ankle${side}`, knee, 0, -0.42, 0);
    }
    this.shape();
  }

  /** New clothes, hair or build. */
  setLook(look: Look): void {
    this.look = look;
    this.shape();
  }

  /** Shoulders and hips spread with the build. */
  private shape(): void {
    const w = 1 + (this.look.body - 1) * 0.1;
    const j = this.joints;
    for (const side of [0, 1] as Side[]) {
      const sx = side === 0 ? -1 : 1;
      j[`shoulder${side}`].position.x = sx * 0.19 * w;
      j[`hip${side}`].position.x = sx * 0.09 * w;
    }
    j.spine.scale.set(w, 1, w);
  }

  /** Sit in a seat (or, for crew, stand behind the cart), walking there if asked. */
  place(seat: SeatId, animate: boolean): void {
    const { x, z } = seatPose(seat);
    const walk = animate && this.seat !== null && !this.restrained;
    this.seat = seat;
    this.crew = grid.isAisleSpot(seat);
    this.restrained = false;
    this.restSpot = null;
    this.moveTo(new THREE.Vector3(x, 0, z + (this.crew ? 0 : 0.06)), walk);
  }

  /** Off for the night: to the lavatory door and out of sight, or through the flight deck door to the jump seat. */
  goAway(door: THREE.Vector3, sit?: THREE.Vector3): void {
    this.away = true;
    this.awaySeat = sit?.clone() ?? null;
    if (!sit) {
      this.moveTo(door, true);
      return;
    }
    const from = this.root.position.clone();
    const curve = new THREE.CatmullRomCurve3([
      from,
      new THREE.Vector3(from.x * 0.45, 0, from.z),
      new THREE.Vector3(0, 0, from.z - 0.25),
      new THREE.Vector3(0, 0, door.z),
      new THREE.Vector3(0, 0, door.z - 0.55),
      new THREE.Vector3(sit.x, 0, sit.z),
    ]);
    this.path = { curve, t: 0, seconds: 1.6 + curve.getLength() / 1.1 };
  }

  /** Back to your seat in the morning. */
  comeBack(): void {
    this.away = false;
    this.hidden = false;
    this.awaySeat = null;
    if (this.seat) this.place(this.seat, true);
  }

  /** Standing or walking (not sitting down). */
  get onFeet(): boolean {
    return this.path !== null || this.stand > 0.3;
  }

  /** Working the aisle with the cart (not while up on the flight deck). */
  private get pushing(): boolean {
    return this.crew && !this.awaySeat;
  }

  /** Stand in the rear galley, hands tied; walks there from the seat when asked. */
  restrainAt(spot: THREE.Vector3, animate: boolean): void {
    const walk = animate && this.seat !== null && !this.restrained;
    this.restrained = true;
    this.crew = false;
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
    if (Math.abs(from.x) < 0.05 && Math.abs(target.x) < 0.05) {
      // Along the aisle and nowhere else (crew walking the cart).
      const curve = new THREE.CatmullRomCurve3([from, target]);
      this.path = { curve, t: 0, seconds: 0.8 + curve.getLength() / 1.1 };
      return;
    }
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

  /** Wave, point, shrug, facepalm or clap, starting now. */
  playEmote(id: EmoteId, time: number): void {
    this.emote = { id, from: time, seconds: EMOTE_BY_ID[id].seconds };
  }

  /** The gesture playing and how far in (and how strongly: it eases in and out), if any. */
  private gestureNow(time: number): { id: EmoteId; t: number; amount: number } | null {
    const g = this.emote;
    if (!g) return null;
    const t = time - g.from;
    if (t >= g.seconds || this.dead || this.restrained) {
      this.emote = null;
      return null;
    }
    const amount = Math.min(1, t / 0.25, (g.seconds - t) / 0.35);
    return { id: g.id, t, amount: amount * amount * (3 - 2 * amount) };
  }

  /** Walk (or run) from where you are through `points` in `seconds`, and stay standing at the end. */
  walkAlong(points: THREE.Vector3[], seconds: number, run = false): void {
    this.driven = null;
    this.standing = true;
    const start = this.root.position.clone();
    this.path = { curve: new THREE.CatmullRomCurve3([start, ...points], false, 'centripetal', 0.5), t: 0, seconds, free: true, run };
  }

  /** Where the eyes are, in the same space as the root. */
  eyes(out = new THREE.Vector3()): THREE.Vector3 {
    this.joints.head.updateWorldMatrix(true, false);
    return out.set(0, 0.11, -0.06).applyMatrix4(this.joints.head.matrixWorld);
  }

  /** Follow the camera rig (or stop following it and sit where you belong). */
  drive(d: { x: number; z: number; yaw: number; walk: number; phase: number } | null): void {
    if (d) {
      this.driven = d;
      this.path = null;
    } else if (this.driven) {
      this.driven = null;
      this.snapHome();
    }
  }

  /** Straight to your seat (or your spot in the rear galley). */
  snapHome(): void {
    this.path = null;
    this.root.rotation.y = 0;
    if (this.seat) {
      const { x, z } = seatPose(this.seat);
      this.root.position.set(x, 0, z + 0.06);
    } else if (this.restSpot) {
      this.root.position.copy(this.restSpot);
    }
  }

  update(dt: number, time: number): void {
    // Where the body is: following your camera, walking a path, or sitting still.
    let moving = false;
    const d = this.driven;
    if (d) {
      this.root.position.set(d.x, 0, d.z);
      this.root.rotation.y = d.yaw;
      moving = d.walk > 0.05;
    } else if (this.path?.free) {
      // A cutscene walk: set off, keep going, face the way you go, stop on your feet.
      const p = this.path;
      p.t = Math.min(1, p.t + dt / p.seconds);
      const ease = p.run ? 0.08 : 0.15;
      const u = p.t < ease ? (p.t * p.t) / (2 * ease * (1 - ease)) : p.t > 1 - ease ? 1 - (1 - p.t) ** 2 / (2 * ease * (1 - ease)) : (p.t - ease / 2) / (1 - ease);
      const point = p.curve.getPointAt(Math.min(1, Math.max(0, u)));
      const ahead = p.curve.getPointAt(Math.min(1, Math.max(0, u) + 0.02));
      this.root.position.copy(point);
      if (ahead.distanceToSquared(point) > 1e-6) {
        const facing = Math.atan2(-(ahead.x - point.x), -(ahead.z - point.z));
        const turn = Math.atan2(Math.sin(facing - this.root.rotation.y), Math.cos(facing - this.root.rotation.y));
        this.root.rotation.y += turn * Math.min(1, dt * 10);
      }
      moving = p.t < 0.97;
      if (p.t >= 1) this.path = null;
    } else if (this.path) {
      const p = this.path;
      p.t = Math.min(1, p.t + dt / p.seconds);
      const u = p.t < 0.5 ? 2 * p.t * p.t : 1 - (-2 * p.t + 2) ** 2 / 2;
      const point = p.curve.getPointAt(u);
      const ahead = p.curve.getPointAt(Math.min(1, u + 0.02));
      this.root.position.copy(point);
      // Face forward to get up and to sit down; face the way you walk in between.
      if (ahead.distanceToSquared(point) > 1e-6 && p.t > 0.12 && p.t < 0.8) {
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
        // In through the lavatory door (a jump seat guest stays in sight, sitting down).
        if (this.away && !this.awaySeat) this.hidden = true;
      }
    }

    const wantsStand =
      d || this.restrained || this.standing || this.pushing || (this.path !== null && this.path.t > 0.04 && this.path.t < 0.96) ? 1 : 0;
    this.stand = approach(this.stand, this.dead ? 0 : wantsStand, 5, dt);
    // Crew push the cart with both hands; a stewardess who dies in the aisle ends up on the floor.
    this.push = approach(this.push, this.pushing && !this.dead && !d ? 1 : 0, 5, dt);
    this.floor = approach(this.floor, this.crew && this.dead ? 1 : 0, 3, dt);
    const running = this.path?.run ? 1.8 : 1;
    this.walkAmount = approach(this.walkAmount, d ? d.walk : moving ? running : 0, 6, dt);
    // Your own legs keep step with the camera's footfalls.
    if (d) this.walkPhase = d.phase;
    else this.walkPhase += dt * 7 * Math.min(1, this.walkAmount) * (this.walkAmount > 1.2 ? 1.7 : 1);
    this.surrender = approach(this.surrender, this.handsUp && !this.dead ? 1 : 0, 5, dt);
    this.brace = approach(this.brace, this.duck && !this.dead ? 1 : 0, 5, dt);
    const wantsReach = !this.dead && !this.restrained && this.stand < 0.2 && this.pose?.lean ? 1 : 0;
    this.reach = approach(this.reach, wantsReach, 5, dt);
    this.point = approach(this.point, this.pointAt && !this.dead && !this.restrained ? 1 : 0, 4, dt);
    this.slump = approach(this.slump, this.dead ? 1 : 0, 2.5, dt);
    this.bind = approach(this.bind, this.restrained ? 1 : 0, 4, dt);

    // Head: follow the network pose, or drift idly.
    const idleYaw = Math.sin(time * 0.21 + this.idleSeed) * 0.45 + Math.sin(time * 0.53 + this.idleSeed * 2) * 0.15;
    const idlePitch = -0.12 + Math.sin(time * 0.37 + this.idleSeed) * 0.08;
    const posed = this.pose && !this.path && !d ? this.pose : null;
    let targetYaw = posed ? Math.max(-1.6, Math.min(1.6, posed.yaw)) : this.path || d ? 0 : idleYaw;
    let targetPitch = posed ? posed.pitch : this.path || d ? -0.08 : idlePitch;
    // Looking at something (in cutscenes): turn the head (and a little of the body) towards it.
    if (this.gaze && !this.dead) {
      const eye = this.root.position.clone().add(new THREE.Vector3(0, this.stand > 0.5 ? 1.6 : 1.18, 0));
      const to = this.gaze.clone().sub(eye);
      const heading = Math.atan2(-to.x, -to.z) - this.root.rotation.y;
      targetYaw = Math.max(-1.7, Math.min(1.7, Math.atan2(Math.sin(heading), Math.cos(heading))));
      targetPitch = Math.max(-0.9, Math.min(0.6, Math.atan2(to.y, Math.hypot(to.x, to.z))));
    }
    if (this.brace > 0.01) targetPitch = lerp(targetPitch, -0.7, this.brace);
    this.yaw = approach(this.yaw, targetYaw, 10, dt);
    this.pitch = approach(this.pitch, targetPitch, 10, dt);

    const j = this.joints;
    const s = this.stand;
    const alive = 1 - this.slump;
    const swing = Math.sin(this.walkPhase) * this.walkAmount;
    j.hips.position.y = lerp(lerp(0.5, 0.92, s), 0.14, this.floor) + Math.abs(Math.sin(this.walkPhase)) * 0.02 * this.walkAmount;
    j.spine.rotation.set(
      lerp(0.1, 0.03, s) - this.reach * 0.16 - this.slump * 0.75 - this.bind * 0.05 - this.brace * 0.8,
      this.yaw * 0.3 * alive,
      this.slump * this.slumpSide * 0.25,
    );
    j.chest.scale.y = 1 + Math.sin(time * 1.6 + this.idleSeed) * 0.012 * alive;
    const gest = this.gestureNow(time);
    // Heads join in: down into the palm, or a tilt with the shrug.
    const headDown = gest?.id === 'facepalm' ? 0.45 * gest.amount : 0;
    const headShake = gest?.id === 'facepalm' ? Math.sin(gest.t * 5) * 0.12 * gest.amount : 0;
    const headTilt = gest?.id === 'shrug' ? 0.18 * gest.amount : 0;
    j.head.rotation.set(
      this.pitch * 0.8 * alive - this.slump * 0.6 - this.bind * 0.25 - headDown,
      this.yaw * 0.7 * alive + headShake,
      this.slump * this.slumpSide * 0.3 + headTilt,
      'YXZ',
    );

    for (const side of [0, 1] as Side[]) {
      const sign = side === 0 ? 1 : -1;
      j[`hip${side}`].rotation.x = lerp(HALF_PI, 0, s) + swing * 0.5 * sign;
      j[`knee${side}`].rotation.x =
        lerp(lerp(-HALF_PI, 0, s), -0.2, this.floor) - Math.max(0, Math.sin(this.walkPhase + (side === 0 ? 0 : Math.PI))) * 0.7 * this.walkAmount;
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
      // Hands up (held at gunpoint), or hands over the head (bracing, heads down).
      shoulderX = lerp(shoulderX, 2.55, this.surrender);
      shoulderZ = lerp(shoulderZ, -sign * 0.45, this.surrender);
      elbowX = lerp(elbowX, 0.45, this.surrender);
      elbowZ = lerp(elbowZ, 0, this.surrender);
      shoulderX = lerp(shoulderX, 2.3, this.brace);
      shoulderZ = lerp(shoulderZ, -sign * 0.2, this.brace);
      elbowX = lerp(elbowX, 1.9, this.brace);
      elbowZ = lerp(elbowZ, 0, this.brace);
      // Hands on the cart's handle, just ahead and below.
      shoulderX = lerp(shoulderX, 0.72, this.push);
      shoulderZ = lerp(shoulderZ, -sign * 0.12, this.push);
      elbowX = lerp(elbowX, 0.4, this.push);
      elbowZ = lerp(elbowZ, 0, this.push);
      shoulderX = lerp(shoulderX, 0.12, this.slump);
      elbowX = lerp(elbowX, 0.35, this.slump);
      let shoulderY = 0;
      const arm = gest ? gesture(gest.id, side, gest.t, this.yaw, this.pitch) : null;
      if (gest && arm) {
        shoulderX = lerp(shoulderX, arm.sx, gest.amount);
        shoulderY = arm.sy * gest.amount;
        shoulderZ = lerp(shoulderZ, arm.sz, gest.amount);
        elbowX = lerp(elbowX, arm.ex, gest.amount);
        elbowZ = lerp(elbowZ, arm.ez, gest.amount);
      }
      // (Turning a raised arm left or right happens last, so a pointing arm swings round with the head.)
      shoulder.rotation.set(shoulderX, shoulderY, shoulderZ, 'YXZ');
      shoulder.position.y = 0.07 + (gest?.id === 'shrug' ? 0.045 * gest.amount : 0);
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
  /** Actors who are not players (the police, in an ending): `sync` leaves them alone. */
  private readonly extras = new Set<string>();
  /** Stand-ins only the cabin cameras see (last night's tape). */
  private readonly cameraOnly = new Set<string>();
  /** Players the cameras leave out while a tape plays (their stand-ins sit in for them). */
  private cameraHide = new Set<string>();
  private cameraPass = false;
  private readonly free: number[] = [];
  /** Stable standing spot per restrained passenger. */
  private readonly rearSlots = new Map<string, number>();
  /** Painted faces, one small mesh each (every face has its own picture). */
  private readonly decals = new Map<string, { mesh: THREE.Mesh; texture: THREE.CanvasTexture; material: THREE.MeshStandardMaterial }>();
  private readonly faceGeometry = faceGeometry();
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

  /** Anyone (drawn, and on their feet) within `radius` of a point on the floor. */
  anyNear(point: THREE.Vector3, radius: number): boolean {
    for (const actor of this.actors.values()) {
      if (actor.hidden || !actor.onFeet) continue;
      const p = actor.root.position;
      if (Math.hypot(p.x - point.x, p.z - point.z) < radius) return true;
    }
    return false;
  }

  /**
   * Someone who is not a player, standing at `at` (the police, in an ending), or a stand-in only the cabin cameras
   * see. Null if the cabin is full.
   */
  extra(id: string, look: Look, at: THREE.Vector3, face = '', cameraOnly = false): Actor | null {
    const existing = this.actors.get(id);
    if (existing) return existing;
    const slot = this.free.pop();
    if (slot === undefined) return null;
    const actor = new Actor(look);
    actor.standing = true;
    actor.root.position.copy(at);
    this.actors.set(id, actor);
    this.slots.set(id, slot);
    this.extras.add(id);
    if (cameraOnly) this.cameraOnly.add(id);
    this.paint(id);
    if (face) this.setFace(id, actor, face);
    return actor;
  }

  /** Take an extra away again. */
  dropExtra(id: string): void {
    const actor = this.actors.get(id);
    if (!actor || !this.extras.has(id)) return;
    this.hide(id);
    this.setFace(id, actor, '');
    this.free.push(this.slots.get(id)!);
    this.slots.delete(id);
    this.actors.delete(id);
    this.extras.delete(id);
    this.cameraOnly.delete(id);
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Kill (or bring back) an extra: the flight recorder's stand-ins fall when the reel reaches their death. */
  setDead(id: string, dead: boolean, cause: DeathCause | null): void {
    const actor = this.actors.get(id);
    if (!actor || !this.extras.has(id) || (actor.dead === dead && actor.cause === cause)) return;
    actor.dead = dead;
    actor.cause = cause;
    this.paint(id);
  }

  /** Players the cameras leave out while their stand-ins sit in for them (empty when no tape plays). */
  setCameraHide(ids: Iterable<string>): void {
    this.cameraHide = new Set(ids);
  }

  /** Draw for the cabin cameras (true) or for your own eyes (false): swaps camera-only stand-ins and the people they stand in for. */
  cameraView(on: boolean): void {
    if (this.cameraPass === on) return;
    this.cameraPass = on;
    if (this.cameraOnly.size === 0 && this.cameraHide.size === 0) return;
    for (const [id, actor] of this.actors) if (this.cameraOnly.has(id) || this.cameraHide.has(id)) this.write(id, actor);
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Match the cabin to the game: create, seat, walk, kill or restrain passengers.
   * `rearSpot(i)` gives where the i-th restrained passenger stands; `faces` has painted faces by player.
   */
  sync(
    players: PlayerSummary[],
    youId: string | null,
    rearSpot: (index: number) => THREE.Vector3,
    faces: ReadonlyMap<string, string> | null = null,
    away: { id: string; door: THREE.Vector3; sit?: THREE.Vector3 }[] = [],
  ): void {
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
      if (!sameLook(actor.look, p.look)) {
        actor.setLook(p.look);
        this.paint(p.id);
      }
      const face = faces?.get(p.id) ?? '';
      if (face !== actor.face) this.setFace(p.id, actor, face);
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
      // Off to the lavatory or the flight deck for the night, and back at dawn (those who died in there stay out of sight).
      // (Your own body goes up to the jump seat with you; to the lavatory it stays behind.)
      const trip = away.find((a) => a.id === p.id);
      const gone = !!trip && (p.id !== youId || !!trip.sit) && p.status === 'alive';
      if (trip && gone && !actor.away) actor.goAway(trip.door, trip.sit);
      else if (!gone && actor.away && p.status !== 'dead') actor.comeBack();
      const dead = p.status === 'dead';
      if (dead !== actor.dead || p.cause !== actor.cause) {
        actor.dead = dead;
        actor.cause = p.cause;
        this.paint(p.id);
      }
    }
    for (const id of [...this.actors.keys()]) {
      if (seen.has(id) || this.extras.has(id)) continue;
      this.hide(id);
      this.setFace(id, this.actors.get(id)!, '');
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
    for (const [id, actor] of this.actors) this.setFace(id, actor, '');
    this.faceGeometry.dispose();
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    const materials = new Set(this.parts.map((p) => p.material));
    for (const material of materials) material.dispose();
  }

  private write(id: string, actor: Actor): void {
    const slot = this.slots.get(id)!;
    // Your camera travels on its own path, so your body only shows once you have arrived (or while it follows you).
    const offCamera = this.cameraPass ? this.cameraHide.has(id) : this.cameraOnly.has(id);
    const hideBody = actor.hidden || offCamera || (actor.hideHead && actor.walking);
    const look = actor.look;
    this.parts.forEach((part, index) => {
      const mesh = this.meshes[index];
      part.joints.forEach((joint, k) => {
        const i = slot * part.joints.length + k;
        const hidden =
          hideBody ||
          (part.head && actor.hideHead) ||
          (part.hair !== undefined && part.hair !== look.hair % HAIR_STYLES.length) ||
          (part.outfit !== undefined && part.outfit !== look.topStyle) ||
          (part.armed && !actor.armed) ||
          (part.accessory !== undefined && (look[part.accessory.slot] ?? 0) !== part.accessory.index) ||
          // A painted face brings its own eyes.
          (part.paint === 'eye' && actor.face !== '');
        if (hidden) {
          mesh.setMatrixAt(i, this.zero);
          return;
        }
        this.tmp.multiplyMatrices(actor.joints[joint].matrixWorld, part.local[k]);
        mesh.setMatrixAt(i, this.tmp);
      });
    });
    const decal = this.decals.get(id);
    if (decal) {
      decal.mesh.visible = !hideBody && !actor.hideHead;
      decal.mesh.matrix.multiplyMatrices(actor.joints.head.matrixWorld, HEAD_LOCAL);
      decal.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  /** Put a painted face on a passenger ('' for the plain one). */
  private setFace(id: string, actor: Actor, face: string): void {
    actor.face = face;
    const old = this.decals.get(id);
    if (old) {
      this.group.remove(old.mesh);
      old.texture.dispose();
      old.material.dispose();
      this.decals.delete(id);
    }
    const ink = face ? decodeFace(face) : null;
    if (!ink) {
      actor.face = '';
      return;
    }
    const texture = new THREE.CanvasTexture(paintFace(ink, 256));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      alphaTest: 0.5,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(this.faceGeometry, material);
    mesh.name = `face:${id}`;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.decals.set(id, { mesh, texture, material });
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
    const top = TOP[look.top] ?? TOP[0];
    const skin = SKIN[look.skin] ?? SKIN[0];
    // Long sleeves and hoodies cover the arms; a T-shirt bares the forearms, a tank top the whole arm.
    const palette: Record<Paint, string> = {
      top,
      upper: look.topStyle === 3 ? skin : top,
      sleeve: look.topStyle === 0 || look.topStyle === 2 ? top : skin,
      bottom: BOTTOM[look.bottom] ?? BOTTOM[0],
      skin,
      shoe: '#1c1d22',
      eye: '#141414',
      hair: HAIR_COLOR[look.hairColor] ?? HAIR_COLOR[0],
      gun: '#16181c',
    };
    this.parts.forEach((part, index) => {
      const mesh = this.meshes[index];
      this.color.set(part.color ?? palette[part.paint]);
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
