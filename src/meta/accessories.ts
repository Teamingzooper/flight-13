/**
 * Accessories: hats, eyewear and things worn round the neck, bought at Duty Free with flight credits and worn in
 * every flight. Purely cosmetic. Each slot's list only ever grows at the end: an accessory's `index` is what a
 * look stores (0 is none), so reordering would change what everyone already wears.
 */

export type AccessorySlot = 'hat' | 'eyes' | 'neck';

export interface Accessory {
  id: string;
  slot: AccessorySlot;
  /** Its number in the look (1…n within the slot). */
  index: number;
  name: string;
  price: number;
  blurb: string;
}

export const ACCESSORY_SLOTS: readonly { slot: AccessorySlot; label: string }[] = [
  { slot: 'hat', label: 'Hat' },
  { slot: 'eyes', label: 'Eyewear' },
  { slot: 'neck', label: 'Neck' },
];

export const ACCESSORIES: readonly Accessory[] = [
  { id: 'beanie', slot: 'hat', index: 1, name: 'Beanie', price: 70, blurb: 'Warm ears at thirty-five thousand feet.' },
  { id: 'captain', slot: 'hat', index: 2, name: 'Captain’s hat', price: 150, blurb: 'Nobody will ask to see your licence.' },
  { id: 'fedora', slot: 'hat', index: 3, name: 'Fedora', price: 110, blurb: 'For the passenger with a past.' },
  { id: 'party', slot: 'hat', index: 4, name: 'Party hat', price: 60, blurb: 'Someone’s birthday is at cruising altitude.' },
  { id: 'cowboy', slot: 'hat', index: 5, name: 'Cowboy hat', price: 120, blurb: 'Yeehaw, but quietly: people are sleeping.' },
  { id: 'beret', slot: 'hat', index: 6, name: 'Beret', price: 90, blurb: 'Very artistic. Possibly French.' },
  { id: 'glasses', slot: 'eyes', index: 1, name: 'Round glasses', price: 60, blurb: 'You read the safety card. Twice.' },
  { id: 'shades', slot: 'eyes', index: 2, name: 'Sunglasses', price: 80, blurb: 'Nobody can tell where you are looking.' },
  { id: 'aviators', slot: 'eyes', index: 3, name: 'Aviators', price: 120, blurb: 'The Pilot is jealous.' },
  { id: 'sleepmask', slot: 'eyes', index: 4, name: 'Sleep mask', price: 70, blurb: 'Worn up on the forehead, for the look of it.' },
  { id: 'hearts', slot: 'eyes', index: 5, name: 'Heart glasses', price: 90, blurb: 'Love is in the (recirculated) air.' },
  { id: 'scarf', slot: 'neck', index: 1, name: 'Scarf', price: 70, blurb: 'The air conditioning is merciless.' },
  { id: 'tie', slot: 'neck', index: 2, name: 'Tie', price: 60, blurb: 'Flying for business. Probably.' },
  { id: 'bowtie', slot: 'neck', index: 3, name: 'Bow tie', price: 80, blurb: 'Dressed for the captain’s dinner.' },
  { id: 'headphones', slot: 'neck', index: 4, name: 'Headphones', price: 110, blurb: 'Noise cancelling. Suspicion not included.' },
  { id: 'lei', slot: 'neck', index: 5, name: 'Lei', price: 90, blurb: 'Aloha from row whatever.' },
  { id: 'chain', slot: 'neck', index: 6, name: 'Gold chain', price: 140, blurb: 'Heavy enough to set off the metal detector.' },
];

export function accessoryById(id: string): Accessory | undefined {
  return ACCESSORIES.find((a) => a.id === id);
}

/** The accessory worn in a slot at `index` (undefined for none). */
export function accessoryAt(slot: AccessorySlot, index: number | undefined): Accessory | undefined {
  return index ? ACCESSORIES.find((a) => a.slot === slot && a.index === index) : undefined;
}

/** How many accessories a slot has. */
export function slotSize(slot: AccessorySlot): number {
  return ACCESSORIES.filter((a) => a.slot === slot).length;
}
