import { useEffect, useState } from 'preact/hooks';

export type Route = { name: 'home' } | { name: 'book' } | { name: 'flight'; code: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const flight = /^\/f\/([A-Za-z0-9-]+)$/.exec(path);
  if (flight) return { name: 'flight', code: flight[1].toUpperCase() };
  if (path === '/book') return { name: 'book' };
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
