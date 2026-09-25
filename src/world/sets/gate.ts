import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SKIN, TOP } from '../../app/Avatar';
import { drawPortrait } from '../../app/portrait';
import { destinationOf, grid, type Look, type PlayerSummary, type PlayerView } from '../../engine';
import { cabinAudio } from '../audio';
import { People } from '../scene/people';
import { buildAirliner } from './airliner';

/**
 * Gate 13 at dawn. Two shots: standing in the boarding queue (the other passengers are the real players,
 * in their own clothes and faces), and a close-up of your boarding pass on the scanner, photo and all.
 * Both are drawn from a local time, so everyone sees the same moment and a reload drops you back in it.
 */

export type GateShot = 'queue' | 'scan';

/** Where the gate podium stands; the queue runs back from it towards +z. */
const DESK_Z = -6;
const STEP = 1.05;
const EYE = 1.62;
/** You stand a little to the side of the line, so you can see past the person in front. */
const SIDE = 0.3;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const span = (t: number, a: number, b: number) => smooth(clamp01((t - a) / (b - a)));

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
  }
  return texture;
}

/** A number from a string, for shuffling the queue the same way on every screen. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface PassInfo {
  name: string;
  seat: string;
  look: Look;
  face: string | undefined;
  destination: string;
  city: string;
}

/** The boarding pass: the usual details, plus a photo no real boarding pass has. */
function passTexture(pass: PassInfo): THREE.CanvasTexture {
  return canvasTexture(1024, 420, (g) => {
    g.fillStyle = '#fbf8f1';
    g.fillRect(0, 0, 1024, 420);
    g.fillStyle = '#1b2a4e';
    g.fillRect(0, 0, 1024, 70);
    g.fillStyle = '#ff8a3d';
    g.fillRect(0, 70, 1024, 8);
    g.fillStyle = '#ffffff';
    g.font = 'bold 40px sans-serif';
    g.fillText('FLIGHT 13', 28, 49);
    g.font = '600 24px sans-serif';
    g.fillText('BOARDING PASS', 250, 47);
    g.fillText('GATE 13', 800, 47);
    // Photo ID: the easter egg.
    g.fillStyle = '#dfe9f5';
    g.fillRect(30, 104, 176, 208);
    drawPortrait(g, pass.look, pass.face, 34, 116, 168);
    g.strokeStyle = '#9aa7ba';
    g.lineWidth = 3;
    g.strokeRect(30, 104, 176, 208);
    g.fillStyle = '#7a8394';
    g.font = '600 15px sans-serif';
    g.fillText('PHOTO ID', 84, 334);
    /** A label and its value; a long value shrinks to fit `width` (a name is never cut short). */
    const field = (label: string, value: string, x: number, y: number, size = 38, width = Infinity) => {
      g.fillStyle = '#7a8394';
      g.font = '600 17px sans-serif';
      g.fillText(label, x, y);
      g.fillStyle = '#16213b';
      let fit = size;
      g.font = `bold ${fit}px sans-serif`;
      while (fit > 14 && g.measureText(value).width > width) {
        fit -= 1;
        g.font = `bold ${fit}px sans-serif`;
      }
      g.fillText(value, x, y + size + 4);
    };
    const name = pass.name.toUpperCase().slice(0, 16);
    field('PASSENGER', name, 236, 118, 46, 520);
    field('TO', `${pass.city.toUpperCase()} (${pass.destination})`, 236, 206, 30);
    field('SEAT', pass.seat, 236, 282, 44);
    field('GROUP', 'A', 400, 282, 44);
    field('FLIGHT', 'FT 13', 520, 282, 44);
    // Barcode.
    let x = 236;
    let r = hash(pass.name) || 1;
    g.fillStyle = '#16213b';
    while (x < 740) {
      r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
      const w = 2 + (r % 5);
      g.fillRect(x, 360, w, 44);
      x += w + 2 + ((r >> 8) % 4);
    }
    // Tear-off stub.
    g.setLineDash([8, 8]);
    g.strokeStyle = '#b3b9c4';
    g.beginPath();
    g.moveTo(770, 86);
    g.lineTo(770, 410);
    g.stroke();
    g.setLineDash([]);
    field('NAME', name, 790, 118, 28, 215);
    field('SEAT', pass.seat, 790, 196, 52);
    field('TO', pass.destination, 790, 290, 44);
  });
}

/** Terminal floor, ceiling, windows onto the apron, the podium, stanchions and gate seating. */
function buildTerminal(scene: THREE.Scene): { screen: THREE.MeshStandardMaterial; light: THREE.MeshStandardMaterial; readout: THREE.CanvasTexture; drawReadout: (text: string, ok: boolean) => void } {
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const floor = new THREE.MeshStandardMaterial({
    roughness: 0.28,
    metalness: 0.05,
    map: canvasTexture(
      512,
      512,
      (g) => {
        g.fillStyle = '#c9c3b7';
        g.fillRect(0, 0, 512, 512);
        let r = 7;
        for (let i = 0; i < 9000; i++) {
          r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
          g.fillStyle = `rgba(${60 + (r % 80)},${55 + (r % 70)},${50 + (r % 60)},0.18)`;
          g.fillRect(r % 512, (r >> 9) % 512, 2, 2);
        }
        g.strokeStyle = 'rgba(80,72,60,0.25)';
        g.lineWidth = 2;
        g.strokeRect(0, 0, 512, 512);
      },
      [14, 14],
    ),
  });
  add(new THREE.PlaneGeometry(40, 40), floor, 0, 0, -4, -Math.PI / 2).castShadow = false;
  add(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#dde0e4', roughness: 0.9 }), 0, 4.6, -4, Math.PI / 2);
  const panel = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#f4f1e8', emissiveIntensity: 1.3 });
  for (let z = -16; z <= 8; z += 3.2) for (const x of [-2.6, 1.2, 5]) add(new THREE.PlaneGeometry(1.6, 0.5), panel, x, 4.58, z, Math.PI / 2);
  // Back wall behind the podium, with the jet bridge door.
  // (It stops at the window line, so the apron stays in view through the glass.)
  add(new THREE.PlaneGeometry(25, 4.6), new THREE.MeshStandardMaterial({ color: '#5b6576', roughness: 0.7 }), 7.5, 2.3, DESK_Z - 3.5);
  add(new THREE.BoxGeometry(1.5, 2.3, 0.1), new THREE.MeshStandardMaterial({ color: '#a8b0bc', roughness: 0.35, metalness: 0.5 }), -0.2, 1.15, DESK_Z - 3.44);
  // Big windows on the left: mullions, glass, the apron beyond.
  const mullion = new THREE.MeshStandardMaterial({ color: '#39414d', roughness: 0.5, metalness: 0.4 });
  for (let z = -20; z <= 10; z += 2.4) add(new THREE.BoxGeometry(0.12, 4.6, 0.12), mullion, -5, 2.3, z);
  add(new THREE.BoxGeometry(0.14, 0.14, 30), mullion, -5, 0.5, -5);
  add(new THREE.BoxGeometry(0.14, 0.14, 30), mullion, -5, 4.5, -5);
  const glass = new THREE.MeshStandardMaterial({ color: '#9fb6cc', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, depthWrite: false });
  const pane = add(new THREE.PlaneGeometry(30, 4), glass, -5.02, 2.5, -5, 0, Math.PI / 2);
  pane.castShadow = false;

  // Outside: concrete apron, the plane at the gate, a jet bridge, a dawn sky.
  const apron = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    map: canvasTexture(
      256,
      256,
      (g) => {
        g.fillStyle = '#6f7277';
        g.fillRect(0, 0, 256, 256);
        g.strokeStyle = '#5c5f63';
        g.strokeRect(0, 0, 256, 256);
        g.fillStyle = '#e1b83f';
        g.fillRect(124, 0, 8, 256);
      },
      [10, 10],
    ),
  });
  add(new THREE.PlaneGeometry(200, 200), apron, -60, -0.02, -10, -Math.PI / 2).castShadow = false;
  const plane = buildAirliner();
  // Parked alongside the terminal, nose towards the back of the queue, its left door at the jet bridge.
  plane.group.position.set(-20, 0, -12);
  plane.group.rotation.y = Math.PI;
  scene.add(plane.group);
  const door = plane.door.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI).add(plane.group.position);
  const bridge = new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.55, metalness: 0.2 });
  const bridgeLength = Math.abs(door.x + 5.2);
  add(new THREE.BoxGeometry(bridgeLength, 2.6, 2.4), bridge, (door.x - 5.2) / 2, door.y + 0.3, door.z);
  add(new THREE.BoxGeometry(0.5, door.y - 1, 0.5), bridge, door.x + 2.5, (door.y - 1) / 2, door.z);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(180, 32, 16),
    new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      map: canvasTexture(512, 256, (g) => {
        const grad = g.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, '#12254a');
        grad.addColorStop(0.45, '#3f5a8a');
        grad.addColorStop(0.62, '#f2a36b');
        grad.addColorStop(0.7, '#ffd9a1');
        grad.addColorStop(1, '#6f7278');
        g.fillStyle = grad;
        g.fillRect(0, 0, 512, 256);
      }),
    }),
  );
  scene.add(sky);

  // The podium with its sign, and the scanner on a stand in front of it.
  const wood = new THREE.MeshStandardMaterial({ color: '#2c3747', roughness: 0.5 });
  add(new RoundedBoxGeometry(1.6, 1.08, 0.6, 3, 0.04), wood, 0.9, 0.54, DESK_Z - 0.35);
  const sign = new THREE.MeshStandardMaterial({
    emissive: '#ffffff',
    emissiveIntensity: 0.9,
    map: canvasTexture(1024, 384, (g) => {
      g.fillStyle = '#0d1424';
      g.fillRect(0, 0, 1024, 384);
      g.fillStyle = '#ffb547';
      g.font = 'bold 110px sans-serif';
      g.fillText('GATE 13', 44, 130);
      g.fillStyle = '#e8eefb';
      g.font = 'bold 64px sans-serif';
      g.fillText('FLIGHT 13', 44, 235);
      g.fillStyle = '#5be38b';
      g.font = 'bold 56px sans-serif';
      g.fillText('NOW BOARDING', 44, 330);
    }),
  });
  sign.emissiveMap = sign.map;
  add(new THREE.BoxGeometry(2.4, 0.9, 0.08), sign, 0.9, 2.55, DESK_Z - 0.7);
  add(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8), mullion, 0.9, 3.8, DESK_Z - 0.7);
  const stand = new THREE.MeshStandardMaterial({ color: '#1c2129', roughness: 0.45, metalness: 0.4 });
  add(new THREE.CylinderGeometry(0.05, 0.16, 1.02, 16), stand, 0, 0.51, DESK_Z + 0.2);
  add(new RoundedBoxGeometry(0.34, 0.08, 0.26, 2, 0.02), stand, 0, 1.06, DESK_Z + 0.2);
  const screen = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ff2a2a', emissiveIntensity: 0.9, roughness: 0.2 });
  add(new THREE.PlaneGeometry(0.2, 0.12), screen, 0, 1.101, DESK_Z + 0.2, -Math.PI / 2);
  const light = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ff3b30', emissiveIntensity: 1.2 });
  add(new THREE.SphereGeometry(0.014, 12, 8), light, 0.13, 1.105, DESK_Z + 0.1);
  const readoutCanvas = document.createElement('canvas');
  readoutCanvas.width = 256;
  readoutCanvas.height = 96;
  const readout = new THREE.CanvasTexture(readoutCanvas);
  readout.colorSpace = THREE.SRGBColorSpace;
  const drawReadout = (text: string, ok: boolean) => {
    const g = readoutCanvas.getContext('2d')!;
    g.fillStyle = ok ? '#0c2a17' : '#0b1220';
    g.fillRect(0, 0, 256, 96);
    g.fillStyle = ok ? '#5be38b' : '#9fb4ff';
    g.font = 'bold 24px sans-serif';
    g.textAlign = 'center';
    g.fillText(text, 128, 58);
    readout.needsUpdate = true;
  };
  drawReadout('SCAN PASS', false);
  const readoutMat = new THREE.MeshStandardMaterial({ map: readout, emissive: '#ffffff', emissiveMap: readout, emissiveIntensity: 0.9 });
  add(new THREE.PlaneGeometry(0.16, 0.06), readoutMat, 0, 1.13, DESK_Z + 0.07, -0.9);

  // Retractable-belt stanchions making a lane back from the podium.
  const chrome = new THREE.MeshStandardMaterial({ color: '#d7dce3', roughness: 0.2, metalness: 1 });
  const belt = new THREE.MeshStandardMaterial({ color: '#233c82', roughness: 0.7 });
  for (const x of [-0.6, 0.6]) {
    for (let z = DESK_Z + 0.9; z <= DESK_Z + 14; z += 2.2) {
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 10), chrome, x, 0.48, z);
      add(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 18), chrome, x, 0.015, z);
      add(new THREE.BoxGeometry(0.01, 0.05, 2.2), belt, x, 0.9, z + 1.1);
    }
  }
  // Rows of gate seats on the right.
  const seat = new THREE.MeshStandardMaterial({ color: '#3b4556', roughness: 0.6 });
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 8; i++) {
      const z = DESK_Z + 2 + i * 0.62;
      const x = 2.4 + row * 1.6;
      add(new RoundedBoxGeometry(0.52, 0.08, 0.5, 2, 0.02), seat, x, 0.45, z);
      add(new RoundedBoxGeometry(0.52, 0.55, 0.07, 2, 0.02), seat, x + 0.28, 0.72, z, 0, Math.PI / 2, 0);
    }
  }

  // Light: bright even terminal light, and the low sun through the windows.
  scene.add(new THREE.HemisphereLight('#e7edf7', '#8b847a', 1.1));
  const sun = new THREE.DirectionalLight('#ffc98f', 2.2);
  sun.position.set(-30, 12, 6);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -12;
  cam.right = 12;
  cam.top = 12;
  cam.bottom = -12;
  cam.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  return { screen, light, readout, drawReadout };
}

/** A hand holding the pass by its end: palm and fingers underneath, thumb pressed on top. Points along +z. */
function buildHand(skin: string, sleeve: string): THREE.Group {
  const g = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.6 });
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.028, 0.09, 3, 0.012), material);
  palm.position.set(0, -0.02, -0.03);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.045, 4, 8), material);
    finger.rotation.x = Math.PI / 2;
    finger.position.set(-0.028 + i * 0.019, -0.012, 0.03 - Math.abs(i - 1.5) * 0.006);
    g.add(finger);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.04, 4, 8), material);
  thumb.rotation.set(Math.PI / 2, 0, 0);
  thumb.position.set(-0.03, 0.009, 0.012);
  g.add(thumb);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.16, 16), new THREE.MeshStandardMaterial({ color: sleeve, roughness: 0.9 }));
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, -0.02, -0.14);
  g.add(cuff);
  return g;
}

export class GateSet {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.02, 400);
  private readonly people = new People();
  private readonly order: string[];
  private readonly youIndex: number;
  private readonly pass: THREE.Group;
  private readonly terminal: ReturnType<typeof buildTerminal>;
  private readonly fired = new Set<string>();
  private lastShot: GateShot | null = null;

  constructor(renderer: THREE.WebGLRenderer, game: PlayerView, faces: ReadonlyMap<string, string> | null) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();
    this.terminal = buildTerminal(this.scene);

    // Everyone in line, in an order every screen agrees on, with you third when there are enough people.
    const you = game.you;
    const others = game.players.filter((p) => p.id !== you?.id).sort((a, b) => hash(game.gameId + a.id) - hash(game.gameId + b.id));
    const ahead = Math.min(2, others.length);
    this.order = you ? [...others.slice(0, ahead).map((p) => p.id), you.id, ...others.slice(ahead).map((p) => p.id)] : others.map((p) => p.id);
    this.youIndex = you ? ahead : -1;
    const standing: PlayerSummary[] = game.players.map((p) => ({ ...p, seat: null, status: 'alive', cause: null }));
    this.people.sync(standing, null, () => new THREE.Vector3(), faces);
    if (you) {
      const me = this.people.actor(you.id);
      if (me) me.hidden = true;
    }
    this.scene.add(this.people.group);

    // Your boarding pass, in your hand.
    const info: PassInfo = {
      name: you?.name ?? 'Passenger',
      seat: you?.seat ? (grid.isAisleSpot(you.seat) ? 'CREW' : you.seat) : '--',
      look: game.players.find((p) => p.id === you?.id)?.look ?? { body: 1, skin: 2, hair: 0, hairColor: 0, top: 0, topStyle: 0, bottom: 0 },
      face: you ? faces?.get(you.id) : undefined,
      destination: destinationOf(game.settings).code,
      city: destinationOf(game.settings).city,
    };
    this.pass = new THREE.Group();
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.0012, 0.082), [
      new THREE.MeshStandardMaterial({ color: '#f3efe6' }),
      new THREE.MeshStandardMaterial({ color: '#f3efe6' }),
      new THREE.MeshStandardMaterial({ map: passTexture(info), roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: '#f3efe6' }),
      new THREE.MeshStandardMaterial({ color: '#f3efe6' }),
      new THREE.MeshStandardMaterial({ color: '#f3efe6' }),
    ]);
    card.castShadow = true;
    this.pass.add(card);
    // Your sleeve: bare arm in a T-shirt or tank top, your top's colour otherwise.
    const skin = SKIN[info.look.skin] ?? SKIN[0];
    const bareArm = info.look.topStyle === 1 || info.look.topStyle === 3;
    const hand = buildHand(skin, bareArm ? skin : TOP[info.look.top] ?? TOP[0]);
    // Holding the right-hand end, thumb over the stub.
    hand.position.set(0.1, 0, 0);
    hand.rotation.y = -Math.PI / 2;
    this.pass.add(hand);
    this.pass.visible = false;
    this.scene.add(this.pass, this.camera);
  }

  /** Draw one shot at a local time (seconds from the start of that shot). */
  show(shot: GateShot, t: number, dt: number, time: number): void {
    if (shot !== this.lastShot) {
      this.lastShot = shot;
      this.fired.clear();
    }
    if (shot === 'queue') this.queue(t);
    else this.scan(t);
    this.people.update(dt, time);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.fov = width < height ? 74 : 60;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.people.dispose();
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of materials) {
        for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
        m.dispose();
      }
    });
    this.scene.environment?.dispose();
  }

  private once(cue: string, fn: () => void): void {
    if (this.fired.has(cue)) return;
    this.fired.add(cue);
    fn();
  }

  /** The line shuffles forward a step; the person at the front goes through; you glance out at the plane. */
  private queue(t: number): void {
    this.pass.visible = false;
    const shuffle = span(t, 1.4, 2.7);
    const walking = t > 1.4 && t < 2.7 ? 1 : 0;
    this.order.forEach((id, i) => {
      const actor = this.people.actor(id);
      if (!actor) return;
      const lane = i === 0 ? span(t, 0.9, 3.4) * 3.2 : shuffle * STEP;
      const z = DESK_Z + 1.2 + i * STEP - lane;
      // The person at the front hands over their pass and heads down the jet bridge door.
      const x = i === 0 ? -span(t, 1.8, 3.4) * 0.9 : Math.sin(i * 1.7) * 0.06;
      actor.hidden = i === this.youIndex || (i === 0 && t > 3.6);
      actor.drive({ x, z, yaw: i === 0 ? span(t, 1.8, 3.2) * 0.8 : Math.sin(i * 2.3) * 0.15, walk: i === 0 ? (t > 0.9 && t < 3.4 ? 1 : 0) : walking, phase: t * 7 + i });
    });
    const me = Math.max(0, this.youIndex);
    const z = DESK_Z + 1.2 + me * STEP - shuffle * STEP + 0.12;
    const bob = walking ? Math.abs(Math.sin(t * 7)) * 0.02 : 0;
    this.camera.position.set(SIDE, EYE + bob + Math.sin(t * 1.2) * 0.004, z);
    // Glance left out of the windows at the plane, then back to the gate.
    const glance = span(t, 3.0, 3.9) - span(t, 4.7, 5.6);
    this.camera.rotation.set(-0.06 + glance * 0.05, glance * 0.9, 0, 'YXZ');
    if (t > 1.45) this.once('steps', () => [0, 0.45, 0.9].forEach((d) => setTimeout(() => cabinAudio.step(), d * 1000)));
    if (t > 0.3) this.once('pa', () => cabinAudio.ding());
  }

  /** Your pass goes over the scanner: red line, beep, green light, welcome aboard. */
  private scan(t: number): void {
    for (const id of this.order) {
      const actor = this.people.actor(id);
      if (actor) actor.hidden = true;
    }
    // Looking down over your own hand at the pass above the scanner glass.
    const hover = new THREE.Vector3(0, 1.19, DESK_Z + 0.26);
    this.camera.position.set(0.012, 1.34, DESK_Z + 0.44);
    this.camera.lookAt(hover.x, hover.y - 0.012, hover.z);
    // In from the bottom right, over the glass, held there, and away.
    const inward = span(t, 0.2, 1.1);
    const away = span(t, 3.3, 4.2);
    this.pass.visible = t > 0.1 && t < 4.3;
    const start = new THREE.Vector3(0.24, 1.02, DESK_Z + 0.5);
    this.pass.position.lerpVectors(start, hover, inward).lerp(new THREE.Vector3(0.3, 1.05, DESK_Z + 0.55), away);
    // Tilted up towards you so you can read it (and the photo).
    this.pass.rotation.set(0.78 - inward * 0.02, -0.06 + Math.sin(t * 2) * 0.01, 0.03);
    const scanning = t > 1.2 && t < 2.3;
    const ok = t >= 2.3;
    this.terminal.screen.emissive.set(scanning ? (Math.sin(t * 40) > 0 ? '#ff2a2a' : '#7a0f0f') : ok ? '#3cff7a' : '#8a1a1a');
    this.terminal.light.emissive.set(ok ? '#3cff7a' : '#ff3b30');
    if (ok) {
      this.once('beep', () => {
        cabinAudio.beep(0.2);
        setTimeout(() => cabinAudio.chime(), 150);
        this.terminal.drawReadout('WELCOME ABOARD', true);
      });
    } else if (t < 0.2) {
      this.fired.delete('beep');
      this.terminal.drawReadout('SCAN PASS', false);
    }
  }
}
