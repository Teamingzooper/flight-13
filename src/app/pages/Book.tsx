import { useState } from 'preact/hooks';
import { defaultSettings, type Settings } from '../../engine';
import { Notice } from '../Notice';
import { loadProfile } from '../profile';
import { navigate } from '../router';
import { bookFlight } from '../sessions';
import { SettingsForm } from '../SettingsForm';

export function Book() {
  const [controlTower, setControlTower] = useState(false);
  if (!loadProfile().name.trim()) {
    return (
      <Notice title="Who's the captain?">
        <p>Write your name on the boarding pass first.</p>
      </Notice>
    );
  }
  const submit = async (settings: Settings) => {
    const booked = await bookFlight(settings, controlTower);
    if ('error' in booked) return booked.error;
    navigate(`/f/${booked.code}`);
    return null;
  };
  return (
    <div class="page book">
      <header class="page-head">
        <button class="btn ghost small" onClick={() => navigate('/')}>
          ← Terminal
        </button>
        <h1>Book a flight</h1>
        <p class="muted">Pick a destination and the rules. You can change them until the doors close.</p>
      </header>
      <SettingsForm
        initial={defaultSettings()}
        submitLabel="Create flight"
        onSubmit={submit}
        extra={
          <label class="toggle">
            <input type="checkbox" checked={controlTower} onChange={(e) => setControlTower(e.currentTarget.checked)} />
            <span>
              <b>Control tower</b>
              <small>Run the flight from this device without playing, for example on a TV or a spare laptop.</small>
            </span>
          </label>
        }
      />
    </div>
  );
}
