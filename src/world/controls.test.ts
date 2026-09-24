import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { boardScript, walkScript, type Script, type Sample } from './controls';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Sample a walk every 50 ms. */
function walk(from: THREE.Vector3, to: THREE.Vector3) {
  const script = walkScript(from, to, 0, -0.26, 0);
  const out: Sample = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, gait: 0 };
  const samples: { t: number; yaw: number; y: number; z: number }[] = [];
  for (let t = 0; t <= script.duration + 1e-9; t += 0.05) {
    script.sample(t, out);
    samples.push({ t, yaw: out.yaw, y: out.pos.y, z: out.pos.z });
  }
  return { script, samples };
}

describe('walking to another seat', () => {
  // Seat 3E (right side, row 3) to seat 8B (left side, row 8): walking toward the back.
  const from = new THREE.Vector3(0.94, 1.2, 1.74);
  const to = new THREE.Vector3(-0.94, 1.2, 5.84);

  it('gets up facing forward and sits down facing forward, without snapping round', () => {
    const { samples } = walk(from, to);
    const rising = samples.filter((s) => s.t < 0.6);
    expect(rising.every((s) => Math.abs(wrap(s.yaw)) < 0.15)).toBe(true);
    // Lowering into the new seat (the last half second) you face the front of the plane.
    const sitting = samples.filter((s) => s.t > samples[samples.length - 1].t - 0.5);
    expect(sitting.every((s) => Math.abs(wrap(s.yaw)) < 0.15)).toBe(true);
    // Never more than a quick head turn between frames.
    for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i].yaw - samples[i - 1].yaw)).toBeLessThan(0.3);
  });

  it('faces down the aisle while walking it', () => {
    const { samples } = walk(from, to);
    const inAisle = samples.filter((s) => s.y > 1.55 && s.z > 2.4 && s.z < 5.2);
    expect(inAisle.length).toBeGreaterThan(5);
    // Walking toward the back of the plane means facing it (yaw PI).
    expect(inAisle.every((s) => Math.abs(wrap(s.yaw - Math.PI)) < 0.35)).toBe(true);
    // And toward the front, facing forward.
    const forward = walk(to, from).samples.filter((s) => s.y > 1.55 && s.z > 2.4 && s.z < 5.2);
    expect(forward.every((s) => Math.abs(wrap(s.yaw)) < 0.35)).toBe(true);
  });

  it('turns toward the new seat when moving along the same row', () => {
    const { samples } = walk(new THREE.Vector3(-1.4, 1.2, 2.56), new THREE.Vector3(-0.48, 1.2, 2.56));
    const standing = samples.filter((s) => s.y > 1.55);
    // Shuffling toward +x means half-turning that way (yaw toward -PI/2).
    expect(standing.some((s) => wrap(s.yaw) < -0.6)).toBe(true);
    expect(Math.abs(wrap(samples[samples.length - 1].yaw))).toBeLessThan(0.05);
  });

  it('does not spin round for a hop of a row or two', () => {
    const { samples } = walk(new THREE.Vector3(0.94, 1.2, 1.74), new THREE.Vector3(0.94, 1.2, 2.56));
    expect(samples.every((s) => Math.abs(wrap(s.yaw)) < 1)).toBe(true);
    for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i].yaw - samples[i - 1].yaw)).toBeLessThan(0.3);
  });
});

/** Sample any script every 50 ms. */
function samplesOf(script: Script) {
  const out: Sample = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, gait: 0 };
  const samples: { t: number; yaw: number; x: number; y: number; z: number; gait: number }[] = [];
  for (let t = 0; t <= script.duration + 1e-9; t += 0.05) {
    script.sample(t, out);
    samples.push({ t, yaw: out.yaw, x: out.pos.x, y: out.pos.y, z: out.pos.z, gait: out.gait });
  }
  return samples;
}

describe('boarding', () => {
  const door = new THREE.Vector3(0, 1.6, -0.37);

  it('walks in facing down the aisle, already in stride, and sits down facing forward', () => {
    const seat = new THREE.Vector3(-0.94, 1.2, 5.84);
    const script = boardScript(door, seat, 0, 8);
    const samples = samplesOf(script);
    expect(samples[0]).toMatchObject({ x: 0, z: -0.37 });
    expect(Math.abs(wrap(samples[0].yaw - Math.PI))).toBeLessThan(0.05);
    expect(samples[3].gait).toBeGreaterThan(0.3);
    const end = samples[samples.length - 1];
    expect(end.z).toBeCloseTo(5.84, 2);
    expect(end.y).toBeCloseTo(1.2, 2);
    expect(Math.abs(wrap(end.yaw))).toBeLessThan(0.05);
    for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i].yaw - samples[i - 1].yaw)).toBeLessThan(0.3);
  });

  it('hurries to fit the time it has, and copes with a front-row seat', () => {
    const far = boardScript(door, new THREE.Vector3(0.94, 1.2, 12.3), 0, 7);
    expect(far.duration).toBeLessThanOrEqual(7.01);
    const front = samplesOf(boardScript(door, new THREE.Vector3(1.42, 1.2, 0.1), 0, 8));
    // Never doubles back towards the galley.
    for (let i = 1; i < front.length; i++) expect(front[i].z).toBeGreaterThan(front[i - 1].z - 0.02);
    expect(Math.abs(wrap(front[front.length - 1].yaw))).toBeLessThan(0.05);
  });
});
