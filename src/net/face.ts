/**
 * Faces are painted in black on a 64 x 64 grid, one bit per pixel, and travel as a short text string:
 * alternating runs of blank and ink (blank first) as LEB128 numbers, in URL-safe base64. A blank face
 * is the empty string. The grid covers the front of the head, ear to ear and brow to chin.
 */
export const FACE_SIZE = 64;
const PIXELS = FACE_SIZE * FACE_SIZE;
/** Longest accepted drawing in text form, so messages stay small. */
export const FACE_MAX_CHARS = 2400;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

function toText(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 1 >= bytes.length ? 2 : i + 2 >= bytes.length ? 3 : 4;
    for (let k = 0; k < chars; k++) out += ALPHABET[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}

function fromText(text: string): number[] | null {
  if (text.length % 4 === 1) return null;
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const v = k < chunk.length ? INDEX.get(chunk[k]) : 0;
      if (v === undefined) return null;
      n = (n << 6) | v;
    }
    bytes.push((n >> 16) & 255);
    if (chunk.length > 2) bytes.push((n >> 8) & 255);
    if (chunk.length > 3) bytes.push(n & 255);
  }
  return bytes;
}

export function encodeFace(ink: ArrayLike<number>): string {
  let any = false;
  for (let i = 0; i < PIXELS; i++) if (ink[i]) any = true;
  if (!any) return '';
  const bytes: number[] = [];
  const push = (n: number) => {
    while (n >= 128) {
      bytes.push((n & 127) | 128);
      n >>>= 7;
    }
    bytes.push(n);
  };
  let current = 0;
  let run = 0;
  for (let i = 0; i < PIXELS; i++) {
    const v = ink[i] ? 1 : 0;
    if (v === current) run++;
    else {
      push(run);
      current = v;
      run = 1;
    }
  }
  push(run);
  return toText(bytes);
}

/** The ink bitmap (1 = paint), or null when the text is not a valid face. */
export function decodeFace(text: string): Uint8Array | null {
  const ink = new Uint8Array(PIXELS);
  if (text === '') return ink;
  const bytes = fromText(text);
  if (!bytes) return null;
  let at = 0;
  let pos = 0;
  let value = 0;
  while (pos < bytes.length) {
    let n = 0;
    let shift = 0;
    for (;;) {
      if (pos >= bytes.length || shift > 21) return null;
      const b = bytes[pos++];
      n |= (b & 127) << shift;
      shift += 7;
      if (b < 128) break;
    }
    if (at + n > PIXELS) return null;
    if (value) ink.fill(1, at, at + n);
    at += n;
    value ^= 1;
  }
  return at === PIXELS ? ink : null;
}

/** A face from untrusted input, or '' (no drawing). */
export function cleanFace(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > FACE_MAX_CHARS) return '';
  return decodeFace(raw) ? raw : '';
}

// ---------- Ready-made faces (a start for drawing, and faces for bots) ----------

type Ink = Uint8Array;

function dab(ink: Ink, x: number, y: number, r: number): void {
  for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) {
    for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      if (xx < 0 || yy < 0 || xx >= FACE_SIZE || yy >= FACE_SIZE) continue;
      if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) ink[yy * FACE_SIZE + xx] = 1;
    }
  }
}

/** Paint a stroke of round dabs from (x0, y0) to (x1, y1). */
export function stroke(ink: Ink, x0: number, y0: number, x1: number, y1: number, r: number, erase = false): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(0.5, r * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (erase) {
      for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) {
        for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
          if (xx >= 0 && yy >= 0 && xx < FACE_SIZE && yy < FACE_SIZE && (xx - x) ** 2 + (yy - y) ** 2 <= r * r) ink[yy * FACE_SIZE + xx] = 0;
        }
      }
    } else {
      dab(ink, x, y, r);
    }
  }
}

function arc(ink: Ink, cx: number, cy: number, rx: number, ry: number, from: number, to: number, r: number): void {
  const steps = 40;
  let px = cx + Math.cos(from) * rx;
  let py = cy + Math.sin(from) * ry;
  for (let i = 1; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    stroke(ink, px, py, x, y, r);
    px = x;
    py = y;
  }
}

const DEG = Math.PI / 180;

function face(draw: (ink: Ink) => void): string {
  const ink = new Uint8Array(PIXELS);
  draw(ink);
  return encodeFace(ink);
}

const eyes = (ink: Ink) => {
  dab(ink, 22, 27, 3.2);
  dab(ink, 42, 27, 3.2);
};

export const FACE_TEMPLATES: readonly { name: string; face: string }[] = [
  {
    name: 'Smile',
    face: face((ink) => {
      eyes(ink);
      arc(ink, 32, 38, 12, 8, 20 * DEG, 160 * DEG, 1.6);
    }),
  },
  {
    name: 'Plain',
    face: face((ink) => {
      eyes(ink);
      stroke(ink, 25, 46, 39, 46, 1.5);
    }),
  },
  {
    name: 'Shocked',
    face: face((ink) => {
      arc(ink, 22, 26, 4.5, 4.5, 0, 360 * DEG, 1.2);
      arc(ink, 42, 26, 4.5, 4.5, 0, 360 * DEG, 1.2);
      dab(ink, 22, 26, 1.5);
      dab(ink, 42, 26, 1.5);
      arc(ink, 32, 46, 4, 5, 0, 360 * DEG, 1.4);
    }),
  },
  {
    name: 'Grumpy',
    face: face((ink) => {
      eyes(ink);
      stroke(ink, 16, 18, 27, 22, 1.6);
      stroke(ink, 48, 18, 37, 22, 1.6);
      arc(ink, 32, 52, 10, 6, 205 * DEG, 335 * DEG, 1.6);
    }),
  },
  {
    name: 'Sleepy',
    face: face((ink) => {
      arc(ink, 22, 25, 5, 3, 20 * DEG, 160 * DEG, 1.4);
      arc(ink, 42, 25, 5, 3, 20 * DEG, 160 * DEG, 1.4);
      arc(ink, 32, 46, 3, 2.5, 0, 360 * DEG, 1.2);
    }),
  },
  {
    name: 'Wink',
    face: face((ink) => {
      dab(ink, 22, 27, 3.2);
      stroke(ink, 38, 27, 46, 27, 1.5);
      arc(ink, 34, 40, 10, 6, 10 * DEG, 120 * DEG, 1.6);
    }),
  },
  {
    name: 'Mustache',
    face: face((ink) => {
      eyes(ink);
      arc(ink, 27, 40, 6, 3.5, 180 * DEG, 360 * DEG, 2.2);
      arc(ink, 37, 40, 6, 3.5, 180 * DEG, 360 * DEG, 2.2);
      stroke(ink, 28, 48, 36, 48, 1.2);
    }),
  },
];
