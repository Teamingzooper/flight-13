import * as THREE from 'three';
import { TOP } from '../app/Avatar';
import { DESTINATIONS, grid, isNightPhase, type PlayerView } from '../engine';
import { formatCode } from '../net/code';
import { clock, phaseTitle } from '../tv/format';

const W = 640;
const H = 410;
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

/** The seatback screen in front of you, drawn live onto a canvas texture. */
export class LiveScreen {
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshStandardMaterial;
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private lastKey = '';

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.material = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: this.texture, emissiveIntensity: 1.15 });
  }

  draw(game: PlayerView, code: string, leftMs: number, hint: string, pulse: boolean): void {
    const seatKey = game.players.map((p) => `${p.seat}${p.status[0]}`).join(',');
    const key = [game.phase.kind, game.phase.night, Math.ceil(leftMs / 1000), seatKey, game.cabin.cartRow, hint, pulse, game.blackout].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const g = this.g;
    const night = isNightPhase(game.phase.kind);

    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, night ? '#08142d' : '#10264d');
    bg.addColorStop(1, night ? '#02060f' : '#060d1c');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // Header.
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(0, 0, W, 52);
    g.textBaseline = 'middle';
    g.font = `700 26px ${FONT}`;
    g.fillStyle = '#e8eefb';
    g.fillText('FLIGHT', 22, 27);
    g.fillStyle = '#ffb547';
    g.fillText('13', 22 + g.measureText('FLIGHT ').width, 27);
    g.font = `600 18px ${FONT}`;
    g.fillStyle = '#93a4c4';
    g.textAlign = 'right';
    g.fillText(`${formatCode(code)} → ${DESTINATIONS[game.settings.destination].id}`, W - 22, 27);
    g.textAlign = 'left';

    // Phase and countdown.
    g.font = `700 40px ${FONT}`;
    g.fillStyle = '#e8eefb';
    g.fillText(phaseTitle(game), 22, 96);
    if (game.phase.kind !== 'ended') {
      g.textAlign = 'right';
      g.font = `700 52px ${FONT}`;
      g.fillStyle = leftMs < 10_000 ? '#ffb547' : '#e8eefb';
      g.fillText(clock(leftMs), W - 22, 98);
      g.textAlign = 'left';
    }

    // Mini seat map: rows left to right, like the Map tab.
    const rows = game.cabin.rows;
    const top = 140;
    const cellW = Math.min(40, (W - 80) / rows);
    const cellH = 26;
    const left = (W - cellW * rows) / 2;
    const bySeat = new Map(game.players.filter((p) => p.seat).map((p) => [p.seat!, p]));
    for (let r = 1; r <= rows; r++) {
      for (let c = 0; c < 7; c++) {
        const x = left + (r - 1) * cellW + 3;
        const y = top + c * (cellH + 3);
        if (c === grid.AISLE_COL) {
          if (!game.cabin.cartDestroyed && game.cabin.cartRow === r) {
            g.fillStyle = '#d7dfee';
            g.fillRect(x + cellW / 2 - 9, y + 5, 16, cellH - 10);
          }
          continue;
        }
        const p = bySeat.get(grid.seatId({ row: r, col: c }));
        const you = p && p.id === game.you?.id;
        g.fillStyle = !p ? '#0e1a31' : p.status === 'dead' ? '#5a2027' : game.blackout && !you ? '#3a4a66' : TOP[p.look.top] ?? '#8aa';
        g.beginPath();
        g.roundRect(x, y, cellW - 6, cellH, 5);
        g.fill();
        if (you) {
          g.strokeStyle = '#4fd1c5';
          g.lineWidth = 3;
          g.stroke();
        }
      }
    }

    // Hint pill.
    g.font = `600 22px ${FONT}`;
    const width = g.measureText(hint).width + 40;
    g.fillStyle = pulse ? 'rgba(255,181,71,0.95)' : 'rgba(255,181,71,0.7)';
    g.beginPath();
    g.roundRect((W - width) / 2, H - 58, width, 40, 20);
    g.fill();
    g.fillStyle = '#231602';
    g.textAlign = 'center';
    g.fillText(hint, W / 2, H - 37);
    g.textAlign = 'left';

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
