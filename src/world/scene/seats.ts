import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { grid, type SeatId } from '../../engine';
import { BULKHEAD_Z, colX, rowZ } from '../layout';
import { fabricTexture, idleScreenTexture } from '../textures';
import { withDetail } from '../graphics';
import { cardFrontTexture, magazineTexture } from '../sets/safetyCardArt';

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
  /** Hide the safety card in the pocket a seat's passenger faces (a hand is holding the real one). */
  hideCard(seat: SeatId | null): void;
  /** Where the card in that pocket stands (its bottom edge's centre, facing its passenger), or null (row 1). */
  pocketCard(seat: SeatId): THREE.Matrix4 | null;
}

/** The literature pocket on each seatback, in the back's own frame (below the pivot, as the lower shell hangs). */
export const POCKET = { y: -0.13, z: 0.078, w: 0.34, h: 0.2 } as const;
/** The laminated safety card, and how far into its pocket it sits (its top edge shows above the pocket's lip). */
export const SAFETY_CARD = { w: 0.32, h: 0.22, bottom: POCKET.y - POCKET.h / 2 + 0.012, z: 0.068 } as const;

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

/** Every seat in the cabin (`cols`: the plane's seat columns; `leather`: the private jet's cream leather). */
export function buildSeats(rows: number, cols: readonly number[] = grid.SEAT_COLS, leather = false): SeatParts {
  const group = new THREE.Group();
  group.name = 'seats';
  const seats = grid.allSeats(rows, cols);
  // The last seat of each block (by the aisle on the left, by the wall on the right) has an armrest on both sides.
  const leftEnd = Math.max(...cols.filter((c) => c < grid.AISLE_COL));
  const rightEnd = Math.max(...cols);

  // (Surface detail, when the graphics setting has it: woven cloth or pebbled leather, moulded plastic.)
  const fabric = leather
    ? withDetail(new THREE.MeshStandardMaterial({ color: '#e6d8bd', roughness: 0.48 }), 'leather', [3, 3], 0.5)
    : withDetail(new THREE.MeshStandardMaterial({ map: fabricTexture(), roughness: 0.92 }), 'fabric', [3, 3], 0.6);
  const headrest = withDetail(
    new THREE.MeshStandardMaterial({ color: leather ? '#d6c3a0' : '#c9ced8', roughness: leather ? 0.5 : 0.9 }),
    leather ? 'leather' : 'fabric',
    [2, 2],
    0.4,
  );
  const shell = withDetail(new THREE.MeshStandardMaterial({ color: '#2b303a', roughness: 0.45 }), 'plastic', [2, 2], 0.25);
  const armMat = withDetail(new THREE.MeshStandardMaterial({ color: '#3a404b', roughness: 0.5 }), 'plastic', [1, 1], 0.25);
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
  const lowerShells: THREE.Matrix4[] = [];
  const pockets: THREE.Matrix4[] = [];
  const bands: THREE.Matrix4[] = [];
  const cards: THREE.Matrix4[] = [];
  const magazines: THREE.Matrix4[] = [];
  const bags: THREE.Matrix4[] = [];
  /** Each seat's own card, by the seat whose back it is in. */
  const cardMatrices = new Map<SeatId, THREE.Matrix4>();

  for (const seat of seats) {
    const cell = grid.parseSeat(seat)!;
    const x = colX(cell.col);
    const z = rowZ(cell.row);
    cushions.push(matrix(new THREE.Vector3(x, 0.46, z - 0.02)));
    backs.push(matrix(onBack(x, z, new THREE.Vector3(0, 0.33, 0)), RECLINE));
    shells.push(matrix(onBack(x, z, new THREE.Vector3(0, 0.32, 0.05)), RECLINE));
    headrests.push(matrix(onBack(x, z, new THREE.Vector3(0, 0.55, -0.05)), RECLINE));
    trays.push(matrix(onBack(x, z, new THREE.Vector3(0, 0.2, 0.068)), RECLINE));
    // Below the back, its shell comes down to the seat frame, with the literature pocket on it and the top of the
    // safety card showing above the pocket's lip.
    lowerShells.push(matrix(onBack(x, z, new THREE.Vector3(0, -0.13, 0.045)), RECLINE));
    pockets.push(matrix(onBack(x, z, new THREE.Vector3(0, POCKET.y, POCKET.z)), RECLINE));
    bands.push(matrix(onBack(x, z, new THREE.Vector3(0, POCKET.y + POCKET.h / 2 - 0.006, POCKET.z + 0.004)), RECLINE));
    const card = matrix(onBack(x, z, new THREE.Vector3(0, SAFETY_CARD.bottom, SAFETY_CARD.z)), RECLINE);
    cards.push(card);
    cardMatrices.set(seat, card);
    // Behind the card: the inflight magazine, and a sick bag.
    magazines.push(matrix(onBack(x, z, new THREE.Vector3(-0.055, SAFETY_CARD.bottom, SAFETY_CARD.z - 0.004)), RECLINE));
    bags.push(matrix(onBack(x, z, new THREE.Vector3(0.1, SAFETY_CARD.bottom, SAFETY_CARD.z - 0.007)), RECLINE));
    legs.push(matrix(new THREE.Vector3(x - 0.15, 0.2, z - 0.08)), matrix(new THREE.Vector3(x + 0.15, 0.2, z - 0.08)));
    // Armrests: one to the left of every seat, plus the aisle/wall side of each block's last seat.
    arms.push(matrix(new THREE.Vector3(x - 0.225, 0.64, z)));
    if (cell.col === leftEnd || cell.col === rightEnd) arms.push(matrix(new THREE.Vector3(x + 0.225, 0.64, z)));

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
  const pocketCloth = withDetail(new THREE.MeshStandardMaterial({ color: '#39404d', roughness: 0.95 }), 'fabric', [4, 2], 0.8);
  const band = new THREE.MeshStandardMaterial({ color: '#4d5564', roughness: 0.7 });
  // The laminated card: glossy, its top strip (the header) all that shows.
  const cardMaterial = new THREE.MeshStandardMaterial({ map: cardFrontTexture(), roughness: 0.32, side: THREE.DoubleSide });
  const cardTop = cardStrip(SAFETY_CARD.w, SAFETY_CARD.h, SAFETY_CARD.h - (POCKET.y + POCKET.h / 2 - SAFETY_CARD.bottom) + 0.01);
  const cardMesh = instanced(cardTop, cardMaterial, cards, false);
  const magazineTop = new THREE.PlaneGeometry(0.2, 0.06);
  magazineTop.translate(0, SAFETY_CARD.h + 0.018 - 0.03, 0);
  instanced(magazineTop, new THREE.MeshStandardMaterial({ map: magazineTexture(), roughness: 0.45, side: THREE.DoubleSide }), magazines, false);
  const bagTop = new THREE.PlaneGeometry(0.1, 0.05);
  bagTop.translate(0, SAFETY_CARD.h + 0.01 - 0.025, 0);
  instanced(bagTop, new THREE.MeshStandardMaterial({ color: '#ece8dd', roughness: 0.9, side: THREE.DoubleSide }), bags, false);
  const perSeat = [
    instanced(new RoundedBoxGeometry(0.43, 0.11, 0.46, 3, 0.045), fabric, cushions),
    instanced(new RoundedBoxGeometry(0.43, 0.66, 0.09, 3, 0.04), fabric, backs),
    instanced(new RoundedBoxGeometry(0.44, 0.64, 0.03, 2, 0.012), shell, shells),
    instanced(new RoundedBoxGeometry(0.3, 0.16, 0.012, 2, 0.005), headrest, headrests, false),
    instanced(new RoundedBoxGeometry(0.38, 0.28, 0.014, 2, 0.006), shell, trays, false),
    instanced(new RoundedBoxGeometry(0.42, 0.26, 0.03, 2, 0.012), shell, lowerShells),
    instanced(pocketGeometry(), pocketCloth, pockets, false),
    instanced(new RoundedBoxGeometry(POCKET.w, 0.018, 0.012, 2, 0.005), band, bands, false),
    cardMesh,
  ];
  const seatIndex = new Map(seats.map((seat, i) => [seat, i]));
  const shade = new THREE.Color();
  instanced(new RoundedBoxGeometry(0.05, 0.05, 0.42, 2, 0.02), armMat, arms);
  instanced(new THREE.BoxGeometry(0.035, 0.4, 0.035), metal, legs, false);
  instanced(new RoundedBoxGeometry(SCREEN_W + 0.03, SCREEN_H + 0.03, 0.012, 2, 0.006), shell, bezels, false);
  const screenMesh = instanced(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), screenMaterial, screens, false);

  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let hidden: SeatId | null = null;
  let hiddenCard: SeatId | null = null;
  const seatAhead = (seat: SeatId): SeatId | null => {
    const cell = grid.parseSeat(seat);
    return cell && cell.row > 1 ? grid.seatId({ row: cell.row - 1, col: cell.col }) : null;
  };

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
    hideCard(seat) {
      const ahead = seat ? seatAhead(seat) : null;
      if (hiddenCard === ahead) return;
      if (hiddenCard && seatIndex.has(hiddenCard)) cardMesh.setMatrixAt(seatIndex.get(hiddenCard)!, cardMatrices.get(hiddenCard)!);
      hiddenCard = ahead;
      if (ahead && seatIndex.has(ahead)) cardMesh.setMatrixAt(seatIndex.get(ahead)!, zero);
      cardMesh.instanceMatrix.needsUpdate = true;
    },
    pocketCard(seat) {
      const ahead = seatAhead(seat);
      return ahead ? (cardMatrices.get(ahead)?.clone() ?? null) : null;
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

/**
 * The pocket: stretchy cloth, bulging out a little in the middle where the card and the magazines sit. A curved
 * panel (its back flat against the shell).
 */
function pocketGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(POCKET.w, POCKET.h, 12, 6);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / (POCKET.w / 2);
    const v = pos.getY(i) / (POCKET.h / 2);
    // Fullest just below the lip, flat at the sides and the bottom seam.
    pos.setZ(i, 0.014 * (1 - u * u) * Math.max(0, 1 - ((v - 0.35) / 1.35) ** 2));
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The safety card's top strip, the part above the pocket's lip: a plane `shown` tall at the top of a card `w` × `h`,
 * built from its bottom edge up (so the card's matrix is its bottom edge), with the card's texture mapped to match.
 */
function cardStrip(w: number, h: number, shown: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(w, shown);
  geometry.translate(0, h - shown / 2, 0);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - shown / h + uv.getY(i) * (shown / h));
  return geometry;
}
