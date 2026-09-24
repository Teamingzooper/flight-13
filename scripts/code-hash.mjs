// Prints the hash for a new Duty Free developer code, to paste into src/meta/codes.ts.
// Usage: node scripts/code-hash.mjs CREW-7Q4K
import { createHash } from 'node:crypto';

const code = process.argv[2];
if (!code) {
  console.error('Usage: node scripts/code-hash.mjs <CODE>');
  process.exit(1);
}
const normalized = code.trim().toUpperCase().replace(/\s+/g, '');
console.log(createHash('sha256').update(`flight13:${normalized}`).digest('hex'));
