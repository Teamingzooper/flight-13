import { joinRoom as joinTorrentRoom } from '@trystero-p2p/torrent';
import { joinRoom as joinNostrRoom, selfId, type JsonValue, type MessageAction, type Room } from 'trystero';
import { relayServers } from './ice';
import { Emitter, type MessageHandler, type PeerHandler, type Transport } from './transport';

const APP_ID = 'flight13-teamingzooper-v1';

/** WebTorrent trackers: built for exactly this kind of WebRTC offer exchange. */
const TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev', 'wss://open.ftorrent.com'];

/**
 * Public Nostr relays as a second, independent way to find each other. Relays that rate-limit or
 * require a web of trust (relay.damus.io, offchain.pub) reject this traffic, so they are left out.
 */
const RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://relay.snort.social', 'wss://nostr-pub.wellorder.net'];

const SEEN_PER_PEER = 256;

/** A type alias (not an interface) so it satisfies Trystero's JSON payload index signature. */
type Envelope = { i: number; m: JsonValue };

interface Route {
  room: Room;
  action: MessageAction<Envelope>;
}

/**
 * One flight's room, joined through two signaling networks at once. A peer counts as connected while
 * either route reaches it; each message goes out once over the first live route and duplicates are dropped.
 */
export function trysteroTransport(code: string): Transport {
  // Relay (TURN) servers, when this build has them, for networks that block direct connections.
  const config = { appId: APP_ID, password: `flight13:${code}`, turnConfig: relayServers() };
  const roomId = `flight-${code}`;
  const routes: Route[] = [
    joinTorrentRoom({ ...config, relayConfig: { urls: TRACKERS } }, roomId),
    joinNostrRoom({ ...config, relayConfig: { urls: RELAYS } }, roomId),
  ].map((room) => ({ room, action: room.makeAction<Envelope>('m') }));

  const messages = new Emitter<[unknown, string]>();
  const joins = new Emitter<[string]>();
  const leaves = new Emitter<[string]>();
  const live = new Map<string, Set<number>>();
  const seen = new Map<string, { order: number[]; ids: Set<number> }>();
  let nextId = 1;
  let closed = false;

  const firstSight = (peerId: string, id: number): boolean => {
    let record = seen.get(peerId);
    if (!record) {
      record = { order: [], ids: new Set() };
      seen.set(peerId, record);
    }
    if (record.ids.has(id)) return false;
    record.ids.add(id);
    record.order.push(id);
    if (record.order.length > SEEN_PER_PEER) record.ids.delete(record.order.shift()!);
    return true;
  };

  routes.forEach((route, index) => {
    route.room.onPeerJoin = (peerId) => {
      const via = live.get(peerId) ?? new Set<number>();
      const isNew = via.size === 0;
      via.add(index);
      live.set(peerId, via);
      if (isNew) joins.emit(peerId);
    };
    route.room.onPeerLeave = (peerId) => {
      const via = live.get(peerId);
      if (!via) return;
      via.delete(index);
      if (via.size > 0) return;
      live.delete(peerId);
      seen.delete(peerId);
      leaves.emit(peerId);
    };
    route.action.onMessage = (data, { peerId }) => {
      if (data && typeof data === 'object' && typeof data.i === 'number' && firstSight(peerId, data.i)) messages.emit(data.m, peerId);
    };
  });

  return {
    selfId,
    send(peerId, msg) {
      const via = live.get(peerId);
      if (closed || !via || via.size === 0) return;
      const route = routes[Math.min(...via)];
      route.action.send({ i: nextId++, m: msg as JsonValue }, { target: peerId }).catch(() => {
        // The peer dropped mid-send; the leave event handles clean-up.
      });
    },
    onMessage: (fn: MessageHandler) => messages.on(fn),
    onPeerJoin: (fn: PeerHandler) => joins.on(fn),
    onPeerLeave: (fn: PeerHandler) => leaves.on(fn),
    close() {
      if (closed) return;
      closed = true;
      messages.clear();
      joins.clear();
      leaves.clear();
      for (const route of routes) void route.room.leave();
    },
  };
}
