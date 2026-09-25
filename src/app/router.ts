import { useEffect, useState } from 'preact/hooks';

export type Route =
  | { name: 'home' }
  | { name: 'book' }
  | { name: 'dutyFree' }
  /** `move`: a ticket to take over your seat from another device. */
  | { name: 'flight'; code: string; move?: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const flight = /^\/f\/([A-Za-z0-9-]+)(?:\?move=([a-z2-7]{20}))?$/.exec(path);
  if (flight) return flight[2] ? { name: 'flight', code: flight[1].toUpperCase(), move: flight[2] } : { name: 'flight', code: flight[1].toUpperCase() };
  if (path === '/book') return { name: 'book' };
  if (path === '/duty-free') return { name: 'dutyFree' };
  return { name: 'home' };
}

export function navigate(path: string): void {
  location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** The link friends open to board a flight. */
export function flightLink(code: string): string {
  return `${location.origin}${location.pathname}#/f/${code}`;
}

/** The link that moves your seat to another device (it works once). */
export function moveLink(code: string, ticket: string): string {
  return `${flightLink(code)}?move=${ticket}`;
}
