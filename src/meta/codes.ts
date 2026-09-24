import { addItems, type Bag, type ItemCounts } from './bag';

/** What a developer code gives. */
export interface Reward {
  credits?: number;
  items?: ItemCounts;
}

/**
 * Developer codes, by the SHA-256 of `flight13:` + the code in capitals, so this public file does not
 * give them away. Add one with `node scripts/code-hash.mjs <CODE>`. Each works once per browser.
 */
export const CODES: Readonly<Record<string, Reward>> = {
  // One of everything.
  c559b2b7e9c4a7427963f15b413644cec163a7aeef8ab89b36f8401ae7ac3df7: {
    items: { antidote: 1, defuser: 1, extender: 1, flashlight: 1, pills: 1, mirror: 1, ffcard: 1, pillow: 1, bobbypin: 1 },
  },
  // Air miles.
  b58cddc5647ef57e57ebe27bedecbf7fd9350861e957c34f604f9d4dd3a09f9e: { credits: 500 },
  // Fast-track security: the survival kit.
  '54db6ba08e5fecaa730d647ff5e79a8e08cb05545bfdd75e880f1faca42e8a9a': { items: { antidote: 2, defuser: 2, pillow: 2 } },
};

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`flight13:${normalizeCode(code)}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type Redemption = { ok: true; bag: Bag; reward: Reward } | { ok: false; error: string };

/** Check a code and add what it gives (once per bag). */
export async function redeem(bag: Bag, code: string): Promise<Redemption> {
  if (!normalizeCode(code)) return { ok: false, error: 'Type a code first.' };
  const hash = await hashCode(code);
  const reward = CODES[hash];
  if (!reward) return { ok: false, error: 'That code does not work.' };
  if (bag.redeemed.includes(hash)) return { ok: false, error: 'You already used that code.' };
  const next = addItems({ ...bag, credits: bag.credits + (reward.credits ?? 0), redeemed: [...bag.redeemed, hash] }, reward.items ?? {});
  return { ok: true, bag: next, reward };
}
