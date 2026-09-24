/** Synthesized cabin sound: nothing is downloaded, every sound is built from noise and oscillators. */

const MUTE_KEY = 'f13-muted';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

interface Beds {
  engineGain: GainNode;
  engineFilter: BiquadFilterNode;
  hum: OscillatorNode;
  whine: OscillatorNode;
  whineGain: GainNode;
  stop: () => void;
}

class CabinAudio {
  muted = readMuted();
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  /** Everything passes through this low-pass, which a nearby blast slams shut for a few seconds. */
  private muffle: BiquadFilterNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private beds: Beds | null = null;
  private wantBeds = false;
  private engineLevel = 0.4;
  private readonly listeners = new Set<() => void>();

  /** Browsers only allow sound after a gesture; call this from pointer and key handlers. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.muffle = ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.ratio.value = 6;
      this.out = ctx.createGain();
      this.out.gain.value = this.muted ? 0 : 0.9;
      this.muffle.connect(compressor).connect(this.out).connect(ctx.destination);
      this.white = this.noiseBuffer(2, false);
      this.brown = this.noiseBuffer(4, true);
      if (this.wantBeds) this.startBeds();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  /** Engine drone and cabin air, for as long as you are in the 3D cabin. */
  start(): void {
    this.wantBeds = true;
    if (this.ctx && !this.beds) this.startBeds();
  }

  stop(): void {
    this.wantBeds = false;
    this.beds?.stop();
    this.beds = null;
  }

  /** 0 = engines idle, 0.45 = cruise, 1 = takeoff power. */
  setEngine(level: number, seconds = 1.5): void {
    this.engineLevel = clamp(level, 0, 1);
    const b = this.beds;
    const ctx = this.ctx;
    if (!b || !ctx) return;
    const t = ctx.currentTime;
    const l = this.engineLevel;
    b.engineGain.gain.setTargetAtTime(0.1 + l * 0.34, t, seconds / 3);
    b.engineFilter.frequency.setTargetAtTime(160 + l * 520, t, seconds / 3);
    b.hum.frequency.setTargetAtTime(48 + l * 26, t, seconds / 3);
    b.whine.frequency.setTargetAtTime(2100 + l * 1700, t, seconds / 3);
    b.whineGain.gain.setTargetAtTime(0.0015 + l * 0.006, t, seconds / 3);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    for (const fn of [...this.listeners]) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** The seatbelt sign: one soft high bing. */
  chime(): void {
    const t = this.now();
    if (t === null) return;
    this.bell(988, t, 1.6, 0.2);
  }

  /** Before the captain speaks: ding-dong. */
  ding(): void {
    const t = this.now();
    if (t === null) return;
    this.bell(1175, t, 1.2, 0.17);
    this.bell(880, t + 0.42, 1.5, 0.17);
  }

  /** The cabin lights relay switching. */
  clunk(): void {
    const t = this.now();
    if (t === null) return;
    this.noise(t, 0.035, { type: 'bandpass', frequency: 1800, q: 1.2 }, 0.35, 0.002);
    this.tone(t, 'sine', 95, 60, 0.14, 0.28);
  }

  /** Landing gear folding away. */
  thunk(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(t, 'sine', 70, 38, 0.3, 0.5);
    this.noise(t, 0.2, { type: 'lowpass', frequency: 320 }, 0.5, 0.005, true);
  }

  /** A bomb going off `distance` metres away. */
  boom(distance: number): void {
    const ctx = this.ctx;
    const t = this.now();
    if (!ctx || t === null || !this.muffle) return;
    const near = clamp(1 - distance / 14, 0.18, 1);
    // Crack, body, sub thump.
    this.noise(t, 0.3, { type: 'lowpass', frequency: 7000, to: 700 }, 0.9 * near, 0.002);
    this.noise(t, 3, { type: 'lowpass', frequency: 1200, to: 70 }, 1.1 * near, 0.01, true);
    this.tone(t, 'sine', 75, 26, 0.9, 1.0 * near);
    // Debris rattling down.
    for (let i = 0; i < 14; i++) {
      const at = t + 0.25 + Math.random() * 1.6;
      this.noise(at, 0.02 + Math.random() * 0.03, { type: 'highpass', frequency: 1500 + Math.random() * 3000 }, 0.12 * near * Math.random(), 0.001);
    }
    // Close by, your ears ring and everything sounds far away for a few seconds.
    if (near > 0.55) {
      this.tone(t + 0.15, 'sine', 3900, 3900, 3.5, 0.035 * near);
      this.muffle.frequency.cancelScheduledValues(t);
      this.muffle.frequency.setValueAtTime(20000, t);
      this.muffle.frequency.exponentialRampToValueAtTime(260, t + 0.12);
      this.muffle.frequency.setValueAtTime(260, t + 1.2);
      this.muffle.frequency.exponentialRampToValueAtTime(20000, t + 4.5);
    }
  }

  /** A turbulence bump: a low shudder, a creak and the bins rattling. */
  rumble(strength = 1): void {
    const t = this.now();
    if (t === null) return;
    const s = clamp(strength, 0.2, 1.5);
    this.noise(t, 1.3, { type: 'lowpass', frequency: 140 }, 0.9 * s, 0.05, true);
    this.tone(t + 0.1, 'sawtooth', 44, 40, 0.45, 0.03 * s, { type: 'bandpass', frequency: 650, q: 7 });
    for (let i = 0; i < 6; i++) {
      this.noise(t + 0.05 + Math.random() * 0.8, 0.015, { type: 'highpass', frequency: 2500 }, 0.1 * s, 0.001);
    }
  }

  /** The drink cart rolling loose: wheels and clinking cans. */
  rattle(): void {
    const t = this.now();
    if (t === null) return;
    this.noise(t, 2.4, { type: 'bandpass', frequency: 260, q: 0.8 }, 0.35, 0.4, true);
    for (let i = 0; i < 16; i++) {
      const at = t + Math.random() * 2.2;
      this.tone(at, 'sine', 2000 + Math.random() * 2200, 2000, 0.07, 0.05);
    }
  }

  /** A footstep on the aisle carpet. */
  step(): void {
    const t = this.now();
    if (t === null) return;
    const v = 0.8 + Math.random() * 0.4;
    this.noise(t, 0.09, { type: 'lowpass', frequency: 380 * v }, 0.32 * v, 0.004, true);
    this.noise(t + 0.01, 0.03, { type: 'bandpass', frequency: 2200 * v, q: 1.5 }, 0.05, 0.002);
  }

  /** Clothes against the seat as you stand up or sit down. */
  rustle(): void {
    const t = this.now();
    if (t === null) return;
    this.noise(t, 0.45, { type: 'bandpass', frequency: 1900, to: 1200, q: 0.9 }, 0.09, 0.08);
    this.noise(t + 0.05, 0.3, { type: 'lowpass', frequency: 260 }, 0.18, 0.03, true);
  }

  /** The click of a phone flashlight. */
  click(): void {
    const t = this.now();
    if (t === null) return;
    this.noise(t, 0.012, { type: 'highpass', frequency: 3500 }, 0.25, 0.001);
    this.tone(t, 'square', 1900, 1900, 0.02, 0.02);
  }

  /** A bomb's fuse ticking down: `urgency` 0..1 raises the pitch. */
  beep(urgency: number): void {
    const t = this.now();
    if (t === null) return;
    const u = clamp(urgency, 0, 1);
    this.tone(t, 'square', 2300 + u * 900, 2300 + u * 900, 0.07, 0.035 + u * 0.03, { type: 'lowpass', frequency: 6000 });
  }

  /** A zip tie being pulled tight. */
  zip(): void {
    const ctx = this.ctx;
    const t = this.now();
    if (!ctx || t === null || !this.white || !this.muffle) return;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 3;
    band.frequency.setValueAtTime(1300, t);
    band.frequency.exponentialRampToValueAtTime(3600, t + 0.35);
    const gate = ctx.createGain();
    gate.gain.value = 0;
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(45, t);
    saw.frequency.linearRampToValueAtTime(85, t + 0.35);
    const depth = ctx.createGain();
    depth.gain.value = 0.25;
    saw.connect(depth).connect(gate.gain);
    src.connect(band).connect(gate).connect(this.muffle);
    src.start(t);
    src.stop(t + 0.38);
    saw.start(t);
    saw.stop(t + 0.38);
  }

  private startBeds(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const engineSrc = ctx.createBufferSource();
    engineSrc.buffer = this.brown;
    engineSrc.loop = true;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.Q.value = 0.6;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineSrc.connect(engineFilter).connect(engineGain).connect(this.muffle!);

    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 180;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.025;
    hum.connect(humFilter).connect(humGain).connect(engineGain);

    const whine = ctx.createOscillator();
    whine.type = 'sine';
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain).connect(this.muffle!);

    // A slow swell so the drone never sounds like a loop.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.03;
    lfo.connect(lfoDepth).connect(engineGain.gain);

    const airSrc = ctx.createBufferSource();
    airSrc.buffer = this.white;
    airSrc.loop = true;
    const airHigh = ctx.createBiquadFilter();
    airHigh.type = 'highpass';
    airHigh.frequency.value = 2200;
    const airLow = ctx.createBiquadFilter();
    airLow.type = 'lowpass';
    airLow.frequency.value = 8000;
    const airGain = ctx.createGain();
    airGain.gain.value = 0;
    airGain.gain.setTargetAtTime(0.012, t, 1);
    airSrc.connect(airHigh).connect(airLow).connect(airGain).connect(this.muffle!);

    for (const node of [engineSrc, hum, whine, lfo, airSrc]) node.start(t);
    this.beds = {
      engineGain,
      engineFilter,
      hum,
      whine,
      whineGain,
      stop: () => {
        const now = ctx.currentTime;
        engineGain.gain.setTargetAtTime(0, now, 0.3);
        airGain.gain.setTargetAtTime(0, now, 0.3);
        whineGain.gain.setTargetAtTime(0, now, 0.3);
        for (const node of [engineSrc, hum, whine, lfo, airSrc]) node.stop(now + 1.5);
      },
    };
    this.setEngine(this.engineLevel, 2);
  }

  private now(): number | null {
    return this.ctx && this.muffle ? this.ctx.currentTime : null;
  }

  private noiseBuffer(seconds: number, brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buffer;
  }

  /** A bell-like tone with a couple of inharmonic partials. */
  private bell(frequency: number, at: number, seconds: number, level: number): void {
    for (const [multiple, amount] of [
      [1, 1],
      [2.76, 0.16],
      [5.4, 0.05],
    ] as const) {
      this.tone(at, 'sine', frequency * multiple, frequency * multiple, seconds / multiple, level * amount);
    }
  }

  private tone(
    at: number,
    type: OscillatorType,
    from: number,
    to: number,
    seconds: number,
    level: number,
    filter?: { type: BiquadFilterType; frequency: number; q?: number },
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    let node: AudioNode = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.frequency.value = filter.frequency;
      if (filter.q) f.Q.value = filter.q;
      node = node.connect(f);
    }
    node.connect(gain).connect(this.muffle!);
    osc.start(at);
    osc.stop(at + seconds + 0.05);
  }

  private noise(
    at: number,
    seconds: number,
    filter: { type: BiquadFilterType; frequency: number; to?: number; q?: number },
    level: number,
    attack: number,
    brown = false,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = brown ? this.brown : this.white;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.setValueAtTime(filter.frequency, at);
    if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, at + seconds);
    if (filter.q) f.Q.value = filter.q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), at + Math.max(0.001, attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    src.connect(f).connect(gain).connect(this.muffle!);
    src.start(at, Math.random() * 1.5);
    src.stop(at + seconds + 0.05);
  }
}

export const cabinAudio = new CabinAudio();
