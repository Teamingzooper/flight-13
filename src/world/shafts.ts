import * as THREE from 'three';

/** A window in the cabin wall: its centre, which wall (-1 left, 1 right), its size, and how far its shade is down. */
export interface WindowSpot {
  x: number;
  y: number;
  z: number;
  side: -1 | 1;
  width: number;
  height: number;
  /** 0: the shade is up; 1: it is all the way down. */
  shade: number;
}

const BEAM_VERTEX = /* glsl */ `
  attribute float along;
  attribute float across;
  varying float vAlong;
  varying float vAcross;
  void main() {
    vAlong = along;
    vAcross = across;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float strength;
  varying float vAlong;
  varying float vAcross;
  void main() {
    // Soft at the edges of the window's light, fading as it travels into the cabin.
    // (Clamped: rounding can carry vAlong a hair past 1, and pow of a negative is NaN, which bloom spreads everywhere.)
    float along = clamp(vAlong, 0.0, 1.0);
    float edge = smoothstep(1.0, 0.35, clamp(abs(vAcross), 0.0, 1.0));
    float fade = pow(1.0 - along, 1.6) * smoothstep(0.0, 0.08, along);
    gl_FragColor = vec4(color * strength * edge * fade, 1.0);
  }
`;

const DUST_VERTEX = /* glsl */ `
  attribute float twinkle;
  uniform float size;
  varying float vTwinkle;
  void main() {
    vTwinkle = twinkle;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size / max(0.1, -view.z);
    gl_Position = projectionMatrix * view;
  }
`;

const DUST_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float strength;
  varying float vTwinkle;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float soft = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(color * strength * soft * vTwinkle, 1.0);
  }
`;

const DUST_PER_BEAM = 36;

interface Beam {
  spot: WindowSpot;
  /** Where the light enters (the middle of the unshaded part of the window) and its half-sizes. */
  origin: THREE.Vector3;
  halfW: number;
  halfH: number;
  length: number;
}

/**
 * Sunlight (or moonlight) through the windows: a soft beam from every uncovered window on the side the light comes
 * from, slanting down into the cabin, with specks of dust turning slowly in it. Two crossed ribbons per window, added
 * to the picture (no depth), so they cost almost nothing.
 */
export class WindowShafts {
  readonly group = new THREE.Group();
  private readonly beamMaterial: THREE.ShaderMaterial;
  private readonly dustMaterial: THREE.ShaderMaterial;
  private beams: THREE.Mesh | null = null;
  private dust: THREE.Points | null = null;
  private dustState: Float32Array = new Float32Array(0);
  private builtFor = '';
  private readonly dir = new THREE.Vector3();
  private beamList: Beam[] = [];
  dustOn = false;

  constructor(private readonly windows: readonly WindowSpot[]) {
    this.group.name = 'window-shafts';
    this.beamMaterial = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      uniforms: { color: { value: new THREE.Color('#fff1d6') }, strength: { value: 0 } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.dustMaterial = new THREE.ShaderMaterial({
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      uniforms: { color: { value: new THREE.Color('#fff4e0') }, strength: { value: 0 }, size: { value: 6 } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
  }

  /**
   * Point the beams along the light (`dir`: the way it travels) at `strength` (0 hides them), in `color`. Rebuilt only
   * when the light's side or angle changes noticeably.
   */
  update(dt: number, time: number, dir: THREE.Vector3, strength: number, color: THREE.Color, pixelRatio: number): void {
    this.group.visible = strength > 0.002;
    if (!this.group.visible) return;
    const key = `${Math.round(dir.x * 20)},${Math.round(dir.y * 20)},${Math.round(dir.z * 20)},${this.dustOn}`;
    if (key !== this.builtFor) {
      this.builtFor = key;
      this.dir.copy(dir).normalize();
      this.build();
    }
    this.beamMaterial.uniforms.strength.value = strength;
    this.beamMaterial.uniforms.color.value.copy(color);
    this.dustMaterial.uniforms.strength.value = strength * 5;
    this.dustMaterial.uniforms.color.value.copy(color);
    this.dustMaterial.uniforms.size.value = 3.2 * pixelRatio;
    if (this.dust) this.driftDust(dt, time);
  }

  dispose(): void {
    this.beams?.geometry.dispose();
    this.dust?.geometry.dispose();
    this.beamMaterial.dispose();
    this.dustMaterial.dispose();
  }

  private build(): void {
    if (this.beams) {
      this.group.remove(this.beams);
      this.beams.geometry.dispose();
      this.beams = null;
    }
    if (this.dust) {
      this.group.remove(this.dust);
      this.dust.geometry.dispose();
      this.dust = null;
    }
    const dir = this.dir;
    // Light travelling towards -x comes in through the right-hand windows, and the other way round.
    const side = dir.x < 0 ? 1 : -1;
    this.beamList = [];
    for (const spot of this.windows) {
      if (spot.side !== side || spot.shade > 0.92) continue;
      const open = 1 - spot.shade;
      const halfH = (spot.height * open) / 2;
      const origin = new THREE.Vector3(spot.x, spot.y - spot.height / 2 + halfH, spot.z);
      // As far as the floor (or three metres).
      const length = Math.min(3, (origin.y - halfH) / Math.max(0.05, -dir.y));
      this.beamList.push({ spot, origin, halfW: spot.width / 2, halfH, length });
    }
    if (this.beamList.length === 0) return;
    const positions: number[] = [];
    const along: number[] = [];
    const across: number[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const ahead = new THREE.Vector3(0, 0, 1);
    for (const beam of this.beamList) {
      // Two ribbons: one as tall as the window, one as wide, both running along the light.
      for (const [axis, half] of [
        [up, beam.halfH],
        [ahead, beam.halfW],
      ] as const) {
        // (The light spreads a little as it goes: the far end is wider.)
        const a = beam.origin.clone().addScaledVector(axis, -half);
        const b = beam.origin.clone().addScaledVector(axis, half);
        const c = beam.origin.clone().addScaledVector(axis, half * 1.7).addScaledVector(dir, beam.length);
        const d = beam.origin.clone().addScaledVector(axis, -half * 1.7).addScaledVector(dir, beam.length);
        for (const [p, s, t] of [
          [a, 0, -1],
          [b, 0, 1],
          [c, 1, 1],
          [a, 0, -1],
          [c, 1, 1],
          [d, 1, -1],
        ] as const) {
          positions.push(p.x, p.y, p.z);
          along.push(s);
          across.push(t);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
    geometry.setAttribute('across', new THREE.Float32BufferAttribute(across, 1));
    this.beams = new THREE.Mesh(geometry, this.beamMaterial);
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 5;
    this.group.add(this.beams);
    if (this.dustOn) this.buildDust();
  }

  private buildDust(): void {
    const count = this.beamList.length * DUST_PER_BEAM;
    // Per speck: where it is in its beam (along 0..1, across -1..1 twice), and its own pace.
    this.dustState = new Float32Array(count * 4);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < count; i++) {
      this.dustState[i * 4] = rand();
      this.dustState[i * 4 + 1] = rand() * 2 - 1;
      this.dustState[i * 4 + 2] = rand() * 2 - 1;
      this.dustState[i * 4 + 3] = rand();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('twinkle', new THREE.Float32BufferAttribute(new Float32Array(count), 1));
    this.dust = new THREE.Points(geometry, this.dustMaterial);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 6;
    this.group.add(this.dust);
  }

  /** Each speck drifts slowly through its beam, bobbing on the air, and glints as it turns. */
  private driftDust(dt: number, time: number): void {
    const dust = this.dust!;
    const pos = dust.geometry.attributes.position as THREE.BufferAttribute;
    const twinkle = dust.geometry.attributes.twinkle as THREE.BufferAttribute;
    const s = this.dustState;
    for (let b = 0; b < this.beamList.length; b++) {
      const beam = this.beamList[b];
      for (let k = 0; k < DUST_PER_BEAM; k++) {
        const i = b * DUST_PER_BEAM + k;
        const pace = s[i * 4 + 3];
        s[i * 4] = (s[i * 4] + dt * (0.008 + pace * 0.02)) % 1;
        const along = s[i * 4];
        const u = s[i * 4 + 1] * 0.85 + Math.sin(time * (0.3 + pace * 0.4) + i) * 0.1;
        const v = s[i * 4 + 2] * 0.85 + Math.cos(time * (0.25 + pace * 0.3) + i * 1.7) * 0.1;
        const x = beam.origin.x + this.dir.x * beam.length * along;
        const y = beam.origin.y + this.dir.y * beam.length * along + u * beam.halfH;
        const z = beam.origin.z + this.dir.z * beam.length * along + v * beam.halfW;
        pos.setXYZ(i, x, y, z);
        // Brighter near the window, glinting now and then as it turns in the light.
        const glint = 0.35 + 0.65 * Math.max(0, Math.sin(time * (1.2 + pace * 2.6) + i * 3.1)) ** 6;
        twinkle.setX(i, glint * (1 - along) * Math.min(1, along * 12));
      }
    }
    pos.needsUpdate = true;
    twinkle.needsUpdate = true;
  }
}
