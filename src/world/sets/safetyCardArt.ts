import * as THREE from 'three';
import { LESSONS, type LessonId } from '../../tutorial/lessons';

/**
 * The laminated safety card in every seat pocket, drawn the way airlines draw them: a navy header, then numbered
 * panels of flat, outlined pictograms. Five panels are Flight School's lessons (Passenger, Nurse, Stewardess, Pilot,
 * Bomber) and the sixth says how a flight goes. The back carries the airline's name and a plan of the plane.
 */

/** The front's pixels (the card is 0.32 m × 0.22 m). */
export const CARD_PX = { w: 2048, h: 1408 } as const;

const INK = '#14213d';
const PAPER = '#f3eee2';
const PANEL = '#fffdf8';
const AMBER = '#ffb547';
const RED = '#c8342b';
const SKIN = '#e7b48b';
const SEAT = '#7d93ae';
const SEAT_DARK = '#4c5667';
const DISPLAY = '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", sans-serif';
const BODY = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const MARGIN = 40;
const HEADER = 196;
const FOOTER = 62;
const GUTTER = 30;
const PANEL_W = (CARD_PX.w - MARGIN * 2 - GUTTER * 2) / 3;
const PANEL_H = (CARD_PX.h - HEADER - FOOTER - 32 - 28 - GUTTER) / 2;
const panelX = (col: number) => MARGIN + col * (PANEL_W + GUTTER);
const panelY = (row: number) => HEADER + 32 + row * (PANEL_H + GUTTER);

export interface Section {
  id: LessonId;
  /** The panel's number on the card. */
  n: number;
  /** Where it is, in card UV (u to the right, v up), and its middle. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** The five lesson panels (the sixth, bottom right, is the how-to). */
export const SECTIONS: readonly Section[] = (['passenger', 'nurse', 'stewardess', 'pilot', 'bomber'] as const).map((id, i) => {
  const x = panelX(i % 3);
  const y = panelY(Math.floor(i / 3));
  return { id, n: i + 1, u0: x / CARD_PX.w, u1: (x + PANEL_W) / CARD_PX.w, v0: 1 - (y + PANEL_H) / CARD_PX.h, v1: 1 - y / CARD_PX.h };
});

/** Which panel a point on the card (in UV) is on, if any. */
export function sectionAt(u: number, v: number): Section | null {
  return SECTIONS.find((s) => u >= s.u0 && u <= s.u1 && v >= s.v0 && v <= s.v1) ?? null;
}

/** A panel's middle in UV, a little above centre (on its picture, where a finger would point). */
export function sectionPoint(s: Section): { u: number; v: number } {
  return { u: (s.u0 + s.u1) / 2, v: s.v0 + (s.v1 - s.v0) * 0.58 };
}

// ---------- Drawing ----------

type Pt = [number, number];

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** A thick limb or body part: a round-capped line with an ink outline. */
function limb(g: CanvasRenderingContext2D, pts: Pt[], width: number, fill: string): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const [w, color] of [
    [width + 8, INK],
    [width, fill],
  ] as const) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
    g.lineWidth = w;
    g.strokeStyle = color;
    g.stroke();
  }
}

/** A filled shape with an ink outline. */
function shape(g: CanvasRenderingContext2D, fill: string | CanvasGradient, path: () => void, line = 5): void {
  g.beginPath();
  path();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = line;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke();
}

function head(g: CanvasRenderingContext2D, x: number, y: number, r = 19, skin = SKIN): void {
  shape(g, skin, () => g.arc(x, y, r, 0, Math.PI * 2));
}

function hand(g: CanvasRenderingContext2D, x: number, y: number): void {
  shape(g, SKIN, () => g.arc(x, y, 7.5, 0, Math.PI * 2), 4);
}

/** A seat seen from the side, facing right: its reclined back, the cushion and the frame. */
function seat(g: CanvasRenderingContext2D, x: number, floor: number, color = SEAT, frame = SEAT_DARK): void {
  limb(g, [[x + 52, floor - 60], [x + 52, floor - 4]], 7, frame);
  limb(g, [[x + 30, floor - 4], [x + 76, floor - 4]], 6, frame);
  shape(g, color, () => g.roundRect(x - 2, floor - 84, 108, 26, 11));
  shape(g, color, () => {
    g.moveTo(x - 6, floor - 72);
    g.lineTo(x - 26, floor - 196);
    g.quadraticCurveTo(x - 10, floor - 206, x + 8, floor - 196);
    g.lineTo(x + 22, floor - 76);
    g.closePath();
  });
}

function floor(g: CanvasRenderingContext2D, y = 206): void {
  g.beginPath();
  g.moveTo(-10, y);
  g.lineTo(410, y);
  g.lineWidth = 5;
  g.strokeStyle = INK;
  g.stroke();
}

/** A round bomb with a lit fuse. */
function bomb(g: CanvasRenderingContext2D, x: number, y: number, r = 15): void {
  shape(g, '#23262e', () => g.arc(x, y, r, 0, Math.PI * 2));
  g.beginPath();
  g.moveTo(x + r * 0.5, y - r * 0.8);
  g.quadraticCurveTo(x + r * 0.9, y - r * 1.6, x + r * 1.4, y - r * 1.5);
  g.lineWidth = 4;
  g.strokeStyle = INK;
  g.stroke();
  spark(g, x + r * 1.5, y - r * 1.55, 9);
}

function spark(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = AMBER;
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = RED;
  g.stroke();
}

/** 1: a passenger shines a flashlight under the seat in front, and finds a bomb. */
function drawPassenger(g: CanvasRenderingContext2D): void {
  floor(g);
  // The beam, under the seat ahead.
  const beam = g.createLinearGradient(240, 160, 350, 190);
  beam.addColorStop(0, 'rgba(255, 214, 90, 0.85)');
  beam.addColorStop(1, 'rgba(255, 214, 90, 0.15)');
  g.beginPath();
  g.moveTo(246, 160);
  g.lineTo(356, 150);
  g.lineTo(346, 204);
  g.closePath();
  g.fillStyle = beam;
  g.fill();
  seat(g, 60, 206);
  seat(g, 282, 206);
  bomb(g, 318, 186, 14);
  // Leaning forward in their seat.
  limb(g, [[146, 84], [168, 116], [186, 124]], 13, '#2f5c8f');
  limb(g, [[98, 124], [172, 124], [184, 198], [202, 200]], 18, '#2c3e5a');
  limb(g, [[98, 126], [150, 76]], 36, '#3a6ea5');
  limb(g, [[150, 80], [190, 118], [226, 146]], 13, '#3a6ea5');
  hand(g, 228, 148);
  limb(g, [[226, 144], [248, 160]], 10, '#555d6b');
  head(g, 170, 54);
}

/** 2: the Nurse bends over a seated passenger, a hand on their shoulder; a red cross keeps them safe tonight. */
function drawNurse(g: CanvasRenderingContext2D): void {
  floor(g);
  seat(g, 50, 206);
  // The patient.
  limb(g, [[82, 124], [156, 124], [166, 198], [184, 200]], 18, '#4b4f63');
  limb(g, [[82, 126], [92, 60]], 36, '#8a6bb0');
  limb(g, [[94, 70], [112, 104], [146, 112]], 13, '#8a6bb0');
  hand(g, 148, 112);
  head(g, 98, 38);
  // The Nurse.
  limb(g, [[222, 120], [214, 162], [206, 202], [220, 203]], 16, '#2f7f72');
  limb(g, [[230, 120], [240, 162], [250, 202], [264, 203]], 16, '#2f7f72');
  limb(g, [[226, 122], [212, 64]], 36, '#3fa08f');
  limb(g, [[212, 70], [174, 84], [126, 68]], 13, '#3fa08f');
  hand(g, 122, 67);
  head(g, 206, 42);
  shape(g, '#ffffff', () => g.roundRect(188, 16, 36, 13, 4), 4);
  g.fillStyle = RED;
  g.fillRect(203, 18, 6, 9);
  g.fillRect(201.5, 19.5, 9, 6);
  // Safe tonight: a red cross in a shield, under the moon.
  shape(g, '#ffffff', () => {
    g.moveTo(330, 60);
    g.lineTo(378, 74);
    g.quadraticCurveTo(378, 132, 330, 156);
    g.quadraticCurveTo(282, 132, 282, 74);
    g.closePath();
  });
  g.fillStyle = RED;
  g.fillRect(322, 80, 16, 52);
  g.fillRect(304, 98, 52, 16);
  shape(g, AMBER, () => g.arc(360, 24, 15, 0, Math.PI * 2), 3);
  g.beginPath();
  g.arc(369, 18, 13, 0, Math.PI * 2);
  g.fillStyle = PANEL;
  g.fill();
}

/** 3: the Stewardess wheels the drink cart down the aisle, and checks under the seats. */
function drawStewardess(g: CanvasRenderingContext2D): void {
  floor(g);
  for (const x of [26, 164, 302]) seat(g, x, 206, '#b3c0d1', '#8d99ab');
  // The cart.
  shape(g, '#cfd5dd', () => g.roundRect(170, 90, 118, 102, 8));
  for (const y of [120, 150]) {
    g.beginPath();
    g.moveTo(176, y);
    g.lineTo(282, y);
    g.lineWidth = 3;
    g.strokeStyle = INK;
    g.stroke();
  }
  shape(g, '#9aa3ae', () => g.roundRect(166, 84, 126, 10, 4), 4);
  shape(g, '#2e7d5b', () => g.roundRect(200, 58, 14, 28, 4), 3);
  shape(g, '#b3462f', () => g.roundRect(224, 64, 14, 22, 4), 3);
  for (const x of [184, 274]) shape(g, INK, () => g.arc(x, 198, 8, 0, Math.PI * 2), 2);
  limb(g, [[162, 100], [162, 124]], 7, '#9aa3ae');
  // The Stewardess, pushing.
  limb(g, [[118, 136], [106, 170], [96, 202], [110, 203]], 14, '#22345c');
  limb(g, [[126, 136], [140, 170], [150, 202], [164, 203]], 14, '#22345c');
  shape(g, '#22345c', () => {
    g.moveTo(108, 150);
    g.lineTo(138, 150);
    g.lineTo(132, 112);
    g.lineTo(114, 112);
    g.closePath();
  });
  limb(g, [[122, 118], [130, 64]], 34, '#2a3f6e');
  shape(g, RED, () => {
    g.moveTo(122, 70);
    g.lineTo(146, 72);
    g.lineTo(132, 88);
    g.closePath();
  }, 3);
  limb(g, [[132, 72], [150, 98], [160, 110]], 12, '#2a3f6e');
  hand(g, 162, 110);
  head(g, 136, 42, 18);
  shape(g, '#3a2a20', () => g.arc(118, 36, 10, 0, Math.PI * 2), 4);
  // The check: a magnifier over the seat, and a tick.
  g.save();
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(364, 178);
  g.lineTo(386, 200);
  g.lineWidth = 14;
  g.strokeStyle = INK;
  g.stroke();
  g.restore();
  shape(g, '#e9f4ff', () => g.arc(348, 162, 24, 0, Math.PI * 2), 6);
  g.beginPath();
  g.moveTo(336, 162);
  g.lineTo(345, 172);
  g.lineTo(362, 150);
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.strokeStyle = '#2e9e5b';
  g.stroke();
}

/** 4: the Pilot at the controls, the cabin cameras on a screen, and the PA. */
function drawPilot(g: CanvasRenderingContext2D): void {
  floor(g);
  // The windscreen and the instrument panel.
  const sky = g.createLinearGradient(0, 8, 0, 92);
  sky.addColorStop(0, '#7db8f2');
  sky.addColorStop(1, '#d9ecff');
  shape(g, sky, () => {
    g.moveTo(236, 8);
    g.lineTo(396, 8);
    g.lineTo(396, 92);
    g.lineTo(262, 92);
    g.closePath();
  });
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(330, 48, 26, 9, 0, 0, Math.PI * 2);
  g.ellipse(352, 42, 18, 8, 0, 0, Math.PI * 2);
  g.fill();
  shape(g, '#2b303a', () => g.roundRect(210, 112, 188, 34, 6));
  for (const [x, c] of [
    [236, '#5fd38d'],
    [262, AMBER],
    [288, '#5fd38d'],
  ] as const) {
    g.beginPath();
    g.arc(x, 129, 6, 0, Math.PI * 2);
    g.fillStyle = c;
    g.fill();
  }
  // The cabin cameras: three rows of seats on a screen.
  shape(g, '#111820', () => g.roundRect(310, 150, 84, 52, 6));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 6; c++) {
      g.fillStyle = r === 1 && c === 2 ? RED : '#5fd38d';
      g.fillRect(318 + c * 12 + (c > 2 ? 4 : 0), 158 + r * 14, 8, 8);
    }
  }
  shape(g, '#dfe3ea', () => g.roundRect(270, 162, 30, 20, 4), 4);
  shape(g, '#dfe3ea', () => {
    g.moveTo(300, 166);
    g.lineTo(312, 160);
    g.lineTo(312, 184);
    g.lineTo(300, 178);
    g.closePath();
  }, 4);
  // The PA: a speaker, and sound going out.
  shape(g, '#dfe3ea', () => {
    g.moveTo(150, 14);
    g.lineTo(162, 14);
    g.lineTo(178, 2);
    g.lineTo(178, 42);
    g.lineTo(162, 30);
    g.lineTo(150, 30);
    g.closePath();
  }, 4);
  for (const r of [12, 22]) {
    g.beginPath();
    g.arc(180, 22, r, -0.7, 0.7);
    g.lineWidth = 4;
    g.strokeStyle = INK;
    g.stroke();
  }
  // The Pilot, at the yoke.
  seat(g, 40, 206, '#8b7d6b', '#5b5245');
  limb(g, [[72, 124], [146, 124], [156, 198], [174, 200]], 18, '#23262e');
  limb(g, [[72, 126], [84, 60]], 36, '#f4f4f4');
  limb(g, [[86, 66], [84, 104]], 6, INK);
  limb(g, [[88, 70], [134, 96], [184, 104]], 13, '#f4f4f4');
  hand(g, 186, 104);
  limb(g, [[190, 90], [190, 120], [208, 128]], 8, '#3a3f4a');
  head(g, 92, 38);
  // Cap and headset.
  shape(g, '#ffffff', () => g.roundRect(70, 10, 44, 14, 5), 4);
  shape(g, INK, () => g.roundRect(94, 20, 30, 6, 3), 2);
  g.beginPath();
  g.arc(92, 38, 23, Math.PI * 1.1, Math.PI * 1.9);
  g.lineWidth = 5;
  g.strokeStyle = '#23262e';
  g.stroke();
  g.beginPath();
  g.moveTo(110, 44);
  g.quadraticCurveTo(116, 58, 106, 56);
  g.lineWidth = 4;
  g.stroke();
}

/** 5: the Bomber, crouched in the dark, slides a ticking bomb under a seat. */
function drawBomber(g: CanvasRenderingContext2D): void {
  floor(g);
  seat(g, 226, 206);
  // A ticking box under the cushion.
  shape(g, '#23262e', () => g.roundRect(246, 170, 50, 30, 5));
  shape(g, '#0c0e12', () => g.roundRect(254, 176, 34, 14, 3), 2);
  g.fillStyle = '#ff4f3d';
  g.font = `700 13px ${DISPLAY}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('0:12', 271, 184);
  g.beginPath();
  g.moveTo(262, 170);
  g.quadraticCurveTo(264, 160, 276, 162);
  g.lineWidth = 3;
  g.strokeStyle = RED;
  g.stroke();
  // Crouched, reaching under the seat.
  limb(g, [[106, 170], [128, 150], [112, 202], [128, 203]], 17, '#262833');
  limb(g, [[112, 172], [156, 164], [150, 202], [166, 203]], 17, '#30333f');
  limb(g, [[110, 172], [162, 118]], 38, '#3b3d4a');
  limb(g, [[158, 126], [200, 152], [242, 182]], 13, '#3b3d4a');
  hand(g, 244, 183);
  // The hood.
  shape(g, '#3b3d4a', () => g.arc(182, 100, 25, 0, Math.PI * 2));
  shape(g, SKIN, () => g.arc(190, 104, 15, -1.3, 1.9));
  // Shh.
  g.fillStyle = RED;
  g.font = `italic 700 30px ${DISPLAY}`;
  g.textAlign = 'left';
  g.fillText('shh…', 40, 60);
}

/** The sixth panel: how a flight goes, and what to do with this card. */
function drawHowTo(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = INK;
  g.font = `700 50px ${DISPLAY}`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText('HOW A FLIGHT GOES', x + 34, y + 72);
  const lines: [string, string][] = [
    ['NIGHT', 'Change seats. Use your ability in the dark.'],
    ['DAY', 'Talk it over: who is lying?'],
    ['VOTE', 'Restrain a suspect.'],
    ['LAND', 'Passengers win if every saboteur is caught first.'],
  ];
  lines.forEach(([tag, text], i) => {
    const ty = y + 138 + i * 76;
    shape(g, i === 0 ? '#22345c' : i === 3 ? '#2e7d5b' : '#e3a33a', () => g.roundRect(x + 34, ty - 36, 104, 46, 8), 3);
    g.fillStyle = '#ffffff';
    g.font = `700 30px ${DISPLAY}`;
    g.textAlign = 'center';
    g.fillText(tag, x + 86, ty - 3);
    g.fillStyle = INK;
    g.font = `500 27px ${BODY}`;
    g.textAlign = 'left';
    wrap(g, text, x + 156, ty - 14, w - 190, 31);
  });
  shape(g, '#fff2d6', () => g.roundRect(x + 24, y + h - 92, w - 48, 66, 10), 3);
  g.fillStyle = INK;
  g.font = `700 29px ${BODY}`;
  g.textAlign = 'center';
  g.fillText('Point to a role to start its lesson', x + w / 2, y + h - 49);
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number): number {
  const words = text.split(' ');
  let line = '';
  let row = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > width && line) {
      g.fillText(line, x, y + row * lineHeight);
      line = word;
      row++;
    } else line = next;
  }
  if (line) g.fillText(line, x, y + row * lineHeight);
  return row + 1;
}

const PICTURES: Record<LessonId, (g: CanvasRenderingContext2D) => void> = {
  passenger: drawPassenger,
  nurse: drawNurse,
  stewardess: drawStewardess,
  pilot: drawPilot,
  bomber: drawBomber,
};

/** A plane seen from above, for the header and the back. */
function planeMark(g: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  g.save();
  g.translate(x, y);
  g.scale(size / 100, size / 100);
  g.fillStyle = color;
  g.beginPath();
  // Fuselage, wings and tail, nose to the right.
  g.moveTo(50, 0);
  g.quadraticCurveTo(46, -6, 30, -6);
  g.lineTo(6, -6);
  g.lineTo(-10, -44);
  g.lineTo(-22, -44);
  g.lineTo(-12, -6);
  g.lineTo(-38, -6);
  g.lineTo(-48, -20);
  g.lineTo(-56, -20);
  g.lineTo(-50, 0);
  g.lineTo(-56, 20);
  g.lineTo(-48, 20);
  g.lineTo(-38, 6);
  g.lineTo(-12, 6);
  g.lineTo(-22, 44);
  g.lineTo(-10, 44);
  g.lineTo(6, 6);
  g.lineTo(30, 6);
  g.quadraticCurveTo(46, 6, 50, 0);
  g.fill();
  g.restore();
}

function cardShape(g: CanvasRenderingContext2D): void {
  g.clearRect(0, 0, CARD_PX.w, CARD_PX.h);
  roundRect(g, 2, 2, CARD_PX.w - 4, CARD_PX.h - 4, 46);
  g.save();
  g.clip();
}

export function drawCardFront(g: CanvasRenderingContext2D): void {
  const { w, h } = CARD_PX;
  cardShape(g);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  // The header: the airline, and what this is.
  g.fillStyle = INK;
  g.fillRect(0, 0, w, HEADER);
  g.fillStyle = AMBER;
  g.fillRect(0, HEADER - 12, w, 12);
  planeMark(g, 140, 96, 150, AMBER);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillStyle = '#ffffff';
  g.font = `800 96px ${DISPLAY}`;
  g.fillText('FLIGHT 13', 232, 126);
  g.textAlign = 'right';
  g.fillStyle = AMBER;
  g.font = `800 84px ${DISPLAY}`;
  g.fillText('SAFETY INFORMATION', w - 60, 112);
  g.fillStyle = '#c9d3e6';
  g.font = `500 32px ${BODY}`;
  g.fillText('Flight School · Please read before takeoff', w - 62, 158);

  // The panels.
  for (let i = 0; i < 6; i++) {
    const x = panelX(i % 3);
    const y = panelY(Math.floor(i / 3));
    const lesson = i < 5 ? SECTIONS[i].id : null;
    const saboteur = lesson === 'bomber';
    shape(g, PANEL, () => g.roundRect(x, y, PANEL_W, PANEL_H, 18), 4);
    if (!lesson) {
      drawHowTo(g, x, y, PANEL_W, PANEL_H);
      continue;
    }
    // Number, name, and the team.
    shape(g, saboteur ? RED : INK, () => g.arc(x + 54, y + 54, 32, 0, Math.PI * 2), 0.01);
    g.fillStyle = '#ffffff';
    g.font = `800 42px ${DISPLAY}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1), x + 54, y + 56);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = saboteur ? RED : INK;
    g.font = `800 58px ${DISPLAY}`;
    g.fillText(LESSONS[lesson].title.toUpperCase(), x + 102, y + 74);
    const tag = saboteur ? 'SABOTEUR' : 'PASSENGERS';
    g.font = `700 24px ${DISPLAY}`;
    const tagW = g.measureText(tag).width + 26;
    shape(g, saboteur ? '#fde3df' : '#e4ecf7', () => g.roundRect(x + PANEL_W - tagW - 24, y + 30, tagW, 36, 18), 3);
    g.fillStyle = saboteur ? RED : INK;
    g.textAlign = 'center';
    g.fillText(tag, x + PANEL_W - tagW / 2 - 24, y + 57);
    // The picture, in its own 400 × 220 space.
    const pw = PANEL_W - 60;
    const scale = pw / 400;
    g.save();
    g.translate(x + 30, y + 104);
    g.scale(scale, scale);
    PICTURES[lesson](g);
    g.restore();
    // The caption.
    g.fillStyle = INK;
    g.font = `600 30px ${BODY}`;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    wrap(g, LESSONS[lesson].line, x + 34, y + PANEL_H - 50, PANEL_W - 68, 34);
  }

  // The footer.
  g.fillStyle = '#5b6478';
  g.font = `500 26px ${BODY}`;
  g.textAlign = 'left';
  g.fillText('Airliner · 8 rows · Seats A–F', MARGIN + 6, h - 26);
  g.textAlign = 'right';
  g.fillText('Please return this card to the seat pocket', w - MARGIN - 6, h - 26);
  g.restore();
}

export function drawCardBack(g: CanvasRenderingContext2D): void {
  const { w, h } = CARD_PX;
  cardShape(g);
  g.fillStyle = INK;
  g.fillRect(0, 0, w, h);
  g.fillStyle = AMBER;
  g.fillRect(0, h - 120, w, 14);
  planeMark(g, w / 2, h * 0.36, 520, '#22345c');
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffffff';
  g.font = `800 190px ${DISPLAY}`;
  g.fillText('FLIGHT 13', w / 2, h * 0.7);
  g.fillStyle = AMBER;
  g.font = `800 70px ${DISPLAY}`;
  g.fillText('SAFETY INFORMATION', w / 2, h * 0.8);
  g.fillStyle = '#c9d3e6';
  g.font = `500 34px ${BODY}`;
  g.fillText('Keep your eyes open. Someone on this plane wants it to go down.', w / 2, h - 44);
  g.restore();
}

function cardTexture(draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_PX.w;
  canvas.height = CARD_PX.h;
  const g = canvas.getContext('2d')!;
  draw(g);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  // Drawn again once the fonts have loaded (the first draw may have used the fallbacks).
  document.fonts?.ready.then(() => {
    draw(g);
    texture.needsUpdate = true;
  });
  return texture;
}

let front: THREE.CanvasTexture | null = null;
let back: THREE.CanvasTexture | null = null;

/** The card's front (shared by every pocket in the cabin, and the one in your hands). */
export function cardFrontTexture(): THREE.CanvasTexture {
  front ??= cardTexture(drawCardFront);
  return front;
}

export function cardBackTexture(): THREE.CanvasTexture {
  back ??= cardTexture(drawCardBack);
  return back;
}

let magazine: THREE.CanvasTexture | null = null;

/** The top of the inflight magazine, showing above the safety card in every seat pocket. */
export function magazineTexture(): THREE.CanvasTexture {
  if (magazine) return magazine;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 154;
  const g = canvas.getContext('2d')!;
  const draw = () => {
    const sky = g.createLinearGradient(0, 0, 512, 154);
    sky.addColorStop(0, '#0e6b74');
    sky.addColorStop(1, '#1f9aa0');
    g.fillStyle = sky;
    g.fillRect(0, 0, 512, 154);
    g.fillStyle = '#ffffff';
    g.font = `800 64px ${DISPLAY}`;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillText('SKIES', 22, 70);
    g.fillStyle = AMBER;
    g.font = `700 22px ${DISPLAY}`;
    g.textAlign = 'right';
    g.fillText('FLIGHT 13 · INFLIGHT', 490, 34);
    g.fillStyle = 'rgba(255, 255, 255, 0.75)';
    g.font = `500 18px ${BODY}`;
    g.fillText('Where to next?', 490, 62);
  };
  draw();
  magazine = new THREE.CanvasTexture(canvas);
  magazine.colorSpace = THREE.SRGBColorSpace;
  document.fonts?.ready.then(() => {
    draw();
    magazine!.needsUpdate = true;
  });
  return magazine;
}
