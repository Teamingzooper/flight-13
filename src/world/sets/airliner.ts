import * as THREE from 'three';

/**
 * Flight 13 from the outside: a narrow-body jet about 36 m long, nose towards -z, wheels on y = 0.
 * White with a navy belly and an orange cheatline, "FLIGHT 13" along the side and a big 13 on the tail.
 * Used through the terminal windows, and for landings, escapes and the worst endings.
 */
export interface Airliner {
  group: THREE.Group;
  /** The forward left door (where the jet bridge docks and people come and go), in the plane's space. */
  door: THREE.Vector3;
  /** Centre of the cabin floor, for placing a fireball. */
  heart: THREE.Vector3;
}

const LENGTH = 36;
const RADIUS = 1.95;
/** Height of the fuselage centre above the ground. */
const BELLY = 3.2;

function liveryTexture(): THREE.CanvasTexture {
  const w = 2048;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  // v runs round the fuselage (0 = bottom, 0.5 = top); u runs nose (0) to tail (1).
  g.fillStyle = '#f4f5f7';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#1b2a4e';
  g.fillRect(0, h * 0.72, w, h * 0.28);
  g.fillRect(0, 0, w, h * 0.06);
  g.fillStyle = '#ff8a3d';
  g.fillRect(0, h * 0.66, w, h * 0.045);
  // Passenger windows along both sides (the texture wraps, so each side gets a row).
  g.fillStyle = '#1a2230';
  for (const row of [0.58, 0.92]) {
    for (let x = w * 0.14; x < w * 0.82; x += 26) {
      g.beginPath();
      g.roundRect(x, h * (1 - row) - 9, 12, 18, 5);
      g.fill();
    }
  }
  // Doors.
  g.strokeStyle = '#b9bec8';
  g.lineWidth = 3;
  for (const x of [0.12, 0.86]) {
    for (const row of [0.58, 0.92]) g.strokeRect(w * x, h * (1 - row) - 30, 28, 58);
  }
  // Titles on both sides.
  g.fillStyle = '#1b2a4e';
  g.font = 'bold 64px sans-serif';
  for (const row of [0.5, 0.84]) {
    g.save();
    g.translate(w * 0.3, h * (1 - row) + 8);
    g.fillText('FLIGHT 13', 0, 0);
    g.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function tailTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#1b2a4e';
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = '#ff8a3d';
  g.beginPath();
  g.moveTo(0, 512);
  g.lineTo(512, 140);
  g.lineTo(512, 230);
  g.lineTo(0, 512);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 230px sans-serif';
  g.textAlign = 'center';
  g.fillText('13', 300, 330);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A tapered wing-like slab: root chord at x = 0, swept back towards +z, `span` out along x. */
function wingGeometry(span: number, root: number, tip: number, sweep: number, thick: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(span, sweep);
  shape.lineTo(span, sweep + tip);
  shape.lineTo(0, root);
  shape.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: thick * 0.4, bevelSegments: 2 });
  // Shape x → span (x), shape y → chord (z); the extrusion becomes the thickness (y).
  g.rotateX(Math.PI / 2);
  g.translate(0, thick / 2, 0);
  return g;
}

export function buildAirliner(): Airliner {
  const group = new THREE.Group();
  group.name = 'airliner';
  const white = new THREE.MeshStandardMaterial({ color: '#f1f2f4', roughness: 0.35, metalness: 0.1 });
  const grey = new THREE.MeshStandardMaterial({ color: '#b8bec8', roughness: 0.45, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#10161f', roughness: 0.15, metalness: 0.6 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // Fuselage: a long tube with a rounded nose and a tail cone that sweeps up.
  const body = LENGTH - 9;
  const tube = new THREE.CylinderGeometry(RADIUS, RADIUS, body, 40, 1, true);
  tube.rotateX(Math.PI / 2);
  const livery = new THREE.MeshStandardMaterial({ map: liveryTexture(), roughness: 0.35, metalness: 0.1 });
  // Cylinder UVs: u goes round, v along the length; rotate the texture so the titles read along the side.
  livery.map!.center.set(0.5, 0.5);
  livery.map!.rotation = Math.PI / 2;
  add(tube, livery, 0, BELLY, 0);
  const noseLength = 4;
  const nose = new THREE.SphereGeometry(RADIUS, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  nose.scale(1, noseLength / RADIUS, 1);
  nose.rotateX(-Math.PI / 2);
  add(nose, white, 0, BELLY, -body / 2);
  const cone = new THREE.CylinderGeometry(0.35, RADIUS, 5, 40, 1, true);
  cone.rotateX(-Math.PI / 2);
  cone.translate(0, 0.55, 0);
  add(cone, white, 0, BELLY, body / 2 + 2.5);
  // Cockpit windows.
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.45, 0.28, 0.9), glass, side * 0.62, BELLY + 0.95, -body / 2 - 2.1, -0.45, side * 0.35, 0);
  }
  add(new THREE.BoxGeometry(0.9, 0.3, 0.6), glass, 0, BELLY + 1.08, -body / 2 - 2.35, -0.6, 0, 0);

  // Wings, with engines slung underneath.
  for (const side of [-1, 1]) {
    const wing = add(wingGeometry(16, 6, 1.6, 6.5, 0.36), white, side * RADIUS * 0.6, BELLY - 1.2, -2.4);
    if (side < 0) wing.scale.x = -1;
    const nacelle = new THREE.CylinderGeometry(0.95, 0.85, 4.2, 32, 1, false);
    nacelle.rotateX(Math.PI / 2);
    add(nacelle, grey, side * 6.2, BELLY - 2.2, -2.2);
    const intake = new THREE.CircleGeometry(0.8, 32);
    add(intake, dark, side * 6.2, BELLY - 2.2, -4.31, 0, Math.PI, 0);
    add(new THREE.BoxGeometry(0.25, 0.9, 2.2), white, side * 6.2, BELLY - 1.55, -1.4);
    // Winglet.
    const winglet = add(new THREE.BoxGeometry(0.12, 1.9, 1.3), white, side * (RADIUS * 0.6 + 16), BELLY + 0.1, 5.2, 0, 0, side * -0.25);
    winglet.castShadow = true;
  }
  // Tail: fin and stabilisers.
  const fin = add(wingGeometry(7, 6.5, 2.4, 5.5, 0.3), new THREE.MeshStandardMaterial({ map: tailTexture(), roughness: 0.4 }), 0, BELLY + 1.4, body / 2 - 3, 0, 0, Math.PI / 2);
  fin.scale.set(1, 1, 1);
  for (const side of [-1, 1]) {
    const stab = add(wingGeometry(6, 3.6, 1.4, 3.2, 0.22), white, side * 0.5, BELLY + 0.9, body / 2 + 0.5);
    if (side < 0) stab.scale.x = -1;
  }

  // Landing gear.
  const tyre = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 20);
  tyre.rotateZ(Math.PI / 2);
  for (const side of [-1, 1]) {
    for (const dz of [-0.6, 0.6]) add(tyre, dark, side * 3.1, 0.55, 1.2 + dz);
    add(new THREE.CylinderGeometry(0.12, 0.12, BELLY - 1.9, 10), grey, side * 3.1, (BELLY - 1.9) / 2 + 0.6, 1.2);
  }
  add(tyre, dark, 0, 0.5, -body / 2 + 1.5);
  add(new THREE.CylinderGeometry(0.1, 0.1, BELLY - 2.3, 10), grey, 0, (BELLY - 2.3) / 2 + 0.6, -body / 2 + 1.5);

  return {
    group,
    door: new THREE.Vector3(-RADIUS, BELLY - 0.2, -body / 2 + 1.6),
    heart: new THREE.Vector3(0, BELLY, 0),
  };
}
