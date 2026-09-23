import type { ComponentChildren } from 'preact';

function Icon({ children, size = 22 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconMap = () => (
  <Icon>
    <rect x="4" y="3" width="16" height="18" rx="3" />
    <path d="M8.5 7.5h2M13.5 7.5h2M8.5 12h2M13.5 12h2M8.5 16.5h2M13.5 16.5h2" />
  </Icon>
);

export const IconBolt = () => (
  <Icon>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </Icon>
);

export const IconChat = () => (
  <Icon>
    <path d="M4 5h16v11H9l-5 4z" />
  </Icon>
);

export const IconVote = () => (
  <Icon>
    <path d="M4 13h16v7H4z" />
    <path d="M8 13V4h8v9" />
    <path d="m10 8 1.5 1.5L14 7" />
  </Icon>
);

export const IconPlane = () => (
  <Icon>
    <path d="M12 2c1 0 2 1.5 2 4v5l7 4v2l-7-2v4l2 2v1l-4-1-4 1v-1l2-2v-4l-7 2v-2l7-4V6c0-2.5 1-4 2-4z" />
  </Icon>
);

export function IconBomb({ size = 14 }: { size?: number }) {
  return (
    <svg class="icon-bomb" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10" cy="14" r="7" fill="currentColor" />
      <path d="M14 8l3-3M17 5h2M17 5V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  );
}

export function IconCart({ size = 18 }: { size?: number }) {
  return (
    <svg class="icon-cart" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="3" width="14" height="15" rx="2" fill="currentColor" />
      <path d="M5 9h14M5 13h14" stroke="#0a1324" stroke-width="1.5" />
      <circle cx="8" cy="20.5" r="1.8" fill="currentColor" />
      <circle cx="16" cy="20.5" r="1.8" fill="currentColor" />
    </svg>
  );
}
