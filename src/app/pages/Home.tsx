import { useState } from 'preact/hooks';
import { addItems, countOf } from '../../meta/bag';
import { updateBag, useBag } from '../../meta/store';
import { formatCode, normalizeCode } from '../../net/code';
import { lastFlight, loadProfile, saveProfile, type Profile } from '../profile';
import { ProfileEditor } from '../ProfileEditor';
import { navigate } from '../router';
import { bookTutorial } from '../sessions';
import { Credits } from '../../meta/Credits';

export function Home() {
  const [profile, setProfile] = useState(loadProfile);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const previous = lastFlight();
  const bag = useBag();

  const update = (next: Profile) => {
    setProfile(next);
    saveProfile(next);
    setError(null);
  };
  const named = () => {
    if (profile.name.trim()) return true;
    setError('Write your name on the boarding pass first.');
    return false;
  };
  /** Flight School: a short flight with scripted bots. It uses a flashlight, so make sure there is one to pack. */
  const tutorial = () => {
    if (!named()) return;
    updateBag((b) => (countOf(b, 'flashlight') > 0 ? b : addItems(b, { flashlight: 1 })));
    navigate(`/f/${bookTutorial()}`);
  };
  const board = (e: Event) => {
    e.preventDefault();
    if (!named()) return;
    const normalized = normalizeCode(code);
    if (!normalized) {
      setError('Flight numbers look like FT-7K2Q.');
      return;
    }
    navigate(`/f/${normalized}`);
  };

  return (
    <div class="home">
      <div class="home-sky" aria-hidden="true" />
      <section>
        <h1 class="logo">
          FLIGHT <span>13</span>
        </h1>
        <p class="tagline">Someone on this plane wants it to go down. Find them before you land.</p>
        <div class="ticket">
          <div class="ticket-main">
            <div class="label">Boarding pass · Passenger</div>
            <ProfileEditor profile={profile} onChange={update} />
          </div>
          <div class="ticket-stub">
            <button class="btn primary big" onClick={() => named() && navigate('/book')}>
              Book a flight
            </button>
            <button class={`btn${bag.stats.flights === 0 ? ' primary' : ''} tutorial-button`} onClick={tutorial}>
              {bag.stats.flights === 0 ? 'New here? Take the tutorial flight' : 'Tutorial flight'}
            </button>
            <form class="board-form" onSubmit={board}>
              <label class="label" for="code">
                Have a flight number?
              </label>
              <div class="row">
                <input
                  id="code"
                  class="input code-input"
                  placeholder="FT-7K2Q"
                  value={code}
                  maxLength={8}
                  autocomplete="off"
                  spellcheck={false}
                  onInput={(e) => setCode(e.currentTarget.value)}
                />
                <button class="btn" type="submit">
                  Board
                </button>
              </div>
            </form>
            {previous && (
              <p class="rejoin">
                Last flight: <a href={`#/f/${previous}`}>{formatCode(previous)}</a>
              </p>
            )}
            <a class="duty-free-link" href="#/duty-free">
              <span>Duty Free</span>
              <Credits amount={bag.credits} />
            </a>
            {error && <p class="error-text">{error}</p>}
          </div>
        </div>
        <ol class="how">
          <li>Book a flight and share the flight number with friends.</li>
          <li>Everyone gets a secret role and a random seat.</li>
          <li>At night, change seats and use your abilities in the dark.</li>
          <li>By day, talk it out and vote to restrain a suspect.</li>
          <li>Passengers win if every saboteur is caught before landing.</li>
        </ol>
      </section>
      <div class="home-window" aria-hidden="true">
        <div class="window-glass" />
      </div>
    </div>
  );
}
