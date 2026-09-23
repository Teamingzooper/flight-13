import { describe, expect, it } from 'vitest';
import { formatCode, newFlightCode, normalizeCode } from './code';

describe('flight codes', () => {
  it('generates four unambiguous characters', () => {
    for (let i = 0; i < 200; i++) expect(newFlightCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  });

  it('accepts the ways people type flight numbers', () => {
    expect(normalizeCode('7k2q')).toBe('7K2Q');
    expect(normalizeCode('FT-7K2Q')).toBe('7K2Q');
    expect(normalizeCode(' ft 7k2q ')).toBe('7K2Q');
    expect(normalizeCode('FTAB')).toBe('FTAB');
    expect(normalizeCode('7K2')).toBeNull();
    expect(normalizeCode('7K2O')).toBeNull();
    expect(formatCode('7K2Q')).toBe('FT-7K2Q');
  });
});
