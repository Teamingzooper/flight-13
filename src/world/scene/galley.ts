import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { withDetail } from '../graphics';
import { BULKHEAD_Z, CABIN_HALF_WIDTH, FLIGHT_DECK } from '../layout';

/** Where the drink cart goes when it is stowed: its bay in the galley unit on the right. */
export const CART_BAY = { x: 1.36, z: BULKHEAD_Z - 0.95 } as const;

/**
 * The forward galley's fittings, between the curtain and the flight deck door: stainless steel units along the walls
 * (ovens and drawers above a worktop, compartments below), and on the right a trolley bay the cart parks in. On the
 * jumbo the spiral staircase takes the left-hand side, so the units are only on the right.
 */
export function buildGalley(plane: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'galley';
  const steel = withDetail(new THREE.MeshStandardMaterial({ color: '#c5cbd3', roughness: 0.38, metalness: 0.6 }), 'brushed', [3, 3], 0.3);
  const dark = new THREE.MeshStandardMaterial({ color: '#2c3139', roughness: 0.55 });
  const counter = withDetail(new THREE.MeshStandardMaterial({ color: '#9aa3ae', roughness: 0.5, metalness: 0.55 }), 'brushed', [4, 1], 0.2);
  const glass = new THREE.MeshStandardMaterial({ color: '#10141a', roughness: 0.15, metalness: 0.3, emissive: '#0b0f14' });
  const amber = new THREE.MeshStandardMaterial({ color: '#1a1206', emissive: '#ffae3d', emissiveIntensity: 1.2 });
  const front = BULKHEAD_Z - 0.18;
  const back = FLIGHT_DECK.doorZ + 0.12;
  const length = front - back;
  const midZ = (front + back) / 2;
  const depth = 0.78;
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  for (const side of plane === 'jumbo' ? [1] : [-1, 1]) {
    const wall = side * CABIN_HALF_WIDTH;
    const x = wall - side * (depth / 2);
    const face = wall - side * depth;
    const bay = side > 0;
    // Lower compartments (with a gap for the trolley on the right), the worktop, and the ovens and drawers above.
    const bayFrom = CART_BAY.z - 0.24;
    const bayTo = CART_BAY.z + 0.24;
    const lowerSpans: [number, number][] = bay ? [[back, bayFrom], [bayTo, front]] : [[back, front]];
    for (const [a, b] of lowerSpans) {
      if (b - a < 0.05) continue;
      add(new RoundedBoxGeometry(depth, 0.92, b - a, 2, 0.015), steel, x, 0.46, (a + b) / 2);
      // Doors: a dark seam between each, and a flush handle.
      for (let z = a + 0.3; z < b - 0.05; z += 0.3) add(new THREE.BoxGeometry(0.006, 0.8, 0.008), dark, face - side * 0.001, 0.47, z);
      for (let z = a + 0.15; z < b; z += 0.3) add(new THREE.BoxGeometry(0.012, 0.02, 0.1), dark, face - side * 0.004, 0.84, z);
    }
    if (bay) {
      // The trolley bay: its back wall and a restraint bar across the front.
      add(new THREE.BoxGeometry(0.02, 0.92, bayTo - bayFrom), dark, wall - side * 0.01, 0.46, CART_BAY.z);
      add(new THREE.CylinderGeometry(0.012, 0.012, bayTo - bayFrom, 8), dark, face - side * 0.02, 0.35, CART_BAY.z).rotation.x = Math.PI / 2;
    }
    add(new RoundedBoxGeometry(depth + 0.04, 0.04, length, 2, 0.01), counter, x - side * 0.02, 0.94, midZ);
    // The upper units: two ovens with dark glass and a lit indicator, and a stack of drawers.
    add(new RoundedBoxGeometry(depth - 0.2, 0.62, length, 2, 0.015), steel, wall - side * ((depth - 0.2) / 2), 1.62, midZ);
    const upperFace = wall - side * (depth - 0.2);
    const ovens = [back + length * 0.22, back + length * 0.5];
    for (const z of ovens) {
      add(new THREE.BoxGeometry(0.006, 0.34, 0.36), glass, upperFace - side * 0.002, 1.6, z);
      add(new THREE.BoxGeometry(0.014, 0.018, 0.26), dark, upperFace - side * 0.008, 1.82, z);
      add(new THREE.BoxGeometry(0.006, 0.02, 0.02), amber, upperFace - side * 0.004, 1.4, z + 0.14);
    }
    for (let i = 0; i < 4; i++) {
      const z = back + length * 0.8;
      add(new THREE.BoxGeometry(0.006, 0.12, 0.34), dark, upperFace - side * 0.001, 1.39 + i * 0.15, z);
      add(new THREE.BoxGeometry(0.012, 0.014, 0.12), counter, upperFace - side * 0.008, 1.43 + i * 0.15, z);
    }
  }
  return group;
}
