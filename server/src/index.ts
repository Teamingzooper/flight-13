/**
 * Flight 13's relay server (a Cloudflare Worker). Each flight is a room (a Durable Object, one per flight code). Every
 * browser in the flight opens a WebSocket to its room; the room tells everyone who is there and passes messages between
 * them. The host's browser still runs the game: this only carries the messages, so it works on any network.
 *
 * Client to room: {t:'send', to: peerId | peerId[], m}  ·  {t:'ping'}
 * Room to client: {t:'hello', self, peers}  ·  {t:'join', peer}  ·  {t:'leave', peer}  ·  {t:'msg', from, m}  ·  {t:'pong'}
 */

interface Env {
  ROOMS: DurableObjectNamespace;
}

const ROOM_PATH = /^\/room\/([A-Za-z0-9-]{1,40})$/;
const PEER_ID = /^[A-Za-z0-9_-]{6,48}$/;
const MAX_PEERS = 64;
const MAX_MESSAGE = 1_000_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const room = url.pathname.match(ROOM_PATH);
    if (!room) return new Response('Flight 13 relay: up and running.', { headers: { 'content-type': 'text/plain' } });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(room[1].toUpperCase())).fetch(request);
  },
};

export class Room implements DurableObject {
  constructor(private readonly state: DurableObjectState) {
    // Keep-alive pings are answered without waking the room.
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async fetch(request: Request): Promise<Response> {
    const peer = new URL(request.url).searchParams.get('peer') ?? '';
    if (!PEER_ID.test(peer)) return new Response('Bad peer id.', { status: 400 });
    const stale = this.state.getWebSockets(peer);
    if (stale.length === 0 && this.peers().length >= MAX_PEERS) return new Response('This flight is full.', { status: 503 });
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
    // (Back on a new socket: everyone sees them leave and join again, so the host greets them afresh.)
    if (stale.length > 0) this.broadcast({ t: 'leave', peer }, peer);
    this.broadcast({ t: 'join', peer }, peer);
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
    const out = JSON.stringify({ t: 'msg', from, m: msg.m });
    for (const to of targets) {
      if (typeof to !== 'string' || to === from) continue;
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
    this.gone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.gone(ws);
  }

  /** Everyone connected, by peer id. */
  private peers(): string[] {
    const ids = new Set<string>();
    for (const ws of this.state.getWebSockets()) {
      if (ws.readyState === WebSocket.OPEN) ids.add(this.state.getTags(ws)[0]);
    }
    return [...ids];
  }

  /** A socket closed: its peer has left, unless they are still here on a newer one. */
  private gone(ws: WebSocket): void {
    const peer = this.state.getTags(ws)[0];
    const still = this.state.getWebSockets(peer).some((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (!still) this.broadcast({ t: 'leave', peer }, peer);
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
