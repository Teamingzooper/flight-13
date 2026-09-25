import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { moveLink } from './router';
import type { OpenFlight } from './sessions';

/** A QR code of `text`, drawn as one SVG path (black squares on a white quiet zone). */
function QrCode({ text }: { text: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const size = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    }
    return { d: path, n: size };
  }, [text]);
  return (
    <svg class="qr" viewBox={`-3 -3 ${n + 6} ${n + 6}`} role="img" aria-label="QR code of the link" shape-rendering="crispEdges">
      <rect x={-3} y={-3} width={n + 6} height={n + 6} fill="#fff" />
      <path d={d} fill="#0b1220" />
    </svg>
  );
}

/**
 * Move your seat to another device (laptop to phone, say): a one-time link, and its QR code to scan. Whoever opens it
 * takes over your seat (name, role, what you know), and this screen leaves the flight.
 */
export function MoveDevice({ flight, onClose, fixed = false }: { flight: OpenFlight; onClose: () => void; fixed?: boolean }) {
  const [ticket, setTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    void flight.client.requestMove().then((result) => {
      if (!alive) return;
      if (result.ok) setTicket(result.ticket);
      else setError(result.error);
    });
    return () => {
      alive = false;
    };
  }, [flight]);
  const link = ticket ? moveLink(flight.code, ticket) : null;
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div class={`tv-overlay${fixed ? ' fixed' : ''}`} role="dialog" aria-modal="true" aria-labelledby="move-title">
      <div class="tv-card move-card">
        <h2 id="move-title">Move to another device</h2>
        {error && <p class="error-text">{error}</p>}
        {!error && !link && <p class="muted">Getting a link…</p>}
        {link && (
          <>
            <p>
              Scan this with your phone, or open the link on your other device. Your seat comes with you: your name, your role and everything
              you know. This screen then leaves the flight.
            </p>
            <div class="move-body">
              <QrCode text={link} />
              <div class="move-link">
                <input class="input" readOnly value={link} aria-label="Link to move your seat" onFocus={(e) => e.currentTarget.select()} />
                <button class="btn" onClick={() => void copy()}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <small class="hint">It works once, for 10 minutes. Keep it to yourself: whoever opens it takes your seat.</small>
              </div>
            </div>
          </>
        )}
        <button class="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
