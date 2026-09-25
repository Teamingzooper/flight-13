import type { Settings } from '../engine';
import { ClientSession } from '../net/client';
import { newFlightCode } from '../net/code';
import { HostSession, newHostSnapshot } from '../net/host';
import { startTicker } from '../net/ticker';
import { MemoryHub, type MediaChannel } from '../net/transport';
import { relayTransport, relayUrl } from '../net/relay';
import type { Transport } from '../net/transport';
import { trysteroTransport } from '../net/trystero';

/** The flight's network: the relay server when this build has one (any network works), else direct connections. */
function openNetwork(code: string): Transport {
  const relay = relayUrl();
  return relay ? relayTransport(relay, code) : trysteroTransport(code);
}
import { stopVoice } from '../net/voice';
import { acquireHostLock, deleteHostSnapshot, loadHostSnapshot, saveHostSnapshot } from './hosting';
import { loadProfile, rememberFlight } from './profile';
import { tutorialSettings } from '../tutorial/script';

export interface OpenFlight {
  kind: 'ok';
  code: string;
  client: ClientSession;
  /** Present when this tab is the host. */
  host: HostSession | null;
  /** Voice streams to the other browsers, and this browser's id among them. */
  media: { channel: MediaChannel; selfId: string } | null;
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

/** Book the tutorial flight (you and five scripted bots) and return its flight number. */
export function bookTutorial(): string {
  const profile = loadProfile();
  let code = newFlightCode();
  while (loadHostSnapshot(code)) code = newFlightCode();
  saveHostSnapshot(newHostSnapshot(code, profile.token, tutorialSettings(), false, true), true);
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
    const network = openNetwork(code);
    const host = new HostSession({
      network,
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
    const flight: OpenFlight = { kind: 'ok', code, client, host, media: network.media ? { channel: network.media, selfId: network.selfId } : null };
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

  const transport = openNetwork(code);
  const client = new ClientSession({
    transport,
    code,
    token: profile.token,
    name: profile.name,
    look: profile.look,
    face: profile.face,
  });
  const flight: OpenFlight = { kind: 'ok', code, client, host: null, media: transport.media ? { channel: transport.media, selfId: transport.selfId } : null };
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
  stopVoice(code);
  stop();
}

/** Host only: send everyone home and forget the flight. */
export function endFlight(code: string): void {
  const flight = active?.flight;
  if (flight?.kind === 'ok' && flight.code === code && flight.host) {
    flight.host.endFlight();
    deleteHostSnapshot(code);
    stopVoice(code);
    const current = active;
    active = null;
    setTimeout(() => current?.stop(), 400);
    return;
  }
  closeFlight(code);
}
