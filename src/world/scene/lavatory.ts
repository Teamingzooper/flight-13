import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** The lavatory's outer box at the back of the cabin (left of the aisle). */
export interface LavatoryBox {
  minX: number;
  maxX: number;
  frontZ: number;
  backZ: number;
  height: number;
}

export interface LavatoryInterior {
  group: THREE.Group;
  /** Where you stand inside, facing the mirror on the back wall. */
  eye: THREE.Vector3;
  /** Facing the back of the plane. */
  restYaw: number;
  /** The little screen beside the mirror (you use it like your seatback screen). */
  screen: THREE.Matrix4;
  /** In the aisle outside the door: where people walk to before they go in. */
  door: THREE.Vector3;
  dispose(): void;
}

/** A mirror without a real reflection: pale silver with soft streaks of light across it. */
function mirrorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d')!;
  const base = g.createLinearGradient(0, 0, 256, 256);
  base.addColorStop(0, '#dfe7ee');
  base.addColorStop(0.5, '#aebccb');
  base.addColorStop(1, '#8e9eb0');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  g.globalAlpha = 0.35;
  g.fillStyle = '#ffffff';
  for (const [x, w] of [
    [40, 34],
    [96, 12],
    [170, 22],
  ]) {
    g.beginPath();
    g.moveTo(x, 256);
    g.lineTo(x + w, 256);
    g.lineTo(x + w + 150, 0);
    g.lineTo(x + 150, 0);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Inside the lavatory, for a night locked in there: walls facing inward, a mirror over a sink, a toilet,
 * a bright ceiling panel and a small screen by the mirror. It sits inside the cabin's solid lavatory
 * box, so from the cabin you never see it.
 */
export function buildLavatory(box: LavatoryBox): LavatoryInterior {
  const group = new THREE.Group();
  group.name = 'lavatory';
  group.visible = false;
  const inset = 0.03;
  const width = box.maxX - box.minX - inset * 2;
  const depth = box.backZ - box.frontZ - inset * 2;
  const height = box.height - inset * 2;
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.frontZ + box.backZ) / 2;
  const back = box.backZ - inset;
  const left = box.minX + inset;
  const front = box.frontZ + inset;

  // Lit from inside (the cabin may be dark): a little emissive keeps it bright without a real light.
  const wall = new THREE.MeshStandardMaterial({ color: '#dcd6cb', emissive: '#fff2dc', emissiveIntensity: 0.22, roughness: 0.55, side: THREE.BackSide });
  const floor = new THREE.MeshStandardMaterial({ color: '#434955', emissive: '#1a1d22', roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: '#f1f1ee', emissive: '#6b6a66', emissiveIntensity: 0.35, roughness: 0.25 });
  const steel = new THREE.MeshStandardMaterial({ color: '#b9c0c8', emissive: '#3d4248', roughness: 0.25, metalness: 0.8 });
  const mirrorMap = mirrorTexture();
  const mirror = new THREE.MeshBasicMaterial({ map: mirrorMap, color: '#b9c3cc' });
  const panel = new THREE.MeshBasicMaterial({ color: '#fff6e6' });
  const cabinet = new THREE.MeshStandardMaterial({ color: '#c9c2b5', emissive: '#3f3a33', roughness: 0.6 });
  const bezel = new THREE.MeshStandardMaterial({ color: '#1f232a', roughness: 0.4 });
  const materials = [wall, floor, white, steel, mirror, panel, cabinet, bezel];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    group.add(mesh);
    return mesh;
  };

  add(new THREE.BoxGeometry(width, height, depth), wall, cx, inset + height / 2, cz);
  add(new THREE.PlaneGeometry(width, depth), floor, cx, 0.02, cz, 0, -Math.PI / 2);
  // Ceiling light.
  add(new THREE.PlaneGeometry(0.5, 0.3), panel, cx, height + inset - 0.005, cz, 0, Math.PI / 2);

  // Mirror over the sink, on the back wall to the right.
  const sinkX = box.maxX - 0.5;
  add(new THREE.PlaneGeometry(0.5, 0.48), mirror, sinkX, 1.47, back - 0.004, Math.PI);
  add(new RoundedBoxGeometry(0.7, 0.07, 0.38, 2, 0.02), white, sinkX, 0.86, back - 0.19);
  add(new RoundedBoxGeometry(0.66, 0.78, 0.34, 2, 0.02), cabinet, sinkX, 0.43, back - 0.17);
  const basin = add(new THREE.CircleGeometry(0.14, 24), steel, sinkX, 0.897, back - 0.2, 0, -Math.PI / 2);
  basin.scale.set(1, 0.7, 1);
  const tap = add(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 10), steel, sinkX, 0.95, back - 0.06);
  tap.rotation.x = -0.9;

  // Toilet against the left wall, lid down.
  const toiletZ = box.frontZ + depth * 0.62;
  add(new THREE.CylinderGeometry(0.17, 0.13, 0.4, 20), white, left + 0.3, 0.2, toiletZ);
  add(new THREE.CylinderGeometry(0.2, 0.2, 0.035, 24), white, left + 0.3, 0.42, toiletZ).scale.set(1, 1, 1.15);
  add(new RoundedBoxGeometry(0.14, 0.42, 0.44, 2, 0.03), white, left + 0.07, 0.62, toiletZ);
  // Paper towels and a grab rail.
  add(new RoundedBoxGeometry(0.26, 0.3, 0.1, 2, 0.02), steel, box.maxX - inset - 0.06, 1.25, back - 0.55, -Math.PI / 2);
  add(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 10), steel, left + 0.03, 1.0, toiletZ, 0, Math.PI / 2);
  // The inside of the door, with its latch.
  add(new RoundedBoxGeometry(0.62, 1.9, 0.02, 2, 0.01), white, box.maxX - 0.46, 0.96, front + 0.012);
  add(new THREE.BoxGeometry(0.08, 0.03, 0.03), steel, box.maxX - 0.24, 1.05, front + 0.03);

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = false;
  });

  const screenPosition = new THREE.Vector3(sinkX - 0.5, 1.33, back - 0.006);
  const screen = new THREE.Matrix4().compose(
    screenPosition,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  // The bezel sits behind the screen's surface (its front face just under it).
  add(new RoundedBoxGeometry(0.29, 0.2, 0.012, 2, 0.006), bezel, screenPosition.x, screenPosition.y, back + 0.002);

  return {
    group,
    // Between the mirror and the screen, so both are in view.
    eye: new THREE.Vector3(sinkX - 0.25, 1.58, front + 0.42),
    restYaw: Math.PI,
    screen,
    door: new THREE.Vector3(Math.min(-0.34, box.maxX - 0.1), 0, box.frontZ - 0.28),
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of materials) m.dispose();
      mirrorMap.dispose();
    },
  };
}
