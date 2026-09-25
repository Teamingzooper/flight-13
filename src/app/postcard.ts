import { h, render } from 'preact';
import { destinationOf, roleNameIn, type Look, type PlayerSummary, type PlayerView } from '../engine';
import { formatCode } from '../net/code';
import { Avatar } from './Avatar';

/**
 * The landing postcard: "Greetings from" the destination, a group photo (the 3D cabin, or everyone's portraits lined
 * up for a class photo), how the flight ended, and everyone aboard with their role. Drawn on a canvas, to save or share.
 */

export const POSTCARD_W = 1600;
export const POSTCARD_H = 1000;
/** The photo's shape (width / height). */
export const PHOTO_ASPECT = 1.6;

const PHOTO_W = 900;
const PHOTO_H = PHOTO_W / PHOTO_ASPECT;
const PAPER = '#f4efe3';
const INK = '#1b2130';
const MUTED = 'rgba(27, 33, 48, 0.62)';
const TEAM_COLOR = { passengers: '#2467b3', saboteurs: '#c0392b' } as const;
const DISPLAY = '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", sans-serif';
const BODY = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface PostcardInput {
  game: PlayerView;
  /** The flight number. */
  code: string;
  /** Painted faces, by player. */
  faces: ReadonlyMap<string, string>;
  /** A group photo of the cabin (about 8:5), or null for a class photo of everyone's portraits. */
  photo: HTMLCanvasElement | null;
  /** The postmark's date. */
  date?: Date;
}

/** How someone got off the plane. */
export function outcome(p: Pick<PlayerSummary, 'status' | 'cause'>): string {
  if (p.status === 'alive') return 'made it';
  if (p.cause === 'restrained' || p.status === 'restrained') return 'restrained';
  if (p.cause === 'poison') return 'poisoned';
  return 'blown up';
}

/** The big line: who won. */
export function headline(game: Pick<PlayerView, 'result'>): string {
  const r = game.result;
  if (!r) return 'Flight over';
  if (r.winner === 'draw') return 'No survivors';
  return r.winner === 'passengers' ? 'The passengers win' : 'The saboteurs win';
}

/** Where the roster's entries go in the right-hand column: one column up to 8 aboard, then two. */
export function rosterLayout(count: number, height: number): { columns: number; perColumn: number; rowHeight: number } {
  const columns = count <= 8 ? 1 : 2;
  const perColumn = Math.max(1, Math.ceil(count / columns));
  return { columns, perColumn, rowHeight: Math.min(68, Math.floor(height / perColumn)) };
}

/** A passenger's portrait (as on screen: clothes, hair, accessories, painted face), as an image. `bare`: no backdrop disc. */
function portrait(look: Look, face: string | undefined, size: number, bare = false): Promise<HTMLImageElement | null> {
  const holder = document.createElement('div');
  render(h(Avatar, { look, face, size }), holder);
  const svg = holder.querySelector('svg');
  if (!svg) return Promise.resolve(null);
  if (bare) svg.querySelector('circle')?.remove();
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`;
  render(null, holder);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Shorten `text` with an ellipsis to fit `width` in the current font. */
function fit(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && g.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * The class photo's rows: how many, how many to a row, the portraits' size, how far apart they stand (as a share of
 * their size: under 1 overlaps), and how far each row stands above the one in front.
 */
export function classRows(count: number): { rows: number; perRow: number; size: number; spacing: number; rise: number } {
  const rows = count <= 5 ? 1 : count <= 12 ? 2 : 3;
  const perRow = Math.max(1, Math.ceil(count / rows));
  const spacing = 0.78;
  const rise = 0.55;
  const byWidth = (PHOTO_W - 40) / (spacing * (perRow - 1) + 1);
  const byHeight = (PHOTO_H * 0.82) / (1 + (rows - 1) * rise);
  return { rows, perRow, size: Math.floor(Math.min(220, byWidth, byHeight)), spacing, rise };
}

/** Without a 3D view: everyone's portraits lined up in rows under a blue sky, the front row biggest. */
async function classPhoto(players: readonly PlayerSummary[], faces: ReadonlyMap<string, string>): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_W;
  canvas.height = PHOTO_H;
  const g = canvas.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, PHOTO_H);
  sky.addColorStop(0, '#5d9bd8');
  sky.addColorStop(0.7, '#bcdcf4');
  sky.addColorStop(1, '#e9f3fb');
  g.fillStyle = sky;
  g.fillRect(0, 0, PHOTO_W, PHOTO_H);
  // A few clouds.
  g.fillStyle = 'rgba(255, 255, 255, 0.75)';
  for (const [x, y, s] of [
    [140, 90, 1],
    [620, 60, 1.3],
    [800, 170, 0.8],
    [330, 190, 0.7],
  ]) {
    for (const [dx, dy, r] of [
      [0, 0, 34],
      [36, -12, 42],
      [78, 2, 32],
      [40, 12, 30],
    ]) {
      g.beginPath();
      g.ellipse(x + dx * s, y + dy * s, r * s * 1.2, r * s * 0.8, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // The tarmac.
  g.fillStyle = '#8e949c';
  g.fillRect(0, PHOTO_H - 70, PHOTO_W, 70);
  g.fillStyle = '#f4f1e6';
  for (let x = 20; x < PHOTO_W; x += 120) g.fillRect(x, PHOTO_H - 38, 60, 6);

  // Shoulder to shoulder (a little overlapped), in up to three rows, as big as fits.
  const { rows, perRow, size, spacing, rise } = classRows(players.length);
  const pics = await Promise.all(players.map((p) => portrait(p.look, faces.get(p.id), size * 2, true)));
  // Back row first (higher up, a little smaller), so the rows in front overlap it. The out-of-play look faded.
  for (let row = 0; row < rows; row++) {
    const members = players.slice(row * perRow, (row + 1) * perRow).map((p, i) => ({ p, pic: pics[row * perRow + i] }));
    const back = rows - 1 - row;
    const s = Math.round(size * (1 - back * 0.1));
    const step = s * spacing;
    const y = PHOTO_H - s - back * size * rise + 8;
    const left = (PHOTO_W - (members.length - 1) * step - s) / 2 + (back % 2 ? step / 2 : 0);
    members.forEach(({ p, pic }, i) => {
      if (!pic) return;
      g.globalAlpha = p.status === 'alive' ? 1 : 0.55;
      g.drawImage(pic, left + i * step, y, s, s);
    });
  }
  g.globalAlpha = 1;
  return canvas;
}

/** The postcard. */
export async function drawPostcard({ game, code, faces, photo, date = new Date() }: PostcardInput): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = POSTCARD_W;
  canvas.height = POSTCARD_H;
  const g = canvas.getContext('2d')!;
  await document.fonts?.ready;
  const players = game.players;
  const picture = photo ?? (await classPhoto(players, faces));

  // Paper, with a faint grain and a printed border.
  g.fillStyle = PAPER;
  g.fillRect(0, 0, POSTCARD_W, POSTCARD_H);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(90, 70, 40, ${rnd() * 0.06})`;
    g.fillRect(rnd() * POSTCARD_W, rnd() * POSTCARD_H, 2, 2);
  }
  g.strokeStyle = 'rgba(27, 33, 48, 0.2)';
  g.lineWidth = 3;
  g.strokeRect(26, 26, POSTCARD_W - 52, POSTCARD_H - 52);

  // The stamp: the destination's code, on a perforated edge, with a postmark over its corner.
  const d = destinationOf(game.settings);
  const sx = POSTCARD_W - 236;
  const sy = 58;
  const sw = 168;
  const sh = 196;
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.18)';
  g.shadowBlur = 8;
  g.shadowOffsetY = 3;
  g.fillStyle = '#ffffff';
  g.fillRect(sx, sy, sw, sh);
  g.restore();
  g.fillStyle = PAPER;
  for (let x = sx + 7; x < sx + sw; x += 14) {
    for (const y of [sy, sy + sh]) {
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (let y = sy + 7; y < sy + sh; y += 14) {
    for (const x of [sx, sx + sw]) {
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = '#1f3a8a';
  g.fillRect(sx + 14, sy + 14, sw - 28, sh - 28);
  g.textAlign = 'center';
  g.fillStyle = '#f2b134';
  g.font = `800 62px ${DISPLAY}`;
  g.fillText(d.code, sx + sw / 2, sy + 112);
  g.fillStyle = '#e9eef5';
  g.font = `700 19px ${DISPLAY}`;
  g.fillText('FLIGHT 13', sx + sw / 2, sy + 150);
  // The postmark.
  const mx = sx - 38;
  const my = sy + sh - 50;
  g.strokeStyle = 'rgba(40, 44, 70, 0.55)';
  g.fillStyle = 'rgba(40, 44, 70, 0.6)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(mx, my, 58, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(mx, my, 48, 0, Math.PI * 2);
  g.stroke();
  g.font = `700 15px ${DISPLAY}`;
  g.fillText('LANDED', mx, my - 14);
  g.font = `700 17px ${DISPLAY}`;
  g.fillText(date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase(), mx, my + 8);
  g.font = `600 13px ${DISPLAY}`;
  g.fillText(d.code, mx, my + 28);
  g.textAlign = 'left';

  // Greetings from…
  g.fillStyle = INK;
  g.font = `italic 600 36px ${BODY}`;
  g.fillText('Greetings from', 72, 112);
  const city = d.city.toUpperCase();
  let cityPx = 118;
  g.font = `800 ${cityPx}px ${DISPLAY}`;
  const room = mx - 70 - 72;
  while (cityPx > 48 && g.measureText(city).width > room) {
    cityPx -= 4;
    g.font = `800 ${cityPx}px ${DISPLAY}`;
  }
  g.fillStyle = INK;
  g.fillText(city, 72 + 5, 222 + 5);
  g.fillStyle = '#d0433f';
  g.fillText(city, 72, 222);

  // The photo, in a white border, not quite straight.
  g.save();
  g.translate(560, 604);
  g.rotate(-0.022);
  g.shadowColor = 'rgba(0, 0, 0, 0.25)';
  g.shadowBlur = 18;
  g.shadowOffsetY = 8;
  g.fillStyle = '#ffffff';
  g.fillRect(-PHOTO_W / 2 - 20, -PHOTO_H / 2 - 20, PHOTO_W + 40, PHOTO_H + 40);
  g.shadowColor = 'transparent';
  const scale = Math.max(PHOTO_W / picture.width, PHOTO_H / picture.height);
  const cw = PHOTO_W / scale;
  const ch = PHOTO_H / scale;
  g.drawImage(picture, (picture.width - cw) / 2, (picture.height - ch) / 2, cw, ch, -PHOTO_W / 2, -PHOTO_H / 2, PHOTO_W, PHOTO_H);
  g.restore();

  // How it ended.
  const col = 1076;
  const colW = POSTCARD_W - 44 - col;
  const r = game.result;
  g.fillStyle = r && r.winner !== 'draw' ? TEAM_COLOR[r.winner] : INK;
  g.font = `800 48px ${DISPLAY}`;
  g.fillText(fit(g, headline(game).toUpperCase(), colW), col, 330);
  g.fillStyle = MUTED;
  g.font = `500 21px ${BODY}`;
  g.fillText(fit(g, `${formatCode(code)} · ${d.nights} nights`, colW), col, 366);

  // Everyone aboard: portrait, name, role, and how they got off.
  const top = 396;
  const layout = rosterLayout(players.length, POSTCARD_H - 70 - top);
  const entryW = colW / layout.columns;
  const pic = layout.rowHeight - 10;
  const nameSize = Math.max(14, Math.min(22, Math.round(layout.rowHeight * 0.33)));
  const roleSize = Math.max(12, Math.min(17, Math.round(layout.rowHeight * 0.26)));
  const pics = await Promise.all(players.map((p) => portrait(p.look, faces.get(p.id), pic * 2)));
  players.forEach((p, i) => {
    const x = col + Math.floor(i / layout.perColumn) * entryW;
    const y = top + (i % layout.perColumn) * layout.rowHeight;
    const img = pics[i];
    if (img) {
      g.globalAlpha = p.status === 'alive' ? 1 : 0.5;
      g.drawImage(img, x, y, pic, pic);
      g.globalAlpha = 1;
    }
    const textX = x + pic + 10;
    const textW = entryW - pic - 18;
    g.fillStyle = INK;
    g.font = `700 ${nameSize}px ${BODY}`;
    g.fillText(fit(g, p.name, textW), textX, y + pic / 2 - 2);
    g.font = `600 ${roleSize}px ${BODY}`;
    g.fillStyle = p.team ? TEAM_COLOR[p.team] : MUTED;
    g.fillText(fit(g, `${p.role ? roleNameIn(p.role, game.settings) : '?'} · ${outcome(p)}`, textW), textX, y + pic / 2 + roleSize + 2);
  });

  // The small print.
  g.fillStyle = MUTED;
  g.font = `600 17px ${BODY}`;
  g.fillText('Flight 13 · teamingzooper.github.io/flight-13', 72, POSTCARD_H - 50);
  return canvas;
}

/** The file name to save the postcard as. */
export function postcardFileName(city: string): string {
  const slug = city
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `flight-13-${slug || 'postcard'}.png`;
}
