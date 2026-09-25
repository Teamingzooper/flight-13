import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ControlId, DeckLook } from '../cockpit';
import { CABIN_HALF_WIDTH, FLIGHT_DECK, screenPose } from '../layout';
import { signTexture } from '../textures';
import { SCREEN_H, SCREEN_W } from './seats';

export interface FlightDeck {
  group: THREE.Group;
  /** The screen in front of the captain (the Pilot's game screen). */
  captainScreen: THREE.Matrix4;
  /** The jump seat guest's little screen, on an arm in front of the jump seat. */
  guestScreen: THREE.Matrix4;
  /** Where the jump seat guest's eyes are, in the corner behind the first officer. */
  jumpSeatEye: THREE.Vector3;
  /** Where the guest sits (on the floor under the jump seat), for their body. */
  jumpSeat: THREE.Vector3;
  /** In the galley, just outside the door: where people walk to before they go in. */
  door: THREE.Vector3;
  /** The doorway itself (people near it open the door). */
  doorway: THREE.Vector3;
  /** The monitor showing the cabin cameras. */
  monitor: THREE.Mesh;
  /** The strip under the monitor naming what it shows. */
  setMonitorLabel(text: string): void;
  /** The view through the windscreen (one texture across all four panes). */
  setView(texture: THREE.Texture): void;
  /** The primary flight displays. */
  setDisplay(texture: THREE.Texture): void;
  /** The captain's controls: invisible boxes to aim at and click, each naming its control in `userData.control`. */
  controls: THREE.Object3D[];
  /** Show tonight's calls: the seatbelt switch and lamp, the CALL light, the lever, the dial and the handset. */
  setLook(look: DeckLook): void;
  /** Swing the door open (true) or shut. */
  setDoor(open: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

const CEILING = 2.0;
const PANES = [-0.6, -0.2, 0.2, 0.6];

/**
 * The flight deck past the galley: a wall with a door marked FLIGHT DECK closing off the galley, a narrowing
 * room with the captain's and first officer's seats, an instrument panel with their screens and flight
 * displays, an overhead panel, a monitor for the cabin cameras, and a windscreen onto the world outside.
 */
export function buildFlightDeck(): FlightDeck {
  const group = new THREE.Group();
  group.name = 'flight-deck';
  const back = FLIGHT_DECK.doorZ;
  const nose = FLIGHT_DECK.noseZ;
  const length = back - nose;
  // A little glow of their own: the flight deck is never quite dark (instrument light, the dome light turned low).
  const wall = new THREE.MeshStandardMaterial({ color: '#b9bec8', emissive: '#1a2130', roughness: 0.6, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: '#23272f', emissive: '#0b0e13', roughness: 0.7 });
  const panelMat = new THREE.MeshStandardMaterial({ color: '#2d323b', emissive: '#10141b', roughness: 0.55, metalness: 0.2 });
  const seatMat = new THREE.MeshStandardMaterial({ color: '#3b3f47', emissive: '#15181e', roughness: 0.85 });
  const doorMat = new THREE.MeshStandardMaterial({ color: '#c8ccd3', emissive: '#1b1f26', roughness: 0.45, metalness: 0.15 });
  const bezel = new THREE.MeshStandardMaterial({ color: '#15181e', roughness: 0.4 });
  const glass = new THREE.MeshBasicMaterial({ color: '#e6edf7' });
  const displayMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const monitorMat = new THREE.MeshBasicMaterial({ color: '#0b1016' });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#15181e', emissive: '#9fd6ff', emissiveIntensity: 0.8 });
  const beltOff = new THREE.MeshStandardMaterial({ color: '#3a2c14', emissive: '#000000' });
  const beltOn = new THREE.MeshStandardMaterial({ color: '#3a2c14', emissive: '#ffb547', emissiveIntensity: 2.2 });
  const callOff = new THREE.MeshStandardMaterial({ color: '#1d3324', emissive: '#08130c', roughness: 0.4 });
  const callOn = new THREE.MeshStandardMaterial({ color: '#1d3324', emissive: '#58ff9a', emissiveIntensity: 1.8, roughness: 0.4 });
  const knobMat = new THREE.MeshStandardMaterial({ color: '#d99a2b', emissive: '#3a2406', roughness: 0.35, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: '#8d939c', emissive: '#15181d', roughness: 0.35, metalness: 0.6 });
  const handsetMat = new THREE.MeshStandardMaterial({ color: '#1b1d22', emissive: '#07080a', roughness: 0.5 });
  const hitMat = new THREE.MeshBasicMaterial();
  const signMap = signTexture('FLIGHT DECK', '#e8eefb', '#18314f', 256, 64);
  const sign = new THREE.MeshStandardMaterial({ color: '#000', map: signMap, emissive: '#ffffff', emissiveMap: signMap, emissiveIntensity: 0.9 });
  const maps: THREE.Texture[] = [signMap];
  /** A little white-on-grey placard, lit from within so it reads in the dark. */
  const placard = (text: string, w: number, h: number) => {
    const map = signTexture(text, '#e9eef6', '#2d323b', 256, Math.round((256 * h) / w));
    maps.push(map);
    const mat = new THREE.MeshStandardMaterial({ color: '#000', map, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.55 });
    materials.push(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    return mesh;
  };
  const materials: THREE.Material[] = [
    wall,
    dark,
    panelMat,
    seatMat,
    doorMat,
    bezel,
    glass,
    displayMat,
    monitorMat,
    lampMat,
    beltOff,
    beltOn,
    callOff,
    callOn,
    knobMat,
    metal,
    handsetMat,
    hitMat,
    sign,
  ];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, parent: THREE.Object3D = group) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0, 'YXZ');
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // The galley's end: a wall across the cabin with a doorway in the middle (the galley side faces +z).
  const doorHalf = 0.42;
  for (const side of [-1, 1]) {
    const w = CABIN_HALF_WIDTH - doorHalf;
    add(new THREE.PlaneGeometry(w, 2.2), wall, side * (doorHalf + w / 2), 1.1, back);
  }
  add(new THREE.PlaneGeometry(doorHalf * 2, 0.3), wall, 0, 2.05, back);
  add(new THREE.PlaneGeometry(0.44, 0.11), sign, 0, 1.72, back + 0.001);
  // The door hangs on its left edge and swings in towards the nose.
  const hinge = new THREE.Group();
  hinge.position.set(-doorHalf + 0.02, 0, back - 0.03);
  group.add(hinge);
  add(new RoundedBoxGeometry(doorHalf * 2 - 0.04, 1.88, 0.05, 2, 0.02), doorMat, doorHalf - 0.02, 0.95, 0, 0, 0, hinge);
  add(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8), bezel, doorHalf * 2 - 0.14, 1.0, 0.04, Math.PI / 2, 0, hinge);

  // The room: floor, ceiling and sides narrowing towards the nose.
  const floor = new THREE.Shape();
  const halfBack = 1.25;
  const halfNose = 0.8;
  floor.moveTo(-halfBack, 0);
  floor.lineTo(halfBack, 0);
  floor.lineTo(halfNose, length);
  floor.lineTo(-halfNose, length);
  floor.lineTo(-halfBack, 0);
  const floorGeometry = new THREE.ShapeGeometry(floor);
  add(floorGeometry, dark, 0, 0.001, back, -Math.PI / 2);
  add(floorGeometry.clone(), wall, 0, CEILING, back, -Math.PI / 2);
  // Each side wall runs straight from the back corner to the nose corner.
  for (const side of [-1, 1]) {
    const quad = new THREE.BufferGeometry();
    const [bx, nx] = [side * halfBack, side * halfNose];
    quad.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([bx, 0, back, nx, 0, nose, nx, CEILING, nose, bx, 0, back, nx, CEILING, nose, bx, CEILING, back], 3),
    );
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    quad.computeVertexNormals();
    add(quad, wall, 0, 0, 0);
  }

  // The windscreen: four panes sharing one view of the world outside, above the glareshield.
  const paneZ = nose + 0.05;
  PANES.forEach((x, i) => {
    const pane = new THREE.PlaneGeometry(0.38, 0.42);
    const uv = pane.getAttribute('uv');
    for (let v = 0; v < uv.count; v++) uv.setX(v, (i + uv.getX(v)) / PANES.length);
    const mesh = add(pane, glass, x, 1.42, paneZ + Math.abs(i - 1.5) * 0.06, -0.35, -x * 0.35);
    mesh.castShadow = mesh.receiveShadow = false;
  });
  add(new THREE.PlaneGeometry(halfNose * 2, 1.15), dark, 0, 0.58, nose + 0.02);
  add(new THREE.PlaneGeometry(halfNose * 2, 0.4), dark, 0, 1.8, nose + 0.12, 0.6);

  // The instrument panel under the glareshield: each pilot's screen with a flight display beside it.
  const panelZ = FLIGHT_DECK.seatZ - 0.62;
  add(new RoundedBoxGeometry(1.7, 0.5, 0.35, 2, 0.04), panelMat, 0, 0.82, panelZ - 0.1);
  add(new RoundedBoxGeometry(1.6, 0.08, 0.5, 2, 0.03), dark, 0, 1.1, panelZ - 0.18);
  const captain = screenPose('Cockpit');
  const tilt = -0.35;
  const onPanel = (x: number) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, captain.y, captain.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)),
      new THREE.Vector3(1, 1, 1),
    );
  const captainScreen = onPanel(captain.x);
  const firstOfficerScreen = onPanel(-captain.x);
  const framed = (m: THREE.Matrix4, w: number, h: number) => {
    const frame = new THREE.Mesh(new RoundedBoxGeometry(w + 0.04, h + 0.04, 0.02, 2, 0.008), bezel);
    frame.applyMatrix4(new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, 0, -0.012)));
    group.add(frame);
  };
  framed(captainScreen, SCREEN_W, SCREEN_H);
  framed(firstOfficerScreen, SCREEN_W, SCREEN_H);
  for (const x of [captain.x - 0.3, -captain.x + 0.3]) {
    const m = onPanel(x);
    framed(m, 0.2, 0.2);
    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), displayMat);
    display.applyMatrix4(m);
    group.add(display);
  }

  // The pedestal between the seats: thrust levers, and the cabin camera monitor on top.
  add(new RoundedBoxGeometry(0.3, 0.6, 0.7, 2, 0.04), panelMat, 0, 0.3, FLIGHT_DECK.seatZ - 0.2);
  for (const x of [-0.05, 0.05]) add(new THREE.BoxGeometry(0.03, 0.14, 0.03), bezel, x, 0.66, FLIGHT_DECK.seatZ - 0.3, 0.4);
  const monitorAt = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0.74, FLIGHT_DECK.seatZ - 0.5),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75, 0, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  framed(monitorAt, 0.24, 0.15);
  const monitor = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.15), monitorMat);
  monitor.applyMatrix4(monitorAt);
  group.add(monitor);
  const monitorHit = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.05), hitMat);
  monitorHit.applyMatrix4(monitorAt);
  monitorHit.visible = false;
  monitorHit.userData.control = 'monitor';
  group.add(monitorHit);
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 256;
  labelCanvas.height = 24;
  const labelMap = new THREE.CanvasTexture(labelCanvas);
  labelMap.colorSpace = THREE.SRGBColorSpace;
  const labelMat = new THREE.MeshBasicMaterial({ map: labelMap });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.0225), labelMat);
  label.applyMatrix4(new THREE.Matrix4().multiplyMatrices(monitorAt, new THREE.Matrix4().makeTranslation(0, -0.075 - 0.0125, 0)));
  group.add(label);
  let labelText = '';

  // The overhead panel: rows of little lamps.
  add(new RoundedBoxGeometry(0.9, 0.06, 0.55, 2, 0.02), panelMat, 0, CEILING - 0.05, FLIGHT_DECK.seatZ - 0.25, 0.25);
  for (let i = 0; i < 12; i++) {
    const lamp = add(new THREE.BoxGeometry(0.03, 0.01, 0.02), lampMat, -0.33 + (i % 6) * 0.13, CEILING - 0.09, FLIGHT_DECK.seatZ - 0.1 - Math.floor(i / 6) * 0.2, 0.25);
    lamp.castShadow = false;
  }

  // The captain's controls. Each has an invisible box around it to aim at (the Pilot clicks them in 3D).
  const S = FLIGHT_DECK.seatZ;
  const controls: THREE.Object3D[] = [];
  const hitBox = (control: ControlId, parent: THREE.Object3D, w: number, h: number, d: number, x = 0, y = 0, z = 0) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hitMat);
    box.position.set(x, y, z);
    box.visible = false;
    box.userData.control = control;
    parent.add(box);
    controls.push(box);
  };
  /** A group posed at a point, turned to face the captain (its +z points at him). */
  const mount = (x: number, y: number, z: number, rx: number, ry = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.set(rx, ry, 0, 'YXZ');
    group.add(g);
    return g;
  };

  // Overhead, on the forward edge above the captain: the SEAT BELTS switch and its lamp.
  const beltPanel = mount(-0.26, CEILING - 0.085, S - 0.6, 0.8);
  // (Drawn a little larger than life: it is the one switch the captain looks up for every night.)
  beltPanel.scale.setScalar(1.35);
  add(new RoundedBoxGeometry(0.21, 0.12, 0.014, 2, 0.005), panelMat, 0, 0, 0, 0, 0, beltPanel);
  const beltSign = placard('SEAT BELTS', 0.15, 0.026);
  beltSign.position.set(0, 0.037, 0.008);
  beltPanel.add(beltSign);
  const belt = add(new THREE.CylinderGeometry(0.013, 0.013, 0.01, 16), beltOff, -0.045, -0.018, 0.009, Math.PI / 2, 0, beltPanel);
  add(new THREE.BoxGeometry(0.03, 0.03, 0.006), bezel, 0.045, -0.018, 0.009, 0, 0, beltPanel);
  const beltToggle = new THREE.Group();
  beltToggle.position.set(0.045, -0.018, 0.012);
  beltPanel.add(beltToggle);
  add(new THREE.CylinderGeometry(0.0045, 0.0055, 0.034, 8), metal, 0, 0.017, 0, 0, 0, beltToggle);
  hitBox('seatbelt', beltPanel, 0.24, 0.14, 0.06);

  // The pedestal between the seats, aft of the thrust levers: the rough air lever on the captain's side...
  const leverBase = mount(-0.1, 0.63, S - 0.16, 0);
  add(new THREE.BoxGeometry(0.03, 0.012, 0.12), bezel, 0, 0, 0, 0, 0, leverBase);
  const lever = new THREE.Group();
  leverBase.add(lever);
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 8), metal, 0, 0.06, 0, 0, 0, lever);
  add(new THREE.SphereGeometry(0.018, 14, 10), knobMat, 0, 0.125, 0, 0, 0, lever);
  const rideSign = placard('RIDE', 0.05, 0.016);
  rideSign.position.set(-0.035, 0.007, 0.03);
  rideSign.rotation.x = -Math.PI / 2;
  leverBase.add(rideSign);
  hitBox('roughair', leverBase, 0.08, 0.18, 0.16, 0, 0.07, 0);

  // In the middle of the instrument panel, above the camera monitor: the cabin intercom and its CALL button.
  const intercom = mount(0.02, 0.93, S - 0.53, -0.35);
  add(new RoundedBoxGeometry(0.14, 0.09, 0.02, 2, 0.006), panelMat, 0, 0, 0, 0, 0, intercom);
  const call = add(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 16), callOff, -0.035, -0.008, 0.014, Math.PI / 2, 0, intercom);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.04, 0.004, 0.004), bezel, 0.03, -0.022 + i * 0.01, 0.012, 0, 0, intercom);
  const callSign = placard('CABIN CALL', 0.1, 0.017);
  callSign.position.set(0, 0.03, 0.0115);
  intercom.add(callSign);
  hitBox('intercom', intercom, 0.16, 0.1, 0.06);

  // On the glareshield in front of the captain: the heading dial (hold, keep course, or take the shortcut).
  const mcp = mount(-0.06, 1.1, S - 0.535, 0);
  add(new RoundedBoxGeometry(0.26, 0.07, 0.04, 2, 0.01), panelMat, 0, 0, 0, 0, 0, mcp);
  const hdgSign = placard('HOLD      HDG      SHORT', 0.2, 0.016);
  hdgSign.position.set(0, 0.024, 0.021);
  mcp.add(hdgSign);
  const dial = new THREE.Group();
  dial.position.set(0, -0.006, 0.022);
  mcp.add(dial);
  add(new THREE.CylinderGeometry(0.02, 0.022, 0.016, 20), metal, 0, 0, 0.008, Math.PI / 2, 0, dial);
  add(new THREE.BoxGeometry(0.004, 0.016, 0.004), knobMat, 0, 0.011, 0.017, 0, 0, dial);
  hitBox('course', mcp, 0.1, 0.08, 0.07, 0, -0.004, 0.02);

  // To the captain's left, on a side console by the wall: the PA handset in its cradle.
  const side = mount(-0.8, 0.6, S - 0.08, 0);
  add(new RoundedBoxGeometry(0.16, 0.1, 0.42, 2, 0.02), panelMat, 0, -0.05, 0, 0, 0, side);
  add(new THREE.BoxGeometry(0.07, 0.02, 0.2), bezel, 0.01, 0.01, 0, 0, 0, side);
  const handset = new THREE.Group();
  handset.position.set(0.01, 0.035, 0);
  side.add(handset);
  add(new RoundedBoxGeometry(0.045, 0.028, 0.19, 2, 0.01), handsetMat, 0, 0, 0, 0, 0, handset);
  for (const end of [-1, 1]) add(new RoundedBoxGeometry(0.05, 0.04, 0.05, 2, 0.012), handsetMat, 0, -0.006, end * 0.085, 0, 0, handset);
  const paSign = placard('PA', 0.04, 0.02);
  paSign.position.set(0.06, 0.001, 0.13);
  paSign.rotation.x = -Math.PI / 2;
  side.add(paSign);
  hitBox('handset', side, 0.16, 0.12, 0.3, 0.01, 0.04, 0);

  // The two pilots' seats, facing forward, and the folding jump seat on the back wall behind the first officer.
  for (const x of [FLIGHT_DECK.seatX, -FLIGHT_DECK.seatX]) {
    add(new RoundedBoxGeometry(0.5, 0.12, 0.5, 2, 0.04), seatMat, x, 0.48, FLIGHT_DECK.seatZ + 0.05);
    add(new RoundedBoxGeometry(0.5, 0.75, 0.12, 2, 0.04), seatMat, x, 0.9, FLIGHT_DECK.seatZ + 0.32, -0.12);
    add(new THREE.CylinderGeometry(0.05, 0.08, 0.42, 10), dark, x, 0.21, FLIGHT_DECK.seatZ + 0.05);
  }
  const jumpX = FLIGHT_DECK.jumpSeatX;
  add(new RoundedBoxGeometry(0.42, 0.08, 0.36, 2, 0.03), seatMat, jumpX, 0.5, back - 0.3);
  add(new RoundedBoxGeometry(0.42, 0.55, 0.08, 2, 0.03), seatMat, jumpX, 0.85, back - 0.1);
  // The first officer's seat hides his screen from back here, so the jump seat has its own, on an arm from the wall.
  const guestScreen = new THREE.Matrix4().compose(
    new THREE.Vector3(jumpX - 0.03, 0.98, back - 0.8),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.45, 0, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  framed(guestScreen, SCREEN_W, SCREEN_H);
  add(new THREE.BoxGeometry(0.2, 0.024, 0.024), dark, jumpX + 0.18, 0.98, back - 0.83);

  // A dome light turned down low, so whoever is up here can be seen at night.
  const dome = new THREE.PointLight('#a9c2ec', 1.3, 3.6, 2);
  dome.position.set(0.15, CEILING - 0.12, FLIGHT_DECK.seatZ + 0.6);
  group.add(dome);
  materials.push(labelMat);

  controls.push(monitorHit);

  // Tonight's calls, eased into place.
  let look: DeckLook = { belt: false, call: false, lever: false, dial: null, handsetUp: false };
  const ease = { belt: 0, lever: 0, dial: 0, handset: 0 };
  let open = 0;
  let wanted = 0;
  return {
    group,
    captainScreen,
    guestScreen,
    jumpSeatEye: new THREE.Vector3(jumpX - 0.04, 1.18, back - 0.36),
    jumpSeat: new THREE.Vector3(jumpX, 0, back - 0.26),
    door: new THREE.Vector3(0, 0, back + 0.35),
    doorway: new THREE.Vector3(0, 0, back),
    monitor,
    controls,
    setView(texture) {
      glass.map = texture;
      glass.needsUpdate = true;
    },
    setDisplay(texture) {
      displayMat.map = texture;
      displayMat.needsUpdate = true;
    },
    setMonitorLabel(text) {
      if (text === labelText) return;
      labelText = text;
      const g = labelCanvas.getContext('2d')!;
      g.fillStyle = '#06100b';
      g.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
      g.fillStyle = '#8dffb4';
      g.font = '600 16px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.textBaseline = 'middle';
      g.fillText(text, 8, labelCanvas.height / 2 + 1);
      g.fillStyle = '#ff4d4d';
      g.beginPath();
      g.arc(labelCanvas.width - 12, labelCanvas.height / 2, 4, 0, Math.PI * 2);
      g.fill();
      labelMap.needsUpdate = true;
    },
    setLook(next) {
      look = next;
      belt.material = next.belt ? beltOn : beltOff;
      call.material = next.call ? callOn : callOff;
    },
    setDoor(value) {
      wanted = value ? 1 : 0;
    },
    update(dt) {
      open += (wanted - open) * Math.min(1, dt * 5);
      hinge.rotation.y = open * 1.45;
      const k = Math.min(1, dt * 8);
      ease.belt += ((look.belt ? 1 : 0) - ease.belt) * k;
      ease.lever += ((look.lever ? 1 : 0) - ease.lever) * k;
      ease.dial += ((look.dial === 'hold' ? 1 : look.dial === 'shortcut' ? -1 : 0) - ease.dial) * k;
      ease.handset += ((look.handsetUp ? 1 : 0) - ease.handset) * Math.min(1, dt * 6);
      // The switch flips down for ON; the lever comes back; the dial turns to HOLD or SHORT; the handset lifts.
      beltToggle.rotation.x = 0.55 - ease.belt * 1.1;
      lever.rotation.x = -0.35 + ease.lever * 0.8;
      dial.rotation.z = ease.dial * 1.1;
      handset.position.y = 0.035 + ease.handset * 0.16;
      handset.position.x = 0.01 + ease.handset * 0.16;
      handset.rotation.set(ease.handset * -0.5, 0, ease.handset * 0.9);
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of materials) m.dispose();
      for (const map of maps) map.dispose();
      labelMap.dispose();
    },
  };
}
