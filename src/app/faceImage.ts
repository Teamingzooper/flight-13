import { FACE_SIZE, decodeFace } from '../net/face';

const INK = [20, 18, 16];
/** How much the ink is softened on its own grid (in cells), and the level its outline is traced at. */
const SIGMA = 0.85;
const LEVEL = 0.45;
const KERNEL = (() => {
  const k = [-2, -1, 0, 1, 2].map((i) => Math.exp(-(i * i) / (2 * SIGMA * SIGMA)));
  const sum = k.reduce((a, b) => a + b, 0);
  return k.map((v) => v / sum);
})();

/** The ink blurred slightly on its own grid, so its outline can be traced smoothly between cells. */
function soften(ink: ArrayLike<number>): Float32Array {
  const n = FACE_SIZE;
  const across = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const xx = x + i;
        if (xx >= 0 && xx < n && ink[y * n + xx]) s += KERNEL[i + 2];
      }
      across[y * n + x] = s;
    }
  }
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const yy = y + i;
        if (yy >= 0 && yy < n) s += across[yy * n + x] * KERNEL[i + 2];
      }
      out[y * n + x] = s;
    }
  }
  return out;
}

/**
 * Paint a face's ink onto a canvas `size` pixels square. The 64 x 64 grid is softened and its outline traced
 * at full size, so strokes come out as round brush marks with clean, anti-aliased edges instead of blocks.
 */
export function paintFace(ink: ArrayLike<number>, size: number, color: readonly number[] = INK): HTMLCanvasElement {
  const n = FACE_SIZE;
  const field = soften(ink);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(size, size);
  const data = img.data;
  const cells = n / size;
  // Half an edge's width in field units: about one pixel, since the field climbs ~0.4 / SIGMA per cell there.
  const soft = Math.max(0.02, (0.2 / SIGMA) * cells);
  const at = (x: number, y: number) => field[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))];
  for (let py = 0; py < size; py++) {
    const gy = (py + 0.5) * cells - 0.5;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let px = 0; px < size; px++) {
      const gx = (px + 0.5) * cells - 0.5;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const a = at(x0, y0);
      const b = at(x0 + 1, y0);
      const c = at(x0, y0 + 1);
      const d = at(x0 + 1, y0 + 1);
      if (a + b + c + d < LEVEL - soft) continue;
      const v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      const t = Math.min(1, Math.max(0, (v - LEVEL + soft) / (2 * soft)));
      if (t === 0) continue;
      const i = (py * size + px) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

const urls = new Map<string, string>();

/** A face as an image URL, trimmed to the round of the head (null for no drawing). */
export function faceUrl(face: string | undefined): string | null {
  if (!face) return null;
  const cached = urls.get(face);
  if (cached) return cached;
  const ink = decodeFace(face);
  if (!ink || typeof document === 'undefined') return null;
  const canvas = paintFace(ink, 128);
  const g = canvas.getContext('2d')!;
  g.globalCompositeOperation = 'destination-in';
  g.beginPath();
  g.ellipse(64, 64, 62, 62, 0, 0, Math.PI * 2);
  g.fill();
  const url = canvas.toDataURL();
  urls.set(face, url);
  return url;
}
