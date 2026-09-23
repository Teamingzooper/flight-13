import type { DestinationId, Twist } from './types';

export interface Destination {
  id: DestinationId;
  city: string;
  nights: number;
  twist: Twist;
  blurb: string;
}

export const DESTINATIONS: Record<DestinationId, Destination> = {
  LAS: { id: 'LAS', city: 'Las Vegas', nights: 3, twist: 'none', blurb: 'Quick hop. Classic rules.' },
  LHR: { id: 'LHR', city: 'London', nights: 5, twist: 'none', blurb: 'Classic rules.' },
  HNL: {
    id: 'HNL',
    city: 'Honolulu',
    nights: 5,
    twist: 'turbulence',
    blurb: 'Turbulence: each night one random passenger is buckled in.',
  },
  HND: { id: 'HND', city: 'Tokyo', nights: 7, twist: 'redeye', blurb: 'Red-eye: a long flight with shorter days.' },
  BDA: {
    id: 'BDA',
    city: 'Bermuda',
    nights: 5,
    twist: 'triangle',
    blurb: 'The Triangle: something strange happens every night.',
  },
};

export const DESTINATION_ORDER: readonly DestinationId[] = ['LAS', 'LHR', 'HNL', 'HND', 'BDA'];
