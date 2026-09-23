import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { formatCode } from '../net/code';
import type { ClientStatus } from '../net/client';
import { navigate } from './router';

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
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 12_000);
    return () => clearTimeout(id);
  }, []);
  const title = status === 'joining' ? 'Boarding…' : hosting ? 'Opening the gate…' : `Looking for ${formatCode(code)}…`;
  return (
    <Notice title={title}>
      <div class="spinner" aria-hidden="true" />
      {status === 'lost' && <p>Lost contact with the captain. Trying to reconnect…</p>}
      {slow && !hosting && (
        <p class="muted">
          Still looking. Make sure the host has the flight open. Some school or work networks block peer-to-peer connections; a phone
          hotspot usually works.
        </p>
      )}
    </Notice>
  );
}
