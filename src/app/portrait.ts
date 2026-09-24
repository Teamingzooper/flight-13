import type { Look } from '../engine';
import { decodeFace } from '../net/face';
import { HAIR_COLOR, HAIR_PATHS, SKIN, TOP } from './Avatar';
import { paintFace } from './faceImage';

const pick = (palette: string[], i: number) => palette[i] ?? palette[0];

/**
 * Draw a passenger's portrait (the same picture as the Avatar component) onto a canvas: shoulders, head,
 * painted face or plain eyes, and hair. `size` is the width and height of the square it fills.
 */
export function drawPortrait(g: CanvasRenderingContext2D, look: Look, face: string | undefined, x: number, y: number, size: number): void {
  const s = size / 40;
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  const skin = pick(SKIN, look.skin);
  const top = pick(TOP, look.top);
  const style = look.topStyle ?? 0;
  if (style === 2) {
    g.globalAlpha = 0.85;
    g.fillStyle = top;
    g.fill(new Path2D('M10 26c-1-10 4-17 10-17s11 7 10 17c-3 2-6 3-10 3s-7-1-10-3z'));
    g.globalAlpha = 1;
  }
  g.fillStyle = style === 3 ? skin : top;
  g.fill(new Path2D('M6 40c1-8 7-12 14-12s13 4 14 12z'));
  if (style === 3) {
    g.fillStyle = top;
    g.fill(new Path2D('M11.5 40c0-6 2.5-10 8.5-10s8.5 4 8.5 10z'));
  }
  g.fillStyle = skin;
  g.beginPath();
  g.arc(20, 17, 8, 0, Math.PI * 2);
  g.fill();
  const ink = face ? decodeFace(face) : null;
  if (ink) {
    // Clip the painted face to the head, like the avatar does.
    g.save();
    g.beginPath();
    g.arc(20, 17, 7.75, 0, Math.PI * 2);
    g.clip();
    g.drawImage(paintFace(ink, 256), 12, 9, 16, 16);
    g.restore();
  } else {
    g.fillStyle = '#141210';
    for (const ex of [17, 23]) {
      g.beginPath();
      g.arc(ex, 17, 1, 0, Math.PI * 2);
      g.fill();
    }
  }
  const hair = HAIR_PATHS[look.hair];
  if (hair) {
    g.fillStyle = pick(HAIR_COLOR, look.hairColor);
    g.fill(new Path2D(hair));
  }
  g.restore();
}
