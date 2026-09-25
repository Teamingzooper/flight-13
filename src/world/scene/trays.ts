import * as THREE from 'three';
import type { Dish, SeatId } from '../../engine';
import { seatPose } from '../layout';

/** As many trays as there can be diners. */
const MAX = 56;

/** A drumstick's outline, bone end first: [radius, length] (turned into a solid, then laid flat). */
const DRUMSTICK: [number, number][] = [
  [0, 0],
  [0.009, 0.002],
  [0.011, 0.008],
  [0.006, 0.013],
  [0.006, 0.036],
  [0.013, 0.042],
  [0.024, 0.062],
  [0.03, 0.084],
  [0.026, 0.104],
  [0.013, 0.118],
  [0, 0.122],
];

/** Part of the drumstick (the bone, or the meat), lying on its side. */
function drumstickPart(from: number, to: number): THREE.BufferGeometry {
  const outline = DRUMSTICK.filter(([, y]) => y >= from && y <= to).map(([r, y]) => new THREE.Vector2(r, y));
  if (outline[0].x !== 0) outline.unshift(new THREE.Vector2(0, from));
  if (outline.at(-1)!.x !== 0) outline.push(new THREE.Vector2(0, to));
  return new THREE.LatheGeometry(outline, 12).translate(0, -0.061, 0).rotateZ(Math.PI / 2).rotateY(0.5);
}

/** Where a diner's tray table sits: folded down from the seat ahead, over the knees. */
const TABLE = { y: 0.695, back: 0.4 };

/**
 * Lunch in 3D: a fold-down tray table in front of everyone who ordered, with a meal tray, their dish (a chicken
 * drumstick, or a bowl of pasta with sauce) and a cup. Drawn as a few instanced meshes; `set` is cheap to call on every
 * update (nothing changes unless the orders do).
 */
export class Trays {
  readonly group = new THREE.Group();
  private readonly meshes: Record<'table' | 'tray' | 'plate' | 'cup' | 'sauce' | 'bone' | Dish, THREE.InstancedMesh>;
  private key = '';

  constructor() {
    const mat = (color: string, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness });
    const pasta = new THREE.SphereGeometry(0.052, 14, 8).scale(1, 0.4, 1);
    const sauce = new THREE.SphereGeometry(0.03, 10, 6).scale(1, 0.3, 1);
    const make = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      // (Two drumsticks to a plate of chicken.)
      const mesh = new THREE.InstancedMesh(geometry, material, MAX * 2);
      mesh.count = 0;
      mesh.receiveShadow = true;
      // (The instances move from seat to seat: a bounding sphere worked out once would cull them wrongly.)
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    this.meshes = {
      table: make(new THREE.BoxGeometry(0.4, 0.014, 0.27), mat('#3b404a', 0.5)),
      tray: make(new THREE.BoxGeometry(0.34, 0.016, 0.22), mat('#9aa3ad', 0.45)),
      plate: make(new THREE.CylinderGeometry(0.075, 0.068, 0.012, 20), mat('#fbfbf8', 0.3)),
      cup: make(new THREE.CylinderGeometry(0.024, 0.019, 0.062, 12), mat('#f5f5f2', 0.35)),
      chicken: make(drumstickPart(0.036, 0.122), mat('#9c5a24', 0.55)),
      bone: make(drumstickPart(0, 0.042), mat('#f3ecdc', 0.4)),
      pasta: make(pasta, mat('#efd27d', 0.7)),
      sauce: make(sauce, mat('#b4322a', 0.5)),
    };
  }

  /** Trays in front of these diners (none: lunch is over, or not yet). */
  set(diners: readonly { seat: SeatId; dish: Dish }[]): void {
    const key = diners.map((d) => `${d.seat}:${d.dish}`).join(',');
    if (key === this.key) return;
    this.key = key;
    const counts = { table: 0, tray: 0, plate: 0, cup: 0, chicken: 0, bone: 0, pasta: 0, sauce: 0 };
    const m = new THREE.Matrix4();
    const put = (part: keyof typeof counts, x: number, y: number, z: number) => {
      m.makeTranslation(x, y, z);
      this.meshes[part].setMatrixAt(counts[part]++, m);
    };
    for (const { seat, dish } of diners.slice(0, MAX)) {
      const { x, z: seatZ } = seatPose(seat);
      const z = seatZ - TABLE.back;
      put('table', x, TABLE.y, z);
      put('tray', x, TABLE.y + 0.015, z + 0.01);
      put('cup', x + 0.12, TABLE.y + 0.054, z - 0.05);
      put('plate', x - 0.04, TABLE.y + 0.029, z + 0.01);
      if (dish === 'chicken') {
        for (const [dx, dz] of [
          [-0.03, 0.035],
          [-0.05, -0.02],
        ]) {
          put('chicken', x + dx, TABLE.y + 0.058, z + dz);
          put('bone', x + dx, TABLE.y + 0.058, z + dz);
        }
      } else {
        put('pasta', x - 0.04, TABLE.y + 0.042, z + 0.01);
        put('sauce', x - 0.04, TABLE.y + 0.058, z + 0.01);
      }
    }
    for (const [part, mesh] of Object.entries(this.meshes) as [keyof typeof counts, THREE.InstancedMesh][]) {
      mesh.count = counts[part];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of Object.values(this.meshes)) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
