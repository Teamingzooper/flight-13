import * as THREE from 'three';
import { BULKHEAD_Z, CABIN_HALF_WIDTH, FLIGHT_DECK } from '../layout';
import { signTexture } from '../textures';

const CEILING = 2.2;

/**
 * The jumbo's spiral staircase up to the upper deck: in the front galley on the left, climbing through the ceiling,
 * with an UPPER DECK sign on the cabin side of the bulkhead so everyone in the cabin knows it is there.
 */
export function buildStaircase(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'staircase';
  const steel = new THREE.MeshStandardMaterial({ color: '#c9cdd4', roughness: 0.35, metalness: 0.55 });
  const tread = new THREE.MeshStandardMaterial({ color: '#3b3f47', roughness: 0.8 });
  const rail = new THREE.MeshStandardMaterial({ color: '#23262c', roughness: 0.4 });
  const signMap = signTexture('UPPER DECK  ↑', '#e8eefb', '#18314f', 320, 64);
  const sign = new THREE.MeshStandardMaterial({ color: '#000', map: signMap, emissive: '#ffffff', emissiveMap: signMap, emissiveIntensity: 0.9 });

  // Halfway along the galley, towards the left wall.
  const cx = -(CABIN_HALF_WIDTH - 0.62);
  const cz = (BULKHEAD_Z + FLIGHT_DECK.doorZ) / 2;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, CEILING + 0.4, 12), steel);
  pole.position.set(cx, (CEILING + 0.4) / 2, cz);
  group.add(pole);

  // Wedge-shaped treads winding up round the pole, then on up through the ceiling.
  const steps = 14;
  const rise = (CEILING + 0.3) / steps;
  const treadGeometry = new THREE.BoxGeometry(0.5, 0.035, 0.2);
  treadGeometry.translate(0.29, 0, 0);
  const railPoints: THREE.Vector3[] = [];
  for (let i = 0; i < steps; i++) {
    const a = i * 0.42;
    const step = new THREE.Mesh(treadGeometry, tread);
    step.position.set(cx, 0.18 + i * rise, cz);
    step.rotation.y = a;
    step.castShadow = step.receiveShadow = true;
    group.add(step);
    railPoints.push(new THREE.Vector3(cx + Math.cos(a) * 0.54, 0.18 + i * rise + 0.85, cz - Math.sin(a) * 0.54));
  }
  const handrail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPoints), 80, 0.018, 8), rail);
  group.add(handrail);
  for (let i = 0; i < steps; i += 2) {
    const p = railPoints[i];
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.85, 6), steel);
    post.position.set(p.x, p.y - 0.425, p.z);
    group.add(post);
  }

  // The sign, on the cabin side of the bulkhead above the left seats.
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.1), sign);
  plate.position.set(-1.1, CEILING - 0.3, BULKHEAD_Z + 0.012);
  group.add(plate);
  return group;
}
