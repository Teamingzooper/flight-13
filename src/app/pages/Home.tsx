import { useState } from 'preact/hooks';
import { addItems, countOf } from '../../meta/bag';
import { updateBag, useBag } from '../../meta/store';
import { formatCode, normalizeCode } from '../../net/code';
import { lastFlight, loadProfile, saveProfile, type Profile } from '../profile';
import { ProfileEditor } from '../ProfileEditor';
import { navigate } from '../router';
import { bookTutorial } from '../sessions';
import { Credits } from '../../meta/Credits';
import { accountsAvailable, useAccount } from '../account';
import { Departures } from '../Departures';
import { TutorialPicker } from '../TutorialPicker';
import type { LessonId } from '../../tutorial/lessons';

export function Home() {
  const [profile, setProfile] = useState(loadProfile);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const previous = lastFlight();
  const bag = useBag();
  const { account } = useAccount();

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
  /**
   * Flight School: the view pans across to your seat, where the safety card in the pocket ahead lists the lessons.
   * (The picker builds off-screen first: `loading` until it is ready to slide in.)
   */
  const [picker, setPicker] = useState<'closed' | 'loading' | 'open' | 'closing'>('closed');
  const tutorial = () => {
    if (!named() || picker !== 'closed') return;
    setPicker('loading');
  };
  const closePicker = () => {
    setPicker('closing');
    setTimeout(() => setPicker((p) => (p === 'closing' ? 'closed' : p)), 1200);
  };
  /** A short flight with scripted bots. The Passenger's uses a flashlight, so make sure there is one to pack. */
  const takeLesson = (lesson: LessonId) => {
    if (lesson === 'passenger') updateBag((b) => (countOf(b, 'flashlight') > 0 ? b : addItems(b, { flashlight: 1 })));
    navigate(`/f/${bookTutorial(lesson)}`);
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
    <div class={`home-track${picker === 'open' ? ' panned' : ''}`}>
      <div class="home" inert={picker === 'open'}>
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
              <button class={`btn${bag.stats.flights === 0 ? ' primary' : ''} tutorial-button`} onClick={tutorial} disabled={picker === 'loading'}>
                {picker === 'loading' ? 'Finding your seat…' : bag.stats.flights === 0 ? 'New here? Take the tutorial flight' : 'Tutorial flight'}
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
              <div class="home-links">
                {accountsAvailable() && (
                  <a class="account-link" href="#/account">
                    {account ? 'Your account & stats' : 'Sign in to keep your progress'}
                  </a>
                )}
                <a class="account-link" href="#/settings">
                  Settings
                </a>
              </div>
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
        <aside class="home-side">
          <Departures onBoard={(flight) => named() && navigate(`/f/${flight}`)} />
          <div class="home-window" aria-hidden="true">
            <div class="window-glass" />
          </div>
        </aside>
      </div>
      {picker !== 'closed' && (
        <TutorialPicker
          look={profile.look}
          open={picker === 'open'}
          onWarm={() => setPicker((p) => (p === 'loading' ? 'open' : p))}
          onBack={closePicker}
          onPick={takeLesson}
        />
      )}
    </div>
  );
}
