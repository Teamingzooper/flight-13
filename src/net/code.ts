const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random 4-character flight number (no I, O, 0 or 1). */
export function newFlightCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return code;
}

/** Accepts "7k2q", "FT-7K2Q" or " ft 7k2q " and returns "7K2Q"; null if it is not a flight number. */
export function normalizeCode(input: string): string | null {
  let cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length === 6 && cleaned.startsWith('FT')) cleaned = cleaned.slice(2);
  if (cleaned.length !== 4) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return cleaned;
}

export function formatCode(code: string): string {
  return `FT-${code}`;
}
