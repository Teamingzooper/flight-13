import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { grid, type SeatId } from '../../engine';
import { BULKHEAD_Z, colX, rowZ } from '../layout';
import { fabricTexture, idleScreenTexture } from '../textures';

/** Seatbacks lean back (toward +z) by this much. */
const RECLINE = 0.2;
/** Screens tilt up toward the passenger behind, relative to the seatback. */
const SCREEN_TILT = -0.36;
export const SCREEN_W = 0.25;
export const SCREEN_H = 0.16;

export interface SeatParts {
  group: THREE.Group;
  screenMaterial: THREE.MeshStandardMaterial;
  /** World transform of the screen in front of a seat (its passenger's screen). */
  screenMatrix(seat: SeatId): THREE.Matrix4;
  /** Hide one seat's idle screen (a live screen is drawn there instead). */
  hideScreen(seat: SeatId | null): void;
  /** Darken a seat (1 = as new, lower = scorched). */
  tint(seat: SeatId, shade: number): void;
}

const tmp = new THREE.Object3D();

function matrix(position: THREE.Vector3, rotationX = 0): THREE.Matrix4 {
  tmp.position.copy(position);
  tmp.rotation.set(rotationX, 0, 0);
  tmp.scale.set(1, 1, 1);
  tmp.updateMatrix();
  return tmp.matrix.clone();
}

/** Point in a seatback's frame (pivot at the bottom of the back) to world space. */
function onBack(x: number, z0: number, local: THREE.Vector3): THREE.Vector3 {
  const pivot = new THREE.Vector3(x, 0.5, z0 + 0.2);
  return local.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), RECLINE).add(pivot);
}

export function buildSeats(rows: number): SeatParts {
  const group = new THREE.Group();
  group.name = 'seats';
  const seats = grid.allSeats(rows);

  const fabric = new THREE.MeshStandardMaterial({ map: fabricTexture(), roughness: 0.92 });
  const headrest = new THREE.MeshStandardMaterial({ color: '#c9ced8', roughness: 0.9 });
  const shell = new THREE.MeshStandardMaterial({ color: '#2b303a', roughness: 0.45 });
  const armMat = new THREE.MeshStandardMaterial({ color: '#3a404b', roughness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: '#8b939e', roughness: 0.35, metalness: 0.6 });
  const idle = idleScreenTexture();
  const screenMaterial = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: idle, emissiveIntensity: 0.9 });

  const cushions: THREE.Matrix4[] = [];
  const backs: THREE.Matrix4[] = [];
  const shells: THREE.Matrix4[] = [];
  const headrests: THREE.Matrix4[] = [];
  const trays: THREE.Matrix4[] = [];
  const arms: THREE.Matrix4[] = [];
  const legs: THREE.Matrix4[] = [];
  const bezels: THREE.Matrix4[] = [];
  const screens: THREE.Matrix4[] = [];
  const screenIndex = new Map<SeatId, number>();
  const screenMatrices = new Map<SeatId, THREE.Matrix4>();

  for (const seat of seats) {
    const cell = grid.parseSeat(seat)!;
    const x = colX(cell.col);
    const z = rowZ(cell.row);
    cushions.push(matrix(new THREE.Vector3(x, 0.46, z - 0.02)));
    backs.push(matrix(onBack(x, z, new THREE.Vector3(0, 0.33, 0)), RECLINE));
    shells.push(matrix(onBack(x, z, new THREE.Vector3(0, 0.32, 0.05)), RECLINE));
    headrests.push(matrix(onBack(x, z, new THREE.Vector3(0, 0.55, -0.05)), RECLINE));
    trays.push(matrix(onBack(x, z, new THREE.Vector3(0, 0.2, 0.068)), RECLINE));
    legs.push(matrix(new THREE.Vector3(x - 0.15, 0.2, z - 0.08)), matrix(new THREE.Vector3(x + 0.15, 0.2, z - 0.08)));
    // Armrests: one to the left of every seat, plus the aisle/wall side of each block's last seat.
    arms.push(matrix(new THREE.Vector3(x - 0.225, 0.64, z)));
    if (cell.col === 2 || cell.col === 6) arms.push(matrix(new THREE.Vector3(x + 0.225, 0.64, z)));

    // The screen this passenger looks at: on the back of the seat ahead, or on the bulkhead for row 1.
    let screen: THREE.Matrix4;
    let bezel: THREE.Matrix4;
    if (cell.row > 1) {
      const aheadZ = rowZ(cell.row - 1);
      screen = matrix(onBack(x, aheadZ, new THREE.Vector3(0, 0.4, 0.084)), RECLINE + SCREEN_TILT);
      bezel = matrix(onBack(x, aheadZ, new THREE.Vector3(0, 0.4, 0.077)), RECLINE + SCREEN_TILT);
    } else {
      screen = matrix(new THREE.Vector3(x, 0.92, BULKHEAD_Z + 0.03), -0.12);
      bezel = matrix(new THREE.Vector3(x, 0.92, BULKHEAD_Z + 0.022), -0.12);
    }
    screenIndex.set(seat, screens.length);
    screenMatrices.set(seat, screen);
    screens.push(screen);
    bezels.push(bezel);
  }

  const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, list: THREE.Matrix4[], castShadow = true) => {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // One instance per seat, in seat order, so a seat can be darkened after a blast.
  const perSeat = [
    instanced(new RoundedBoxGeometry(0.43, 0.11, 0.46, 3, 0.045), fabric, cushions),
    instanced(new RoundedBoxGeometry(0.43, 0.66, 0.09, 3, 0.04), fabric, backs),
    instanced(new RoundedBoxGeometry(0.44, 0.64, 0.03, 2, 0.012), shell, shells),
    instanced(new RoundedBoxGeometry(0.3, 0.16, 0.012, 2, 0.005), headrest, headrests, false),
    instanced(new RoundedBoxGeometry(0.38, 0.28, 0.014, 2, 0.006), shell, trays, false),
  ];
  const seatIndex = new Map(seats.map((seat, i) => [seat, i]));
  const shade = new THREE.Color();
  instanced(new RoundedBoxGeometry(0.05, 0.05, 0.42, 2, 0.02), armMat, arms);
  instanced(new THREE.BoxGeometry(0.035, 0.4, 0.035), metal, legs, false);
  instanced(new RoundedBoxGeometry(SCREEN_W + 0.03, SCREEN_H + 0.03, 0.012, 2, 0.006), shell, bezels, false);
  const screenMesh = instanced(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), screenMaterial, screens, false);

  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let hidden: SeatId | null = null;

  return {
    group,
    screenMaterial,
    screenMatrix: (seat) => screenMatrices.get(seat)?.clone() ?? new THREE.Matrix4(),
    hideScreen(seat) {
      if (hidden === seat) return;
      if (hidden && screenIndex.has(hidden)) screenMesh.setMatrixAt(screenIndex.get(hidden)!, screenMatrices.get(hidden)!);
      hidden = seat;
      if (seat && screenIndex.has(seat)) screenMesh.setMatrixAt(screenIndex.get(seat)!, zero);
      screenMesh.instanceMatrix.needsUpdate = true;
    },
    tint(seat, amount) {
      const i = seatIndex.get(seat);
      if (i === undefined) return;
      shade.setScalar(amount);
      for (const mesh of perSeat) {
        mesh.setColorAt(i, shade);
        mesh.instanceColor!.needsUpdate = true;
      }
    },
  };
}
