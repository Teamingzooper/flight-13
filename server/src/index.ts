/**
 * Flight 13's server (a Cloudflare Worker). Each flight is a room (a Durable Object, one per flight code). Every browser
 * in the flight opens a WebSocket to its room, and the room passes messages between them (voice, and everything in
 * flights a browser hosts, like the tutorial).
 *
 * Flights booked here are also run here: the room holds the flight and plays the host (peer `server`), with the same
 * code the browser host runs (src/net/host.ts), so a flight carries on whoever leaves. See
 * docs/superpowers/specs/2026-09-25-online-services-design.md.
 *
 * Client to room: {t:'send', to: peerId | peerId[], m}  ·  {t:'ping'}
 * Room to client: {t:'hello', self, peers}  ·  {t:'join', peer}  ·  {t:'leave', peer}  ·  {t:'msg', from, m}  ·  {t:'pong'}
 * HTTP: POST /flights {settings, controlTower, token} → {code}  ·  GET /board → the departures board (BoardFlight[])
 */

import { validateSettings } from '../../src/engine';
import { BOARD_STALE_MS, boardRow, isBoardFlight, sortBoard, type BoardFlight } from '../../src/net/board';
import { newFlightCode } from '../../src/net/code';
import { HostSession, newHostSnapshot, type HostSnapshot } from '../../src/net/host';
import { cleanSettings } from '../../src/net/protocol';
import { Emitter, type MessageHandler, type PeerHandler, type Transport } from '../../src/net/transport';

interface Env {
  ROOMS: DurableObjectNamespace;
  BOARD: DurableObjectNamespace;
}

const ROOM_PATH = /^\/room\/([A-Za-z0-9-]{1,40})$/;
const PEER_ID = /^[A-Za-z0-9_-]{6,48}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_PEERS = 64;
const MAX_MESSAGE = 1_000_000;

/** The room's own id on the relay, when it runs the flight. */
const HOST_PEER = 'server';
const FLIGHT_KEY = 'flight';
const LAST_SEEN_KEY = 'lastSeen';
const TICK_MS = 250;
/** Saved at most this often while the flight changes (and whenever everyone leaves). */
const SAVE_MS = 5_000;
/** Timers alone do not keep a room in memory: an alarm this often does, while anyone is aboard. */
const KEEPALIVE_MS = 30_000;
/** A flight nobody has been aboard for this long is forgotten. */
const EXPIRE_MS = 3 * 60 * 60_000;
/** A listed flight tells the board when its row changes (at most this often), and every minute that it is still there. */
const BOARD_CHANGE_MS = 5_000;
const BOARD_REFRESH_MS = 60_000;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/flights' && request.method === 'POST') return bookFlight(request, env);
    if (url.pathname === '/board' && request.method === 'GET') {
      const res = await board(env).fetch('https://board/list');
      return new Response(res.body, { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=5', ...CORS } });
    }
    const room = url.pathname.match(ROOM_PATH);
    if (!room) return new Response('Flight 13 relay: up and running.', { headers: { 'content-type': 'text/plain', ...CORS } });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(room[1].toUpperCase())).fetch(request);
  },
};

function board(env: Env): DurableObjectStub {
  return env.BOARD.get(env.BOARD.idFromName('board'));
}

/** Book a flight run by the server: check the settings, find a free flight number, and set up its room. */
async function bookFlight(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'That booking did not make sense.' }, 400);
  }
  const token = typeof body.token === 'string' && TOKEN.test(body.token) ? body.token : null;
  if (!token) return json({ error: 'Your boarding pass is missing. Reload the page.' }, 400);
  const settings = cleanSettings(body.settings);
  const invalid = settings ? validateSettings(settings) : 'Those settings are not valid.';
  if (!settings || invalid) return json({ error: invalid }, 400);
  for (let i = 0; i < 8; i++) {
    const code = newFlightCode();
    const res = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch('https://room/create', {
      method: 'POST',
      body: JSON.stringify({ code, settings, controlTower: body.controlTower === true, token }),
    });
    if (res.status === 201) return json({ code }, 201);
    if (res.status !== 409) return json({ error: 'The server could not book that flight. Try again.' }, 502);
  }
  return json({ error: 'Every flight number tried was taken. Try again.' }, 503);
}

/** The flight's host, speaking through the room's sockets as peer `server`. */
class RoomTransport implements Transport {
  readonly selfId = HOST_PEER;
  private readonly messages = new Emitter<[unknown, string]>();
  private readonly joins = new Emitter<[string]>();
  private readonly leaves = new Emitter<[string]>();

  constructor(private readonly state: DurableObjectState) {}

  send(peerId: string, msg: unknown): void {
    this.deliver([peerId], msg);
  }

  sendMany(peerIds: string[], msg: unknown): void {
    this.deliver(peerIds, msg);
  }

  onMessage(fn: MessageHandler) {
    return this.messages.on(fn);
  }

  onPeerJoin(fn: PeerHandler) {
    return this.joins.on(fn);
  }

  onPeerLeave(fn: PeerHandler) {
    return this.leaves.on(fn);
  }

  close(): void {
    this.messages.clear();
    this.joins.clear();
    this.leaves.clear();
  }

  joined(peer: string): void {
    this.joins.emit(peer);
  }

  left(peer: string): void {
    this.leaves.emit(peer);
  }

  received(msg: unknown, from: string): void {
    this.messages.emit(msg, from);
  }

  private deliver(peerIds: string[], msg: unknown): void {
    const out = JSON.stringify({ t: 'msg', from: HOST_PEER, m: msg });
    for (const id of peerIds) {
      for (const ws of this.state.getWebSockets(id)) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        try {
          ws.send(out);
        } catch {
          // Closing; its close handler says goodbye.
        }
      }
    }
  }
}

export class Room implements DurableObject {
  /** The flight, when this room runs one (null: a plain relay, for a flight a browser hosts). */
  private host: HostSession | null = null;
  private transport: RoomTransport | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private savedAt = 0;
  /** What the board last heard from this flight ('' never, 'null' not listed), and when. */
  private boardSent = '';
  private boardAt = 0;
  /** The flight's code after it is forgotten (to take it off the board). */
  private lastCode = '';

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    // Keep-alive pings are answered without waking the room.
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    // Back from a restart (or evicted while empty): pick the flight up where it was saved.
    void state.blockConcurrencyWhile(async () => {
      const saved = await state.storage.get<HostSnapshot>(FLIGHT_KEY);
      if (saved) this.run(saved);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/create') return this.create(request);
    const peer = url.searchParams.get('peer') ?? '';
    if (!PEER_ID.test(peer) || peer === HOST_PEER) return new Response('Bad peer id.', { status: 400 });
    const stale = this.state.getWebSockets(peer);
    if (stale.length === 0 && this.clients().length >= MAX_PEERS) return new Response('This flight is full.', { status: 503 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server, [peer]);
    // The same browser coming back (a reload, a dropped connection): the new socket replaces the old one.
    for (const old of stale) {
      try {
        old.close(4000, 'replaced');
      } catch {
        // Already gone.
      }
    }
    server.send(JSON.stringify({ t: 'hello', self: peer, peers: this.peers().filter((p) => p !== peer) }));
    // (Back on a new socket: everyone sees them leave and join again, so the others greet them afresh.)
    if (stale.length > 0) this.broadcast({ t: 'leave', peer }, peer);
    this.broadcast({ t: 'join', peer }, peer);
    if (this.host && this.transport) {
      this.host.idle(false);
      // (The host greets them again either way; their client answers with its token and takes its seat back.)
      this.transport.joined(peer);
      this.wake();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return;
    const from = this.state.getTags(ws)[0];
    let msg: { t?: unknown; to?: unknown; m?: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.t !== 'send') return;
    const targets = Array.isArray(msg.to) ? msg.to : [msg.to];
    let out: string | null = null;
    for (const to of targets) {
      if (typeof to !== 'string' || to === from) continue;
      if (to === HOST_PEER) {
        this.transport?.received(msg.m, from);
        continue;
      }
      out ??= JSON.stringify({ t: 'msg', from, m: msg.m });
      for (const socket of this.state.getWebSockets(to)) {
        try {
          socket.send(out);
        } catch {
          // Closing; its close handler says goodbye.
        }
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.gone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.gone(ws);
  }

  async alarm(): Promise<void> {
    if (!this.host) return;
    const now = Date.now();
    if (this.clients().length > 0) {
      if (this.dirty) await this.save();
      await this.state.storage.setAlarm(now + KEEPALIVE_MS);
      return;
    }
    const last = (await this.state.storage.get<number>(LAST_SEEN_KEY)) ?? 0;
    if (now - last >= EXPIRE_MS) await this.forget();
    else await this.state.storage.setAlarm(last + EXPIRE_MS);
  }

  /** Set up a new flight in this room (from bookFlight; never reachable from outside). */
  private async create(request: Request): Promise<Response> {
    const { code, settings, controlTower, token } = (await request.json()) as {
      code: string;
      settings: HostSnapshot['settings'];
      controlTower: boolean;
      token: string;
    };
    if (this.host || this.state.getWebSockets().length > 0 || (await this.state.storage.get(FLIGHT_KEY))) {
      return new Response('Taken.', { status: 409 });
    }
    const snapshot = newHostSnapshot(code, token, settings, controlTower);
    await this.state.storage.put(FLIGHT_KEY, snapshot);
    await this.state.storage.put(LAST_SEEN_KEY, Date.now());
    await this.state.storage.setAlarm(Date.now() + EXPIRE_MS);
    this.run(snapshot);
    return new Response('Booked.', { status: 201 });
  }

  /** Run the flight: this room becomes its host, and everyone already here is greeted (after a restart). */
  private run(snapshot: HostSnapshot): void {
    const transport = new RoomTransport(this.state);
    this.transport = transport;
    this.host = new HostSession({
      network: transport,
      snapshot,
      serverHosted: true,
      persist: () => {
        this.dirty = true;
      },
      onEnd: () => void this.forget(),
    });
    const here = this.clients();
    for (const peer of here) transport.joined(peer);
    if (here.length > 0) {
      this.host.idle(false);
      this.wake();
    }
  }

  /** Someone is aboard: keep the clock ticking and the room awake. */
  private wake(): void {
    this.ticker ??= setInterval(() => this.tick(), TICK_MS);
    void this.state.storage.getAlarm().then((at) => {
      if (at === null || at > Date.now() + KEEPALIVE_MS) void this.state.storage.setAlarm(Date.now() + KEEPALIVE_MS);
    });
  }

  private tick(): void {
    if (!this.host) return;
    this.host.tickNow();
    if (this.dirty && Date.now() - this.savedAt >= SAVE_MS) void this.save();
    this.report();
  }

  /** Keep the departures board up to date: this flight's row while it is listed and boarding, nothing otherwise. */
  private report(): void {
    const now = Date.now();
    const row = this.host ? boardRow(this.host.snapshot, this.clients().length) : null;
    const key = JSON.stringify(row);
    if (row) {
      const changed = key !== this.boardSent;
      if (changed ? now - this.boardAt < BOARD_CHANGE_MS : now - this.boardAt < BOARD_REFRESH_MS) return;
    } else if (this.boardSent === '' || this.boardSent === key) {
      this.boardSent = key;
      return;
    }
    const code = this.host?.snapshot.code ?? this.lastCode;
    this.boardSent = key;
    this.boardAt = now;
    if (!code) return;
    void board(this.env)
      .fetch(row ? 'https://board/put' : 'https://board/drop', { method: 'POST', body: JSON.stringify(row ?? { code }) })
      .catch(() => {
        // The board is only a convenience: next time.
        this.boardAt = 0;
      });
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  private async save(): Promise<void> {
    if (!this.host) return;
    this.dirty = false;
    this.savedAt = Date.now();
    await this.state.storage.put(FLIGHT_KEY, this.host.snapshot);
  }

  /** The flight is over (ended by its captain, or abandoned): the room goes back to being a plain relay. */
  private async forget(): Promise<void> {
    this.stopTicker();
    this.lastCode = this.host?.snapshot.code ?? this.lastCode;
    // (The host sends everyone its goodbye before it shuts; the sockets stay until each browser leaves.)
    const host = this.host;
    this.host = null;
    this.transport = null;
    this.report();
    if (host) setTimeout(() => host.close(), 1000);
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
  }

  /** Everyone connected, by peer id: the browsers. */
  private clients(): string[] {
    const ids = new Set<string>();
    for (const ws of this.state.getWebSockets()) {
      if (ws.readyState === WebSocket.OPEN) ids.add(this.state.getTags(ws)[0]);
    }
    return [...ids];
  }

  /** Everyone in the room: the browsers, and the flight's host when the room runs it. */
  private peers(): string[] {
    return this.host ? [HOST_PEER, ...this.clients()] : this.clients();
  }

  /** A socket closed: its peer has left, unless they are still here on a newer one. */
  private async gone(ws: WebSocket): Promise<void> {
    const peer = this.state.getTags(ws)[0];
    const still = this.state.getWebSockets(peer).some((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (still) return;
    this.broadcast({ t: 'leave', peer }, peer);
    if (!this.host) return;
    this.transport?.left(peer);
    if (this.clients().some((p) => p !== peer)) return;
    // The last one out: the flight waits for someone to come back (and is forgotten if nobody does).
    this.host.idle(true);
    this.stopTicker();
    this.report();
    await this.save();
    await this.state.storage.put(LAST_SEEN_KEY, Date.now());
    await this.state.storage.setAlarm(Date.now() + EXPIRE_MS);
  }

  private broadcast(msg: unknown, except: string): void {
    const out = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (this.state.getTags(ws)[0] === except || ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(out);
      } catch {
        // Closing.
      }
    }
  }
}

/** The departures board: one row per listed flight still boarding, kept in memory (rooms report every minute). */
export class Board implements DurableObject {
  private readonly rows = new Map<string, { row: BoardFlight; at: number }>();

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/put') {
      const row: unknown = await request.json();
      if (isBoardFlight(row)) this.rows.set(row.code, { row, at: Date.now() });
      return new Response('Listed.');
    }
    if (path === '/drop') {
      const { code } = (await request.json()) as { code?: unknown };
      if (typeof code === 'string') this.rows.delete(code);
      return new Response('Dropped.');
    }
    const now = Date.now();
    for (const [code, { at }] of this.rows) if (now - at > BOARD_STALE_MS) this.rows.delete(code);
    return Response.json(sortBoard([...this.rows.values()].map((r) => r.row)).slice(0, 40));
  }
}
