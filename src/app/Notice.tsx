import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { formatCode } from '../net/code';
import type { ClientStatus } from '../net/client';
import { hasRelay } from '../net/ice';
import { checkNetwork, type NetworkKind } from '../net/natcheck';
import { relayUrl } from '../net/relay';
import { navigate } from './router';

/** This network's answer to "can other players reach me directly?" (null while checking; 'relay': it does not matter). */
export function useNetwork(): NetworkKind | 'relay' | null {
  const [kind, setKind] = useState<NetworkKind | 'relay' | null>(() => (relayUrl() ? 'relay' : null));
  useEffect(() => {
    if (relayUrl()) return;
    let alive = true;
    void checkNetwork().then((k) => alive && setKind(k));
    return () => {
      alive = false;
    };
  }, []);
  return kind;
}

/** One line about how well this network can connect to other players. */
export function NetworkNote({ kind }: { kind: NetworkKind | 'relay' | null }) {
  if (kind === 'relay') return <p class="net-note ok">Everyone connects through the Flight 13 server, so any network works.</p>;
  if (kind === null) return <p class="net-note muted">Checking your connection…</p>;
  if (kind === 'open') return <p class="net-note ok">Your network allows direct connections.</p>;
  if (kind === 'unknown') return null;
  return (
    <p class="net-note warn">
      Your network {kind === 'blocked' ? 'blocks' : 'restricts'} direct connections to other players
      {hasRelay() ? ', so the game will go through its relay server.' : '. Try a phone hotspot or another Wi-Fi, and turn off any VPN.'}
    </p>
  );
}

export function Notice({ title, children, action }: { title: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="notice-page">
      <div class="notice">
        <div class="label">Flight 13</div>
        <h1>{title}</h1>
        {children && <div class="notice-body">{children}</div>}
        <div class="row">
          {action}
          <button class="btn ghost" onClick={() => navigate('/')}>
            Back to the terminal
          </button>
        </div>
      </div>
    </div>
  );
}

export function Searching({ code, status, hosting }: { code: string; status: ClientStatus; hosting: boolean }) {
  const [slow, setSlow] = useState(false);
  const network = useNetwork();
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(id);
  }, []);
  const title = status === 'joining' ? 'Boarding…' : hosting ? 'Opening the gate…' : `Looking for ${formatCode(code)}…`;
  return (
    <Notice title={title}>
      <div class="spinner" aria-hidden="true" />
      {status === 'lost' && <p>Lost contact with the captain. Trying to reconnect…</p>}
      {slow && !hosting && (
        <div class="net-help">
          <p>Still looking. Check that:</p>
          {network === 'relay' ? (
            <ul>
              <li>the flight number is right, and the captain has not ended the flight;</li>
              <li>the plane has not taken off yet (unless you were already aboard);</li>
              <li>you are on the latest version: reload the page if in doubt.</li>
            </ul>
          ) : (
            <ul>
              <li>the host still has the flight open, in front (a phone may pause it in the background);</li>
              <li>the flight number is right and the plane has not taken off yet;</li>
              <li>you are both on the latest version: reload the page if in doubt.</li>
            </ul>
          )}
          <NetworkNote kind={network} />
        </div>
      )}
    </Notice>
  );
}
