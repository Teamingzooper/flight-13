import { Emitter, type MediaChannel, type Unsubscribe } from './transport';

/**
 * Voice chat through the relay server, for networks that block direct connections. Each browser encodes its microphone
 * as Opus (the browser's own codec, through WebCodecs) in 60 ms packets and sends them through the relay to whoever may
 * hear it; each listener decodes them into a stream of its own, which the voice chat plays like any other (placed in the
 * cabin, louder the closer). Silence is not sent.
 */

/** A voice packet in the relay's messages (game messages never carry this key). */
export interface VoicePacket {
  __voice: number;
  /** Opus, base64. */
  d: string;
}

export function isVoicePacket(m: unknown): m is VoicePacket {
  return !!m && typeof m === 'object' && typeof (m as VoicePacket).__voice === 'number' && typeof (m as VoicePacket).d === 'string';
}

/** This browser can encode and decode Opus itself. */
export function canRelayVoice(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined' && typeof AudioContext !== 'undefined';
}

const RATE = 48_000;
const OPUS = { codec: 'opus', sampleRate: RATE, numberOfChannels: 1 } as const;
const ENCODER: AudioEncoderConfig = { ...OPUS, bitrate: 24_000, opus: { frameDuration: 60_000, usedtx: true } } as AudioEncoderConfig;
/** How far ahead of now a voice starts playing, to ride out uneven arrival. */
const JITTER_S = 0.09;
/** More than this queued up (a burst after a stall): skip ahead rather than lag behind. */
const MAX_QUEUE_S = 0.45;
/** Opus packets this small are silence (DTX): not worth sending. */
const SILENT_BYTES = 3;

/** Collects the microphone in 20 ms blocks (an AudioWorklet, loaded from a blob so it needs no separate file). */
const CAPTURE_WORKLET = `
class F13Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(960); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let i = 0;
      while (i < ch.length) {
        const take = Math.min(ch.length - i, 960 - this.n);
        this.buf.set(ch.subarray(i, i + take), this.n);
        this.n += take;
        i += take;
        if (this.n === 960) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(960);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('f13-capture', F13Capture);
`;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Your microphone, encoded and sent to the current listeners. */
class Sender {
  private readonly ctx = new AudioContext({ sampleRate: RATE });
  private encoder: AudioEncoder | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timestamp = 0;
  private seq = 0;
  private closed = false;

  constructor(
    readonly stream: MediaStream,
    private readonly send: (packet: VoicePacket) => void,
  ) {
    void this.start();
  }

  private async start(): Promise<void> {
    try {
      const support = await AudioEncoder.isConfigSupported(ENCODER);
      if (!support.supported || this.closed) return;
      const encoder = new AudioEncoder({
        output: (chunk) => {
          if (chunk.byteLength <= SILENT_BYTES) return;
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          this.send({ __voice: this.seq++, d: toBase64(bytes) });
        },
        error: () => this.close(),
      });
      encoder.configure(ENCODER);
      this.encoder = encoder;
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      if (this.closed) return;
      await this.ctx.resume().catch(() => {});
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, 'f13-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
      this.node.port.onmessage = (event: MessageEvent<Float32Array<ArrayBuffer>>) => this.encode(event.data);
      // (A worklet only runs while connected through to the speakers: silently.)
      this.source.connect(this.node).connect(new GainNode(this.ctx, { gain: 0 })).connect(this.ctx.destination);
    } catch {
      this.close();
    }
  }

  private encode(samples: Float32Array<ArrayBuffer>): void {
    const encoder = this.encoder;
    if (!encoder || encoder.state !== 'configured') return;
    const data = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: samples.length, numberOfChannels: 1, timestamp: this.timestamp, data: samples });
    this.timestamp += Math.round((samples.length / RATE) * 1e6);
    encoder.encode(data);
    data.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.node?.port.close();
    this.source?.disconnect();
    this.node?.disconnect();
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    void this.ctx.close().catch(() => {});
  }
}

/** One person's voice: their packets, decoded and queued into a stream of its own. */
class Receiver {
  readonly output: MediaStreamAudioDestinationNode;
  private readonly decoder: AudioDecoder;
  private next = 0;
  private timestamp = 0;

  constructor(private readonly ctx: AudioContext) {
    this.output = ctx.createMediaStreamDestination();
    this.decoder = new AudioDecoder({ output: (data) => this.play(data), error: () => {} });
    this.decoder.configure(OPUS);
  }

  get stream(): MediaStream {
    return this.output.stream;
  }

  push(packet: VoicePacket): void {
    if (this.decoder.state !== 'configured') return;
    const data = fromBase64(packet.d);
    this.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: this.timestamp, data }));
    this.timestamp += 60_000;
  }

  private play(data: AudioData): void {
    const frames = data.numberOfFrames;
    const samples = new Float32Array(frames);
    try {
      data.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });
    } catch {
      data.copyTo(samples, { planeIndex: 0 });
    }
    const rate = data.sampleRate;
    data.close();
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, frames, rate);
    buffer.copyToChannel(samples, 0);
    const now = ctx.currentTime;
    // Fell behind (a gap in the talking): start again a little ahead. Too far ahead (a burst): skip this bit.
    if (this.next < now) this.next = now + JITTER_S;
    if (this.next - now > MAX_QUEUE_S) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output);
    source.start(this.next);
    this.next += buffer.duration;
  }

  close(): void {
    if (this.decoder.state !== 'closed') this.decoder.close();
    for (const track of this.stream.getTracks()) {
      track.stop();
      // (A stopped track does not say so by itself; the voice chat listens for this to let the voice go.)
      track.dispatchEvent(new Event('ended'));
    }
    this.output.disconnect();
  }
}

export interface RelayVoiceLink {
  /** Send a voice packet to these peers. */
  sendMany(peerIds: string[], packet: VoicePacket): void;
  isConnected(peerId: string): boolean;
}

/** Voice through the relay, in the shape the voice chat expects of a peer-to-peer media channel. */
export class RelayVoice implements MediaChannel {
  private sender: Sender | null = null;
  private readonly targets = new Set<string>();
  private ctx: AudioContext | null = null;
  private readonly receivers = new Map<string, Receiver>();
  private readonly streams = new Emitter<[MediaStream, string]>();

  constructor(private readonly link: RelayVoiceLink) {}

  addStream(stream: MediaStream, peerId: string): boolean {
    if (!this.link.isConnected(peerId)) return false;
    if (this.sender?.stream !== stream) {
      this.sender?.close();
      this.sender = new Sender(stream, (packet) => {
        if (this.targets.size > 0) this.link.sendMany([...this.targets], packet);
      });
    }
    this.targets.add(peerId);
    return true;
  }

  removeStream(stream: MediaStream, peerId: string): void {
    this.targets.delete(peerId);
    if (this.targets.size === 0 && this.sender?.stream === stream) {
      this.sender.close();
      this.sender = null;
    }
  }

  isConnected(peerId: string): boolean {
    return this.link.isConnected(peerId);
  }

  onPeerStream(fn: (stream: MediaStream, peerId: string) => void): Unsubscribe {
    const off = this.streams.on(fn);
    // Voices already arriving before anyone listened.
    for (const [peerId, receiver] of this.receivers) fn(receiver.stream, peerId);
    return off;
  }

  /** A packet from someone (the relay transport hands these over instead of treating them as game messages). */
  received(packet: VoicePacket, peerId: string): void {
    let receiver = this.receivers.get(peerId);
    if (!receiver) {
      this.ctx ??= new AudioContext({ sampleRate: RATE });
      void this.ctx.resume().catch(() => {});
      receiver = new Receiver(this.ctx);
      this.receivers.set(peerId, receiver);
      this.streams.emit(receiver.stream, peerId);
    }
    receiver.push(packet);
  }

  /** Someone left the flight: their voice goes. */
  peerLeft(peerId: string): void {
    this.targets.delete(peerId);
    this.receivers.get(peerId)?.close();
    this.receivers.delete(peerId);
  }

  close(): void {
    this.sender?.close();
    this.sender = null;
    this.targets.clear();
    for (const receiver of this.receivers.values()) receiver.close();
    this.receivers.clear();
    this.streams.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
