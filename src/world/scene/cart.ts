import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TABLET, rowZ } from '../layout';
import { SCREEN_H, SCREEN_W } from './seats';

/** The crew tablet's screen on the cart, in the cart's own space. */
const TABLET_LOCAL = new THREE.Matrix4().compose(
  new THREE.Vector3(0, TABLET.y, TABLET.z),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(TABLET.tilt, 0, 0)),
  new THREE.Vector3(1, 1, 1),
);

/** The aluminium drink trolley that rolls down the aisle. */
export class Cart {
  readonly group = new THREE.Group();
  private z = 0;
  private targetZ = 0;
  private placed = false;
  /** Metres per second: walking pace, or careering down the aisle when it breaks loose. */
  private speed = 0.9;
  /** Pushed somewhere by hand in an ending (its row no longer places it). */
  private held = false;

  constructor() {
    this.group.name = 'cart';
    const aluminium = new THREE.MeshStandardMaterial({ color: '#c3c9d1', roughness: 0.28, metalness: 0.75 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2f38', roughness: 0.6 });
    const top = new THREE.MeshStandardMaterial({ color: '#e7e2d6', roughness: 0.5 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.92, 0.72, 3, 0.03), aluminium);
    body.position.y = 0.54;
    const tray = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.03, 0.74, 2, 0.01), top);
    tray.position.y = 1.015;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.03), dark);
    handle.position.set(0, 0.95, 0.38);
    this.group.add(body, tray, handle);
    // The crew tablet, propped on a little stand at the handle end (the Stewardess's screen).
    const tablet = new THREE.Mesh(new RoundedBoxGeometry(SCREEN_W + 0.03, SCREEN_H + 0.03, 0.014, 2, 0.006), dark);
    tablet.applyMatrix4(new THREE.Matrix4().multiplyMatrices(TABLET_LOCAL, new THREE.Matrix4().makeTranslation(0, 0, -0.009)));
    // Behind the screen (the Stewardess stands on the +z side).
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.15, 10), dark);
    pole.position.set(0, 1.1, TABLET.z - 0.035);
    this.group.add(tablet, pole);
    const colors = ['#d23b3b', '#e6e6e6', '#2f6fd1', '#f2b134', '#3fae6b'];
    for (let i = 0; i < 7; i++) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.11, 12), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.3, metalness: 0.5 }));
      can.position.set(-0.09 + (i % 3) * 0.09, 1.085, -0.3 + Math.floor(i / 3) * 0.12);
      this.group.add(can);
    }
    const wheelGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.03, 12);
    for (const x of [-0.12, 0.12]) {
      for (const z of [-0.3, 0.3]) {
        const wheel = new THREE.Mesh(wheelGeometry, dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.04, z);
        this.group.add(wheel);
      }
    }
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
  }

  /** Where the cart is along the aisle, or null when there is no cart to see. */
  get aisleZ(): number | null {
    return this.group.visible ? this.z : null;
  }

  /** Put the cart where the hands pushing it have it (an ending): on the floor at x, z, its handle end facing `yaw`. */
  hold(x: number, z: number, yaw: number): void {
    this.held = true;
    this.group.position.set(x, 0, z);
    this.group.rotation.set(0, yaw, 0);
  }

  setRow(row: number, destroyed: boolean, runaway = false): void {
    this.group.visible = !destroyed;
    if (rowZ(row) !== this.targetZ) this.speed = runaway ? 3.2 : 0.9;
    this.targetZ = rowZ(row);
    if (!this.placed) {
      this.z = this.targetZ;
      this.placed = true;
    }
  }

  /** Where the tablet's screen is right now (it rolls with the cart). */
  tabletMatrix(out = new THREE.Matrix4()): THREE.Matrix4 {
    this.group.updateMatrixWorld();
    return out.multiplyMatrices(this.group.matrixWorld, TABLET_LOCAL);
  }

  /** Where the tablet's screen will be once the cart stops at `row`. */
  static tabletAt(row: number, out = new THREE.Matrix4()): THREE.Matrix4 {
    return out.makeTranslation(0, 0, rowZ(row)).multiply(TABLET_LOCAL);
  }

  update(dt: number, time: number): void {
    if (this.held) return;
    const diff = this.targetZ - this.z;
    // Roll rather than snap; a runaway cart wobbles as it goes.
    const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * this.speed);
    this.z += step;
    const wobble = this.speed > 1 && Math.abs(diff) > 0.01 ? Math.sin(time * 23) * 0.04 : 0;
    this.group.position.set(0, 0, this.z);
    this.group.rotation.set(0, wobble, wobble * 0.3);
  }
}
