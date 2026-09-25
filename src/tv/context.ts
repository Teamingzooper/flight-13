import type { OpenFlight } from '../app/sessions';
import type { Intent, PlayerView } from '../engine';
import type { ClientSnapshot } from '../net/client';
import type { ClientState } from '../net/protocol';

/** Everything a TV tab needs. */
export interface TVContext {
  flight: OpenFlight;
  state: ClientState;
  game: PlayerView;
  snap: ClientSnapshot;
  /** Milliseconds left in the current phase. */
  left: number;
  /** Send an intent; shows a toast and resolves false when the host refuses it. */
  send: (intent: Intent) => Promise<boolean>;
  toast: (message: string) => void;
  /** Drawn on a screen inside the 3D cabin (the captain works his controls there instead). */
  embedded?: boolean;
}
