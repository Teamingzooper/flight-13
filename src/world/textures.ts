import * as THREE from 'three';

/** Deterministic pseudo-random numbers so textures look the same on every load. */
function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext('2d')!];
}

function toTexture(canvas: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
  }
  return texture;
}

/** Dark airline carpet with a small repeating diamond pattern. */
export function carpetTexture(length: number): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(256, 256);
  g.fillStyle = '#1a2233';
  g.fillRect(0, 0, 256, 256);
  const r = seeded(7);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.14)';
    g.fillRect(r() * 256, r() * 256, 1.5, 1.5);
  }
  g.strokeStyle = 'rgba(126,152,214,0.16)';
  g.lineWidth = 2;
  for (let y = 0; y < 256; y += 32) {
    for (let x = (y / 32) % 2 ? 16 : 0; x < 256; x += 32) {
      g.beginPath();
      g.moveTo(x, y + 8);
      g.lineTo(x + 8, y);
      g.lineTo(x + 16, y + 8);
      g.lineTo(x + 8, y + 16);
      g.closePath();
      g.stroke();
    }
  }
  return toTexture(canvas, [3, Math.max(4, Math.round(length / 1.2))]);
}

/** Woven seat fabric. */
export function fabricTexture(): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(128, 128);
  g.fillStyle = '#26345a';
  g.fillRect(0, 0, 128, 128);
  const r = seeded(11);
  for (let y = 0; y < 128; y += 2) {
    g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.03})`;
    g.fillRect(0, y, 128, 1);
  }
  for (let x = 0; x < 128; x += 2) {
    g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.06})`;
    g.fillRect(x, 0, 1, 128);
  }
  for (let i = 0; i < 600; i++) {
    g.fillStyle = 'rgba(160,190,255,0.05)';
    g.fillRect(r() * 128, r() * 128, 2, 2);
  }
  return toTexture(canvas, [2, 2]);
}

/** What you see through a window: day clouds or a night sky. Wraps horizontally so it can drift. */
export function skyTexture(night: boolean): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(512, 256);
  const r = seeded(night ? 23 : 5);
  const sky = g.createLinearGradient(0, 0, 0, 256);
  if (night) {
    sky.addColorStop(0, '#02040b');
    sky.addColorStop(0.6, '#07112a');
    sky.addColorStop(1, '#13234a');
  } else {
    sky.addColorStop(0, '#3d7fd6');
    sky.addColorStop(0.55, '#8fc0f2');
    sky.addColorStop(1, '#e8f1fb');
  }
  g.fillStyle = sky;
  g.fillRect(0, 0, 512, 256);
  if (night) {
    for (let i = 0; i < 260; i++) {
      const a = 0.25 + r() * 0.75;
      g.fillStyle = `rgba(255,255,255,${a})`;
      const size = r() < 0.08 ? 1.6 : 1;
      g.fillRect(r() * 512, r() * 170, size, size);
    }
    const band = g.createLinearGradient(0, 180, 0, 256);
    band.addColorStop(0, 'rgba(40,60,110,0)');
    band.addColorStop(1, 'rgba(60,80,140,0.45)');
    g.fillStyle = band;
    g.fillRect(0, 180, 512, 76);
  } else {
    for (let i = 0; i < 70; i++) {
      const x = r() * 512;
      const y = 120 + r() * 130;
      const w = 30 + r() * 90;
      const h = 8 + r() * 22;
      const cloud = g.createRadialGradient(x, y, 1, x, y, w);
      cloud.addColorStop(0, 'rgba(255,255,255,0.85)');
      cloud.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cloud;
      g.save();
      g.translate(x, y);
      g.scale(1, h / w);
      g.translate(-x, -y);
      g.beginPath();
      g.arc(x, y, w, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
  const texture = toTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/** A lit sign such as EXIT or WC. */
export function signTexture(text: string, fg: string, bg: string, width = 256, height = 96): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(width, height);
  g.fillStyle = bg;
  g.fillRect(0, 0, width, height);
  g.fillStyle = fg;
  g.font = `700 ${Math.round(height * 0.62)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, width / 2, height / 2 + 2);
  return toTexture(canvas);
}

/** The seatbelt / no-smoking pictogram panel above each row. */
export function seatbeltSignTexture(): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(128, 64);
  g.fillStyle = '#0c0f14';
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#ffd27a';
  g.fillStyle = '#ffd27a';
  g.lineWidth = 4;
  // Seatbelt glyph: a seated figure with a strap.
  g.beginPath();
  g.arc(36, 18, 6, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(36, 26);
  g.lineTo(36, 42);
  g.lineTo(50, 42);
  g.lineTo(50, 54);
  g.stroke();
  g.beginPath();
  g.moveTo(26, 36);
  g.lineTo(46, 36);
  g.stroke();
  // No-smoking glyph.
  g.beginPath();
  g.arc(92, 32, 18, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(79, 45);
  g.lineTo(105, 19);
  g.stroke();
  g.fillRect(80, 30, 22, 5);
  return toTexture(canvas);
}

/** What other passengers' screens show: the airline idle loop. */
export function idleScreenTexture(): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(256, 160);
  const bg = g.createLinearGradient(0, 0, 256, 160);
  bg.addColorStop(0, '#0d2248');
  bg.addColorStop(1, '#050b19');
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = 'rgba(255,181,71,0.55)';
  g.setLineDash([3, 5]);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(30, 120);
  g.quadraticCurveTo(128, 30, 226, 120);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#ffb547';
  g.beginPath();
  g.arc(226, 120, 5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e8eefb';
  g.font = '700 22px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText('FLIGHT 13', 16, 30);
  return toTexture(canvas);
}
