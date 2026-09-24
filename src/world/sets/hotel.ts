import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ITEMS, ITEM_ORDER, MAX_PACKED, type ItemId } from '../../engine';
import { ITEM_COLORS, whenLabel } from '../../meta/shop';
import { cabinAudio } from '../audio';
import { buildItem, disposeItem } from './items3d';

/**
 * The night before the flight: a hotel room, your carry-on on the bed, and everything you own laid out
 * around it (the Sons of the Forest inventory: things on a mat, seen from above, picked up by hand).
 * You toss the bag onto the bed, it unzips and falls open, and the view leans in over the bed. Hover an
 * item to lift it and read about it; click to drop it into one of three pockets, click it again to take
 * it back out. When packing ends the lid comes down and the bag zips shut.
 */

export interface HotelEvents {
  onPack: (item: ItemId) => void;
  onUnpack: (slot: number) => void;
  /** The bag is zipped and the room can fade out. */
  onClosed?: () => void;
}

type Stage = 'wait' | 'toss' | 'land' | 'unzip' | 'open' | 'enter' | 'ready' | 'closing' | 'closed';
type Layout = 'wide' | 'tall';

interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

interface Instance {
  item: ItemId;
  copy: number;
  root: THREE.Group;
  home: Pose;
  slot: number | null;
  from: Pose;
  to: Pose;
  t: number;
  /** Hover glow and lift, 0..1, eased. */
  hover: number;
  glow: { material: THREE.MeshStandardMaterial; color: THREE.Color; intensity: number }[];
}

/** Top of the duvet. */
const SURFACE = 0.665;
/** The carry-on: base footprint and heights (the lid is shallower). */
const BAG = { w: 0.56, d: 0.38, h: 0.13, lid: 0.085, wall: 0.012, r: 0.045 };
/** Where the lid rests once it has fallen open onto the duvet. */
const LID_OPEN = -(Math.PI + 0.12);
const SLOT_X = [-0.18, 0, 0.18];
/** Props are shown a bit larger than life so they read well from above. */
const ON_BED_SCALE = 1.35;
const IN_BAG_SCALE = 1.08;
/** The runner lying across the foot of the bed (items there rest on top of it). */
const RUNNER = { z: -0.2, depth: 0.34, top: SURFACE + 0.008 };
const groundAt = (z: number) => (Math.abs(z - RUNNER.z) < RUNNER.depth / 2 ? RUNNER.top : SURFACE);
const HOVER_TINT = new THREE.Color('#ffb547');

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
  }
  return texture;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** An open-topped rounded tray (walls with thickness, and a floor), from y = 0 up to `h`. */
function tray(w: number, d: number, h: number, shell: THREE.Material, lining: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const outer = roundedRect(w, d, BAG.r);
  outer.holes.push(roundedRect(w - BAG.wall * 2, d - BAG.wall * 2, BAG.r - BAG.wall));
  const walls = new THREE.ExtrudeGeometry(outer, { depth: h, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2, curveSegments: 10 });
  walls.rotateX(-Math.PI / 2);
  const wallMesh = new THREE.Mesh(walls, shell);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  const floor = new THREE.ShapeGeometry(roundedRect(w, d, BAG.r), 10);
  floor.rotateX(Math.PI / 2);
  const floorMesh = new THREE.Mesh(floor, shell);
  floorMesh.castShadow = true;
  // The lining: a solid box drawn inside out, so from above you see its walls and floor.
  const inner = new THREE.ExtrudeGeometry(roundedRect(w - BAG.wall * 2 - 0.002, d - BAG.wall * 2 - 0.002, BAG.r - BAG.wall), {
    depth: h - 0.004,
    bevelEnabled: false,
    curveSegments: 10,
  });
  inner.rotateX(-Math.PI / 2);
  inner.translate(0, 0.004, 0);
  const liningMesh = new THREE.Mesh(inner, lining);
  liningMesh.receiveShadow = true;
  g.add(wallMesh, floorMesh, liningMesh);
  return g;
}

interface Suitcase {
  group: THREE.Group;
  lid: THREE.Group;
  pull: THREE.Group;
  zipper: THREE.CatmullRomCurve3;
  /** Where things go inside, relative to the base. */
  floorY: number;
}

function buildSuitcase(): Suitcase {
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: '#1e4d5c', roughness: 0.42, metalness: 0.15 });
  const lining = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.95,
    side: THREE.BackSide,
    map: canvasTexture(
      256,
      256,
      (g) => {
        g.fillStyle = '#4b5463';
        g.fillRect(0, 0, 256, 256);
        g.strokeStyle = 'rgba(255,255,255,0.05)';
        for (let i = -256; i < 256; i += 10) {
          g.beginPath();
          g.moveTo(i, 0);
          g.lineTo(i + 256, 256);
          g.stroke();
        }
      },
      [3, 3],
    ),
  });
  const base = tray(BAG.w, BAG.d, BAG.h, shell, lining);
  group.add(base);

  // Three padded pockets, split by elastic straps: one per carry-on item.
  const pad = new THREE.MeshStandardMaterial({ color: '#5d6879', roughness: 0.9 });
  const floorY = 0.02;
  for (const x of SLOT_X) {
    const pocket = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.016, 0.31, 2, 0.006), pad);
    pocket.position.set(x, 0.012, 0);
    pocket.receiveShadow = true;
    group.add(pocket);
  }
  const strap = new THREE.MeshStandardMaterial({ color: '#262b33', roughness: 0.8 });
  for (const x of [-0.09, 0.09]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.075, BAG.d - BAG.wall * 2), strap);
    band.position.set(x, 0.045, 0);
    band.castShadow = true;
    group.add(band);
  }

  // Wheels at one end and a carry handle at the other.
  const rubber = new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.7 });
  for (const z of [-0.13, 0.13]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.022, 16), rubber);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(-BAG.w / 2 - 0.014, 0.03, z);
    wheel.castShadow = true;
    group.add(wheel);
  }
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.009, 8, 20, Math.PI), rubber);
  handle.rotation.set(0, Math.PI / 2, 0);
  handle.position.set(BAG.w / 2 + 0.004, 0.07, 0);
  handle.castShadow = true;
  group.add(handle);

  // The lid hinges on the back edge of the base.
  const lid = new THREE.Group();
  lid.position.set(0, BAG.h, -BAG.d / 2);
  const lidTray = tray(BAG.w, BAG.d, BAG.lid, shell, lining);
  lidTray.rotation.x = Math.PI;
  lidTray.position.set(0, BAG.lid, BAG.d / 2);
  lid.add(lidTray);
  // Hard-shell ribs on the outside of the lid.
  const rib = new THREE.MeshStandardMaterial({ color: '#23596a', roughness: 0.4, metalness: 0.15 });
  for (const x of [-0.16, 0, 0.16]) {
    const r = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.008, BAG.d - 0.06, 2, 0.003), rib);
    r.position.set(x, BAG.lid + 0.004, BAG.d / 2);
    r.castShadow = true;
    lid.add(r);
  }
  // Folded clothes under a mesh net inside the lid (face up once it is open).
  const clothes = ['#e9e4d8', '#2a3b5f', '#b3413b', '#7a8c6a'];
  clothes.forEach((c, i) => {
    const shirt = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.022, 0.13, 3, 0.009), new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
    shirt.position.set(-0.12 + (i % 2) * 0.24, BAG.lid - 0.03 - (i > 1 ? 0.024 : 0), BAG.d / 2 + (i > 1 ? 0.03 : -0.05));
    shirt.rotation.y = (i - 1.5) * 0.06;
    lid.add(shirt);
  });
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(BAG.w - 0.05, BAG.d - 0.05),
    new THREE.MeshStandardMaterial({
      transparent: true,
      roughness: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      map: canvasTexture(
        128,
        128,
        (g) => {
          g.clearRect(0, 0, 128, 128);
          g.strokeStyle = 'rgba(20,24,30,0.55)';
          g.lineWidth = 1.5;
          for (let i = 0; i < 128; i += 8) {
            g.beginPath();
            g.moveTo(i, 0);
            g.lineTo(i, 128);
            g.moveTo(0, i);
            g.lineTo(128, i);
            g.stroke();
          }
        },
        [5, 4],
      ),
    }),
  );
  net.rotation.x = Math.PI / 2;
  net.position.set(0, 0.012, BAG.d / 2);
  lid.add(net);
  group.add(lid);

  // The zipper runs round the front and sides of the seam.
  const hw = BAG.w / 2 + 0.002;
  const hd = BAG.d / 2 + 0.002;
  const zipper = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(hw, BAG.h, -hd + 0.03),
      new THREE.Vector3(hw, BAG.h, hd - 0.04),
      new THREE.Vector3(hw - 0.04, BAG.h, hd),
      new THREE.Vector3(-hw + 0.04, BAG.h, hd),
      new THREE.Vector3(-hw, BAG.h, hd - 0.04),
      new THREE.Vector3(-hw, BAG.h, -hd + 0.03),
    ],
    false,
    'catmullrom',
    0.2,
  );
  const teeth = new THREE.Mesh(new THREE.TubeGeometry(zipper, 80, 0.004, 6, false), new THREE.MeshStandardMaterial({ color: '#16191d', roughness: 0.6 }));
  group.add(teeth);
  const pull = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.25, metalness: 1 });
  const slider = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.01, 0.014), metal);
  const tab = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.004, 0.03, 2, 0.002), metal);
  tab.position.set(0, 0.004, 0.022);
  slider.castShadow = tab.castShadow = true;
  pull.add(slider, tab);
  group.add(pull);
  return { group, lid, pull, zipper, floorY };
}

/** The room around the bed. Returns the lamp shades' lights so they can flicker gently. */
function buildRoom(scene: THREE.Scene): void {
  const room = new THREE.Group();
  scene.add(room);
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, shadows = true) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.receiveShadow = shadows;
    m.castShadow = shadows;
    room.add(m);
    return m;
  };

  const carpet = new THREE.MeshStandardMaterial({
    roughness: 1,
    map: canvasTexture(
      256,
      256,
      (g) => {
        g.fillStyle = '#23302f';
        g.fillRect(0, 0, 256, 256);
        g.strokeStyle = 'rgba(210,190,140,0.12)';
        g.lineWidth = 2;
        for (let i = 0; i <= 256; i += 64) {
          for (let j = 0; j <= 256; j += 64) {
            g.beginPath();
            g.moveTo(i, j - 24);
            g.lineTo(i + 24, j);
            g.lineTo(i, j + 24);
            g.lineTo(i - 24, j);
            g.closePath();
            g.stroke();
          }
        }
      },
      [5, 5],
    ),
  });
  add(new THREE.PlaneGeometry(4.8, 4.6), carpet, 0, 0, -0.2, -Math.PI / 2, 0, 0, false).receiveShadow = true;
  const wallpaper = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    map: canvasTexture(
      256,
      256,
      (g) => {
        g.fillStyle = '#d6c8ad';
        g.fillRect(0, 0, 256, 256);
        g.fillStyle = 'rgba(160,138,100,0.18)';
        for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 12, 256);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        for (let y = 16; y < 256; y += 32) for (let x = 22; x < 256; x += 32) g.fillRect(x, y, 4, 4);
      },
      [4, 2],
    ),
  });
  add(new THREE.PlaneGeometry(4.8, 2.7), wallpaper, 0, 1.35, -2.15, 0, 0, 0, false).receiveShadow = true;
  add(new THREE.PlaneGeometry(4.6, 2.7), wallpaper, 2.35, 1.35, -0.2, 0, -Math.PI / 2, 0, false).receiveShadow = true;
  add(new THREE.PlaneGeometry(4.6, 2.7), wallpaper, -2.35, 1.35, -0.2, 0, Math.PI / 2, 0, false).receiveShadow = true;
  add(new THREE.PlaneGeometry(4.8, 2.7), wallpaper, 0, 1.35, 2.1, 0, Math.PI, 0, false);
  add(new THREE.PlaneGeometry(4.8, 4.6), new THREE.MeshStandardMaterial({ color: '#e7e1d6', roughness: 1 }), 0, 2.7, -0.2, Math.PI / 2, 0, 0, false);
  // Skirting boards.
  const trim = new THREE.MeshStandardMaterial({ color: '#efe9dd', roughness: 0.6 });
  add(new THREE.BoxGeometry(4.8, 0.1, 0.02), trim, 0, 0.05, -2.14, 0, 0, 0, false);

  // The bed: base, mattress, duvet, a runner across the foot, pillows, a padded headboard.
  const wood = new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: 0.55 });
  add(new RoundedBoxGeometry(1.74, 0.34, 2.08, 3, 0.03), wood, 0, 0.17, -1.0);
  add(new RoundedBoxGeometry(1.62, 0.26, 2.0, 4, 0.08), new THREE.MeshStandardMaterial({ color: '#f1ede4', roughness: 0.95 }), 0, 0.47, -1.0);
  const duvet = new THREE.MeshStandardMaterial({
    roughness: 0.97,
    map: canvasTexture(
      512,
      512,
      (g) => {
        g.fillStyle = '#e8e2d6';
        g.fillRect(0, 0, 512, 512);
        g.strokeStyle = 'rgba(140,122,95,0.2)';
        g.lineWidth = 2;
        for (let i = -512; i < 1024; i += 48) {
          g.beginPath();
          g.moveTo(i, 0);
          g.lineTo(i + 512, 512);
          g.moveTo(i + 512, 0);
          g.lineTo(i, 512);
          g.stroke();
        }
        const r = rng(7);
        for (let n = 0; n < 4000; n++) {
          g.fillStyle = `rgba(120,110,90,${r() * 0.05})`;
          g.fillRect(r() * 512, r() * 512, 2, 2);
        }
      },
      [2, 2],
    ),
  });
  add(new RoundedBoxGeometry(1.74, 0.07, 1.72, 4, 0.034), duvet, 0, SURFACE - 0.035, -0.86);
  const runner = new THREE.MeshStandardMaterial({
    roughness: 0.85,
    map: canvasTexture(512, 64, (g) => {
      g.fillStyle = '#1f4750';
      g.fillRect(0, 0, 512, 64);
      g.fillStyle = '#c8a45a';
      g.fillRect(0, 7, 512, 3);
      g.fillRect(0, 54, 512, 3);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      for (let x = 0; x < 512; x += 16) g.fillRect(x, 18, 8, 28);
    }),
  });
  add(new RoundedBoxGeometry(1.8, 0.02, RUNNER.depth, 2, 0.008), runner, 0, RUNNER.top - 0.01, RUNNER.z);
  const pillowMat = new THREE.MeshStandardMaterial({ color: '#fbf9f4', roughness: 0.95 });
  for (const [x, z, tilt] of [
    [-0.4, -1.83, 0.5],
    [0.4, -1.83, 0.5],
    [-0.38, -1.66, 0.25],
    [0.38, -1.66, 0.25],
  ] as const) {
    const p = add(new RoundedBoxGeometry(0.66, 0.16, 0.36, 4, 0.07), pillowMat, x, SURFACE + 0.07 + tilt * 0.1, z, tilt, 0, 0);
    p.scale.set(1, 0.9, 1);
  }
  const headboard = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    map: canvasTexture(512, 320, (g) => {
      g.fillStyle = '#34465a';
      g.fillRect(0, 0, 512, 320);
      for (let y = 40; y < 320; y += 64) {
        for (let x = (y / 64) % 2 ? 32 : 64; x < 512; x += 64) {
          const grad = g.createRadialGradient(x, y, 1, x, y, 30);
          grad.addColorStop(0, 'rgba(0,0,0,0.45)');
          grad.addColorStop(0.2, 'rgba(0,0,0,0.12)');
          grad.addColorStop(1, 'rgba(255,255,255,0.03)');
          g.fillStyle = grad;
          g.fillRect(x - 32, y - 32, 64, 64);
        }
      }
    }),
  });
  add(new RoundedBoxGeometry(1.95, 1.25, 0.1, 3, 0.04), headboard, 0, 0.95, -2.08);

  // Nightstands with lamps; a painting over the bed; a window onto the city at night.
  const lampShade = new THREE.MeshStandardMaterial({ color: '#f4e3c1', roughness: 0.8, emissive: '#ffcc88', emissiveIntensity: 1.05, side: THREE.DoubleSide });
  const brass = new THREE.MeshStandardMaterial({ color: '#b8904d', roughness: 0.35, metalness: 0.9 });
  for (const side of [-1, 1]) {
    add(new RoundedBoxGeometry(0.5, 0.56, 0.44, 2, 0.02), wood, side * 1.18, 0.28, -1.84);
    add(new THREE.CylinderGeometry(0.05, 0.08, 0.3, 16), brass, side * 1.18, 0.71, -1.86);
    const shade = add(new THREE.CylinderGeometry(0.13, 0.18, 0.24, 24, 1, true), lampShade, side * 1.18, 0.98, -1.86, 0, 0, 0, false);
    shade.castShadow = false;
    const bulb = new THREE.PointLight('#ffc27a', 3.2, 6, 2);
    bulb.position.set(side * 1.18, 0.98, -1.86);
    room.add(bulb);
  }
  const painting = new THREE.MeshStandardMaterial({
    roughness: 0.7,
    map: canvasTexture(512, 256, (g) => {
      const grad = g.createLinearGradient(0, 0, 512, 256);
      grad.addColorStop(0, '#20344f');
      grad.addColorStop(1, '#c47a4a');
      g.fillStyle = grad;
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = 'rgba(255,230,190,0.85)';
      g.beginPath();
      g.arc(360, 110, 42, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#10192a';
      g.beginPath();
      g.moveTo(0, 256);
      g.lineTo(140, 150);
      g.lineTo(260, 210);
      g.lineTo(380, 120);
      g.lineTo(512, 200);
      g.lineTo(512, 256);
      g.fill();
    }),
  });
  add(new THREE.BoxGeometry(1.1, 0.58, 0.03), new THREE.MeshStandardMaterial({ color: '#2a2016', roughness: 0.5 }), 0, 1.95, -2.13, 0, 0, 0, false);
  add(new THREE.PlaneGeometry(1.02, 0.5), painting, 0, 1.95, -2.112, 0, 0, 0, false);

  const city = new THREE.MeshBasicMaterial({
    map: canvasTexture(1024, 512, (g) => {
      const sky = g.createLinearGradient(0, 0, 0, 512);
      sky.addColorStop(0, '#060b1c');
      sky.addColorStop(0.7, '#17223f');
      sky.addColorStop(1, '#3b2a33');
      g.fillStyle = sky;
      g.fillRect(0, 0, 1024, 512);
      const r = rng(13);
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.6})`;
        g.fillRect(r() * 1024, r() * 200, 1.5, 1.5);
      }
      let x = 0;
      while (x < 1024) {
        const w = 40 + r() * 90;
        const h = 90 + r() * 280;
        g.fillStyle = '#070a13';
        g.fillRect(x, 512 - h, w, h);
        for (let wy = 512 - h + 10; wy < 505; wy += 14) {
          for (let wx = x + 6; wx < x + w - 6; wx += 11) {
            if (r() < 0.38) {
              g.fillStyle = r() < 0.7 ? `rgba(255,214,150,${0.5 + r() * 0.5})` : `rgba(170,210,255,${0.4 + r() * 0.4})`;
              g.fillRect(wx, wy, 5, 7);
            }
          }
        }
        x += w + 4 + r() * 10;
      }
    }),
  });
  add(new THREE.PlaneGeometry(2.2, 1.55), city, -2.34, 1.55, -0.2, 0, Math.PI / 2, 0, false);
  const frame = new THREE.MeshStandardMaterial({ color: '#dcd4c6', roughness: 0.5 });
  add(new THREE.BoxGeometry(0.06, 1.65, 0.06), frame, -2.33, 1.55, -1.3, 0, 0, 0, false);
  add(new THREE.BoxGeometry(0.06, 1.65, 0.06), frame, -2.33, 1.55, 0.9, 0, 0, 0, false);
  add(new THREE.BoxGeometry(0.06, 0.06, 2.3), frame, -2.33, 0.76, -0.2, 0, 0, 0, false);
  add(new THREE.BoxGeometry(0.06, 0.06, 2.3), frame, -2.33, 2.34, -0.2, 0, 0, 0, false);
  const drape = new THREE.MeshStandardMaterial({ color: '#5a2a33', roughness: 0.95, side: THREE.DoubleSide });
  for (const z of [-1.55, 1.15]) {
    const g = new THREE.PlaneGeometry(0.55, 2.5, 24, 1);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 34) * 0.035);
    g.computeVertexNormals();
    add(g, drape, -2.25, 1.35, z, 0, Math.PI / 2, 0);
  }

  // Light: the lamps, a warm downlight over the bed (the one that casts the item shadows), moonlight, fill.
  scene.add(new THREE.HemisphereLight('#44506e', '#2a2018', 0.45));
  const key = new THREE.SpotLight('#ffe2bf', 15, 6, 0.75, 0.85, 2);
  key.position.set(0.25, 2.55, -0.45);
  key.target.position.set(0, SURFACE, -0.78);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  const moon = new THREE.DirectionalLight('#7f98d8', 0.45);
  moon.position.set(-3, 2.2, 0.2);
  scene.add(moon);
}

interface LayoutSpec {
  bag: THREE.Vector3;
  spots: { x: number; z: number; yaw: number }[];
  slotYaw: number;
  /** Where the eye looks from, as a direction from `target`, and how much must fit on screen. */
  view: { dir: THREE.Vector3; target: THREE.Vector3; fov: number; halfWidth: number; halfHeight: number };
  stand: { pos: THREE.Vector3; target: THREE.Vector3 };
}

function layoutFor(kind: Layout): LayoutSpec {
  const jitter = rng(31);
  const j = () => (jitter() - 0.5) * 0.5;
  if (kind === 'wide') {
    const spots = [
      ...[-1.12, -0.8, -0.48].map((z) => ({ x: -0.62, z, yaw: j() })),
      ...[-1.12, -0.8, -0.48].map((z) => ({ x: 0.62, z, yaw: j() })),
      ...[-0.34, 0, 0.34].map((x) => ({ x, z: -0.24, yaw: j() })),
    ];
    return {
      bag: new THREE.Vector3(0, SURFACE, -0.74),
      spots,
      slotYaw: Math.PI / 2,
      view: { dir: new THREE.Vector3(0, 0.8, 0.6).normalize(), target: new THREE.Vector3(0, SURFACE, -0.72), fov: 50, halfWidth: 0.84, halfHeight: 0.62 },
      stand: { pos: new THREE.Vector3(0.2, 1.66, 1.05), target: new THREE.Vector3(0, SURFACE, -0.8) },
    };
  }
  const spots: LayoutSpec['spots'] = [];
  for (const z of [-0.62, -0.38, -0.14]) for (const x of [-0.25, 0, 0.25]) spots.push({ x, z, yaw: Math.PI / 2 + j() * 0.6 });
  return {
    bag: new THREE.Vector3(0, SURFACE, -0.98),
    spots,
    slotYaw: Math.PI / 2,
    view: { dir: new THREE.Vector3(0, 0.97, 0.24).normalize(), target: new THREE.Vector3(0, SURFACE, -0.8), fov: 60, halfWidth: 0.42, halfHeight: 0.86 },
    stand: { pos: new THREE.Vector3(0.1, 1.72, 0.95), target: new THREE.Vector3(0, SURFACE, -0.9) },
  };
}

const pose = (pos: THREE.Vector3, yaw: number, scale = 1): Pose => ({
  pos,
  quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
  scale,
});

export class HotelSet {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.02, 30);
  private readonly bag: Suitcase;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(0, 0);
  private readonly look = new THREE.Vector2(0, 0);
  private readonly tip = document.createElement('div');
  private readonly offs: (() => void)[] = [];
  private instances: Instance[] = [];
  private owned: Record<ItemId, number> = Object.fromEntries(ITEM_ORDER.map((id) => [id, 0])) as Record<ItemId, number>;
  private packed: ItemId[] = [];
  private layoutKind: Layout = 'wide';
  private layout = layoutFor('wide');
  private aspect = 1.6;
  private stage: Stage = 'wait';
  private stageTime = 0;
  private interactive = false;
  private hovered: Instance | null = null;
  private down: { x: number; y: number } | null = null;
  private pointerInside = false;
  private time = 0;
  private readonly bagHand = new THREE.Vector3();
  private closedSent = false;
  /** One-shot sounds already played in the current stage. */
  private readonly fired = new Set<string>();

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly dom: HTMLElement,
    private readonly container: HTMLElement,
    private readonly events: HotelEvents,
  ) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.15;
    pmrem.dispose();
    this.scene.background = new THREE.Color('#0b0d12');
    buildRoom(this.scene);
    this.bag = buildSuitcase();
    this.scene.add(this.bag.group);
    this.scene.add(this.camera);

    this.tip.className = 'hotel-tip';
    this.tip.hidden = true;
    container.appendChild(this.tip);

    const listen = <T extends Event>(type: string, fn: (e: T) => void) => {
      dom.addEventListener(type, fn as EventListener);
      this.offs.push(() => dom.removeEventListener(type, fn as EventListener));
    };
    listen<PointerEvent>('pointermove', (e) => {
      this.setPointer(e);
      this.pointerInside = true;
    });
    listen<PointerEvent>('pointerleave', () => {
      this.pointerInside = false;
      this.setHover(null);
    });
    listen<PointerEvent>('pointerdown', (e) => {
      this.setPointer(e);
      this.pointerInside = true;
      this.down = { x: e.clientX, y: e.clientY };
      // Touch has no hover: pick up what is under the finger straight away.
      this.updateHover();
    });
    listen<PointerEvent>('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
      this.setPointer(e);
      this.updateHover();
      this.pick();
    });

    this.placeBagInHand();
    this.applyCamera(0);
  }

  /** How many of each item you own (what lies on the bed). */
  setInventory(owned: Record<ItemId, number>): void {
    if (ITEM_ORDER.every((id) => (owned[id] ?? 0) === this.owned[id])) return;
    this.owned = { ...owned };
    this.rebuild();
  }

  /** What is in the bag, slot by slot; items fly in or out to match. */
  setPacked(packed: readonly ItemId[]): void {
    this.packed = [...packed];
    this.assignSlots(true);
  }

  /** Whether you can pick things up (not while a card is open, or once you are done). */
  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) this.setHover(null);
  }

  /** Toss the bag onto the bed and open it (once). */
  start(): void {
    if (this.stage !== 'wait') return;
    this.goto('toss');
    cabinAudio.whoosh();
  }

  /** Lid down, zip up; `onClosed` fires when it is done. */
  close(): void {
    if (this.stage === 'closing' || this.stage === 'closed') return;
    // Skipped straight to the end (joined late): the bag is simply on the bed, shut.
    if (this.stage === 'wait' || this.stage === 'toss' || this.stage === 'land') this.restBag();
    this.setHover(null);
    this.interactive = false;
    this.goto('closing');
  }

  get closed(): boolean {
    return this.stage === 'closed';
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    const kind: Layout = this.aspect >= 0.95 ? 'wide' : 'tall';
    if (kind !== this.layoutKind) {
      this.layoutKind = kind;
      this.layout = layoutFor(kind);
      for (const inst of this.instances) inst.home = this.homePose(inst.item, inst.copy);
      if (this.stage === 'wait' || this.stage === 'toss') this.placeBagInHand();
      else this.restBag();
      this.assignSlots(true);
      for (const inst of this.instances) if (inst.slot === null) this.travel(inst, inst.home);
    }
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.stageTime += dt;
    this.runStage();
    for (const inst of this.instances) this.animate(inst, dt);
    if (this.pointerInside && this.stage === 'ready') this.updateHover();
    this.placeTip();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.tip.remove();
    this.dom.style.cursor = '';
    for (const inst of this.instances) disposeItem(inst.root);
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of materials) {
        for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
        m.dispose();
      }
    });
    this.scene.environment?.dispose();
  }

  // ---------- The sequence ----------

  private goto(stage: Stage): void {
    this.stage = stage;
    this.stageTime = 0;
    this.fired.clear();
  }

  private once(cue: string, play: () => void): void {
    if (this.fired.has(cue)) return;
    this.fired.add(cue);
    play();
  }

  private placeBagInHand(): void {
    const stand = this.layout.stand;
    this.bagHand.copy(stand.pos).add(new THREE.Vector3(0.36, -0.64, -0.68));
    this.bag.group.position.copy(this.bagHand);
    this.bag.group.quaternion.setFromEuler(new THREE.Euler(0.25, -0.6, 1.35));
    this.bag.group.scale.set(1, 1, 1);
    this.bag.lid.rotation.x = 0;
    this.placePull(0);
  }

  private restBag(): void {
    this.bag.group.position.copy(this.layout.bag);
    this.bag.group.quaternion.identity();
    this.bag.group.scale.set(1, 1, 1);
  }

  private placePull(u: number): void {
    const p = this.bag.zipper.getPointAt(clamp01(u));
    const ahead = this.bag.zipper.getPointAt(clamp01(u + 0.01));
    this.bag.pull.position.copy(p).add(new THREE.Vector3(0, 0.004, 0));
    this.bag.pull.rotation.set(0, Math.atan2(ahead.x - p.x, ahead.z - p.z), 0);
  }

  private runStage(): void {
    const t = this.stageTime;
    const bag = this.bag.group;
    switch (this.stage) {
      case 'wait': {
        // The bag in your hand sways a little while you read your boarding pass.
        bag.position.copy(this.bagHand).add(new THREE.Vector3(0, Math.sin(this.time * 1.7) * 0.01, 0));
        this.applyCamera(0);
        break;
      }
      case 'toss': {
        const d = 0.78;
        const k = clamp01(t / d);
        const rest = this.layout.bag;
        bag.position.lerpVectors(this.bagHand, rest, k);
        bag.position.y += 0.42 * 4 * k * (1 - k);
        const from = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, -0.6, 1.35));
        const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (1 - smooth(k)) * 0.9, 0));
        bag.quaternion.slerpQuaternions(from, new THREE.Quaternion(), smooth(k)).premultiply(spin);
        this.applyCamera(0);
        if (k >= 1) {
          this.goto('land');
          cabinAudio.thud(1);
        }
        break;
      }
      case 'land': {
        this.restBag();
        // A bounce on the springs, and the shell squashing into the duvet.
        bag.position.y += 0.03 * Math.exp(-9 * t) * Math.abs(Math.sin(16 * t));
        bag.scale.y = 1 - 0.07 * Math.exp(-11 * t) * Math.cos(20 * t);
        this.applyCamera(0, 0.012 * Math.exp(-10 * t));
        if (t > 0.45) {
          bag.scale.y = 1;
          this.goto('unzip');
          cabinAudio.zipper(0.95);
        }
        break;
      }
      case 'unzip': {
        this.placePull(smooth(clamp01(t / 0.95)));
        this.applyCamera(0);
        if (t > 1.05) this.goto('open');
        break;
      }
      case 'open': {
        const k = clamp01(t / 0.62);
        const swing = k < 1 ? LID_OPEN * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2) : LID_OPEN;
        // It flops onto the duvet with a little bounce.
        const bounce = k >= 1 ? 0.07 * Math.exp(-8 * (t - 0.62)) * Math.abs(Math.sin(14 * (t - 0.62))) : 0;
        this.bag.lid.rotation.x = swing + bounce;
        if (k >= 1) this.once('lid', () => cabinAudio.thud(0.45));
        this.applyCamera(0);
        if (t > 0.95) this.goto('enter');
        break;
      }
      case 'enter': {
        this.bag.lid.rotation.x = LID_OPEN;
        this.applyCamera(smooth(clamp01(t / 0.9)));
        if (t > 0.9) this.goto('ready');
        break;
      }
      case 'ready':
        this.bag.lid.rotation.x = LID_OPEN;
        this.applyCamera(1);
        break;
      case 'closing': {
        const k = clamp01(t / 0.6);
        this.bag.lid.rotation.x = LID_OPEN * (1 - smooth(k));
        if (k >= 1) this.once('shut', () => cabinAudio.thud(0.6));
        if (t > 0.65) {
          this.placePull(1 - smooth(clamp01((t - 0.65) / 0.7)));
          this.once('zip', () => cabinAudio.zipper(0.7));
        }
        this.applyCamera(1);
        if (t > 1.5) {
          this.goto('closed');
          if (!this.closedSent) {
            this.closedSent = true;
            this.events.onClosed?.();
          }
        }
        break;
      }
      case 'closed':
        this.bag.lid.rotation.x = 0;
        this.placePull(0);
        this.applyCamera(1);
        break;
    }
  }

  /** Blend the camera from standing at the foot of the bed (0) to leaning over it (1). */
  private applyCamera(lean: number, shake = 0): void {
    const view = this.layout.view;
    const fov = view.fov;
    const half = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const distance = Math.max(1.05, view.halfHeight / half, view.halfWidth / (half * this.aspect));
    const over = view.target.clone().addScaledVector(view.dir, distance);
    const stand = this.layout.stand;
    const pos = new THREE.Vector3().lerpVectors(stand.pos, over, lean);
    const target = new THREE.Vector3().lerpVectors(stand.target, view.target, lean);
    // Breathing, a little parallax with the pointer, and any shake from the landing bag.
    this.look.lerp(this.pointer, 0.06);
    pos.y += Math.sin(this.time * 1.3) * 0.004;
    target.x += this.look.x * 0.05;
    target.z -= this.look.y * 0.03;
    if (shake > 0) pos.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0));
    this.camera.fov = THREE.MathUtils.lerp(55, fov, lean);
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
  }

  // ---------- Items ----------

  private homePose(item: ItemId, copy: number): Pose {
    const order = ITEM_ORDER.filter((id) => this.owned[id] > 0);
    const spot = this.layout.spots[Math.max(0, order.indexOf(item))] ?? this.layout.spots[0];
    // Copies make a small pile, the top one a little askew.
    const pos = new THREE.Vector3(spot.x + copy * 0.025, groundAt(spot.z) + copy * 0.018, spot.z + copy * 0.035);
    return pose(pos, spot.yaw + copy * 0.28, ON_BED_SCALE);
  }

  private slotPose(slot: number): Pose {
    const base = this.layout.bag;
    return pose(new THREE.Vector3(base.x + SLOT_X[slot], base.y + this.bag.floorY, base.z), this.layout.slotYaw, IN_BAG_SCALE);
  }

  private rebuild(): void {
    for (const inst of this.instances) {
      this.scene.remove(inst.root);
      disposeItem(inst.root);
    }
    this.instances = [];
    this.hovered = null;
    for (const item of ITEM_ORDER) {
      const copies = Math.min(this.owned[item], MAX_PACKED);
      for (let copy = 0; copy < copies; copy++) {
        const root = new THREE.Group();
        root.add(buildItem(item));
        root.userData.item = item;
        const glow: Instance['glow'] = [];
        root.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of materials) if (m instanceof THREE.MeshStandardMaterial) glow.push({ material: m, color: m.emissive.clone(), intensity: m.emissiveIntensity });
        });
        const home = this.homePose(item, copy);
        const inst: Instance = { item, copy, root, home, slot: null, from: home, to: home, t: 1, hover: 0, glow };
        root.userData.instance = inst;
        this.place(inst, home);
        this.scene.add(root);
        this.instances.push(inst);
      }
    }
    this.assignSlots(false);
  }

  /** Match instances to the packed list, keeping items that are already where they belong. */
  private assignSlots(animate: boolean): void {
    const chosen = new Map<Instance, number>();
    const taken = new Set<Instance>();
    this.packed.forEach((item, slot) => {
      const keep = this.instances.find((i) => i.slot === slot && i.item === item && !taken.has(i));
      if (keep) {
        chosen.set(keep, slot);
        taken.add(keep);
      }
    });
    this.packed.forEach((item, slot) => {
      if ([...chosen.values()].includes(slot)) return;
      const inBag = this.instances.find((i) => i.item === item && i.slot !== null && !taken.has(i));
      const onBed = this.instances.filter((i) => i.item === item && i.slot === null && !taken.has(i)).sort((a, b) => b.copy - a.copy)[0];
      const inst = inBag ?? onBed;
      if (inst) {
        chosen.set(inst, slot);
        taken.add(inst);
      }
    });
    for (const inst of this.instances) {
      const slot = chosen.get(inst) ?? null;
      if (slot === inst.slot) continue;
      const packing = slot !== null && inst.slot === null;
      inst.slot = slot;
      const target = slot === null ? inst.home : this.slotPose(slot);
      if (animate) {
        this.travel(inst, target);
        if (packing) setTimeout(() => cabinAudio.pop(), 380);
      } else {
        this.place(inst, target);
      }
    }
  }

  private place(inst: Instance, p: Pose): void {
    inst.from = inst.to = p;
    inst.t = 1;
    inst.root.position.copy(p.pos);
    inst.root.quaternion.copy(p.quat);
    inst.root.scale.setScalar(p.scale);
  }

  private travel(inst: Instance, p: Pose): void {
    inst.from = { pos: inst.root.position.clone(), quat: inst.root.quaternion.clone(), scale: inst.root.scale.x };
    inst.to = p;
    inst.t = 0;
  }

  private animate(inst: Instance, dt: number): void {
    const target = this.hovered === inst && this.interactive ? 1 : 0;
    inst.hover += (target - inst.hover) * (1 - Math.exp(-14 * dt));
    if (inst.t < 1) inst.t = Math.min(1, inst.t + dt / 0.46);
    const k = easeOut(inst.t);
    const r = inst.root;
    r.position.lerpVectors(inst.from.pos, inst.to.pos, k);
    // Lifted over the edge of the bag on the way in or out.
    r.position.y += Math.sin(Math.PI * inst.t) * 0.2;
    r.quaternion.slerpQuaternions(inst.from.quat, inst.to.quat, k);
    r.scale.setScalar(THREE.MathUtils.lerp(inst.from.scale, inst.to.scale, k));
    // Hovered: picked up a little, tilted towards you, glowing.
    r.position.y += inst.hover * 0.035;
    r.rotateX(-inst.hover * 0.12);
    for (const g of inst.glow) {
      g.material.emissive.copy(g.color).lerp(HOVER_TINT, inst.hover * 0.8);
      g.material.emissiveIntensity = THREE.MathUtils.lerp(g.intensity, Math.max(g.intensity, 0.5), inst.hover);
    }
  }

  // ---------- Pointer ----------

  private setPointer(e: PointerEvent): void {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  private updateHover(): void {
    if (!this.interactive || this.stage !== 'ready') {
      this.setHover(null);
      return;
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.instances.map((i) => i.root),
      true,
    );
    let found: Instance | null = null;
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.instance) o = o.parent;
      if (o) {
        found = o.userData.instance as Instance;
        break;
      }
    }
    this.setHover(found);
  }

  private setHover(inst: Instance | null): void {
    if (inst === this.hovered) return;
    this.hovered = inst;
    this.dom.style.cursor = inst ? 'pointer' : '';
    if (!inst) {
      this.tip.hidden = true;
      return;
    }
    const info = ITEMS[inst.item];
    const full = this.packed.length >= MAX_PACKED;
    const action = inst.slot !== null ? 'Click to take it out' : full ? 'Your carry-on is full' : 'Click to pack it';
    const count = this.owned[inst.item];
    this.tip.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'hotel-tip-head';
    const name = document.createElement('b');
    name.textContent = info.name;
    name.style.color = ITEM_COLORS[inst.item];
    const when = document.createElement('span');
    when.className = `when when-${info.automatic ? 'auto' : info.when}`;
    when.textContent = whenLabel(info.when, info.automatic);
    head.append(name, when);
    const blurb = document.createElement('p');
    blurb.textContent = info.blurb;
    const foot = document.createElement('div');
    foot.className = 'hotel-tip-foot';
    foot.textContent = `${action}${count > 1 ? ` · you have ${count}` : ''}`;
    this.tip.append(head, blurb, foot);
    this.tip.hidden = false;
  }

  private pick(): void {
    const inst = this.hovered;
    if (!inst || !this.interactive || this.stage !== 'ready') return;
    if (inst.slot !== null) this.events.onUnpack(inst.slot);
    else if (this.packed.length < MAX_PACKED) this.events.onPack(inst.item);
  }

  /** Keep the tooltip beside the hovered item. */
  private placeTip(): void {
    const inst = this.hovered;
    if (!inst || this.tip.hidden) return;
    const p = inst.root.position.clone().add(new THREE.Vector3(0, 0.08, 0)).project(this.camera);
    const rect = this.dom.getBoundingClientRect();
    const host = this.container.getBoundingClientRect();
    const x = rect.left - host.left + ((p.x + 1) / 2) * rect.width;
    const y = rect.top - host.top + ((1 - p.y) / 2) * rect.height;
    const right = x < host.width * 0.6;
    this.tip.style.left = `${right ? x + 24 : x - 24}px`;
    this.tip.style.top = `${y}px`;
    this.tip.style.transform = `translate(${right ? '0' : '-100%'}, -50%)`;
  }
}
