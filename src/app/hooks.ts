import { useEffect, useState } from 'preact/hooks';
import type { ClientSession, ClientSnapshot } from '../net/client';

export function useClientSnapshot(client: ClientSession): ClientSnapshot {
  const [snapshot, setSnapshot] = useState(client.snapshot);
  useEffect(() => {
    setSnapshot(client.snapshot);
    return client.subscribe(setSnapshot);
  }, [client]);
  return snapshot;
}

export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    onChange();
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** A message that clears itself after a few seconds. */
export function useToast(ms = 3500): [string | null, (message: string | null) => void] {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), ms);
    return () => clearTimeout(id);
  }, [message, ms]);
  return [message, setMessage];
}
