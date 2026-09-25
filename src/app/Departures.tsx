import { useEffect, useState } from 'preact/hooks';
import { isBoardFlight, type BoardFlight } from '../net/board';
import { formatCode } from '../net/code';
import { relayHttpUrl } from '../net/relay';

const POLL_MS = 15_000;

/** The flights on the departures board, refreshed while the page is in front (null until the first answer). */
function useBoard(base: string | null): BoardFlight[] | null {
  const [flights, setFlights] = useState<BoardFlight[] | null>(null);
  useEffect(() => {
    if (!base) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let first = true;
    const load = async () => {
      // (Checked once straight away, then only while the page is in front.)
      if (first || document.visibilityState === 'visible') {
        first = false;
        try {
          const rows: unknown = await (await fetch(`${base}/board`)).json();
          if (alive && Array.isArray(rows)) setFlights(rows.filter(isBoardFlight));
        } catch {
          // Offline for a moment: keep what the board showed.
        }
      }
      if (alive) timer = setTimeout(load, POLL_MS);
    };
    void load();
    const onShow = () => {
      if (document.visibilityState !== 'visible' || !alive) return;
      if (timer) clearTimeout(timer);
      void load();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [base]);
  return flights;
}

/** The terminal's departures board: open flights anyone may board (flights the server runs, listed by their captain). */
export function Departures({ onBoard }: { onBoard: (code: string) => void }) {
  const base = relayHttpUrl();
  const flights = useBoard(base);
  if (!base) return null;
  return (
    <section class="departures" aria-label="Departures board">
      <header class="dep-head">
        <span class="dep-title">Departures</span>
        <span class="dep-cols" aria-hidden="true">
          <span>Flight</span>
          <span>To</span>
          <span class="dep-captain">Captain</span>
          <span>Seats</span>
          <span />
        </span>
      </header>
      <div class="dep-rows">
        {flights === null && <p class="dep-empty">Checking the board…</p>}
        {flights?.length === 0 && <p class="dep-empty">No open flights right now. Book one and it shows up here.</p>}
        {flights?.map((f) => {
          const full = f.aboard >= f.max;
          return (
            <button
              key={f.code}
              type="button"
              class={`dep-row${full ? ' full' : ''}`}
              disabled={full}
              onClick={() => onBoard(f.code)}
              aria-label={`${formatCode(f.code)} to ${f.city}${f.captain ? `, captain ${f.captain}` : ''}: ${f.aboard} of ${f.max} aboard. ${full ? 'Full.' : 'Board this flight.'}`}
            >
              <span class="flap">{formatCode(f.code)}</span>
              <span class="flap dep-city" title={`${f.city} (${f.airport}) · ${f.plane}`}>
                {f.city}
              </span>
              <span class="dep-captain">{f.captain || 'Control tower'}</span>
              <span class="flap">
                {f.aboard}/{f.max}
              </span>
              <span class={`dep-status${full ? '' : ' open'}`}>{full ? 'Full' : 'Boarding'}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
