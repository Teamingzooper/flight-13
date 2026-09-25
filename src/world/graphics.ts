import * as THREE from 'three';
import type { Quality } from '../app/prefs';

/**
 * What each graphics setting turns on. From Basic (anything that can draw a triangle) to Ultra (a fast desktop GPU):
 * resolution, shadows, post-processing, surface detail, light through the windows, and ambient occlusion.
 */
export interface GraphicsProfile {
  quality: Quality;
  /** Most pixels per CSS pixel (the screen's own ratio caps it). */
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Shadow edge softness (shadow-map texels). */
  shadowRadius: number;
  /** Post-processing: none (the renderer tone-maps), a light grade, or the full chain. */
  post: 'none' | 'light' | 'full';
  bloom: boolean;
  smaa: boolean;
  /** Hardware multisampling of the scene (0: off). */
  multisampling: number;
  /** Ambient occlusion (N8AO), and at which quality. */
  ao: 'off' | 'Low' | 'Medium' | 'High';
  /** Neutral keeps the colours true and bright windows from blowing out; ACES is the classic filmic look. */
  tone: 'aces' | 'neutral';
  grain: number;
  /** A hint of lens colour fringing at the edges. */
  fringe: boolean;
  /** Normal maps on fabric, plastics and carpet. */
  detail: boolean;
  /** Reflections of the cabin in glossy surfaces (the environment map). */
  environment: boolean;
  /** Light shafts through the windows, and dust drifting in them. */
  shafts: boolean;
  dust: boolean;
  anisotropy: number;
}

const PROFILES: Record<Quality, GraphicsProfile> = {
  basic: {
    quality: 'basic',
    pixelRatio: 0.75,
    shadows: false,
    shadowMapSize: 512,
    shadowRadius: 1,
    post: 'none',
    bloom: false,
    smaa: false,
    multisampling: 0,
    ao: 'off',
    tone: 'aces',
    grain: 0,
    fringe: false,
    detail: false,
    environment: false,
    shafts: false,
    dust: false,
    anisotropy: 1,
  },
  low: {
    quality: 'low',
    pixelRatio: 1,
    shadows: false,
    shadowMapSize: 512,
    shadowRadius: 1,
    post: 'light',
    bloom: false,
    smaa: false,
    multisampling: 0,
    ao: 'off',
    tone: 'aces',
    grain: 0,
    fringe: false,
    detail: false,
    environment: true,
    shafts: false,
    dust: false,
    anisotropy: 2,
  },
  medium: {
    quality: 'medium',
    pixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    shadowRadius: 1.5,
    post: 'full',
    bloom: true,
    smaa: false,
    multisampling: 0,
    ao: 'off',
    tone: 'neutral',
    grain: 0.06,
    fringe: false,
    detail: true,
    environment: true,
    shafts: false,
    dust: false,
    anisotropy: 4,
  },
  high: {
    quality: 'high',
    pixelRatio: 1.75,
    shadows: true,
    shadowMapSize: 2048,
    shadowRadius: 2.2,
    post: 'full',
    bloom: true,
    smaa: true,
    multisampling: 0,
    ao: 'Low',
    tone: 'neutral',
    grain: 0.05,
    fringe: false,
    detail: true,
    environment: true,
    shafts: true,
    dust: false,
    anisotropy: 8,
  },
  ultra: {
    quality: 'ultra',
    pixelRatio: 2.5,
    shadows: true,
    shadowMapSize: 4096,
    shadowRadius: 3,
    post: 'full',
    bloom: true,
    smaa: false,
    multisampling: 4,
    ao: 'High',
    tone: 'neutral',
    grain: 0.045,
    fringe: true,
    detail: true,
    environment: true,
    shafts: true,
    dust: true,
    anisotropy: 16,
  },
};

export function graphicsProfile(quality: Quality, touch: boolean): GraphicsProfile {
  const p = PROFILES[quality] ?? PROFILES.high;
  // Phones and tablets: never more than 1.25 pixels, and no multisampling (their GPUs share memory).
  return touch ? { ...p, pixelRatio: Math.min(p.pixelRatio, 1.25), multisampling: 0 } : p;
}

// ---------- Surface detail ----------

export type DetailKind = 'fabric' | 'plastic' | 'carpet' | 'leather' | 'brushed';

/** A normal map from a height field drawn on a canvas (Sobel slopes; `strength` steepens them). */
function normalMapFrom(height: (g: CanvasRenderingContext2D, size: number) => void, size: number, strength: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  height(g, size);
  const src = g.getImageData(0, 0, size, size);
  const out = g.createImageData(size, size);
  const h = (x: number, y: number) => src.data[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)) * strength;
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Height fields: a basket weave, fine moulded grain, cut carpet pile, pebbled leather, brushed metal. */
const HEIGHTS: Record<DetailKind, { size: number; strength: number; draw: (g: CanvasRenderingContext2D, size: number) => void }> = {
  fabric: {
    size: 128,
    strength: 2.2,
    draw(g, size) {
      g.fillStyle = '#808080';
      g.fillRect(0, 0, size, size);
      const cell = 4;
      for (let y = 0; y < size; y += cell) {
        for (let x = 0; x < size; x += cell) {
          // Over and under: alternate threads rise and fall.
          const over = ((x / cell + y / cell) % 2) === 0;
          const grad = g.createLinearGradient(x, y, over ? x + cell : x, over ? y : y + cell);
          grad.addColorStop(0, '#5a5a5a');
          grad.addColorStop(0.5, over ? '#e0e0e0' : '#c8c8c8');
          grad.addColorStop(1, '#5a5a5a');
          g.fillStyle = grad;
          g.fillRect(x, y, cell, cell);
        }
      }
    },
  },
  plastic: {
    size: 128,
    strength: 0.9,
    draw(g, size) {
      g.fillStyle = '#808080';
      g.fillRect(0, 0, size, size);
      const r = seeded(29);
      for (let i = 0; i < 2600; i++) {
        const v = 100 + Math.floor(r() * 56);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(r() * size, r() * size, 1 + r() * 1.5, 1 + r() * 1.5);
      }
    },
  },
  carpet: {
    size: 128,
    strength: 3,
    draw(g, size) {
      g.fillStyle = '#707070';
      g.fillRect(0, 0, size, size);
      const r = seeded(43);
      for (let i = 0; i < 5000; i++) {
        const v = Math.floor(60 + r() * 150);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.beginPath();
        g.arc(r() * size, r() * size, 0.6 + r() * 1.1, 0, Math.PI * 2);
        g.fill();
      }
    },
  },
  brushed: {
    size: 128,
    strength: 1.2,
    draw(g, size) {
      g.fillStyle = '#808080';
      g.fillRect(0, 0, size, size);
      const r = seeded(83);
      // Fine streaks all one way, as the brush left them.
      for (let i = 0; i < 700; i++) {
        const v = Math.floor(95 + r() * 70);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(r() * size, r() * size, 10 + r() * 50, 1);
      }
    },
  },
  leather: {
    size: 128,
    strength: 1.4,
    draw(g, size) {
      g.fillStyle = '#808080';
      g.fillRect(0, 0, size, size);
      const r = seeded(61);
      for (let i = 0; i < 900; i++) {
        const v = Math.floor(90 + r() * 90);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.beginPath();
        g.arc(r() * size, r() * size, 1.2 + r() * 2.2, 0, Math.PI * 2);
        g.fill();
      }
    },
  },
};

const detailMaps = new Map<DetailKind, THREE.CanvasTexture>();
function detailMap(kind: DetailKind): THREE.CanvasTexture {
  let map = detailMaps.get(kind);
  if (!map) {
    const h = HEIGHTS[kind];
    map = normalMapFrom(h.draw, h.size, h.strength);
    detailMaps.set(kind, map);
  }
  return map;
}

interface Detailed {
  kind: DetailKind;
  repeat: [number, number];
  scale: number;
}

const detailed = new Map<THREE.MeshStandardMaterial, Detailed>();
let detailOn = false;
let anisotropy = 8;

/**
 * Give a material surface detail (a normal map) when the graphics setting has it. `repeat`: how often the pattern
 * repeats across the material's UVs; `scale`: how pronounced it is.
 */
export function withDetail<M extends THREE.MeshStandardMaterial>(material: M, kind: DetailKind, repeat: [number, number] = [1, 1], scale = 1): M {
  detailed.set(material, { kind, repeat, scale });
  material.addEventListener('dispose', () => detailed.delete(material));
  applyTo(material);
  return material;
}

function applyTo(material: THREE.MeshStandardMaterial): void {
  const d = detailed.get(material);
  if (!d) return;
  if (detailOn) {
    // Each material gets its own view of the shared map (its own repeat), sharing the pixels.
    const map = detailMap(d.kind).clone();
    map.repeat.set(d.repeat[0], d.repeat[1]);
    map.anisotropy = anisotropy;
    material.normalMap?.dispose();
    material.normalMap = map;
    material.normalScale.set(d.scale, d.scale);
  } else if (material.normalMap) {
    material.normalMap.dispose();
    material.normalMap = null;
  }
  material.needsUpdate = true;
}

/** Turn surface detail on or off everywhere (and how sharp textures stay at a glancing angle). */
export function setDetail(on: boolean, aniso: number): void {
  if (on === detailOn && aniso === anisotropy) return;
  detailOn = on;
  anisotropy = aniso;
  for (const material of detailed.keys()) applyTo(material);
}
