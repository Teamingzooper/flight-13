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

/** Things worn round the neck (under the chin): scarf, tie, bow tie, headphones, lei, gold chain. */
function NeckArt({ index }: { index: number }) {
  switch (index) {
    case 1:
      return (
        <>
          <path d="M12.5 25.2Q20 29.6 27.5 25.2L27.8 28Q20 32.4 12.2 28Z" fill="#c0392b" />
          <path d="M21.5 28.6h3.2l.6 7.4h-3.6z" fill="#a82f22" />
        </>
      );
    case 2:
      return (
        <>
          <rect x="18.8" y="26.2" width="2.4" height="2.2" rx=".6" fill="#1f3a8a" />
          <path d="M19.1 28.3h1.8l1.3 6.6-2.2 2.2-2.2-2.2z" fill="#27479f" />
        </>
      );
    case 3:
      return (
        <path d="M15.8 25.8 20 27.4l-4.2 1.7zM24.2 25.8 20 27.4l4.2 1.7zM18.9 27.4a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0" fill="#c0392b" />
      );
    case 4:
      return (
        <>
          <path d="M12.2 26.4Q20 33.4 27.8 26.4" fill="none" stroke="#26282e" stroke-width="1.5" />
          <circle cx="12.4" cy="26.2" r="2.4" fill="#34373f" />
          <circle cx="27.6" cy="26.2" r="2.4" fill="#34373f" />
          <circle cx="12.4" cy="26.2" r="1" fill="#8d939c" />
          <circle cx="27.6" cy="26.2" r="1" fill="#8d939c" />
        </>
      );
    case 5:
      return (
        <>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const a = Math.PI * (0.08 + (i / 7) * 0.84);
            return <circle key={i} cx={20 - Math.cos(a) * 7.5} cy={25.4 + Math.sin(a) * 4.6} r="1.5" fill={['#e05d8c', '#f2b134', '#f4f1ea'][i % 3]} />;
          })}
        </>
      );
    case 6:
      return (
        <>
          <path d="M13.8 26.4Q20 33 26.2 26.4" fill="none" stroke="#e0b33a" stroke-width="1" />
          <circle cx="20" cy="30.2" r="1.2" fill="#f2c94c" />
        </>
      );
    default:
      return null;
  }
}

/** Eyewear, over the eyes (or up on the forehead). */
function EyesArt({ index }: { index: number }) {
  switch (index) {
    case 1:
      return (
        <g fill="none" stroke="#15171c" stroke-width=".8">
          <circle cx="17" cy="17" r="2.5" />
          <circle cx="23" cy="17" r="2.5" />
          <path d="M19.5 16.6q.5-.5 1 0" />
        </g>
      );
    case 2:
      return (
        <g fill="#111318">
          <rect x="13.8" y="15.4" width="5.6" height="3.4" rx="1.3" />
          <rect x="20.6" y="15.4" width="5.6" height="3.4" rx="1.3" />
          <rect x="19.2" y="16" width="1.6" height=".7" />
        </g>
      );
    case 3:
      return (
        <g fill="#3b3c46" stroke="#d9b34a" stroke-width=".6">
          <path d="M14 15.6h5.2c.3 2.6-.8 3.9-2.6 3.9S14 18.2 14 15.6z" />
          <path d="M20.8 15.6H26c0 2.6-.8 3.9-2.6 3.9s-2.9-1.3-2.6-3.9z" />
          <path d="M19.2 15.8h1.6" fill="none" />
        </g>
      );
    case 4:
      return (
        <g>
          <rect x="11.6" y="10.4" width="16.8" height="3.4" rx="1.6" fill="#e58fc0" />
          <circle cx="17" cy="12.1" r="1.2" fill="#f7c4de" />
          <circle cx="23" cy="12.1" r="1.2" fill="#f7c4de" />
        </g>
      );
    case 5:
      return (
        <g fill="#e5534b">
          <path d="M17 19.2l-2.6-2.6a1.5 1.5 0 0 1 2.6-1.6 1.5 1.5 0 0 1 2.6 1.6z" />
          <path d="M23 19.2l-2.6-2.6a1.5 1.5 0 0 1 2.6-1.6 1.5 1.5 0 0 1 2.6 1.6z" />
        </g>
      );
    default:
      return null;
  }
}

/** Hats, over the hair. */
function HatArt({ index }: { index: number }) {
  switch (index) {
    case 1:
      return (
        <>
          <path d="M11.4 14c0-6.4 4-8.6 8.6-8.6s8.6 2.2 8.6 8.6z" fill="#27406b" />
          <rect x="11" y="12.4" width="18" height="3" rx="1.2" fill="#3a5a8c" />
          <circle cx="20" cy="5.4" r="2" fill="#e9eef5" />
        </>
      );
    case 2:
      return (
        <>
          <path d="M10.6 11.4 12.4 5.8h15.2l1.8 5.6z" fill="#f4f4f0" />
          <rect x="11" y="10" width="18" height="2.6" fill="#1d1f24" />
          <path d="M10.4 12.4Q20 16.4 29.6 12.4l-.2 1.2Q20 17 10.6 13.6z" fill="#1d1f24" />
          <circle cx="20" cy="8.3" r="1.4" fill="#e0b33a" />
        </>
      );
    case 3:
      return (
        <>
          <ellipse cx="20" cy="12.6" rx="12" ry="2.1" fill="#5a3d26" />
          <path d="M13 12.2c0-6 2-7.8 7-7.8s7 1.8 7 7.8z" fill="#6b4a2f" />
          <path d="M16.5 5.6q3.5 1.8 7 0" fill="none" stroke="#4a3220" stroke-width=".7" />
          <rect x="13" y="10" width="14" height="2" fill="#2a1d14" />
        </>
      );
    case 4:
      return (
        <>
          <path d="M20 .8 26 13.2H14z" fill="#e5534b" />
          <path d="M17.4 6.4h5.2M15.6 10h8.8" stroke="#f2b134" stroke-width="1.1" />
          <circle cx="20" cy="1.4" r="1.6" fill="#3fb27f" />
        </>
      );
    case 5:
      return (
        <>
          <path d="M4.6 11.8Q8 16 20 15.2q12 .8 15.4-3.4-3.6 2-15.4 1.6-11.8.4-15.4-1.6z" fill="#b8894f" />
          <path d="M13 13.4c0-6.8 2.6-7.8 7-6.2 4.4-1.6 7 .6 7 6.2z" fill="#c89b62" />
          <rect x="13" y="11" width="14" height="1.8" fill="#6b4a2f" />
        </>
      );
    case 6:
      return (
        <>
          <ellipse cx="19" cy="9.6" rx="9.6" ry="3.8" fill="#c0392b" transform="rotate(-8 19 9.6)" />
          <circle cx="19.6" cy="5.9" r=".9" fill="#a82f22" />
        </>
      );
    default:
      return null;
  }
}

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
      <NeckArt index={look.neck ?? 0} />
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
      <EyesArt index={look.eyes ?? 0} />
      <HatArt index={look.hat ?? 0} />
    </svg>
  );
}
