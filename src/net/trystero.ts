import { joinRoom, selfId, type JsonValue } from 'trystero';
import { Emitter, type MessageHandler, type PeerHandler, type Transport } from './transport';

const APP_ID = 'flight13-teamingzooper-v1';

/** A Trystero (WebRTC + Nostr signaling) room for one flight. */
export function trysteroTransport(code: string): Transport {
  const room = joinRoom({ appId: APP_ID, password: `flight13:${code}` }, `flight-${code}`);
  const action = room.makeAction<JsonValue>('m');
  const messages = new Emitter<[unknown, string]>();
  const joins = new Emitter<[string]>();
  const leaves = new Emitter<[string]>();
  action.onMessage = (data, { peerId }) => messages.emit(data, peerId);
  room.onPeerJoin = (peerId) => joins.emit(peerId);
  room.onPeerLeave = (peerId) => leaves.emit(peerId);
  let closed = false;
  return {
    selfId,
    send(peerId, msg) {
      if (closed) return;
      action.send(msg as JsonValue, { target: peerId }).catch(() => {
        // The peer went away mid-send; the leave event handles clean-up.
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
      void room.leave();
    },
  };
}
