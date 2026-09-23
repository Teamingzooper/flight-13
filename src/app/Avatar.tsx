import type { Look } from '../engine';

export const SKIN = ['#f6d3b8', '#e9b48c', '#cf9165', '#a86b43', '#7c4a2b', '#4d2e1c'];
export const HAIR_COLOR = ['#1c1714', '#4b2f1d', '#8b5a2b', '#d4a95f', '#b9b9b9', '#a8362a'];
export const TOP = ['#e5534b', '#3f8ddb', '#3fb27f', '#f2b134', '#9b5cc6', '#5f7390', '#e57a2e', '#e9eef5'];
export const BOTTOM = ['#23282e', '#34495e', '#5b4032', '#1e3a5f', '#6c6576'];

const HAIR_PATHS = [
  'M12 16c0-6 4-9 8-9s8 3 8 9c-2-3-5-4-8-4s-6 1-8 4z',
  'M11 18c0-7 4-11 9-11s9 4 9 11v7c-1-5-2-9-3-10-2 1-4 2-6 2s-4-1-6-2c-1 1-2 5-3 10z',
  'M12 15c0-5 4-8 8-8s8 3 8 8c-3-2-5-3-8-3s-5 1-8 3zM17 5a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  '',
  'M12 14c1-5 4-7 8-7s7 2 8 7l-2-1-2 2-2-2-2 2-2-2-2 2-2-2z',
  'M11 17c0-7 4-10 9-10s9 3 9 10c-3-2-3-5-9-5s-6 3-9 5z',
  'M10 20c0-8 4-13 10-13s10 5 10 13c0 2-1 4-2 5 0-4-1-8-3-10-2 1-3 1-5 1s-3 0-5-1c-2 2-3 6-3 10-1-1-2-3-2-5z',
  'M12 15c0-5 4-8 8-8s8 3 8 8z',
];

export function Avatar({ look, size = 40, dim = false }: { look: Look; size?: number; dim?: boolean }) {
  return (
    <svg class={`avatar${dim ? ' dim' : ''}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#0d1628" />
      <path d="M6 40c1-8 7-12 14-12s13 4 14 12z" fill={TOP[look.top] ?? TOP[0]} />
      <circle cx="20" cy="17" r="8" fill={SKIN[look.skin] ?? SKIN[0]} />
      {HAIR_PATHS[look.hair] ? <path d={HAIR_PATHS[look.hair]} fill={HAIR_COLOR[look.hairColor] ?? HAIR_COLOR[0]} /> : null}
    </svg>
  );
}
