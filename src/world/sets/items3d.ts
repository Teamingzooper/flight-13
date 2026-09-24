import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ItemId } from '../../engine';

/**
 * Carry-on items as small props (metres), resting on y = 0, longest side along x, facing up: laid out
 * the way you would spread them on a bed. Every prop gets its own materials so it can glow when hovered.
 */

const std = (color: THREE.ColorRepresentation, roughness = 0.6, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A cylinder lying along x. */
function rod(radius: number, length: number, material: THREE.Material, x = 0, y = radius, z = 0, segments = 20): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(radius, radius, length, segments), material, x, y, z, 0, 0, Math.PI / 2);
}

function labelTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w = 256, h = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function antidote(): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({ color: '#dff5ea', roughness: 0.08, metalness: 0, transmission: 0, transparent: true, opacity: 0.38 });
  const liquid = std('#39c774', 0.3, 0, { emissive: '#1f8f4c', emissiveIntensity: 0.35 });
  const cap = std('#c9ced6', 0.35, 0.85);
  const label = new THREE.MeshStandardMaterial({
    roughness: 0.8,
    map: labelTexture((c, w, h) => {
      c.fillStyle = '#f7f4ec';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#1d6b42';
      c.fillRect(0, 0, w, 26);
      c.fillStyle = '#10321f';
      c.font = 'bold 40px sans-serif';
      c.fillText('ANTIDOTE', 18, 82);
      c.font = '22px sans-serif';
      c.fillText('single dose', 18, 112);
    }),
  });
  g.add(rod(0.019, 0.1, glass, 0, 0.019));
  g.add(rod(0.0165, 0.072, liquid, -0.012, 0.019));
  g.add(rod(0.0195, 0.04, label, 0.005, 0.019));
  g.add(rod(0.021, 0.024, cap, 0.058, 0.021));
  g.add(rod(0.012, 0.012, cap, 0.075, 0.021));
  // A second, smaller auto-injector beside it.
  const pen = std('#f1d24a', 0.5);
  g.add(rod(0.011, 0.085, pen, 0.004, 0.011, 0.045));
  g.add(rod(0.0112, 0.02, std('#2d8a53', 0.4), 0.052, 0.011, 0.045));
  return g;
}

function defuser(): THREE.Group {
  const g = new THREE.Group();
  const pouch = std('#2b3024', 0.95);
  g.add(mesh(new RoundedBoxGeometry(0.16, 0.035, 0.1, 3, 0.014), pouch, 0, 0.0175, 0));
  g.add(mesh(new THREE.BoxGeometry(0.15, 0.004, 0.012), std('#15170f', 0.7), 0, 0.036, -0.03));
  // Wire cutters lying across the pouch.
  const grip = std('#d8412e', 0.55);
  const steel = std('#9aa3ad', 0.3, 0.9);
  const handle = new THREE.CapsuleGeometry(0.008, 0.075, 4, 10);
  g.add(mesh(handle, grip, -0.012, 0.043, 0.016, 0, 0, Math.PI / 2 - 0.12));
  g.add(mesh(handle, grip, -0.012, 0.043, 0.038, 0, 0, Math.PI / 2 + 0.12));
  g.add(mesh(new THREE.BoxGeometry(0.045, 0.006, 0.01), steel, 0.055, 0.045, 0.022, 0, 0.12, 0));
  g.add(mesh(new THREE.BoxGeometry(0.045, 0.006, 0.01), steel, 0.055, 0.045, 0.032, 0, -0.12, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 12), steel, 0.034, 0.045, 0.027));
  // A red and a blue wire poking out.
  g.add(mesh(new THREE.TorusGeometry(0.02, 0.0025, 6, 16, Math.PI), std('#e23a2f', 0.5), -0.06, 0.036, -0.045, -Math.PI / 2, 0, 0));
  g.add(mesh(new THREE.TorusGeometry(0.016, 0.0025, 6, 16, Math.PI), std('#2f6be2', 0.5), -0.035, 0.036, -0.045, -Math.PI / 2, 0, 0));
  return g;
}

function extender(): THREE.Group {
  const g = new THREE.Group();
  const webbing = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    map: labelTexture(
      (c, w, h) => {
        c.fillStyle = '#56637a';
        c.fillRect(0, 0, w, h);
        c.strokeStyle = 'rgba(255,255,255,0.08)';
        for (let x = 0; x < w; x += 5) {
          c.beginPath();
          c.moveTo(x, 0);
          c.lineTo(x + 8, h);
          c.stroke();
        }
      },
      128,
      32,
    ),
  });
  const chrome = std('#dfe4ea', 0.18, 1);
  g.add(mesh(new THREE.BoxGeometry(0.19, 0.006, 0.042), webbing, 0, 0.004, 0));
  g.add(mesh(new RoundedBoxGeometry(0.055, 0.014, 0.058, 2, 0.005), chrome, 0.1, 0.008, 0));
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.004, 0.032), std('#3a3f47', 0.4, 0.4), 0.103, 0.0155, 0));
  g.add(mesh(new THREE.BoxGeometry(0.04, 0.004, 0.03), chrome, -0.112, 0.004, 0));
  return g;
}

function flashlight(): THREE.Group {
  const g = new THREE.Group();
  const body = std('#1c1f24', 0.4, 0.6);
  g.add(rod(0.0135, 0.1, body, -0.012, 0.019));
  g.add(rod(0.019, 0.034, body, 0.05, 0.019, 0, 24));
  g.add(mesh(new THREE.TorusGeometry(0.0138, 0.002, 6, 20), std('#9aa3ad', 0.3, 0.9), -0.03, 0.019, 0, 0, Math.PI / 2, 0));
  const lens = std('#fff4d6', 0.2, 0, { emissive: '#ffe2a0', emissiveIntensity: 0.6 });
  g.add(mesh(new THREE.CircleGeometry(0.016, 20), lens, 0.0675, 0.019, 0, 0, Math.PI / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(0.012, 0.004, 0.008), std('#f4c542', 0.5), 0.01, 0.033, 0));
  g.add(mesh(new THREE.TorusGeometry(0.009, 0.0018, 6, 14), std('#2a2d33', 0.6), -0.066, 0.019, 0, 0, 0, 0));
  return g;
}

function pills(): THREE.Group {
  const g = new THREE.Group();
  const bottle = new THREE.MeshPhysicalMaterial({ color: '#e8801f', roughness: 0.25, transparent: true, opacity: 0.85 });
  const cap = std('#f4f4f2', 0.5);
  const label = new THREE.MeshStandardMaterial({
    roughness: 0.8,
    map: labelTexture((c, w, h) => {
      c.fillStyle = '#fbfaf6';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#233';
      c.font = 'bold 30px sans-serif';
      c.fillText('SLEEP AID', 16, 50);
      c.font = '20px sans-serif';
      c.fillText('Take 1 at bedtime', 16, 84);
      c.fillText('May cause drowsiness', 16, 110);
    }),
  });
  g.add(rod(0.026, 0.07, bottle, -0.01, 0.026));
  g.add(rod(0.0262, 0.04, label, -0.012, 0.026));
  g.add(rod(0.028, 0.02, cap, 0.034, 0.028));
  const white = std('#f8f8f6', 0.4);
  const blue = std('#5a86e8', 0.4);
  const capsule = new THREE.CapsuleGeometry(0.0055, 0.012, 4, 8);
  g.add(mesh(capsule, white, 0.07, 0.0055, 0.03, 0, 0.7, Math.PI / 2));
  g.add(mesh(capsule, blue, 0.06, 0.0055, -0.035, 0, -0.4, Math.PI / 2));
  g.add(mesh(new THREE.SphereGeometry(0.006, 10, 8), white, 0.08, 0.004, 0.0));
  return g;
}

function mirror(): THREE.Group {
  const g = new THREE.Group();
  const shell = std('#e3a0bf', 0.3, 0.7);
  const glass = std('#ffffff', 0.02, 1);
  const r = 0.042;
  g.add(mesh(new THREE.CylinderGeometry(r, r, 0.012, 32), shell, 0, 0.006, 0));
  g.add(mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.002, 32), std('#f0d7e2', 0.8), 0, 0.0125, 0));
  // The lid, hinged at the back and open towards you.
  const lid = new THREE.Group();
  lid.position.set(0, 0.012, -r);
  lid.rotation.x = -1.95;
  lid.add(mesh(new THREE.CylinderGeometry(r, r, 0.008, 32), shell, 0, 0.004, r));
  lid.add(mesh(new THREE.CylinderGeometry(r * 0.84, r * 0.84, 0.001, 32), glass, 0, -0.0005, r));
  g.add(lid);
  return g;
}

function ffcard(): THREE.Group {
  const g = new THREE.Group();
  const face = new THREE.MeshStandardMaterial({
    roughness: 0.3,
    metalness: 0.5,
    map: labelTexture((c, w, h) => {
      const grad = c.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#f6dc86');
      grad.addColorStop(0.5, '#caa04a');
      grad.addColorStop(1, '#f1d27a');
      c.fillStyle = grad;
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#3a2a08';
      c.font = 'bold 22px sans-serif';
      c.fillText('FLIGHT 13', 16, 32);
      c.font = '15px sans-serif';
      c.fillText('FREQUENT FLYER', 16, 54);
      c.font = 'bold 18px sans-serif';
      c.fillText('PLATINUM', 16, 150);
      c.fillStyle = '#d8d0b0';
      c.fillRect(16, 72, 36, 28);
      c.strokeStyle = '#8a7a45';
      c.strokeRect(16, 72, 36, 28);
      c.fillStyle = '#3a2a08';
      c.font = '16px monospace';
      c.fillText('4813 0013 1313', 16, 124);
    }, 256, 162),
  });
  const edge = std('#b08a3a', 0.4, 0.6);
  // Box faces are +x, -x, +y, -y, +z, -z: the printed face is on top.
  const card = mesh(new THREE.BoxGeometry(0.086, 0.0018, 0.054), [edge, edge, face, edge, edge, edge], 0, 0.001, 0);
  g.add(card);
  return g;
}

function pillow(): THREE.Group {
  const g = new THREE.Group();
  const fleece = std('#5f86d6', 1);
  const torus = new THREE.TorusGeometry(0.068, 0.032, 16, 40, Math.PI * 1.5);
  torus.scale(1, 1, 0.8);
  const ring = mesh(torus, fleece, 0, 0.026, 0.01, -Math.PI / 2, 0, Math.PI * 0.75 + Math.PI / 2);
  g.add(ring);
  // Rounded ends and a little snap strap.
  const end = new THREE.SphereGeometry(0.032, 16, 12);
  end.scale(1, 0.8, 1);
  g.add(mesh(end, fleece, Math.cos(Math.PI * 0.25) * 0.068, 0.026, Math.sin(Math.PI * 0.25) * 0.068 + 0.01));
  g.add(mesh(end, fleece, -Math.cos(Math.PI * 0.25) * 0.068, 0.026, Math.sin(Math.PI * 0.25) * 0.068 + 0.01));
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.004, 0.012), std('#2c3f6b', 0.8), 0, 0.052, 0.058));
  return g;
}

function bobbypin(): THREE.Group {
  const g = new THREE.Group();
  const card = new THREE.MeshStandardMaterial({
    roughness: 0.85,
    map: labelTexture((c, w, h) => {
      c.fillStyle = '#f3e9da';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#b3475f';
      c.fillRect(0, 0, w, 30);
      c.fillStyle = '#fff';
      c.font = 'bold 20px sans-serif';
      c.fillText('HAIR PINS', 12, 22);
    }, 128, 180),
  });
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.002, 0.085), card, 0, 0.001, 0));
  const wire = std('#1d1f23', 0.35, 0.8);
  for (let i = 0; i < 3; i++) {
    const x = -0.016 + i * 0.016;
    const pin = new THREE.Group();
    pin.position.set(x, 0.0035, 0.008);
    pin.add(mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.06, 6), wire, -0.0022, 0, 0, Math.PI / 2, 0, 0));
    pin.add(mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.06, 6), wire, 0.0022, 0, 0, Math.PI / 2, 0, 0));
    pin.add(mesh(new THREE.TorusGeometry(0.0022, 0.0012, 6, 10, Math.PI), wire, 0, 0, -0.03, -Math.PI / 2, 0, 0));
    g.add(pin);
  }
  return g;
}

const BUILDERS: Record<ItemId, () => THREE.Group> = { antidote, defuser, extender, flashlight, pills, mirror, ffcard, pillow, bobbypin };

export function buildItem(id: ItemId): THREE.Group {
  const g = BUILDERS[id]();
  g.name = `item:${id}`;
  return g;
}

/** Free everything a prop made (it owns its geometries, materials and label textures). */
export function disposeItem(g: THREE.Object3D): void {
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materials) {
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
      m.dispose();
    }
  });
}
