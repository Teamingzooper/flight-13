import { describe, expect, it } from 'vitest';
import { classifyCandidates } from './natcheck';

const host = 'candidate:1 1 udp 2122260223 0b8f2c1e-4c6a-4f5e.local 54400 typ host generation 0';
const srflx = (ip: string, port: number) => `candidate:2 1 udp 1686052607 ${ip} ${port} typ srflx raddr 0.0.0.0 rport 0 generation 0`;

describe('network check', () => {
  it('calls a network open when every STUN server sees the same public port', () => {
    expect(classifyCandidates([host, srflx('203.0.113.7', 51234)])).toBe('open');
    expect(classifyCandidates([host, srflx('203.0.113.7', 51234), srflx('203.0.113.7', 51234)])).toBe('open');
  });

  it('calls a network strict when the NAT hands each server a different port', () => {
    expect(classifyCandidates([host, srflx('203.0.113.7', 51234), srflx('203.0.113.7', 60811)])).toBe('strict');
  });

  it('calls a network blocked when no public address comes back', () => {
    expect(classifyCandidates([host])).toBe('blocked');
    expect(classifyCandidates([])).toBe('blocked');
  });

  it('ignores IPv6 reflexive addresses', () => {
    expect(classifyCandidates([host, srflx('2001:db8::1', 5000), srflx('2001:db8::1', 6000), srflx('198.51.100.2', 7000)])).toBe('open');
  });
});
