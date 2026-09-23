import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { rowZ } from '../layout';

/** The aluminium drink trolley that rolls down the aisle. */
export class Cart {
  readonly group = new THREE.Group();
  private z = 0;
  private targetZ = 0;
  private placed = false;

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
    const colors = ['#d23b3b', '#e6e6e6', '#2f6fd1', '#f2b134', '#3fae6b'];
    for (let i = 0; i < 7; i++) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.11, 12), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.3, metalness: 0.5 }));
      can.position.set(-0.09 + (i % 3) * 0.09, 1.085, -0.22 + Math.floor(i / 3) * 0.14);
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

  setRow(row: number, destroyed: boolean): void {
    this.group.visible = !destroyed;
    this.targetZ = rowZ(row);
    if (!this.placed) {
      this.z = this.targetZ;
      this.placed = true;
    }
  }

  update(dt: number): void {
    const diff = this.targetZ - this.z;
    // Roll at walking pace rather than snapping.
    const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 0.9);
    this.z += step;
    this.group.position.set(0, 0, this.z);
  }
}
