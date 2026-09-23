export type Unsubscribe = () => void;
export type MessageHandler = (msg: unknown, peerId: string) => void;
export type PeerHandler = (peerId: string) => void;

/** A room of peers that exchange JSON messages (Trystero in the browser, MemoryHub in tests). */
export interface Transport {
  readonly selfId: string;
  send(peerId: string, msg: unknown): void;
  onMessage(fn: MessageHandler): Unsubscribe;
  onPeerJoin(fn: PeerHandler): Unsubscribe;
  onPeerLeave(fn: PeerHandler): Unsubscribe;
  close(): void;
}

export class Emitter<T extends unknown[]> {
  private readonly fns = new Set<(...args: T) => void>();

  on(fn: (...args: T) => void): Unsubscribe {
    this.fns.add(fn);
    return () => void this.fns.delete(fn);
  }

  emit(...args: T): void {
    for (const fn of [...this.fns]) fn(...args);
  }

  clear(): void {
    this.fns.clear();
  }
}

/** An in-memory room: every member sees every other member, like a Trystero room. Delivery is async and JSON-cloned. */
export class MemoryHub {
  private readonly members = new Map<string, MemoryTransport>();
  private counter = 0;

  join(id?: string): MemoryTransport {
    const selfId = id ?? `peer${++this.counter}`;
    if (this.members.has(selfId)) throw new Error(`Duplicate peer ${selfId}`);
    const transport = new MemoryTransport(selfId, this);
    const existing = [...this.members.values()];
    this.members.set(selfId, transport);
    queueMicrotask(() => {
      for (const other of existing) {
        if (!this.members.has(other.selfId) || !this.members.has(selfId)) continue;
        other.peerJoined(selfId);
        transport.peerJoined(other.selfId);
      }
    });
    return transport;
  }

  /** @internal */
  deliver(from: string, to: string, msg: unknown): void {
    if (!this.members.has(from)) return;
    const payload: unknown = JSON.parse(JSON.stringify(msg));
    queueMicrotask(() => this.members.get(to)?.receive(payload, from));
  }

  /** @internal */
  leave(id: string): void {
    if (!this.members.delete(id)) return;
    const rest = [...this.members.values()];
    queueMicrotask(() => {
      for (const other of rest) other.peerLeft(id);
    });
  }
}

export class MemoryTransport implements Transport {
  private readonly messages = new Emitter<[unknown, string]>();
  private readonly joins = new Emitter<[string]>();
  private readonly leaves = new Emitter<[string]>();
  private closed = false;

  constructor(
    readonly selfId: string,
    private readonly hub: MemoryHub,
  ) {}

  send(peerId: string, msg: unknown): void {
    if (!this.closed) this.hub.deliver(this.selfId, peerId, msg);
  }

  onMessage(fn: MessageHandler): Unsubscribe {
    return this.messages.on(fn);
  }

  onPeerJoin(fn: PeerHandler): Unsubscribe {
    return this.joins.on(fn);
  }

  onPeerLeave(fn: PeerHandler): Unsubscribe {
    return this.leaves.on(fn);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.hub.leave(this.selfId);
  }

  /** @internal */
  receive(msg: unknown, from: string): void {
    if (!this.closed) this.messages.emit(msg, from);
  }

  /** @internal */
  peerJoined(id: string): void {
    if (!this.closed) this.joins.emit(id);
  }

  /** @internal */
  peerLeft(id: string): void {
    if (!this.closed) this.leaves.emit(id);
  }
}
