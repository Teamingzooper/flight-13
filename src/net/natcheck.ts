/** How friendly this network is to direct peer-to-peer connections. */
export type NetworkKind = 'open' | 'strict' | 'blocked' | 'unknown';

interface Candidate {
  type: string;
  ip: string;
  port: string;
}

function parse(line: string): Candidate | null {
  // e.g. "candidate:842163049 1 udp 1677729535 203.0.113.7 51234 typ srflx raddr 0.0.0.0 rport 0 ..."
  const parts = line.replace(/^candidate:/, '').trim().split(/\s+/);
  const typ = parts.indexOf('typ');
  if (typ < 0 || parts.length < 6) return null;
  return { type: parts[typ + 1], ip: parts[4], port: parts[5] };
}

/**
 * Classify the candidates gathered against two different STUN servers. A NAT that shows each server a
 * different public port for the same address is "symmetric": other players cannot reach it directly.
 * No public (server-reflexive) address at all means UDP is blocked.
 */
export function classifyCandidates(lines: readonly string[]): NetworkKind {
  const reflexive = lines.map(parse).filter((c): c is Candidate => c?.type === 'srflx' && !c.ip.includes(':'));
  if (reflexive.length === 0) return 'blocked';
  const portsByIp = new Map<string, Set<string>>();
  for (const c of reflexive) portsByIp.set(c.ip, (portsByIp.get(c.ip) ?? new Set()).add(c.port));
  for (const ports of portsByIp.values()) if (ports.size > 1) return 'strict';
  return 'open';
}

let cached: Promise<NetworkKind> | null = null;

/** Probe this network once (about three seconds) and remember the answer for the visit. */
export function checkNetwork(timeoutMs = 3500): Promise<NetworkKind> {
  cached ??= probe(timeoutMs);
  return cached;
}

async function probe(timeoutMs: number): Promise<NetworkKind> {
  if (typeof RTCPeerConnection === 'undefined') return 'unknown';
  let pc: RTCPeerConnection | null = null;
  try {
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] });
    const lines: string[] = [];
    pc.onicecandidate = (e) => {
      if (e.candidate?.candidate) lines.push(e.candidate.candidate);
    };
    pc.createDataChannel('check');
    await pc.setLocalDescription(await pc.createOffer());
    const peer = pc;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      peer.onicegatheringstatechange = () => {
        if (peer.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      };
    });
    return classifyCandidates(lines);
  } catch {
    return 'unknown';
  } finally {
    pc?.close();
  }
}
