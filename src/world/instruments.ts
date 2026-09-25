import * as THREE from 'three';

/** How the plane is flying, for the flight displays. */
export interface Attitude {
  /** Knots. */
  speed: number;
  /** Feet. */
  altitude: number;
  /** Radians, nose up positive. */
  pitch: number;
  /** Radians, right wing down positive. */
  roll: number;
}

const S = 256;
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

/** A primary flight display: the attitude ball with its pitch ladder, a speed tape and an altitude tape. */
export class FlightDisplay {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private drawnAt = -Infinity;

  constructor() {
    this.canvas.width = S;
    this.canvas.height = S;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  /** Redraw (at most ten times a second). */
  draw(a: Attitude, time: number): void {
    if (time - this.drawnAt < 0.1) return;
    this.drawnAt = time;
    const g = this.g;
    g.fillStyle = '#05070b';
    g.fillRect(0, 0, S, S);

    // The attitude ball: sky over ground, tilted with the wings and shifted with the nose.
    const cx = S / 2;
    const cy = S / 2 - 6;
    const r = 78;
    const perDegree = 3.2;
    g.save();
    g.beginPath();
    g.rect(cx - r, cy - r, r * 2, r * 2);
    g.clip();
    g.translate(cx, cy);
    g.rotate(-a.roll);
    g.translate(0, ((a.pitch * 180) / Math.PI) * perDegree);
    g.fillStyle = '#2f7fd3';
    g.fillRect(-S, -S * 2, S * 2, S * 2);
    g.fillStyle = '#7a4a26';
    g.fillRect(-S, 0, S * 2, S * 2);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-S, 0);
    g.lineTo(S, 0);
    g.stroke();
    g.font = `600 11px ${FONT}`;
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    for (const deg of [-20, -10, 10, 20]) {
      const y = -deg * perDegree;
      const half = Math.abs(deg) === 10 ? 26 : 38;
      g.beginPath();
      g.moveTo(-half, y);
      g.lineTo(half, y);
      g.stroke();
      g.fillText(String(Math.abs(deg)), half + 4, y + 4);
    }
    g.restore();
    // The aircraft symbol, fixed in the middle.
    g.strokeStyle = '#ffcc33';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx - 44, cy);
    g.lineTo(cx - 14, cy);
    g.lineTo(cx - 14, cy + 8);
    g.moveTo(cx + 44, cy);
    g.lineTo(cx + 14, cy);
    g.lineTo(cx + 14, cy + 8);
    g.stroke();
    g.fillStyle = '#ffcc33';
    g.fillRect(cx - 3, cy - 3, 6, 6);

    // Speed on the left, altitude on the right.
    const tape = (x: number, value: string, label: string) => {
      g.fillStyle = 'rgba(40, 46, 58, 0.9)';
      g.fillRect(x, cy - 70, 38, 140);
      g.fillStyle = '#05070b';
      g.fillRect(x - 2, cy - 12, 42, 24);
      g.strokeStyle = '#e8eefb';
      g.lineWidth = 1.5;
      g.strokeRect(x - 2, cy - 12, 42, 24);
      g.fillStyle = '#e8eefb';
      g.font = `700 15px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(value, x + 19, cy + 6);
      g.font = `600 10px ${FONT}`;
      g.fillStyle = '#93a4c4';
      g.fillText(label, x + 19, cy - 78);
    };
    tape(6, String(Math.round(a.speed)), 'KT');
    tape(S - 44, a.altitude >= 1000 ? `${Math.round(a.altitude / 100)}` : String(Math.round(a.altitude)), a.altitude >= 1000 ? 'FL' : 'FT');
    // Heading across the bottom.
    g.fillStyle = '#e8eefb';
    g.font = `700 14px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('HDG 042', cx, S - 12);
    g.textAlign = 'left';
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
