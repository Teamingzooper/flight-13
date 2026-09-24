import type { ItemId, ItemWhen } from '../engine';

/** Duty Free prices in flight credits. */
export const PRICES: Record<ItemId, number> = {
  antidote: 60,
  defuser: 80,
  extender: 50,
  flashlight: 40,
  pills: 90,
  mirror: 70,
  ffcard: 60,
  pillow: 120,
  bobbypin: 50,
};

/** Accent colour per item (icons, cards, 3D props). */
export const ITEM_COLORS: Record<ItemId, string> = {
  antidote: '#46c07a',
  defuser: '#e0503c',
  extender: '#8fa0b8',
  flashlight: '#f4c542',
  pills: '#f08a3c',
  mirror: '#e58fc0',
  ffcard: '#d9b34a',
  pillow: '#6a8fd8',
  bobbypin: '#a7b0c2',
};

export function whenLabel(when: ItemWhen, automatic: boolean): string {
  if (automatic) return 'Automatic';
  return when === 'night' ? 'Night' : when === 'day' ? 'Day' : 'Any time';
}
