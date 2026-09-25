import { afterEach, describe, expect, it, vi } from 'vitest';
import { relayTransport } from './relay';

/** A stand-in for the browser's WebSocket, driven by the test as if it were the relay server. */
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open(peers: string[]) {
    this.readyState = 1;
    this.onopen?.();
    this.server({ t: 'hello', self: 'me', peers });
  }
  server(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeSocket.all = [];
});

describe('the relay transport', () => {
  it('joins the flight’s room, and passes messages to and from the others', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const t = relayTransport('https://relay.example.dev/', 'AB12');
    const events: string[] = [];
    t.onPeerJoin((p) => events.push(`join ${p}`));
    t.onPeerLeave((p) => events.push(`leave ${p}`));
    t.onMessage((m, p) => events.push(`msg ${p} ${JSON.stringify(m)}`));
    const ws = FakeSocket.all[0];
    expect(ws.url).toBe(`wss://relay.example.dev/room/AB12?peer=${t.selfId}`);
    ws.open(['host']);
    ws.server({ t: 'join', peer: 'amy' });
    ws.server({ t: 'msg', from: 'host', m: { t: 'hello' } });
    ws.server({ t: 'leave', peer: 'amy' });
    expect(events).toEqual(['join host', 'join amy', 'msg host {"t":"hello"}', 'leave amy']);
    t.send('host', { t: 'join' });
    t.send('nobody', { t: 'join' });
    t.sendMany!(['host', 'nobody'], { t: 'poses' });
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([
      { t: 'send', to: 'host', m: { t: 'join' } },
      // (One peer left after the filter: a plain id, which the relay treats the same.)
      { t: 'send', to: 'host', m: { t: 'poses' } },
    ]);
  });

  it('keeps voice packets out of the game’s messages', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const t = relayTransport('wss://relay.example.dev', 'AB12');
    const got: unknown[] = [];
    t.onMessage((m) => got.push(m));
    const ws = FakeSocket.all[0];
    ws.open(['host']);
    ws.server({ t: 'msg', from: 'host', m: { __voice: 7, d: 'AAAA' } });
    ws.server({ t: 'msg', from: 'host', m: { t: 'hello', v: 1 } });
    expect(got).toEqual([{ t: 'hello', v: 1 }]);
    t.close();
  });

  it('reconnects after a drop, and both sides greet each other afresh', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const t = relayTransport('wss://relay.example.dev', 'AB12');
    const events: string[] = [];
    t.onPeerJoin((p) => events.push(`join ${p}`));
    t.onPeerLeave((p) => events.push(`leave ${p}`));
    FakeSocket.all[0].open(['host']);
    FakeSocket.all[0].drop();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1].open(['host']);
    expect(events).toEqual(['join host', 'leave host', 'join host']);
    // Gone for good: after a while the others count as gone.
    FakeSocket.all[1].drop();
    vi.advanceTimersByTime(9_000);
    expect(events.at(-1)).toBe('leave host');
    t.close();
  });
});
