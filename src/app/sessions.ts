import type { Settings } from '../engine';
import { ClientSession } from '../net/client';
import { newFlightCode } from '../net/code';
import { HostSession, newHostSnapshot } from '../net/host';
import { startTicker } from '../net/ticker';
import { MemoryHub } from '../net/transport';
import { trysteroTransport } from '../net/trystero';
import { acquireHostLock, deleteHostSnapshot, loadHostSnapshot, saveHostSnapshot } from './hosting';
import { loadProfile, rememberFlight } from './profile';

export interface OpenFlight {
  kind: 'ok';
  code: string;
  client: ClientSession;
  /** Present when this tab is the host. */
  host: HostSession | null;
}

export type ActiveFlight = OpenFlight | { kind: 'blocked'; code: string };

let active: { flight: ActiveFlight; stop: () => void } | null = null;

// Live sessions hold WebRTC connections that hot updates cannot migrate: reload the page instead.
import.meta.hot?.accept(() => location.reload());

/** Create a new flight hosted by this browser and return its flight number. */
export function bookFlight(settings: Settings, controlTower: boolean): string {
  const profile = loadProfile();
  let code = newFlightCode();
  while (loadHostSnapshot(code)) code = newFlightCode();
  saveHostSnapshot(newHostSnapshot(code, profile.token, settings, controlTower), true);
  return code;
}

/** Connect to a flight: as its host if this browser booked it, otherwise as a passenger. */
export function openFlight(code: string): ActiveFlight {
  if (active?.flight.code === code) return active.flight;
  if (active) closeFlight(active.flight.code);
  rememberFlight(code);
  const profile = loadProfile();
  const saved = loadHostSnapshot(code);

  if (saved && saved.hostToken === profile.token) {
    const lock = acquireHostLock(code);
    if (!lock) {
      active = { flight: { kind: 'blocked', code }, stop: () => {} };
      return active.flight;
    }
    const hub = new MemoryHub();
    const host = new HostSession({
      network: trysteroTransport(code),
      local: hub.join('host'),
      snapshot: saved,
      persist: (snapshot) => saveHostSnapshot(snapshot),
    });
    const stopTicker = startTicker(() => {
      host.tickNow();
      lock.beat();
    }, 125);
    const client = new ClientSession({
      transport: hub.join('local'),
      code,
      token: profile.token,
      name: profile.name,
      look: profile.look,
      face: profile.face,
      tower: saved.controlTower,
    });
    const flight: OpenFlight = { kind: 'ok', code, client, host };
    exposeForDev(flight);
    active = {
      flight,
      stop: () => {
        stopTicker();
        client.close();
        host.close();
        lock.release();
      },
    };
    return flight;
  }

  const client = new ClientSession({
    transport: trysteroTransport(code),
    code,
    token: profile.token,
    name: profile.name,
    look: profile.look,
    face: profile.face,
  });
  const flight: OpenFlight = { kind: 'ok', code, client, host: null };
  exposeForDev(flight);
  active = { flight, stop: () => client.close() };
  return flight;
}

/** Development only: expose the open flight so tests in the browser can drive it. */
function exposeForDev(flight: ActiveFlight): void {
  if (import.meta.env.DEV) (globalThis as { f13?: ActiveFlight }).f13 = flight;
}

export function closeFlight(code: string): void {
  if (!active || active.flight.code !== code) return;
  const { stop } = active;
  active = null;
  stop();
}

/** Host only: send everyone home and forget the flight. */
export function endFlight(code: string): void {
  const flight = active?.flight;
  if (flight?.kind === 'ok' && flight.code === code && flight.host) {
    flight.host.endFlight();
    deleteHostSnapshot(code);
    const current = active;
    active = null;
    setTimeout(() => current?.stop(), 400);
    return;
  }
  closeFlight(code);
}
