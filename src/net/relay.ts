import { RelayVoice, canRelayVoice, isVoicePacket } from './relayVoice';
import { Emitter, type MessageHandler, type PeerHandler, type Transport } from './transport';

/**
 * Flight 13's relay server: instead of connecting browsers to each other (which some networks block), every player's
 * browser keeps one WebSocket to the flight's room on the server, and the room passes the messages on. The host's
 * browser still runs the game. Voice rides along as Opus packets (see relayVoice.ts). See server/src/index.ts for the
 * room's side.
 */

const DEV_KEY = 'flight13.relay';

/** The relay's address for this build (VITE_RELAY_URL), or a development override; null to connect directly. */
export function relayUrl(): string | null {
  try {
    const override = import.meta.env.DEV ? localStorage.getItem(DEV_KEY) : null;
    if (override) return override === 'off' ? null : override;
  } catch {
    // No storage: the build's setting.
  }
  const built = import.meta.env.VITE_RELAY_URL as string | undefined;
  return built ? built : null;
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('');
}

const PING_MS = 25_000;
/** How long a dropped connection may take to come back before the others count as gone. */
const GRACE_MS = 8_000;

type ServerMessage =
  | { t: 'hello'; self: string; peers: string[] }
  | { t: 'join'; peer: string }
  | { t: 'leave'; peer: string }
  | { t: 'msg'; from: string; m: unknown }
  | { t: 'pong' };

export function relayTransport(base: string, code: string): Transport {
  const selfId = randomId();
  const url = `${base.replace(/\/+$/, '').replace(/^http/, 'ws')}/room/${encodeURIComponent(code)}?peer=${selfId}`;
  const messages = new Emitter<[unknown, string]>();
  const joins = new Emitter<[string]>();
  const leaves = new Emitter<[string]>();
  const peers = new Set<string>();
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let pinger: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let grace: ReturnType<typeof setTimeout> | null = null;

  /** Several peers, one message (the relay passes it to each). */
  const sendTo = (peerIds: string[], msg: unknown) => {
    if (closed || ws?.readyState !== WebSocket.OPEN) return;
    const to = peerIds.filter((p) => peers.has(p));
    if (to.length > 0) ws.send(JSON.stringify({ t: 'send', to: to.length === 1 ? to[0] : to, m: msg }));
  };
  // Voice goes through the relay too, where the browser can encode it itself.
  const voice = canRelayVoice() ? new RelayVoice({ sendMany: sendTo, isConnected: (peer) => peers.has(peer) }) : null;

  const join = (peer: string) => {
    if (peer === selfId || peers.has(peer)) return;
    peers.add(peer);
    joins.emit(peer);
  };
  const leave = (peer: string) => {
    if (!peers.delete(peer)) return;
    voice?.peerLeft(peer);
    leaves.emit(peer);
  };
  const leaveAll = () => {
    for (const peer of [...peers]) leave(peer);
  };

  const connect = () => {
    if (closed) return;
    const socket = new WebSocket(url);
    ws = socket;
    socket.onopen = () => {
      attempt = 0;
      pinger ??= setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), PING_MS);
    };
    socket.onmessage = (event) => {
      if (ws !== socket || typeof event.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.t) {
        case 'hello':
          // (Re)connected: start from the room as it is now, so both sides greet each other afresh.
          if (grace) clearTimeout(grace);
          grace = null;
          leaveAll();
          for (const peer of msg.peers) join(peer);
          break;
        case 'join':
          join(msg.peer);
          break;
        case 'leave':
          leave(msg.peer);
          break;
        case 'msg':
          join(msg.from);
          if (isVoicePacket(msg.m)) voice?.received(msg.m, msg.from);
          else messages.emit(msg.m, msg.from);
          break;
        default:
          break;
      }
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      if (closed) return;
      // Back soon, with the others counted as gone if it takes too long.
      grace ??= setTimeout(() => {
        grace = null;
        leaveAll();
      }, GRACE_MS);
      const delay = Math.min(5_000, 400 * 2 ** attempt++);
      retry = setTimeout(connect, delay);
    };
  };
  connect();

  return {
    selfId,
    send(peerId, msg) {
      if (closed || ws?.readyState !== WebSocket.OPEN || !peers.has(peerId)) return;
      ws.send(JSON.stringify({ t: 'send', to: peerId, m: msg }));
    },
    sendMany: sendTo,
    ...(voice ? { media: voice } : {}),
    onMessage: (fn: MessageHandler) => messages.on(fn),
    onPeerJoin: (fn: PeerHandler) => joins.on(fn),
    onPeerLeave: (fn: PeerHandler) => leaves.on(fn),
    close() {
      closed = true;
      if (pinger) clearInterval(pinger);
      if (retry) clearTimeout(retry);
      if (grace) clearTimeout(grace);
      voice?.close();
      ws?.close(1000, 'left');
      ws = null;
      messages.clear();
      joins.clear();
      leaves.clear();
    },
  };
}
