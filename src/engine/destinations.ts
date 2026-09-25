import type { CustomDestination, DestinationId, Settings, Twist } from './types';

export interface Destination {
  id: DestinationId | 'custom';
  /** Three letters, like an airport code. */
  code: string;
  city: string;
  nights: number;
  twists: readonly Twist[];
  blurb: string;
}

export const DESTINATIONS: Record<DestinationId, Destination> = {
  LAS: { id: 'LAS', code: 'LAS', city: 'Las Vegas', nights: 3, twists: [], blurb: 'Quick hop. Classic rules.' },
  LHR: { id: 'LHR', code: 'LHR', city: 'London', nights: 5, twists: [], blurb: 'Classic rules.' },
  HNL: {
    id: 'HNL',
    code: 'HNL',
    city: 'Honolulu',
    nights: 5,
    twists: ['turbulence'],
    blurb: 'Turbulence: each night one random passenger is buckled in.',
  },
  HND: { id: 'HND', code: 'HND', city: 'Tokyo', nights: 7, twists: ['redeye'], blurb: 'Red-eye: a long flight with shorter days.' },
  BDA: {
    id: 'BDA',
    code: 'BDA',
    city: 'Bermuda',
    nights: 5,
    twists: ['triangle'],
    blurb: 'The Triangle: something strange happens every night.',
  },
};

export const DESTINATION_ORDER: readonly DestinationId[] = ['LAS', 'LHR', 'HNL', 'HND', 'BDA'];

/** Effects a host can mix into a destination of their own, in the order the lobby lists them. */
export const TWISTS: readonly { id: Twist; name: string; blurb: string }[] = [
  { id: 'turbulence', name: 'Turbulence', blurb: 'each night one random passenger is buckled in' },
  { id: 'redeye', name: 'Red-eye', blurb: 'shorter days' },
  { id: 'triangle', name: 'The Bermuda Triangle', blurb: 'something strange happens every night, under aurora skies' },
];

export const CUSTOM_LIMITS = { cityLength: 24, minNights: 2, maxNights: 10 } as const;

export function defaultCustomDestination(): CustomDestination {
  return { city: 'Anywhere', code: 'ANY', nights: 5, twists: [] };
}

/** Where this flight is going: one of the five, or the host's own. */
export function destinationOf(settings: Pick<Settings, 'destination' | 'customDestination'>): Destination {
  if (settings.destination !== 'custom') return DESTINATIONS[settings.destination];
  const c = settings.customDestination ?? defaultCustomDestination();
  const effects = TWISTS.filter((t) => c.twists.includes(t.id));
  const blurb = effects.length ? `${effects.map((t) => `${t.name}: ${t.blurb}`).join('. ')}.` : 'Classic rules.';
  return { id: 'custom', code: c.code, city: c.city, nights: c.nights, twists: effects.map((t) => t.id), blurb };
}

export function hasTwist(d: Destination, twist: Twist): boolean {
  return d.twists.includes(twist);
}

/** Bombs each Bomber (and the Mastermind) gets: one for every three nights of the flight, from one to four. */
export function bombsFor(nights: number): number {
  return Math.min(4, Math.max(1, Math.ceil(nights / 3)));
}
