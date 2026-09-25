import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { grid, type SeatId } from '../../engine';
import { BULKHEAD_Z, CABIN_HALF_WIDTH, rowZ } from '../layout';
import { carpetTexture, seatbeltSignTexture, signTexture, skyTexture } from '../textures';
import type { LavatoryBox } from './lavatory';

const WALL_X = CABIN_HALF_WIDTH - 0.02;
const WINDOW_Y = 1.14;
const WINDOW_W = 0.24;
const WINDOW_H = 0.34;
const BIN_BOTTOM = 1.62;
const BIN_DEPTH = 0.95;
const CEILING_Y = 2.2;
/** Galley space visible past the front curtain. */
const GALLEY_LENGTH = 1.8;
const REAR_ZONE = 1.5;

export interface CabinParts {
  group: THREE.Group;
  /** Cove and ceiling strips (bright by day, dim at night). */
  cove: THREE.MeshStandardMaterial;
  /** Aisle path lighting (off by day, on at night). */
  floorLights: THREE.MeshStandardMaterial;
  exitSigns: THREE.MeshStandardMaterial;
  /** Shared window glass materials (a few, with different sky offsets). */
  windowGlass: THREE.MeshBasicMaterial[];
  skyDay: THREE.CanvasTexture;
  skyNight: THREE.CanvasTexture;
  /** Reading lights, one per seat, drawn as a single instanced mesh. */
  readingLights: { seats: SeatId[]; set(seat: SeatId, on: boolean): void };
  /** Light the seatbelt sign above one row side ("12L" / "12R"), or none. */
  lightSeatbelt(key: string | null): void;
  lavatoryDoor: THREE.Mesh;
  /** The lavatory's box (its inside is built separately, for nights spent in there). */
  lavatory: LavatoryBox;
  frontZ: number;
  rearZ: number;
}

function roundedRect(path: THREE.Shape | THREE.Path, cx: number, cy: number, w: number, h: number, r: number): void {
  const x = cx - w / 2;
  const y = cy - h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

/** Collect transformed geometries per material and merge them into one mesh each. */
class Batcher {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    const list = this.parts.get(material) ?? [];
    list.push(g);
    this.parts.set(material, list);
  }

  build(group: THREE.Group, shadows = true): void {
    for (const [material, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.receiveShadow = shadows;
      mesh.castShadow = false;
      group.add(mesh);
    }
  }
}

const m4 = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));

export function buildCabin(rows: number): CabinParts {
  const group = new THREE.Group();
  group.name = 'cabin';
  const frontZ = BULKHEAD_Z;
  const rearPartitionZ = rowZ(rows) + 0.62;
  const rearZ = rearPartitionZ + REAR_ZONE;
  const startZ = frontZ - GALLEY_LENGTH;
  const length = rearZ - startZ;
  const midZ = (startZ + rearZ) / 2;

  const wall = new THREE.MeshStandardMaterial({ color: '#c3c7cf', roughness: 0.6 });
  const wallLow = new THREE.MeshStandardMaterial({ color: '#9aa1ad', roughness: 0.75 });
  const binMat = new THREE.MeshStandardMaterial({ color: '#cfd2d8', roughness: 0.45 });
  const trim = new THREE.MeshStandardMaterial({ color: '#7b8492', roughness: 0.35, metalness: 0.4 });
  const seam = new THREE.MeshStandardMaterial({ color: '#8d939e', roughness: 0.8 });
  const frameMat = new THREE.MeshStandardMaterial({ color: '#c4c8cf', roughness: 0.5 });
  const shadeMat = new THREE.MeshStandardMaterial({ color: '#ece8de', roughness: 0.7, side: THREE.DoubleSide });
  const curtain = new THREE.MeshStandardMaterial({ color: '#1f2b4d', roughness: 0.95, side: THREE.DoubleSide });
  const psuMat = new THREE.MeshStandardMaterial({ color: '#c9cdd4', roughness: 0.55 });
  const carpet = new THREE.MeshStandardMaterial({ map: carpetTexture(length), roughness: 0.96 });

  const cove = new THREE.MeshStandardMaterial({ color: '#0b0d12', emissive: '#e9f0ff', emissiveIntensity: 1.4 });
  const floorLights = new THREE.MeshStandardMaterial({ color: '#0b0d12', emissive: '#bcd3ff', emissiveIntensity: 0.1 });
  const exitSigns = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveIntensity: 1.6, map: signTexture('EXIT', '#6bff9a', '#062812'), emissiveMap: signTexture('EXIT', '#6bff9a', '#062812') });
  const readingMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const beltTexture = seatbeltSignTexture();
  const seatbeltOff = new THREE.MeshStandardMaterial({ color: '#15181e', map: beltTexture, emissive: '#000' });
  const seatbeltOn = new THREE.MeshStandardMaterial({ color: '#15181e', map: beltTexture, emissive: '#ffffff', emissiveMap: beltTexture, emissiveIntensity: 2.2 });

  const skyDay = skyTexture(false);
  const skyNight = skyTexture(true);
  const windowGlass = [0, 0.33, 0.66].map((offset) => {
    const map = skyDay.clone();
    map.offset.x = offset;
    map.needsUpdate = true;
    return new THREE.MeshBasicMaterial({ map });
  });

  const statics = new Batcher();
  const windowBatches = windowGlass.map(() => new Batcher());

  // Floor (carpet) and the lower side walls.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(CABIN_HALF_WIDTH * 2, length), carpet);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, midZ);
  floor.receiveShadow = true;
  group.add(floor);

  for (const side of [-1, 1]) {
    const ry = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    statics.add(new THREE.PlaneGeometry(length, 0.8), wallLow, m4(side * WALL_X, 0.4, midZ, ry));
    statics.add(new THREE.PlaneGeometry(length, 0.08), trim, m4(side * (WALL_X - 0.005), 0.8, midZ, ry));
    // Band between the windows and the bins.
    statics.add(new THREE.PlaneGeometry(length, 0.1), wall, m4(side * WALL_X, BIN_BOTTOM - 0.02, midZ, ry));
    // Floor light strips along both edges of the aisle.
    statics.add(new THREE.BoxGeometry(0.02, 0.012, length), floorLights, m4(side * 0.27, 0.006, midZ));
  }

  // Window panels with openings, frames, glass and shades: one per row per side.
  const panelH = BIN_BOTTOM - 0.07 - 0.8;
  const panelShape = new THREE.Shape();
  roundedRect(panelShape, 0, 0.8 + panelH / 2, 0.82, panelH, 0.001);
  const hole = new THREE.Path();
  roundedRect(hole, 0, WINDOW_Y, WINDOW_W, WINDOW_H, 0.09);
  panelShape.holes.push(hole);
  const panelGeometry = new THREE.ShapeGeometry(panelShape, 12);
  const frameShape = new THREE.Shape();
  roundedRect(frameShape, 0, WINDOW_Y, WINDOW_W + 0.05, WINDOW_H + 0.05, 0.11);
  const frameHole = new THREE.Path();
  roundedRect(frameHole, 0, WINDOW_Y, WINDOW_W, WINDOW_H, 0.09);
  frameShape.holes.push(frameHole);
  const frameGeometry = new THREE.ShapeGeometry(frameShape, 12);
  const glassGeometry = new THREE.PlaneGeometry(WINDOW_W + 0.04, WINDOW_H + 0.04);
  const shadeGeometry = new THREE.PlaneGeometry(WINDOW_W + 0.01, 1);
  const random = (() => {
    let s = 99;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  })();

  for (let row = 1; row <= rows; row++) {
    const z = rowZ(row) - 0.05;
    for (const side of [-1, 1]) {
      const ry = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      statics.add(panelGeometry, wall, m4(side * WALL_X, 0, z, ry));
      statics.add(frameGeometry, frameMat, m4(side * (WALL_X - 0.004), 0, z, ry));
      const glassIndex = (row + (side > 0 ? 1 : 0)) % windowGlass.length;
      windowBatches[glassIndex].add(glassGeometry, windowGlass[glassIndex], m4(side * (WALL_X + 0.05), WINDOW_Y, z, ry));
      const drawn = random() < 0.35 ? 0.15 + random() * 0.75 : random() * 0.12;
      if (drawn > 0.02) {
        const h = (WINDOW_H + 0.02) * drawn;
        const shade = shadeGeometry.clone();
        shade.scale(1, h, 1);
        statics.add(shade, shadeMat, m4(side * (WALL_X + 0.025), WINDOW_Y + (WINDOW_H + 0.02) / 2 - h / 2, z, ry));
      }
    }
  }
  // Plain wall panels in front of row 1 and behind the last row.
  for (const side of [-1, 1]) {
    const ry = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const h = BIN_BOTTOM - 0.07 - 0.8;
    const frontLen = rowZ(1) - 0.46 - startZ;
    statics.add(new THREE.PlaneGeometry(frontLen, h), wall, m4(side * WALL_X, 0.8 + h / 2, startZ + frontLen / 2, ry));
    const backStart = rowZ(rows) + 0.36;
    statics.add(new THREE.PlaneGeometry(rearZ - backStart, h), wall, m4(side * WALL_X, 0.8 + h / 2, (backStart + rearZ) / 2, ry));
  }

  // Overhead bins, seams, cove lights and the ceiling.
  const binLength = rearPartitionZ - frontZ - 0.1;
  const binZ = (frontZ + rearPartitionZ) / 2;
  const binGeometry = new RoundedBoxGeometry(BIN_DEPTH, 0.46, binLength, 3, 0.06);
  for (const side of [-1, 1]) {
    const binX = side * (CABIN_HALF_WIDTH - BIN_DEPTH / 2);
    statics.add(binGeometry, binMat, m4(binX, BIN_BOTTOM + 0.23, binZ));
    const face = binX - side * (BIN_DEPTH / 2 + 0.002);
    for (let z = frontZ + 0.8; z < rearPartitionZ - 0.4; z += 1.64) {
      statics.add(new THREE.BoxGeometry(0.004, 0.42, 0.012), seam, m4(face, BIN_BOTTOM + 0.23, z));
    }
    statics.add(new THREE.BoxGeometry(0.03, 0.02, binLength), cove, m4(side * (CABIN_HALF_WIDTH - BIN_DEPTH - 0.02), BIN_BOTTOM + 0.47, binZ));
    // Sloped ceiling panel from the bin tops up to the flat centre (tilt after laying it flat).
    const binInner = CABIN_HALF_WIDTH - BIN_DEPTH;
    const run = binInner - 0.6;
    const rise = CEILING_Y - (BIN_BOTTOM + 0.46);
    const slopeMatrix = new THREE.Matrix4()
      .makeRotationZ(side * Math.atan2(rise, run))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
      .setPosition(side * (0.6 + run / 2), CEILING_Y - rise / 2, midZ);
    statics.add(new THREE.PlaneGeometry(Math.hypot(run, rise) + 0.02, length), wall, slopeMatrix);
    // Wall above the bins (hidden mostly, closes the gap).
    statics.add(new THREE.PlaneGeometry(length, 0.3), wall, m4(side * WALL_X, CEILING_Y - 0.1, midZ, side < 0 ? Math.PI / 2 : -Math.PI / 2));
  }
  statics.add(new THREE.PlaneGeometry(1.2, length), wall, m4(0, CEILING_Y, midZ, 0, Math.PI / 2));
  for (const side of [-1, 1]) {
    statics.add(new THREE.BoxGeometry(0.02, 0.01, length - 0.2), cove, m4(side * 0.58, CEILING_Y - 0.006, midZ));
  }

  // Passenger service units under the bins: reading lights and seatbelt signs.
  const readingSeats: SeatId[] = [];
  const readingMatrices: THREE.Matrix4[] = [];
  const signKeys: string[] = [];
  const signMatrices: THREE.Matrix4[] = [];
  const discGeometry = new THREE.CircleGeometry(0.024, 16);
  const signGeometry = new THREE.PlaneGeometry(0.1, 0.05);
  const faceDown = Math.PI / 2;
  for (let row = 1; row <= rows; row++) {
    const z = rowZ(row) - 0.08;
    for (const side of [-1, 1]) {
      const psuX = side * (CABIN_HALF_WIDTH - BIN_DEPTH / 2);
      statics.add(new THREE.BoxGeometry(BIN_DEPTH - 0.04, 0.02, 0.34), psuMat, m4(psuX, BIN_BOTTOM - 0.01, z));
      const cols = side < 0 ? [0, 1, 2] : [4, 5, 6];
      for (const col of cols) {
        // Aisle seat nearest the aisle end of the panel, window seat nearest the wall.
        const fromAisle = side < 0 ? 2 - col : col - 4;
        readingSeats.push(grid.seatId({ row, col }));
        readingMatrices.push(m4(side * (CABIN_HALF_WIDTH - BIN_DEPTH + 0.1 + fromAisle * 0.22), BIN_BOTTOM - 0.021, z - 0.06, 0, faceDown));
      }
      signKeys.push(`${row}${side < 0 ? 'L' : 'R'}`);
      signMatrices.push(m4(side * (CABIN_HALF_WIDTH - BIN_DEPTH + 0.2), BIN_BOTTOM - 0.022, z + 0.1, 0, faceDown));
    }
  }

  // Front bulkhead with the galley curtain and an exit sign (and a galley side, seen from the flight deck).
  const opening = 0.46;
  for (const side of [-1, 1]) {
    const w = CABIN_HALF_WIDTH - opening;
    statics.add(new THREE.PlaneGeometry(w, CEILING_Y), wall, m4(side * (opening + w / 2), CEILING_Y / 2, frontZ));
    statics.add(new THREE.PlaneGeometry(w, CEILING_Y), wall, m4(side * (opening + w / 2), CEILING_Y / 2, frontZ - 0.01, Math.PI));
  }
  statics.add(new THREE.PlaneGeometry(opening * 2, 0.22), wall, m4(0, CEILING_Y - 0.11, frontZ));
  statics.add(new THREE.PlaneGeometry(opening * 2, 0.22), wall, m4(0, CEILING_Y - 0.11, frontZ - 0.01, Math.PI));
  const curtainGeometry = new THREE.PlaneGeometry(opening * 2, CEILING_Y - 0.22, 48, 1);
  const pos = curtainGeometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 34) * 0.025);
  curtainGeometry.computeVertexNormals();
  const curtainMesh = new THREE.Mesh(curtainGeometry, curtain);
  curtainMesh.position.set(0, (CEILING_Y - 0.22) / 2, frontZ - 0.12);
  group.add(curtainMesh);
  statics.add(new THREE.BoxGeometry(0.3, 0.09, 0.02), exitSigns, m4(0, CEILING_Y - 0.11, frontZ + 0.012));

  // Rear: lavatory (left), crew area (right), rear exit.
  const lavFront = rearPartitionZ;
  const lavWidth = CABIN_HALF_WIDTH - 0.3;
  const lavBox = new RoundedBoxGeometry(lavWidth, CEILING_Y - 0.02, REAR_ZONE - 0.1, 2, 0.03);
  statics.add(lavBox, wall, m4(-(0.3 + lavWidth / 2), (CEILING_Y - 0.02) / 2, lavFront + (REAR_ZONE - 0.1) / 2));
  const lavatoryDoor = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.9, 0.03), new THREE.MeshStandardMaterial({ color: '#c3c8d0', roughness: 0.5 }));
  lavatoryDoor.position.set(-(0.3 + lavWidth / 2), 0.96, lavFront - 0.01);
  group.add(lavatoryDoor);
  const wcSign = new THREE.MeshStandardMaterial({ color: '#000', map: signTexture('WC', '#e8eefb', '#18314f', 128, 64), emissive: '#ffffff', emissiveMap: signTexture('WC', '#e8eefb', '#18314f', 128, 64), emissiveIntensity: 1.2 });
  statics.add(new THREE.PlaneGeometry(0.16, 0.08), wcSign, m4(-(0.3 + lavWidth / 2), 2.0, lavFront - 0.03, Math.PI));
  const crewWall = new THREE.PlaneGeometry(CABIN_HALF_WIDTH - 0.3, CEILING_Y);
  statics.add(crewWall, wallLow, m4(0.3 + (CABIN_HALF_WIDTH - 0.3) / 2, CEILING_Y / 2, lavFront + 0.3, Math.PI));
  const crewSign = new THREE.MeshStandardMaterial({ color: '#000', map: signTexture('CREW', '#c9d4e8', '#1a1f2a', 128, 64), emissive: '#ffffff', emissiveMap: signTexture('CREW', '#c9d4e8', '#1a1f2a', 128, 64), emissiveIntensity: 0.6 });
  statics.add(new THREE.PlaneGeometry(0.2, 0.1), crewSign, m4(0.3 + (CABIN_HALF_WIDTH - 0.3) / 2, 1.9, lavFront + 0.29, Math.PI));
  statics.add(new THREE.PlaneGeometry(CABIN_HALF_WIDTH * 2, CEILING_Y), wallLow, m4(0, CEILING_Y / 2, rearZ, Math.PI));
  const rearExit = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveIntensity: 1.6, map: signTexture('EXIT', '#ff6b6b', '#2a0808'), emissiveMap: signTexture('EXIT', '#ff6b6b', '#2a0808') });
  statics.add(new THREE.BoxGeometry(0.3, 0.09, 0.02), rearExit, m4(0, CEILING_Y - 0.14, rearZ - 0.012));

  statics.build(group);
  windowBatches.forEach((batch) => batch.build(group, false));

  const lampOff = new THREE.Color('#8e929a');
  const lampOn = new THREE.Color('#ffe6b3');
  const lamps = new THREE.InstancedMesh(discGeometry, readingMat, readingMatrices.length);
  readingMatrices.forEach((m, i) => {
    lamps.setMatrixAt(i, m);
    lamps.setColorAt(i, lampOff);
  });
  group.add(lamps);
  const lampIndex = new Map(readingSeats.map((seat, i) => [seat, i]));
  const signs = new THREE.InstancedMesh(signGeometry, seatbeltOff, signMatrices.length);
  signMatrices.forEach((m, i) => signs.setMatrixAt(i, m));
  group.add(signs);
  const litSign = new THREE.Mesh(signGeometry, seatbeltOn);
  litSign.matrixAutoUpdate = false;
  litSign.visible = false;
  group.add(litSign);
  const signIndex = new Map(signKeys.map((key, i) => [key, i]));

  return {
    group,
    cove,
    floorLights,
    exitSigns,
    windowGlass,
    skyDay,
    skyNight,
    readingLights: {
      seats: readingSeats,
      set(seat, on) {
        const i = lampIndex.get(seat);
        if (i === undefined) return;
        lamps.setColorAt(i, on ? lampOn : lampOff);
        lamps.instanceColor!.needsUpdate = true;
      },
    },
    lightSeatbelt(key) {
      const i = key === null ? undefined : signIndex.get(key);
      litSign.visible = i !== undefined;
      if (i === undefined) return;
      // Sit the lit copy a hair below the dark sign.
      litSign.matrix.copy(signMatrices[i]).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.001));
      litSign.matrixWorldNeedsUpdate = true;
    },
    lavatoryDoor,
    lavatory: { minX: -(0.3 + lavWidth), maxX: -0.3, frontZ: lavFront, backZ: lavFront + REAR_ZONE - 0.1, height: CEILING_Y - 0.02 },
    frontZ,
    rearZ,
  };
}
