import * as THREE from 'three';

/** What the windscreen looks out on: the runway (taxiing, taking off, landing) or the sky by time of day. */
export type ViewMode = 'runway' | 'day' | 'night' | 'dawn' | 'aurora';

const W = 1024;
const H = 300;

interface Sky {
  top: string;
  horizon: string;
  sea: [string, string];
}

const SKIES: Record<Exclude<ViewMode, 'runway'>, Sky> = {
  day: { top: '#2f6fc1', horizon: '#a9cfee', sea: ['#f1f5fb', '#b9c9dd'] },
  night: { top: '#03070f', horizon: '#0d1b38', sea: ['#0d1629', '#050a14'] },
  dawn: { top: '#2a3a6e', horizon: '#f2a46c', sea: ['#f0c7a4', '#7c6479'] },
  aurora: { top: '#02060e', horizon: '#0b2432', sea: ['#0b1a28', '#040a12'] },
};

/** A little seeded randomness, so the stars and clouds stay put between frames. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * The view through the windscreen, drawn onto one wide canvas that the four panes share. On the ground a
 * runway runs at you in perspective; in the air a sea of cloud drifts in from the horizon. The horizon
 * drops as the nose pitches up.
 */
export class ForwardView {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly stars: { x: number; y: number; r: number }[] = [];
  private readonly clouds: { x: number; z: number; w: number }[] = [];
  /** Metres of runway gone by, and how far the clouds have come. */
  private travel = 0;
  private drift = 0;

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const r = seeded(13);
    for (let i = 0; i < 160; i++) this.stars.push({ x: r() * W, y: r(), r: r() * 1.3 + 0.3 });
    for (let i = 0; i < 26; i++) this.clouds.push({ x: r(), z: r(), w: 0.4 + r() * 0.8 });
  }

  /** `speed` 0..1 (how fast the ground or the clouds go by), `pitch` in radians (nose up is positive). */
  update(dt: number, mode: ViewMode, speed: number, pitch: number, time: number): void {
    this.travel += dt * speed * 70;
    this.drift += dt * (0.015 + speed * 0.04);
    const g = this.g;
    const horizon = H * 0.5 + Math.max(-0.4, Math.min(0.5, pitch)) * H * 1.6;
    if (mode === 'runway') this.drawRunway(g, horizon);
    else this.drawAir(g, mode, horizon, time);
    this.texture.needsUpdate = true;
  }

  private drawRunway(g: CanvasRenderingContext2D, horizon: number): void {
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#5d8fc9');
    sky.addColorStop(1, '#d6e6f2');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const ground = g.createLinearGradient(0, horizon, 0, H);
    ground.addColorStop(0, '#8a9677');
    ground.addColorStop(1, '#4f5c3f');
    g.fillStyle = ground;
    g.fillRect(0, horizon, W, H - horizon);
    if (horizon >= H) return;
    // Perspective: `depth` metres ahead sits this far down from the horizon (1 at your feet).
    const k = 14;
    const down = (depth: number) => k / (Math.max(0.01, depth) + k);
    const yAt = (depth: number) => horizon + (H - horizon) * down(depth);
    const halfAt = (depth: number) => W * 0.46 * down(depth);
    const cx = W / 2;
    g.fillStyle = '#44474d';
    g.beginPath();
    g.moveTo(cx - halfAt(0), H);
    g.lineTo(cx + halfAt(0), H);
    g.lineTo(cx + halfAt(3000), yAt(3000));
    g.lineTo(cx - halfAt(3000), yAt(3000));
    g.fill();
    // Edge lines.
    g.strokeStyle = 'rgba(240, 240, 240, 0.85)';
    g.lineWidth = 2;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + side * halfAt(0) * 0.96, H);
      g.lineTo(cx + side * halfAt(3000) * 0.96, yAt(3000));
      g.stroke();
    }
    // Centre-line dashes rushing at you.
    g.fillStyle = '#f4f4f0';
    const spacing = 30;
    const offset = this.travel % spacing;
    for (let i = 0; i < 40; i++) {
      const near = i * spacing - offset;
      const far = near + 14;
      if (far <= 0.5) continue;
      const y0 = yAt(Math.max(0.5, near));
      const y1 = yAt(far);
      const w0 = halfAt(Math.max(0.5, near)) * 0.035;
      const w1 = halfAt(far) * 0.035;
      g.beginPath();
      g.moveTo(cx - w0, y0);
      g.lineTo(cx + w0, y0);
      g.lineTo(cx + w1, y1);
      g.lineTo(cx - w1, y1);
      g.fill();
    }
  }

  private drawAir(g: CanvasRenderingContext2D, mode: Exclude<ViewMode, 'runway'>, horizon: number, time: number): void {
    const sky = SKIES[mode];
    const top = g.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    top.addColorStop(0, sky.top);
    top.addColorStop(1, sky.horizon);
    g.fillStyle = top;
    g.fillRect(0, 0, W, H);
    if (mode === 'night' || mode === 'aurora') {
      g.fillStyle = '#ffffff';
      for (const s of this.stars) {
        const y = s.y * horizon * 0.95;
        g.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(time * 0.7 + s.x));
        g.fillRect(s.x, y, s.r, s.r);
      }
      g.globalAlpha = 1;
    }
    if (mode === 'aurora') {
      for (let band = 0; band < 3; band++) {
        g.strokeStyle = band === 1 ? 'rgba(120, 255, 190, 0.22)' : 'rgba(90, 220, 255, 0.16)';
        g.lineWidth = 26 - band * 6;
        g.beginPath();
        for (let x = 0; x <= W; x += 16) {
          const y = horizon * (0.3 + band * 0.12) + Math.sin(x * 0.006 + time * 0.25 + band) * 18;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    if (horizon >= H) return;
    // The cloud sea below: a gradient floor, and puffs coming in from the horizon.
    const sea = g.createLinearGradient(0, horizon, 0, H);
    sea.addColorStop(0, sky.sea[0]);
    sea.addColorStop(1, sky.sea[1]);
    g.fillStyle = sea;
    g.fillRect(0, horizon, W, H - horizon);
    const light = mode === 'day' ? 'rgba(255, 255, 255, 0.55)' : mode === 'dawn' ? 'rgba(255, 220, 190, 0.45)' : 'rgba(120, 140, 180, 0.12)';
    g.fillStyle = light;
    for (const c of this.clouds) {
      const z = (c.z + this.drift) % 1;
      const y = horizon + (H - horizon) * z * z;
      const w = (20 + c.w * 90) * (0.15 + z * 1.6);
      const x = W / 2 + (c.x - 0.5) * W * (0.4 + z * 1.4);
      g.beginPath();
      g.ellipse(x, y, w, w * 0.18, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  dispose(): void {
    this.texture.dispose();
  }
}
