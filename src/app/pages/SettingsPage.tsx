import { navigate } from '../router';
import { SettingsPanel } from '../SettingsPanel';

/** Settings from the terminal (the seatback TV has them too, with the people on your flight). */
export function SettingsPage() {
  return (
    <div class="page settings-page">
      <header class="page-head">
        <button class="btn ghost small" onClick={() => navigate('/')}>
          ← Terminal
        </button>
        <h1>Settings</h1>
        <p class="muted">Sound, voice, graphics and accessibility, for this browser. Mute people from the seatback TV once you are aboard.</p>
      </header>
      <div class="panel">
        <SettingsPanel />
      </div>
    </div>
  );
}
