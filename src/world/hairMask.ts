import type * as THREE from 'three';
import { FACE_SIZE } from '../net/face';
import { FACE_RADIUS, FACE_SPAN, HEAD_CENTER_Y, HEAD_SCALE, hairGeometries } from './scene/people';

const N = FACE_SIZE;
let geometries: (THREE.BufferGeometry | null)[] | null = null;
let skinDepth: Float32Array | null = null;
const masks = new Map<number, Uint8Array>();

/** How far forward the skin is (head-joint z; the face looks down -z) at each cell of the face grid; NaN off the head. */
function skin(): Float32Array {
  if (skinDepth) return skinDepth;
  skinDepth = new Float32Array(N * N);
  const scale = FACE_RADIUS / FACE_SPAN;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -((i + 0.5) / N - 0.5) * scale;
      const y = (0.5 - (j + 0.5) / N) * scale;
      const d = FACE_RADIUS * FACE_RADIUS - x * x - y * y;
      skinDepth[j * N + i] = d > 0 ? -Math.sqrt(d) * HEAD_SCALE.z : NaN;
    }
  }
  return skinDepth;
}

/**
 * Which cells of the face grid a hair style hides, seen from the front (1 = hair): the 3D hair's triangles,
 * flattened onto the face picture wherever they lie in front of the skin.
 */
export function hairMask(style: number): Uint8Array {
  const cached = masks.get(style);
  if (cached) return cached;
  geometries ??= hairGeometries();
  const mask = new Uint8Array(N * N);
  const geometry = geometries[style];
  if (geometry) {
    const depth = skin();
    const pos = geometry.getAttribute('position');
    const index = geometry.index;
    const count = index ? index.count : pos.count;
    const gx = (k: number) => (0.5 - (FACE_SPAN * (pos.getX(k) / HEAD_SCALE.x)) / FACE_RADIUS) * N;
    const gy = (k: number) => (0.5 - (FACE_SPAN * ((pos.getY(k) - HEAD_CENTER_Y) / HEAD_SCALE.y)) / FACE_RADIUS) * N;
    for (let t = 0; t + 2 < count; t += 3) {
      const a = index ? index.getX(t) : t;
      const b = index ? index.getX(t + 1) : t + 1;
      const c = index ? index.getX(t + 2) : t + 2;
      const ax = gx(a), ay = gy(a), bx = gx(b), by = gy(b), cx = gx(c), cy = gy(c);
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5));
      const x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx) - 0.5));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5));
      const y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy) - 0.5));
      for (let j = y0; j <= y1; j++) {
        for (let i = x0; i <= x1; i++) {
          const px = i + 0.5;
          const py = j + 0.5;
          const wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
          const wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
          const wc = 1 - wa - wb;
          if (wa < 0 || wb < 0 || wc < 0) continue;
          const z = wa * pos.getZ(a) + wb * pos.getZ(b) + wc * pos.getZ(c);
          const surface = depth[j * N + i];
          if (z < surface + 0.002) mask[j * N + i] = 1;
        }
      }
    }
  }
  masks.set(style, mask);
  return mask;
}
