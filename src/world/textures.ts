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

/** The view at dusk while rolling down the runway: sky above, terminal and grass below, edge lights near. */
export function runwayTexture(): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(1024, 512);
  const r = seeded(31);
  const horizon = 300;
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#26386b');
  sky.addColorStop(0.55, '#8c6a8f');
  sky.addColorStop(0.85, '#e79463');
  sky.addColorStop(1, '#f7c887');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1024, horizon);
  // Terminal, hangars and the tower on the horizon.
  g.fillStyle = '#2a2530';
  for (let x = 0; x < 1024; ) {
    const w = 20 + r() * 70;
    const h = 4 + r() * 16;
    g.fillRect(x, horizon - h, w, h);
    x += w + r() * 40;
  }
  g.fillRect(610, horizon - 42, 8, 42);
  g.fillRect(600, horizon - 50, 28, 10);
  const ground = g.createLinearGradient(0, horizon, 0, 512);
  ground.addColorStop(0, '#6f6655');
  ground.addColorStop(0.3, '#54573c');
  ground.addColorStop(1, '#3a4428');
  g.fillStyle = ground;
  g.fillRect(0, horizon, 1024, 512 - horizon);
  for (let i = 0; i < 5000; i++) {
    const y = horizon + r() * (512 - horizon);
    g.fillStyle = r() > 0.5 ? 'rgba(255,240,200,0.05)' : 'rgba(0,0,0,0.12)';
    g.fillRect(r() * 1024, y, 2 + ((y - horizon) / 212) * 6, 1 + ((y - horizon) / 212) * 2);
  }
  // Taxiway with blue lights, then our runway's edge with white lights, then the runway itself.
  g.fillStyle = '#4c4b4a';
  g.fillRect(0, 352, 1024, 12);
  for (let x = 0; x < 1024; x += 64) {
    g.fillStyle = 'rgba(90,140,255,0.9)';
    g.fillRect(x, 348, 4, 3);
  }
  g.fillStyle = '#2f3033';
  g.fillRect(0, 440, 1024, 72);
  g.fillStyle = '#d9d6cf';
  g.fillRect(0, 440, 1024, 4);
  for (let x = 0; x < 1024; x += 128) {
    const glow = g.createRadialGradient(x + 4, 432, 1, x + 4, 432, 14);
    glow.addColorStop(0, 'rgba(255,248,220,1)');
    glow.addColorStop(1, 'rgba(255,248,220,0)');
    g.fillStyle = glow;
    g.fillRect(x - 12, 418, 32, 28);
  }
  const texture = toTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  // A window shows the middle half: horizon in view, runway lights along the bottom.
  texture.repeat.set(1, 0.5);
  texture.offset.set(0, 0.06);
  return texture;
}

/** Sunrise: deep blue overhead, pink and orange toward the horizon. */
export function dawnSkyTexture(): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(512, 256);
  const r = seeded(41);
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#1d2c5c');
  sky.addColorStop(0.45, '#6d5d92');
  sky.addColorStop(0.75, '#ef8a63');
  sky.addColorStop(1, '#ffd89a');
  g.fillStyle = sky;
  g.fillRect(0, 0, 512, 256);
  const sun = g.createRadialGradient(300, 250, 4, 300, 250, 120);
  sun.addColorStop(0, 'rgba(255,244,210,0.95)');
  sun.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = sun;
  g.fillRect(0, 100, 512, 156);
  for (let i = 0; i < 40; i++) {
    const x = r() * 512;
    const y = 150 + r() * 90;
    const w = 30 + r() * 80;
    g.fillStyle = `rgba(${200 + r() * 55},${120 + r() * 60},${140 + r() * 40},0.35)`;
    g.beginPath();
    g.ellipse(x, y, w, 4 + r() * 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  const texture = toTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/** Night over the Bermuda Triangle: green curtains of light. */
export function auroraSkyTexture(): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(512, 256);
  const r = seeded(53);
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#020610');
  sky.addColorStop(0.6, '#051a24');
  sky.addColorStop(1, '#0c2c35');
  g.fillStyle = sky;
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 180; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.7})`;
    g.fillRect(r() * 512, r() * 150, 1, 1);
  }
  for (let x = 0; x < 512; x += 2) {
    const wave = Math.sin(x * 0.02) * 30 + Math.sin(x * 0.051 + 1) * 14;
    const top = 40 + wave;
    const height = 70 + Math.sin(x * 0.033) * 25;
    const band = g.createLinearGradient(0, top, 0, top + height);
    const a = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(x * 0.07));
    band.addColorStop(0, 'rgba(80,255,170,0)');
    band.addColorStop(0.7, `rgba(80,255,170,${a})`);
    band.addColorStop(1, 'rgba(120,90,255,0)');
    g.fillStyle = band;
    g.fillRect(x, top, 2, height);
  }
  const texture = toTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/** A soft puff for smoke sprites. */
export function smokeTexture(): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(128, 128);
  const r = seeded(61);
  for (let i = 0; i < 14; i++) {
    const x = 40 + r() * 48;
    const y = 40 + r() * 48;
    const radius = 18 + r() * 26;
    const puff = g.createRadialGradient(x, y, 0, x, y, radius);
    puff.addColorStop(0, 'rgba(255,255,255,0.32)');
    puff.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = puff;
    g.fillRect(0, 0, 128, 128);
  }
  return toTexture(canvas);
}

/** A flame tongue for fire sprites (drawn additively). */
export function flameTexture(): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(64, 128);
  const flame = g.createRadialGradient(32, 96, 2, 32, 80, 60);
  flame.addColorStop(0, 'rgba(255,246,210,1)');
  flame.addColorStop(0.25, 'rgba(255,190,80,0.9)');
  flame.addColorStop(0.6, 'rgba(230,80,20,0.35)');
  flame.addColorStop(1, 'rgba(120,20,0,0)');
  g.fillStyle = flame;
  g.beginPath();
  g.moveTo(32, 4);
  g.bezierCurveTo(56, 50, 60, 90, 32, 124);
  g.bezierCurveTo(4, 90, 8, 50, 32, 4);
  g.fill();
  return toTexture(canvas);
}

/** A blackened blast mark for the floor. */
export function scorchTexture(): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(256, 256);
  const r = seeded(71);
  for (let i = 0; i < 30; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * 60;
    const x = 128 + Math.cos(a) * d;
    const y = 128 + Math.sin(a) * d;
    const radius = 30 + r() * 60;
    const blot = g.createRadialGradient(x, y, 0, x, y, radius);
    blot.addColorStop(0, 'rgba(8,6,5,0.5)');
    blot.addColorStop(1, 'rgba(8,6,5,0)');
    g.fillStyle = blot;
    g.fillRect(0, 0, 256, 256);
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const a = r() * Math.PI * 2;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 20, 128 + Math.sin(a) * 20);
    g.lineTo(128 + Math.cos(a) * (70 + r() * 50), 128 + Math.sin(a) * (70 + r() * 50));
    g.stroke();
  }
  // Pale ash and a few embers, so the mark reads even on dark carpet.
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2;
    const d = 20 + r() * 80;
    g.fillStyle = `rgba(190,184,176,${0.12 + r() * 0.25})`;
    g.fillRect(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 1 + r() * 3, 1 + r() * 2);
  }
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * 40;
    g.fillStyle = `rgba(255,${90 + r() * 80},30,${0.35 + r() * 0.4})`;
    g.fillRect(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 1.5, 1.5);
  }
  return toTexture(canvas);
}

/** A soft round glow (for the fireball). */
export function glowTexture(): THREE.CanvasTexture {
  const [canvas, g] = makeCanvas(128, 128);
  const glow = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  glow.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 128, 128);
  return toTexture(canvas);
}
