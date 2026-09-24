import type { Look } from '../engine';
import { faceUrl } from './faceImage';

// Palettes grow at the end so every look saved earlier keeps its colours.
export const SKIN = ['#f6d3b8', '#e9b48c', '#cf9165', '#a86b43', '#7c4a2b', '#4d2e1c', '#fbe4d2', '#36200f'];
export const HAIR_COLOR = [
  '#1c1714',
  '#4b2f1d',
  '#8b5a2b',
  '#d4a95f',
  '#b9b9b9',
  '#a8362a',
  '#efe0b6',
  '#f06a2c',
  '#e05d8c',
  '#8e5bd0',
  '#4a7bd8',
  '#3fae6b',
];
export const TOP = ['#e5534b', '#3f8ddb', '#3fb27f', '#f2b134', '#9b5cc6', '#5f7390', '#e57a2e', '#e9eef5', '#1f2a44', '#2e2e33', '#c9a27e', '#d94f8a'];
export const BOTTOM = ['#23282e', '#34495e', '#5b4032', '#1e3a5f', '#6c6576', '#7d6b57', '#3e5c3a', '#b9b2a6'];

/** Swatch order for the wardrobe (lightest skin first). */
export const SKIN_ORDER = [6, 0, 1, 2, 3, 4, 5, 7];
export const HAIR_STYLES = ['Short', 'Long', 'Bun', 'Buzz', 'Spiky', 'Bob', 'Curls', 'Cap', 'Bald', 'Ponytail'];
export const TOP_STYLES = ['Long sleeves', 'T-shirt', 'Hoodie', 'Tank top'];
export const BUILDS = ['Slim', 'Average', 'Broad'];

export const HAIR_PATHS = [
  'M12 16c0-6 4-9 8-9s8 3 8 9c-2-3-5-4-8-4s-6 1-8 4z',
  'M11 18c0-7 4-11 9-11s9 4 9 11v7c-1-5-2-9-3-11-2-.5-4-.5-6-.5s-4 0-6 .5c-1 2-2 6-3 11z',
  'M12 15c0-5 4-8 8-8s8 3 8 8c-3-2-5-3-8-3s-5 1-8 3zM17 5a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  'M12.2 14.5c.3-4 3.4-5.9 7.8-5.9s7.5 1.9 7.8 5.9c-2.2-1.5-4.8-2.2-7.8-2.2s-5.6.7-7.8 2.2z',
  'M12 14c1-5 4-7 8-7s7 2 8 7l-2-1-2 2-2-2-2 2-2-2-2 2-2-2z',
  'M11 17c0-7 4-10 9-10s9 3 9 10c-3-2-3-5-9-5s-6 3-9 5z',
  'M10 20c0-8 4-13 10-13s10 5 10 13c0 2-1 4-2 5 0-4-1-8-3-11-2 1-3 1-5 1s-3 0-5-1c-2 2-3 7-3 11-1-1-2-3-2-5z',
  'M12 13c0-4 4-7 8-7s8 3 8 7zM11 12.5h18c.6 0 .6 1.5 0 1.5H11c-.6 0-.6-1.5 0-1.5z',
  '',
  'M12 16c0-6 4-9 8-9s8 3 8 9c-2-3-5-4-8-4s-6 1-8 4zM27 11c3 1 5 5 4 9-1 1-2 1-3 0 1-3 0-6-2-7z',
];

const pick = (palette: string[], i: number) => palette[i] ?? palette[0];

/** A passenger's portrait: clothes, skin, a painted face (or plain eyes) and hair. */
export function Avatar({ look, face, size = 40, dim = false }: { look: Look; face?: string; size?: number; dim?: boolean }) {
  const skin = pick(SKIN, look.skin);
  const top = pick(TOP, look.top);
  const style = look.topStyle ?? 0;
  const painted = faceUrl(face);
  return (
    <svg class={`avatar${dim ? ' dim' : ''}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#0d1628" />
      {style === 2 && <path d="M10 26c-1-10 4-17 10-17s11 7 10 17c-3 2-6 3-10 3s-7-1-10-3z" fill={top} opacity="0.85" />}
      {style === 3 ? (
        <>
          <path d="M6 40c1-8 7-12 14-12s13 4 14 12z" fill={skin} />
          <path d="M11.5 40c0-6 2.5-10 8.5-10s8.5 4 8.5 10z" fill={top} />
        </>
      ) : (
        <path d="M6 40c1-8 7-12 14-12s13 4 14 12z" fill={top} />
      )}
      <circle cx="20" cy="17" r="8" fill={skin} />
      {painted ? (
        <image href={painted} x="12" y="9" width="16" height="16" />
      ) : (
        <>
          <circle cx="17" cy="17" r="1" fill="#141210" />
          <circle cx="23" cy="17" r="1" fill="#141210" />
        </>
      )}
      {HAIR_PATHS[look.hair] ? <path d={HAIR_PATHS[look.hair]} fill={pick(HAIR_COLOR, look.hairColor)} /> : null}
    </svg>
  );
}
