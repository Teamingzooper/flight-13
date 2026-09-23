import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatCode, normalizeCode } from '../../net/code';
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

function Connected({ flight }: { flight: OpenFlight }) {
  const snap = useClientSnapshot(flight.client);
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
      {state.game ? <TV flight={flight} snap={snap} state={state} /> : <Boarding flight={flight} state={state} />}
    </>
  );
}
