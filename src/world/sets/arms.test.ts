import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Arms, handFacing, indexTip } from './arms';

describe('first-person arms', () => {
  it('points: the forefinger tip lands where a reach aimed it', () => {
    const arms = new Arms();
    const head = new THREE.Vector3(0, 1.2, 0);
    const facing = new THREE.Vector3(0, 0, -1);
    for (const arm of [arms.left, arms.right]) {
      const target = new THREE.Vector3(arm.side === 'left' ? 0.05 : -0.05, 1.05, -0.4);
      const quat = handFacing(new THREE.Vector3(0.2, -0.3, -1), new THREE.Vector3(0, -1, 0.2));
      arm.snap(target.clone(), quat);
      arm.reach(target, quat, indexTip(arm.side));
      arm.targetPointing = 1;
      for (let i = 0; i < 180; i++) arms.update(1 / 60, head, facing);
      expect(arm.pointing).toBeGreaterThan(0.99);
      expect(arm.fingerTip().distanceTo(target)).toBeLessThan(0.006);
    }
  });

  it('curls the forefinger most in a pinch, on both hands', () => {
    const arms = new Arms();
    for (const arm of [arms.left, arms.right]) {
      arm.snap(new THREE.Vector3(0, 1, -0.4), new THREE.Quaternion());
      arm.targetPinch = 1;
      for (let i = 0; i < 60; i++) arms.update(1 / 60, new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, -1));
      // The forefinger bends over towards the thumb: its tip comes back from where a straight finger would be.
      expect(arm.fingerTip().z).toBeGreaterThan(arm.point(indexTip(arm.side)).z + 0.01);
    }
  });
});
