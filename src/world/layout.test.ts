import { describe, expect, it } from 'vitest';
import { CABIN_HALF_WIDTH, PITCH, SEAT_WIDTH, colX, eyePosition, rowZ, screenPose, seatPose } from './layout';

describe('cabin layout', () => {
  it('places columns symmetrically around the aisle', () => {
    expect(colX(3)).toBe(0);
    for (const [l, r] of [[0, 6], [1, 5], [2, 4]]) expect(colX(l)).toBeCloseTo(-colX(r));
    expect(colX(2) - colX(1)).toBeCloseTo(SEAT_WIDTH);
    expect(colX(0) - SEAT_WIDTH / 2).toBeGreaterThan(-CABIN_HALF_WIDTH);
  });

  it('spaces rows by the seat pitch', () => {
    expect(rowZ(1)).toBe(0);
    expect(rowZ(5) - rowZ(4)).toBeCloseTo(PITCH);
    expect(seatPose('3D')).toEqual({ x: colX(4), z: rowZ(3) });
  });

  it('puts every screen within arm reach in front of its passenger', () => {
    for (const seat of ['1A', '2C', '7F', '12D']) {
      const eye = eyePosition(seat);
      const screen = screenPose(seat);
      const reach = eye.z - screen.z;
      expect(screen.x).toBeCloseTo(eye.x);
      expect(reach).toBeGreaterThan(0.45);
      expect(reach).toBeLessThan(0.8);
      expect(screen.y).toBeLessThan(eye.y);
    }
  });
});
