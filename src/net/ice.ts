/**
 * TURN relay servers, baked in at build time. Direct peer-to-peer connections fail between some
 * networks (strict NATs, mobile carriers, school or office Wi-Fi, VPNs); a relay carries the game for
 * them. Build with VITE_TURN_URLS (comma separated), VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL.
 * The game data stays end-to-end encrypted: a relay only forwards it.
 */
export function relayServers(): RTCIceServer[] {
  const urls = String(import.meta.env.VITE_TURN_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length === 0) return [];
  return [{ urls, username: import.meta.env.VITE_TURN_USERNAME ?? '', credential: import.meta.env.VITE_TURN_CREDENTIAL ?? '' }];
}

export const hasRelay = (): boolean => relayServers().length > 0;
