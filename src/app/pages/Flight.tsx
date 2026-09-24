import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PlayerView } from '../../engine';
import { settleGame, spendUsed } from '../../meta/bag';
import { updateBag } from '../../meta/store';
import type { ClientSnapshot } from '../../net/client';
import { formatCode, normalizeCode } from '../../net/code';
import type { ClientState } from '../../net/protocol';
import { TV } from '../../tv/TV';
import { useClientSnapshot } from '../hooks';
import { Notice, Searching } from '../Notice';
import { loadProfile, saveProfile } from '../profile';
import { ProfileEditor } from '../ProfileEditor';
import { closeFlight, openFlight, type OpenFlight } from '../sessions';
import { Boarding } from './Boarding';

export function Flight({ code: raw }: { code: string }) {
  const code = normalizeCode(raw);
  const [named, setNamed] = useState(() => loadProfile().name.trim().length > 0);
  if (!code) {
    return (
      <Notice title="That is not a flight number">
        <p>Flight numbers look like FT-7K2Q.</p>
      </Notice>
    );
  }
  if (!named) return <NamePrompt code={code} onDone={() => setNamed(true)} />;
  return <FlightSession key={code} code={code} />;
}

function NamePrompt({ code, onDone }: { code: string; onDone: () => void }) {
  const [profile, setProfile] = useState(loadProfile);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: Event) => {
    e.preventDefault();
    if (!profile.name.trim()) {
      setError('Tell the crew your name first.');
      return;
    }
    saveProfile({ ...profile, name: profile.name.trim() });
    onDone();
  };
  return (
    <div class="notice-page">
      <form class="notice" onSubmit={submit}>
        <div class="label">Boarding {formatCode(code)}</div>
        <h1>Who is flying?</h1>
        <ProfileEditor
          profile={profile}
          onChange={(p) => {
            setProfile(p);
            setError(null);
          }}
        />
        {error && <p class="error-text">{error}</p>}
        <button class="btn primary big" type="submit">
          Board flight
        </button>
      </form>
    </div>
  );
}

function FlightSession({ code }: { code: string }) {
  const flight = useMemo(() => openFlight(code), [code]);
  useEffect(() => () => closeFlight(code), [code]);
  if (flight.kind === 'blocked') {
    return (
      <Notice title="This flight is open in another tab">
        <p>Close the other tab, then reload this one.</p>
      </Notice>
    );
  }
  return <Connected flight={flight} />;
}

type ViewMode = '3d' | '2d';
const VIEW_KEY = 'flight13.view';
let webgl2Cache: boolean | null = null;

function hasWebGL2(): boolean {
  if (webgl2Cache === null) {
    try {
      webgl2Cache = !!document.createElement('canvas').getContext('webgl2');
    } catch {
      webgl2Cache = false;
    }
  }
  return webgl2Cache;
}

/** 3D by default where WebGL2 works; the choice is remembered per browser. */
function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(VIEW_KEY);
    } catch {
      saved = null;
    }
    if (!hasWebGL2()) return '2d';
    return saved === '2d' ? '2d' : '3d';
  });
  const choose = (next: ViewMode) => {
    setMode(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Not remembered; fine.
    }
  };
  return [mode, choose];
}

type WorldComponent = typeof import('../../world/World').World;

/** Loads the Three.js cabin on demand so the terminal and gate stay light. */
function World3D(props: { flight: OpenFlight; snap: ClientSnapshot; state: ClientState; onUse2D: () => void }) {
  const [World, setWorld] = useState<WorldComponent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    import('../../world/World')
      .then((module) => {
        if (alive) setWorld(() => module.World);
      })
      .catch(() => {
        // The 3D files changed under us (a new version was deployed): reload to pick them up (see index.html).
        const reloading = (globalThis as { flight13Reload?: () => boolean }).flight13Reload?.() ?? false;
        if (alive && !reloading) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (failed) {
    return (
      <div class="world-failed">
        <p>The 3D cabin did not load. Reload the page, or play on the 2D screen.</p>
        <div class="row">
          <button class="btn" onClick={() => location.reload()}>
            Reload
          </button>
          <button class="btn primary" onClick={props.onUse2D}>
            Use the 2D screen
          </button>
        </div>
      </div>
    );
  }
  if (!World) {
    return (
      <div class="world-loading">
        <div class="spinner" aria-hidden="true" />
        <p>Boarding the cabin…</p>
      </div>
    );
  }
  return <World {...props} />;
}

/** Keep your bag in step with the flight: items leave it as you use them, and the flight pays out once it is over. */
function useBagSync(game: PlayerView | null | undefined): void {
  const used = game?.you?.usedItems.length ?? 0;
  useEffect(() => {
    if (game?.you) updateBag((bag) => spendUsed(bag, game.gameId, game.you!.usedItems));
  }, [game?.gameId, used]);
  const ended = game?.phase.kind === 'ended';
  useEffect(() => {
    if (game && ended) updateBag((bag) => settleGame(bag, game, Math.random));
  }, [game?.gameId, ended]);
}

function Connected({ flight }: { flight: OpenFlight }) {
  const snap = useClientSnapshot(flight.client);
  const [view, setView] = useViewMode();
  useBagSync(snap.state?.game);
  const { state } = snap;
  if (snap.status === 'refused') {
    return (
      <Notice title="You are not on this flight">
        <p>{snap.reason ?? 'The host turned you away.'}</p>
      </Notice>
    );
  }
  if (!state) return <Searching code={flight.code} status={snap.status} hosting={flight.host !== null} />;
  return (
    <>
      {snap.status === 'lost' && (
        <div class="lost-banner" role="status">
          Lost contact with the captain. Reconnecting…
        </div>
      )}
      {!state.game ? (
        <Boarding flight={flight} state={state} />
      ) : view === '3d' ? (
        <World3D flight={flight} snap={snap} state={state} onUse2D={() => setView('2d')} />
      ) : (
        <TV flight={flight} snap={snap} state={state} onUse3D={hasWebGL2() ? () => setView('3d') : undefined} />
      )}
    </>
  );
}
