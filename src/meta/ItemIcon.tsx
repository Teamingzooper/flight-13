import type { ItemId } from '../engine';
import { ITEM_COLORS } from './shop';

const PATHS: Record<ItemId, string[]> = {
  antidote: ['M10 3h4', 'M11 3v5l-4.2 9.2A2 2 0 0 0 8.6 20h6.8a2 2 0 0 0 1.8-2.8L13 8V3', 'M8.4 14h7.2'],
  defuser: ['M9.5 3.5 12 10l2.5-6.5', 'M12 10 7 20.5', 'M12 10l5 10.5', 'M10.3 13.5h3.4'],
  extender: ['M2.5 9.5h9v5h-9z', 'M11.5 12h10', 'M5.5 11.2v1.6', 'M16 10.5v3'],
  flashlight: ['M3 9.5h9.5L17 6.5v11l-4.5-3H3z', 'M19.5 9l2-1', 'M19.5 15l2 1', 'M20 12h2'],
  pills: ['M5.6 18.4a3.6 3.6 0 0 1 0-5.1l7.7-7.7a3.6 3.6 0 0 1 5.1 5.1l-7.7 7.7a3.6 3.6 0 0 1-5.1 0z', 'M9.4 9.4l5.2 5.2'],
  mirror: ['M12 3.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10z', 'M7 16.5a5 2.8 0 0 0 10 0', 'M10 6.5l3.5 3.5'],
  ffcard: ['M3 6.5h18v11H3z', 'M3 10.5h18', 'M6.5 14.5h5'],
  pillow: ['M7.5 4.5c-2.2 0-3.5 2.4-3.5 5.5a8 8 0 0 0 16 0c0-3.1-1.3-5.5-3.5-5.5-2 0-3.2 1.8-3.2 3.8a1.3 1.3 0 0 1-2.6 0c0-2-1.2-3.8-3.2-3.8z'],
  bobbypin: ['M5 19 16.2 7.8a2.6 2.6 0 1 0-3.7-3.7L5 11.6', 'M8.4 19.5 18.6 9.3'],
};

/** A carry-on item as a small line drawing in its colour. */
export function ItemIcon({ item, size = 24, muted = false }: { item: ItemId; size?: number; muted?: boolean }) {
  return (
    <svg
      class="item-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={muted ? 'currentColor' : ITEM_COLORS[item]}
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[item].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
