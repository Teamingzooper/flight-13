import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CABIN_HALF_WIDTH, FLIGHT_DECK, screenPose } from '../layout';
import { signTexture } from '../textures';
import { SCREEN_H, SCREEN_W } from './seats';

export interface FlightDeck {
  group: THREE.Group;
  /** The screen in front of the captain (the Pilot's game screen). */
  captainScreen: THREE.Matrix4;
  /** The first officer's screen, which the jump seat guest uses. */
  guestScreen: THREE.Matrix4;
  /** Where the jump seat guest's eyes are, behind the captain. */
  jumpSeatEye: THREE.Vector3;
  /** In the galley, just outside the door: where people walk to before they go in. */
  door: THREE.Vector3;
  /** What the windscreen shows (the same skies as the cabin windows). */
  setSky(texture: THREE.Texture): void;
  dispose(): void;
}

const CEILING = 2.0;

/**
 * The flight deck past the galley: a wall with a door marked FLIGHT DECK closing off the galley, a narrowing
 * room with the captain's and first officer's seats, an instrument panel with their screens, and a
 * windscreen onto the sky.
 */
export function buildFlightDeck(): FlightDeck {
  const group = new THREE.Group();
  group.name = 'flight-deck';
  const back = FLIGHT_DECK.doorZ;
  const nose = FLIGHT_DECK.noseZ;
  const length = back - nose;
  const wall = new THREE.MeshStandardMaterial({ color: '#b9bec8', roughness: 0.6, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: '#23272f', roughness: 0.7 });
  const panelMat = new THREE.MeshStandardMaterial({ color: '#2d323b', roughness: 0.55, metalness: 0.2 });
  const seatMat = new THREE.MeshStandardMaterial({ color: '#3b3f47', roughness: 0.85 });
  const doorMat = new THREE.MeshStandardMaterial({ color: '#c8ccd3', roughness: 0.45, metalness: 0.15 });
  const bezel = new THREE.MeshStandardMaterial({ color: '#15181e', roughness: 0.4 });
  const glass = new THREE.MeshBasicMaterial({ color: '#dfe8f5' });
  const signMap = signTexture('FLIGHT DECK', '#e8eefb', '#18314f', 256, 64);
  const sign = new THREE.MeshStandardMaterial({ color: '#000', map: signMap, emissive: '#ffffff', emissiveMap: signMap, emissiveIntensity: 0.9 });
  const materials = [wall, dark, panelMat, seatMat, doorMat, bezel, glass, sign];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0, 'YXZ');
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // The galley's end: a wall across the cabin with a door in the middle (the galley side faces +z).
  const doorHalf = 0.42;
  for (const side of [-1, 1]) {
    const w = CABIN_HALF_WIDTH - doorHalf;
    add(new THREE.PlaneGeometry(w, 2.2), wall, side * (doorHalf + w / 2), 1.1, back);
  }
  add(new THREE.PlaneGeometry(doorHalf * 2, 0.3), wall, 0, 2.05, back);
  add(new RoundedBoxGeometry(doorHalf * 2 - 0.04, 1.88, 0.05, 2, 0.02), doorMat, 0, 0.95, back - 0.03);
  add(new THREE.PlaneGeometry(0.44, 0.11), sign, 0, 1.72, back + 0.001);

  // The room: floor, ceiling and sides narrowing towards the nose.
  const floor = new THREE.Shape();
  const halfBack = 1.25;
  const halfNose = 0.8;
  floor.moveTo(-halfBack, 0);
  floor.lineTo(halfBack, 0);
  floor.lineTo(halfNose, length);
  floor.lineTo(-halfNose, length);
  floor.lineTo(-halfBack, 0);
  const floorGeometry = new THREE.ShapeGeometry(floor);
  add(floorGeometry, dark, 0, 0.001, back, -Math.PI / 2);
  add(floorGeometry.clone(), wall, 0, CEILING, back, -Math.PI / 2);
  // Each side wall runs straight from the back corner to the nose corner.
  for (const side of [-1, 1]) {
    const quad = new THREE.BufferGeometry();
    const [bx, nx] = [side * halfBack, side * halfNose];
    quad.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([bx, 0, back, nx, 0, nose, nx, CEILING, nose, bx, 0, back, nx, CEILING, nose, bx, CEILING, back], 3),
    );
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    quad.computeVertexNormals();
    add(quad, wall, 0, 0, 0);
  }

  // The windscreen: four panes onto the sky above the glareshield, and the nose below them.
  const paneZ = nose + 0.05;
  for (const [i, x] of [-0.6, -0.2, 0.2, 0.6].entries()) {
    add(new THREE.PlaneGeometry(0.38, 0.42), glass, x, 1.42, paneZ + Math.abs(i - 1.5) * 0.06, -0.35, -x * 0.35);
  }
  add(new THREE.PlaneGeometry(halfNose * 2, 1.15), dark, 0, 0.58, nose + 0.02);
  add(new THREE.PlaneGeometry(halfNose * 2, 0.4), dark, 0, 1.8, nose + 0.12, 0.6);

  // The instrument panel under the glareshield, with a screen for each pilot.
  const panelZ = FLIGHT_DECK.seatZ - 0.62;
  add(new RoundedBoxGeometry(1.7, 0.5, 0.35, 2, 0.04), panelMat, 0, 0.82, panelZ - 0.1);
  add(new RoundedBoxGeometry(1.6, 0.08, 0.5, 2, 0.03), dark, 0, 1.1, panelZ - 0.18);
  const captain = screenPose('Cockpit');
  const tilt = -0.35;
  const screenAt = (x: number) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, captain.y, captain.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)),
      new THREE.Vector3(1, 1, 1),
    );
  const captainScreen = screenAt(captain.x);
  const guestScreen = screenAt(-captain.x);
  for (const m of [captainScreen, guestScreen]) {
    const frame = new THREE.Mesh(new RoundedBoxGeometry(SCREEN_W + 0.04, SCREEN_H + 0.04, 0.02, 2, 0.008), bezel);
    frame.applyMatrix4(new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, 0, -0.012)));
    group.add(frame);
  }
  // A pedestal between the seats, with the thrust levers.
  add(new RoundedBoxGeometry(0.3, 0.6, 0.7, 2, 0.04), panelMat, 0, 0.3, FLIGHT_DECK.seatZ - 0.2);
  for (const x of [-0.05, 0.05]) add(new THREE.BoxGeometry(0.03, 0.14, 0.03), bezel, x, 0.66, FLIGHT_DECK.seatZ - 0.3, 0.4);

  // The two pilots' seats, facing forward, and the folding jump seat against the back wall.
  for (const x of [FLIGHT_DECK.seatX, -FLIGHT_DECK.seatX]) {
    add(new RoundedBoxGeometry(0.5, 0.12, 0.5, 2, 0.04), seatMat, x, 0.48, FLIGHT_DECK.seatZ + 0.05);
    add(new RoundedBoxGeometry(0.5, 0.75, 0.12, 2, 0.04), seatMat, x, 0.9, FLIGHT_DECK.seatZ + 0.32, -0.12);
    add(new THREE.CylinderGeometry(0.05, 0.08, 0.42, 10), dark, x, 0.21, FLIGHT_DECK.seatZ + 0.05);
  }
  const jumpX = FLIGHT_DECK.jumpSeatX;
  add(new RoundedBoxGeometry(0.42, 0.08, 0.36, 2, 0.03), seatMat, jumpX, 0.5, back - 0.3);
  add(new RoundedBoxGeometry(0.42, 0.55, 0.08, 2, 0.03), seatMat, jumpX, 0.85, back - 0.1);

  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material === glass) o.castShadow = o.receiveShadow = false;
  });

  return {
    group,
    captainScreen,
    guestScreen,
    jumpSeatEye: new THREE.Vector3(jumpX, 1.18, back - 0.32),
    door: new THREE.Vector3(0, 0, back + 0.35),
    setSky(texture) {
      glass.map = texture;
      glass.needsUpdate = true;
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of materials) m.dispose();
      signMap.dispose();
    },
  };
}
