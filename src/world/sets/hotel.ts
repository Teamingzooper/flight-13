import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SKIN, TOP } from '../../app/Avatar';
import { ITEMS, ITEM_ORDER, MAX_PACKED, type ItemId, type Look } from '../../engine';
import { ITEM_COLORS, whenLabel } from '../../meta/shop';
import { cabinAudio } from '../audio';
import { Arms, GRAB_POINT, PINCH_POINT, handFacing } from './arms';
import { buildItem, disposeItem } from './items3d';

/**
 * The night before the flight: a hotel room, your carry-on on the bed, and everything you own laid out around it
 * (the Sons of the Forest inventory: things on a mat, seen from above, picked up by hand). Nothing here moves unless
 * your hands move it. The bag hangs from your hand; you swing it and throw it onto the bed. One hand steadies it
 * while the other pinches the zip and pulls it round, then fingers catch the lid's lip, lift it past upright and let
 * it fall open. Leaning over the bed, your hand follows the pointer: hover an item to read about it, click to have
 * your hand pick it up and set it in one of three pockets (click it again to take it back out). When packing ends
 * your hand flips the lid over, presses it shut, and zips it closed.
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
/** Props are shown a bit larger than life so they read well from above (the same size in the hand and the bag). */
const ITEM_SCALE = 1.2;
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
    // (Soft enough not to burn a hot spot into the wallpaper behind.)
    const bulb = new THREE.PointLight('#ffd6a0', 1.7, 6, 2);
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

/** One thing your hand does with an item: pick it up where it lies, carry it, set it down at `to`. */
interface Carry {
  inst: Instance;
  to: Pose;
  phase: CarryPhase;
  t: number;
  /** Where the hand's grab point was, and how it was turned, when this phase began. */
  from: THREE.Vector3;
  fromQuat: THREE.Quaternion;
}

type CarryPhase = 'reach' | 'dip' | 'grab' | 'lift' | 'carry' | 'lower' | 'release' | 'rise';
const CARRY_ORDER: readonly CarryPhase[] = ['reach', 'dip', 'grab', 'lift', 'carry', 'lower', 'release', 'rise'];
const CARRY_TIME: Record<CarryPhase, number> = { reach: 0.28, dip: 0.13, grab: 0.1, lift: 0.14, carry: 0.4, lower: 0.15, release: 0.1, rise: 0.16 };
/** How high the hand floats over the duvet while you look for something, and how high it lifts what it holds. */
const HOVER_HEIGHT = 0.16;
const CARRY_HEIGHT = 0.14;
/** Seconds a thrown bag is in the air. */
const FLIGHT = 0.5;
const GRAVITY = new THREE.Vector3(0, -9.81, 0);
/** Where your hand holds the bag: the top of the side handle, in the bag's own frame. */
const HANDLE = new THREE.Vector3(BAG.w / 2 + 0.004, 0.07 + 0.045, 0);
/** Where fingers catch the lid to lift it: under the front lip, in the lid's own frame. */
const LID_LIP = new THREE.Vector3(0, BAG.lid * 0.45, BAG.d + 0.012);
const DOWN = new THREE.Vector3(0, -1, 0);
/** The bag's handle sits in the curled fingers. */
const HANDLE_GRIP = GRAB_POINT;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class HotelSet {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.02, 30);
  private readonly bag: Suitcase;
  private readonly arms = new Arms();
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
  private closedSent = false;
  /** One-shot sounds already played in the current stage. */
  private readonly fired = new Set<string>();
  /** What your hand is doing with items, one after another. */
  private carries: Carry[] = [];
  /** The item in your hand, and where it sits in the hand. */
  private held: { inst: Instance; local: THREE.Matrix4 } | null = null;
  /** The lid's angle on its hinge, and how far round the zip pull is (0 shut, 1 all the way open). */
  private lidAngle = 0;
  private zip = 0;
  /** A lid let go of mid-swing, falling the rest of the way open. */
  private lidFall: { from: number; t: number } | null = null;
  /** The bag in your hand until you let go of it, then in the air until it lands. */
  private bagInHand = true;
  private flight: { from: THREE.Vector3; v: THREE.Vector3; quat: THREE.Quaternion; t: number } | null = null;
  /** The bag swinging from your hand, about the view's forward and sideways axes. */
  private readonly swing = new THREE.Vector2();
  private readonly swingVel = new THREE.Vector2();
  /** How far you are leaning in over the bed, 0 to 1. */
  private lean = 0;
  private shake = 0;
  /** Something your eyes follow (the bag in the air), or null. */
  private focus: THREE.Vector3 | null = null;
  /** Points round the zip, in the bag's frame, for finding where a hand has pulled it to. */
  private readonly zipSamples: THREE.Vector3[];

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
    this.scene.add(this.camera, this.arms.group);
    this.zipSamples = Array.from({ length: 97 }, (_, i) => this.bag.zipper.getPointAt(i / 96));

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
      // Touch has no hover: find what is under the finger straight away.
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

    this.applyCamera();
    this.placeHandsAtStart();
  }

  /** Your hands and sleeves: your skin, and your top's colour (a T-shirt or tank top leaves the forearms bare). */
  setLook(look: Look): void {
    this.arms.setLook(SKIN[look.skin] ?? SKIN[0], TOP[look.top] ?? TOP[0], look.topStyle === 1 || look.topStyle === 3);
  }

  /** How many of each item you own (what lies on the bed). */
  setInventory(owned: Record<ItemId, number>): void {
    if (ITEM_ORDER.every((id) => (owned[id] ?? 0) === this.owned[id])) return;
    this.owned = { ...owned };
    this.rebuild();
  }

  /** What is in the bag, slot by slot: your hand moves things in or out to match. */
  setPacked(packed: readonly ItemId[]): void {
    this.packed = [...packed];
    this.assignSlots(true);
  }

  /** Whether you can pick things up (not while a card is open, or once you are done). */
  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) this.setHover(null);
  }

  /** Throw the bag onto the bed and open it (once). */
  start(): void {
    if (this.stage !== 'wait') return;
    this.goto('toss');
  }

  /** Flip the lid shut and zip it up; `onClosed` fires when your hands are done. */
  close(): void {
    if (this.stage === 'closing' || this.stage === 'closed') return;
    // Joined late, or packing ended before the bag was even open: it is simply on the bed, shut.
    if (this.stage === 'wait' || this.stage === 'toss' || this.stage === 'land' || this.stage === 'unzip') {
      this.flight = null;
      this.bagInHand = false;
      this.restBag();
      this.lidAngle = 0;
      this.zip = 0;
      this.finishCarries();
      this.setHover(null);
      this.interactive = false;
      this.goto('closed');
      this.sendClosed();
      return;
    }
    this.finishCarries();
    this.lidFall = null;
    this.lidAngle = LID_OPEN;
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
      this.finishCarries();
      for (const inst of this.instances) inst.home = this.homePose(inst.item, inst.copy);
      if (!this.bagInHand) this.restBag();
      for (const inst of this.instances) this.place(inst, inst.slot === null ? inst.home : this.slotPose(inst.slot));
    }
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.stageTime += dt;
    // What the hands aim for, then where the eyes are, then the hands themselves, then whatever they hold.
    this.runStage(dt);
    this.applyCamera();
    const facing = new THREE.Vector3();
    this.camera.getWorldDirection(facing);
    this.arms.update(dt, this.camera.position, facing);
    this.applyHolds(dt);
    for (const inst of this.instances) this.glow(inst, dt);
    if (this.pointerInside && this.stage === 'ready') this.updateHover();
    this.dom.style.cursor = this.pointerInside && this.stage === 'ready' && this.interactive ? 'none' : '';
    this.placeTip();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.tip.remove();
    this.dom.style.cursor = '';
    for (const inst of this.instances) disposeItem(inst.root);
    this.arms.dispose();
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

  private sendClosed(): void {
    if (this.closedSent) return;
    this.closedSent = true;
    this.events.onClosed?.();
  }

  /** A point in front of your eyes: x to the right, y up, z towards you (so -z is ahead). */
  private eye(x: number, y: number, z: number): THREE.Vector3 {
    this.camera.updateMatrixWorld();
    return this.camera.localToWorld(new THREE.Vector3(x, y, z));
  }

  /** Straight ahead, level with the floor. */
  private ahead(): THREE.Vector3 {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    return f.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, -1) : f.normalize();
  }

  /** Palm down, fingers pointing ahead: reaching for things on the bed. */
  private palmDown(): THREE.Quaternion {
    return handFacing(this.ahead(), DOWN);
  }

  /** Where a hand waits when it has nothing to do: down at your side, out of sight. */
  private rest(side: 'left' | 'right'): THREE.Vector3 {
    const s = side === 'right' ? 1 : -1;
    return this.eye(0.34 * s, -0.46, 0.22);
  }

  /** Holding the bag, before you throw it: low on your right, the bag hanging from your hand. */
  private carryPoint(): THREE.Vector3 {
    return this.eye(0.27, -0.31, -0.58).add(new THREE.Vector3(0, Math.sin(this.time * 1.7) * 0.008, 0));
  }

  private placeHandsAtStart(): void {
    this.arms.right.snap(this.carryPoint(), this.palmDown());
    this.arms.right.targetGrip = this.arms.right.grip = 1;
    const rest = this.rest('left');
    this.arms.left.snap(rest, this.palmDown());
    this.bagInHand = true;
    this.lidAngle = 0;
    this.zip = 0;
    this.applyHolds(0);
  }

  private restBag(): void {
    this.bag.group.position.copy(this.layout.bag);
    this.bag.group.quaternion.identity();
    this.bag.group.scale.set(1, 1, 1);
  }

  /** The lid's catch point in the world, for a lid angle. */
  private lipAt(angle: number): { point: THREE.Vector3; quat: THREE.Quaternion } {
    const was = this.bag.lid.rotation.x;
    this.bag.lid.rotation.x = angle;
    this.bag.group.updateMatrixWorld(true);
    const point = this.bag.lid.localToWorld(LID_LIP.clone());
    const lidQuat = new THREE.Quaternion();
    this.bag.lid.getWorldQuaternion(lidQuat);
    this.bag.lid.rotation.x = was;
    this.bag.group.updateMatrixWorld(true);
    // Fingers over the lid towards the hinge, palm on its top.
    const quat = lidQuat.multiply(handFacing(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0)));
    return { point, quat };
  }

  /** The lid angle that puts its lip nearest `point` (a hand lifting the lid turns it about the hinge). */
  private lidAngleFor(point: THREE.Vector3): number {
    this.bag.group.updateMatrixWorld(true);
    const local = this.bag.group.worldToLocal(point.clone());
    const hinge = this.bag.lid.position;
    const dy = local.y - hinge.y;
    const dz = local.z - hinge.z;
    // The lip sits at LID_LIP from the hinge; turning the lid by a about x moves it from angle θ0 to θ0 - a (in the
    // hinge's z-y plane). Opening turns it negative, past -π when it lies open behind the bag.
    const lipAngle = Math.atan2(LID_LIP.y, LID_LIP.z);
    let angle = lipAngle - Math.atan2(dy, dz);
    if (angle > 0.5) angle -= 2 * Math.PI;
    return Math.max(LID_OPEN, Math.min(0, angle));
  }

  /** The zip pull's place along the zip, for u, in the world; and which way the zip runs there. */
  private pullAt(u: number): { point: THREE.Vector3; along: THREE.Vector3 } {
    this.bag.group.updateMatrixWorld(true);
    const p = this.bag.zipper.getPointAt(clamp01(u));
    const q = this.bag.zipper.getPointAt(clamp01(clamp01(u) + 0.01));
    const point = this.bag.group.localToWorld(p.clone().add(new THREE.Vector3(0, 0.006, 0)));
    const along = this.bag.group.localToWorld(q.clone()).sub(this.bag.group.localToWorld(p.clone())).normalize();
    return { point, along };
  }

  /** How far round the zip a hand at `point` has pulled it. */
  private zipFor(point: THREE.Vector3): number {
    this.bag.group.updateMatrixWorld(true);
    const local = this.bag.group.worldToLocal(point.clone());
    let best = 0;
    let bestD = Infinity;
    this.zipSamples.forEach((s, i) => {
      const d = s.distanceToSquared(local);
      if (d < bestD) {
        bestD = d;
        best = i / (this.zipSamples.length - 1);
      }
    });
    return best;
  }

  private runStage(dt: number): void {
    this.bag.group.updateMatrixWorld(true);
    const t = this.stageTime;
    const right = this.arms.right;
    const left = this.arms.left;
    this.focus = null;
    this.shake *= Math.exp(-dt * 9);
    switch (this.stage) {
      case 'wait': {
        this.lean = 0;
        right.stiffness = 70;
        right.reach(this.carryPoint(), this.palmDown(), HANDLE_GRIP);
        right.targetGrip = 1;
        left.stiffness = 60;
        left.reach(this.rest('left'), this.palmDown());
        break;
      }
      case 'toss': {
        this.lean = 0;
        const home = this.carryPoint();
        const wind = 0.34;
        if (t < wind) {
          // The wind-up: the arm swings back and down, the bag with it.
          const k = ease(t / wind);
          right.stiffness = 140;
          right.reach(home.clone().add(this.offsetInView(0.03 * k, -0.13 * k, 0.16 * k)), this.palmDown(), HANDLE_GRIP);
        } else if (this.bagInHand) {
          // The swing: forward and up at the bed, letting go near the top.
          const k = easeOut(clamp01((t - wind) / 0.2));
          right.stiffness = 260;
          right.reach(home.clone().add(this.offsetInView(0.03 - 0.1 * k, -0.13 + 0.3 * k, 0.16 - 0.56 * k)), this.palmDown(), HANDLE_GRIP);
          if (t >= wind + 0.15) this.letGoOfBag();
        } else {
          // Follow-through, then the arm drops away out of sight.
          const k = smooth(clamp01((t - 0.5) / 0.45));
          right.stiffness = 90;
          right.targetGrip = 0;
          right.reach(home.clone().add(this.offsetInView(-0.07, 0.17 - 0.3 * k, -0.4 + 0.2 * k)).lerp(this.rest('right'), k * k), this.palmDown());
        }
        if (this.flight) this.focus = this.bag.group.position;
        left.reach(this.rest('left'), this.palmDown());
        break;
      }
      case 'land': {
        this.lean = 0;
        right.reach(this.rest('right'), this.palmDown());
        left.reach(this.rest('left'), this.palmDown());
        if (t > 0.5) this.goto('unzip');
        break;
      }
      case 'unzip': {
        // You step up to the bed: one hand steadies the lid, the other pinches the zip and pulls it round.
        this.lean = 0.55 * smooth(clamp01(t / 0.7));
        left.stiffness = 70;
        left.targetGrip = 0.15;
        left.reach(this.bag.group.localToWorld(new THREE.Vector3(-0.13, BAG.h + BAG.lid + 0.004, 0.04)), this.palmDown());
        const start = this.pullAt(0);
        right.targetPinch = t > 0.45 ? 1 : 0;
        right.targetGrip = 0;
        if (t < 0.55) {
          right.stiffness = 90;
          right.reach(start.point, handFacing(start.along, DOWN), PINCH_POINT);
        } else if (t < 1.55) {
          if (t < 0.6) this.once('zip', () => cabinAudio.zipper(0.95));
          const u = smooth(clamp01((t - 0.55) / 0.95));
          const at = this.pullAt(u);
          right.stiffness = 220;
          right.reach(at.point, handFacing(at.along, DOWN), PINCH_POINT);
        } else {
          right.targetPinch = 0;
          const at = this.pullAt(1);
          right.reach(at.point.add(new THREE.Vector3(0, 0.05, 0)), handFacing(at.along, DOWN), PINCH_POINT);
        }
        if (t > 1.7) this.goto('open');
        break;
      }
      case 'open': {
        // Fingers under the lip, the lid lifted past upright, then let go to fall open onto the duvet.
        this.lean = 0.55 + 0.25 * smooth(clamp01(t / 0.9));
        left.reach(this.rest('left'), this.palmDown());
        const lift = 0.24;
        const let_go = 0.72;
        if (t < lift) {
          const lip = this.lipAt(0);
          right.stiffness = 110;
          right.targetGrip = t > lift * 0.7 ? 0.7 : 0;
          right.reach(lip.point, lip.quat);
        } else if (t < let_go) {
          const angle = -1.95 * ease(clamp01((t - lift) / (let_go - lift)));
          const lip = this.lipAt(angle);
          right.stiffness = 200;
          right.targetGrip = 0.7;
          right.reach(lip.point, lip.quat);
        } else {
          if (!this.lidFall) this.lidFall = { from: this.lidAngle, t: 0 };
          right.targetGrip = 0;
          right.stiffness = 70;
          right.reach(this.hoverRest(), this.palmDown());
        }
        if (t > 1.15) this.goto('enter');
        break;
      }
      case 'enter': {
        this.lean = 0.8 + 0.2 * smooth(clamp01(t / 0.6));
        this.arms.right.stiffness = 70;
        right.reach(this.hoverRest(), this.palmDown());
        left.reach(this.rest('left'), this.palmDown());
        if (t > 0.6) this.goto('ready');
        break;
      }
      case 'ready': {
        this.lean = 1;
        left.reach(this.rest('left'), this.palmDown());
        this.runCarries(dt);
        break;
      }
      case 'closing': {
        this.lean = 1;
        this.runClosing(t);
        break;
      }
      case 'closed': {
        this.lean = 1;
        right.targetGrip = 0;
        right.targetPinch = 0;
        right.reach(this.rest('right'), this.palmDown());
        left.reach(this.rest('left'), this.palmDown());
        break;
      }
    }
  }

  /** Lid flipped over and pressed shut, then zipped round, then hands away. */
  private runClosing(t: number): void {
    const right = this.arms.right;
    const left = this.arms.left;
    const reachLid = 0.36;
    const flipped = 1.0;
    const pressed = 1.16;
    const toPull = 1.36;
    const zipped = 2.1;
    if (t < reachLid) {
      const lip = this.lipAt(LID_OPEN);
      right.stiffness = 100;
      right.targetGrip = t > reachLid * 0.7 ? 0.7 : 0;
      right.reach(lip.point, lip.quat);
      left.reach(this.rest('left'), this.palmDown());
    } else if (t < flipped) {
      const k = ease(clamp01((t - reachLid) / (flipped - reachLid)));
      const lip = this.lipAt(LID_OPEN * (1 - k));
      right.stiffness = 200;
      right.targetGrip = 0.7;
      right.reach(lip.point, lip.quat);
    } else if (t < pressed) {
      // A firm press on the closed lid.
      const lip = this.lipAt(0);
      right.targetGrip = 0;
      right.reach(lip.point.add(new THREE.Vector3(0, -0.012, -0.08)), this.palmDown());
      this.once('shut', () => {
        cabinAudio.thud(0.6);
        this.shake = 0.004;
      });
    } else {
      // The left hand holds the lid down; the right runs the zip back round.
      left.stiffness = 80;
      left.targetGrip = 0.15;
      left.reach(this.bag.group.localToWorld(new THREE.Vector3(-0.13, BAG.h + BAG.lid + 0.004, 0.04)), this.palmDown());
      if (t < toPull) {
        const end = this.pullAt(1);
        right.stiffness = 100;
        right.targetPinch = t > toPull - 0.08 ? 1 : 0;
        right.reach(end.point, handFacing(end.along.clone().negate(), DOWN), PINCH_POINT);
      } else if (t < zipped + 0.25) {
        // (Held a moment at the end, so the hand really gets the pull there before letting go.)
        this.once('zip', () => cabinAudio.zipper(0.7));
        // (Aimed a touch past the end, so the pull really gets there.)
        const u = 1 - 1.06 * smooth(clamp01((t - toPull) / (zipped - toPull)));
        const at = this.pullAt(u);
        right.stiffness = 220;
        right.targetPinch = 1;
        right.reach(at.point, handFacing(at.along.clone().negate(), DOWN), PINCH_POINT);
      } else {
        right.targetPinch = 0;
        right.reach(this.rest('right'), this.palmDown());
        left.reach(this.rest('left'), this.palmDown());
      }
    }
    if (t > 2.6) {
      this.goto('closed');
      this.sendClosed();
    }
  }

  /** Let go of the bag mid-swing: it flies on from there and lands on the bed. */
  private letGoOfBag(): void {
    if (!this.bagInHand) return;
    this.bagInHand = false;
    this.arms.right.targetGrip = 0;
    const from = this.bag.group.position.clone();
    const to = this.layout.bag.clone();
    // The throw that carries it there in FLIGHT seconds (your swing, aimed at the middle of the bed).
    const v = to.sub(from).sub(GRAVITY.clone().multiplyScalar(0.5 * FLIGHT * FLIGHT)).divideScalar(FLIGHT);
    this.flight = { from, v, quat: this.bag.group.quaternion.clone(), t: 0 };
    cabinAudio.whoosh();
  }

  /** A vector in the view's frame (x right, y up, z towards you), in the world. */
  private offsetInView(x: number, y: number, z: number): THREE.Vector3 {
    const q = new THREE.Quaternion();
    this.camera.getWorldQuaternion(q);
    return new THREE.Vector3(x, y, z).applyQuaternion(q);
  }

  /** Where the hand floats over the middle of the bed while you think. */
  private hoverRest(): THREE.Vector3 {
    return this.layout.view.target.clone().add(new THREE.Vector3(0.12, HOVER_HEIGHT - 0.02, 0.22));
  }

  /** Whatever the hands hold moves with them: the bag, the zip pull, the lid, an item. */
  private applyHolds(dt: number): void {
    const right = this.arms.right;
    const bag = this.bag.group;
    // The bag hanging from your hand, swinging a little as the hand moves.
    if (this.bagInHand) {
      const v = right.velocity;
      const side = this.offsetInView(1, 0, 0);
      const fwd = this.offsetInView(0, 0, -1);
      this.swingVel.x += (-42 * this.swing.x - 5.5 * this.swingVel.x - v.dot(side) * 7) * dt;
      this.swingVel.y += (-42 * this.swing.y - 5.5 * this.swingVel.y + v.dot(fwd) * 7) * dt;
      this.swing.addScaledVector(this.swingVel, dt);
      const up = new THREE.Vector3(0, 1, 0);
      const across = new THREE.Vector3().crossVectors(this.ahead(), up).normalize();
      const face = new THREE.Vector3().crossVectors(across, up).normalize();
      const hang = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(up, face, across));
      const sway = new THREE.Quaternion()
        .setFromAxisAngle(this.ahead(), this.swing.x * 0.6)
        .multiply(new THREE.Quaternion().setFromAxisAngle(across, this.swing.y * 0.6));
      bag.quaternion.copy(sway.multiply(hang));
      bag.position.copy(right.point(HANDLE_GRIP)).sub(HANDLE.clone().applyQuaternion(bag.quaternion));
    } else if (this.flight) {
      const f = this.flight;
      f.t += dt;
      const k = Math.min(f.t, FLIGHT);
      bag.position.copy(f.from).addScaledVector(f.v, k).addScaledVector(GRAVITY, 0.5 * k * k);
      const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (1 - smooth(k / FLIGHT)) * 0.7);
      bag.quaternion.slerpQuaternions(f.quat, new THREE.Quaternion(), smooth(k / FLIGHT)).premultiply(spin);
      if (f.t >= FLIGHT) {
        this.flight = null;
        this.restBag();
        cabinAudio.thud(1);
        this.shake = 0.012;
        this.goto('land');
      }
    } else if (this.stage === 'land') {
      // A bounce on the springs, the shell squashing into the duvet.
      const t = this.stageTime;
      this.restBag();
      bag.position.y += 0.03 * Math.exp(-9 * t) * Math.abs(Math.sin(16 * t));
      bag.scale.y = 1 - 0.07 * Math.exp(-11 * t) * Math.cos(20 * t);
    } else if (this.stage === 'closing' && this.stageTime >= 1.0 && this.stageTime < 1.3) {
      // Squashed a touch under the press.
      const k = (this.stageTime - 1.0) / 0.3;
      this.restBag();
      bag.scale.y = 1 - 0.035 * Math.sin(Math.PI * k);
    } else {
      bag.scale.y = 1;
    }

    // The zip pull goes where a pinching hand pulls it (and stays put otherwise).
    if (right.pinch > 0.6) {
      const u = this.zipFor(right.point(PINCH_POINT));
      this.zip = this.stage === 'closing' ? Math.min(this.zip, u) : Math.max(this.zip, u);
    }
    this.placePull(this.zip);

    // The lid turns only when fingers hold its lip (or when it was let go of and falls the rest of the way).
    if (this.lidFall) {
      const f = this.lidFall;
      f.t += dt;
      const k = Math.min(1, (f.t / 0.3) ** 2);
      this.lidAngle = f.from + (LID_OPEN - f.from) * k;
      if (k >= 1) {
        const bounce = 0.07 * Math.exp(-8 * (f.t - 0.3)) * Math.abs(Math.sin(14 * (f.t - 0.3)));
        this.lidAngle = LID_OPEN + bounce;
        this.once('lid', () => cabinAudio.thud(0.45));
        if (f.t > 0.9) {
          this.lidFall = null;
          this.lidAngle = LID_OPEN;
        }
      }
    } else if (right.grip > 0.5 && (this.stage === 'open' || (this.stage === 'closing' && this.stageTime < 1.02))) {
      this.lidAngle = this.lidAngleFor(right.point());
    } else if (this.stage === 'closing' && this.stageTime >= 1.02) {
      this.lidAngle = 0;
    }
    this.bag.lid.rotation.x = this.lidAngle;

    // An item in your hand goes wherever your hand does.
    if (this.held) {
      const m = right.matrix().multiply(this.held.local);
      m.decompose(this.held.inst.root.position, this.held.inst.root.quaternion, new THREE.Vector3());
    }
  }

  private placePull(u: number): void {
    const p = this.bag.zipper.getPointAt(clamp01(u));
    const ahead = this.bag.zipper.getPointAt(clamp01(u + 0.01));
    this.bag.pull.position.copy(p).add(new THREE.Vector3(0, 0.004, 0));
    this.bag.pull.rotation.set(0, Math.atan2(ahead.x - p.x, ahead.z - p.z), 0);
  }

  /** Blend the eyes from standing at the foot of the bed (lean 0) to leaning over it (1), with a breath and a glance. */
  private applyCamera(): void {
    const lean = this.lean;
    const view = this.layout.view;
    const fov = view.fov;
    const half = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const distance = Math.max(1.05, view.halfHeight / half, view.halfWidth / (half * this.aspect));
    const over = view.target.clone().addScaledVector(view.dir, distance);
    const stand = this.layout.stand;
    const k = smooth(lean);
    const pos = new THREE.Vector3().lerpVectors(stand.pos, over, k);
    const target = new THREE.Vector3().lerpVectors(stand.target, view.target, k);
    // Breathing, a little parallax with the pointer, a glance after the bag in the air, a jolt when it lands.
    this.look.lerp(this.pointer, 0.06);
    pos.y += Math.sin(this.time * 1.3) * 0.004;
    target.x += this.look.x * 0.05 * k;
    target.z -= this.look.y * 0.03 * k;
    if (this.focus) target.lerp(this.focus, 0.3);
    if (this.shake > 0.0005) pos.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0));
    this.camera.fov = THREE.MathUtils.lerp(55, fov, k);
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  // ---------- Items ----------

  private homePose(item: ItemId, copy: number): Pose {
    const order = ITEM_ORDER.filter((id) => this.owned[id] > 0);
    const spot = this.layout.spots[Math.max(0, order.indexOf(item))] ?? this.layout.spots[0];
    // Copies make a small pile, the top one a little askew.
    const pos = new THREE.Vector3(spot.x + copy * 0.025, groundAt(spot.z) + copy * 0.018, spot.z + copy * 0.035);
    return pose(pos, spot.yaw + copy * 0.28, ITEM_SCALE);
  }

  private slotPose(slot: number): Pose {
    const base = this.layout.bag;
    return pose(new THREE.Vector3(base.x + SLOT_X[slot], base.y + this.bag.floorY, base.z), this.layout.slotYaw, ITEM_SCALE);
  }

  private rebuild(): void {
    this.finishCarries();
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

  /** Match instances to the packed list, keeping items already where they belong; the hand moves the rest. */
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
    // Your hand moves them (it gets to them once you are leaning over the bag: see runCarries).
    const byHand = animate;
    for (const inst of this.instances) {
      const slot = chosen.get(inst) ?? null;
      if (slot === inst.slot) continue;
      inst.slot = slot;
      const target = slot === null ? inst.home : this.slotPose(slot);
      // Already on its way somewhere: go there instead.
      const queued = this.carries.find((c) => c.inst === inst);
      if (queued) queued.to = target;
      else if (byHand) this.carries.push({ inst, to: target, phase: 'reach', t: 0, from: this.arms.right.point(), fromQuat: this.arms.right.quat.clone() });
      else this.place(inst, target);
    }
  }

  /** Everything the hand still had to move is where it goes, now. */
  private finishCarries(): void {
    for (const c of this.carries) this.place(c.inst, c.to);
    this.carries = [];
    this.held = null;
    this.arms.right.targetGrip = 0;
  }

  private place(inst: Instance, p: Pose): void {
    inst.from = inst.to = p;
    inst.t = 1;
    inst.root.position.copy(p.pos);
    inst.root.quaternion.copy(p.quat);
    inst.root.scale.setScalar(p.scale);
  }

  /** The top of an item where it lies: where fingers close on it. */
  private topOf(pos: THREE.Vector3): THREE.Vector3 {
    return pos.clone().add(new THREE.Vector3(0, 0.035 * ITEM_SCALE, 0));
  }

  /** Your hand at work: following the pointer over the bed, or moving an item in or out of the bag. */
  private runCarries(dt: number): void {
    const right = this.arms.right;
    const c = this.carries[0];
    if (!c) {
      // Hovering: over the thing under the pointer, or wherever the pointer is over the bed.
      right.stiffness = 75;
      right.targetPinch = 0;
      right.targetGrip = this.hovered ? 0.18 : 0.08;
      const at = this.hovered ? this.topOf(this.hovered.root.position).add(new THREE.Vector3(0, 0.07 + Math.sin(this.time * 3) * 0.004, 0)) : this.pointerOverBed();
      right.reach(at, this.palmDown());
      return;
    }
    c.t += dt;
    const k = clamp01(c.t / CARRY_TIME[c.phase]);
    const start = this.topOf(c.inst.root.position);
    const end = this.topOf(c.to.pos);
    const lifted = (p: THREE.Vector3, h: number) => p.clone().add(new THREE.Vector3(0, h, 0));
    let goal: THREE.Vector3;
    let turn = this.palmDown();
    right.stiffness = 170;
    switch (c.phase) {
      case 'reach':
        goal = c.from.clone().lerp(lifted(start, 0.09), ease(k));
        goal.y += Math.sin(Math.PI * k) * 0.03;
        right.targetGrip = 0.1;
        break;
      case 'dip':
        goal = lifted(start, 0.09 * (1 - ease(k)));
        right.targetGrip = 0.1;
        break;
      case 'grab':
        goal = start;
        right.targetGrip = 1;
        if (k >= 1 && !this.held) this.held = { inst: c.inst, local: right.matrix().invert().multiply(c.inst.root.matrixWorld.clone()) };
        break;
      case 'lift':
        goal = c.from.clone().lerp(lifted(c.from, CARRY_HEIGHT), ease(k));
        right.targetGrip = 1;
        break;
      case 'carry': {
        // Over to above where it goes, turning the wrist so it arrives the right way round.
        goal = c.from.clone().lerp(lifted(end, CARRY_HEIGHT), ease(k));
        goal.y += Math.sin(Math.PI * k) * 0.06;
        const localQuat = new THREE.Quaternion();
        if (this.held) this.held.local.decompose(new THREE.Vector3(), localQuat, new THREE.Vector3());
        const arrive = c.to.quat.clone().multiply(localQuat.invert());
        turn = c.fromQuat.clone().slerp(arrive, ease(k));
        right.targetGrip = 1;
        break;
      }
      case 'lower':
        goal = c.from.clone().lerp(end, ease(k));
        turn = c.fromQuat.clone();
        right.targetGrip = 1;
        break;
      case 'release':
        goal = end;
        turn = c.fromQuat.clone();
        right.targetGrip = 0.05;
        if (k >= 0.5 && this.held) {
          // Let go: it settles exactly where it belongs.
          this.held = null;
          this.place(c.inst, c.to);
          if (c.inst.slot !== null) cabinAudio.pop();
        }
        break;
      default:
        goal = c.from.clone().lerp(lifted(end, 0.1), ease(k));
        right.targetGrip = 0.05;
        break;
    }
    right.reach(goal, turn);
    if (k >= 1) {
      const next = CARRY_ORDER[CARRY_ORDER.indexOf(c.phase) + 1];
      if (next) {
        c.phase = next;
        c.t = 0;
        c.from = right.point();
        c.fromQuat = right.quat.clone();
      } else {
        this.carries.shift();
        const after = this.carries[0];
        if (after) {
          after.from = right.point();
          after.fromQuat = right.quat.clone();
        }
      }
    }
  }

  /** Where the pointer points on a plane just over the bed (kept over the bed). */
  private pointerOverBed(): THREE.Vector3 {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(SURFACE + HOVER_HEIGHT));
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return this.hoverRest();
    hit.x = Math.max(-0.9, Math.min(0.9, hit.x));
    hit.z = Math.max(-1.35, Math.min(0.1, hit.z));
    return hit;
  }

  /** A soft glow on what your hand is over (it lights up; it does not move). */
  private glow(inst: Instance, dt: number): void {
    const target = this.hovered === inst && this.interactive && this.carries.length === 0 ? 1 : 0;
    inst.hover += (target - inst.hover) * (1 - Math.exp(-14 * dt));
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
      this.instances.filter((i) => i !== this.held?.inst).map((i) => i.root),
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
    if (this.carries.some((c) => c.inst === inst)) return;
    if (inst.slot !== null) {
      this.events.onUnpack(inst.slot);
      setTimeout(() => cabinAudio.thud(0.25), 450);
    } else if (this.packed.length < MAX_PACKED) this.events.onPack(inst.item);
    else cabinAudio.nope();
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
