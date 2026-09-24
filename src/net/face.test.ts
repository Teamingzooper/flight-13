import { describe, expect, it } from 'vitest';
import { FACE_SIZE, FACE_TEMPLATES, cleanFace, decodeFace, encodeFace } from './face';

const blank = () => new Uint8Array(FACE_SIZE * FACE_SIZE);

describe('drawn faces', () => {
  it('survive a round trip through their compact text form', () => {
    const ink = blank();
    for (let x = 10; x < 54; x++) ink[40 * FACE_SIZE + x] = 1;
    ink[20 * FACE_SIZE + 20] = ink[20 * FACE_SIZE + 44] = 1;
    const text = encodeFace(ink);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(text.length).toBeLessThan(40);
    expect(decodeFace(text)).toEqual(ink);
  });

  it('encode a blank face as an empty string', () => {
    expect(encodeFace(blank())).toBe('');
    expect(decodeFace('')).toEqual(blank());
  });

  it('reject junk, truncated data and oversized drawings', () => {
    expect(cleanFace(42)).toBe('');
    expect(cleanFace('not base64!')).toBe('');
    const ink = blank();
    ink[5] = 1;
    const good = encodeFace(ink);
    expect(cleanFace(good)).toBe(good);
    expect(cleanFace(good.slice(0, -1))).toBe('');
    const noisy = blank().map((_, i) => (i % 2 ? 1 : 0));
    expect(cleanFace(encodeFace(noisy))).toBe('');
  });

  it('ship ready-made faces that are all valid', () => {
    expect(FACE_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const t of FACE_TEMPLATES) expect(cleanFace(t.face)).toBe(t.face);
  });
});
