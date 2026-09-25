import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import {
  BOT_CHATTERS,
  BOT_SKILLS,
  CUSTOM_LIMITS,
  DESTINATIONS,
  DESTINATION_ORDER,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLANES,
  PLANE_ORDER,
  SPECIAL_CARDS,
  TIMERS,
  TWISTS,
  bombsFor,
  countSpecials,
  defaultCustomDestination,
  destinationOf,
  hasTwist,
  presetCards,
  validateCards,
  validateSettings,
  type BotChatter,
  type BotSkill,
  type Cards,
  type CustomDestination,
  type Settings,
  type SpecialCard,
  type TimerPreset,
} from '../engine';

const CARD_NAME: Record<SpecialCard, [string, string]> = {
  bomber: ['Bomber', 'Bombers'],
  mastermind: ['Mastermind', 'Masterminds'],
  stewardess: ['Stewardess', 'Stewardesses'],
  pilot: ['Pilot', 'Pilots'],
  nurse: ['Nurse', 'Nurses'],
  investigator: ['Investigator', 'Investigators'],
  marshal: ['Air Marshal', 'Air Marshals'],
};

const CARD_NOTE: Record<SpecialCard, string> = {
  bomber: 'Saboteur. A bomb for every three nights.',
  mastermind: 'Saboteur. A bomber who looks innocent.',
  stewardess: 'Team decided at takeoff (odds below).',
  pilot: 'Passenger. Buckles someone in each night.',
  nurse: 'Passenger. Saves the person next to them.',
  investigator: 'Passenger. Finds bombs nearby.',
  marshal: 'Passenger. Handcuffs one suspect per game.',
};

export function describeCards(cards: Cards): string {
  const parts = SPECIAL_CARDS.filter((c) => cards[c] > 0).map((c) => `${cards[c]} ${CARD_NAME[c][cards[c] > 1 ? 1 : 0]}`);
  return parts.length ? parts.join(', ') : 'no special roles';
}

/** Smallest passenger count these settings can take off with, or null if never. */
export function minPlayersFor(settings: Settings): number | null {
  const plane = PLANES[settings.plane] ?? PLANES.airliner;
  for (let n = Math.max(MIN_PLAYERS, plane.minPlayers); n <= plane.maxPlayers; n++) {
    const cards = settings.rolesMode === 'auto' ? presetCards(n) : settings.cards;
    if (validateCards(cards, n, settings.stewardessRogueChance) === null) return n;
  }
  return null;
}

const BOT_CHATTER_NAMES: Record<BotChatter, string> = { quiet: 'Quiet', normal: 'Normal', lively: 'Lively' };
const BOT_SKILL_NAMES: Record<BotSkill, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

export function describeRules(s: Settings): string[] {
  const d = destinationOf(s);
  const t = TIMERS[s.timers];
  const discuss = Math.round(t.day_discuss * (hasTwist(d, 'redeye') ? 0.6 : 1));
  const bombs = bombsFor(d.nights);
  const plane = PLANES[s.plane] ?? PLANES.airliner;
  return [
    `${plane.name}, up to ${s.maxPassengers} passengers. ${plane.blurb}`,
    `${d.city} (${d.code}): ${d.nights} nights. ${d.blurb}`,
    `Each Bomber carries ${bombs === 1 ? 'one bomb' : `${bombs} bombs`} (one for every three nights) and plants at most one a night.`,
    s.rolesMode === 'auto'
      ? 'Roles are balanced automatically for however many passengers board.'
      : `Roles: ${describeCards(s.cards)}. Everyone else is a Passenger.`,
    `The Stewardess turns rogue ${Math.round(s.stewardessRogueChance * 100)}% of the time.`,
    `The Pilot turns rogue ${Math.round(s.pilotRogueChance * 100)}% of the time (never if the saboteurs would stop being outnumbered).`,
    `Pace: nights ${t.night_move + t.night_act}s, discussion ${discuss}s, votes ${t.day_vote}s.`,
    s.voteMode === 'daily' ? 'A vote every day.' : 'Votes only after a night with a death or an explosion.',
    s.revealRoles ? 'Roles are revealed when someone is out.' : 'Roles stay secret until landing.',
    s.anonymousVotes ? 'Votes are anonymous.' : 'Everyone sees who voted for whom.',
    s.whispers ? 'Whispers to nearby seats are allowed.' : 'No whispering.',
    ...(s.pilotMustFly ? ['Pilot must fly: restraining the Pilot hands the saboteurs the win.'] : []),
    `Bots: ${BOT_CHATTER_NAMES[s.botChatter].toLowerCase()} chatter, ${BOT_SKILL_NAMES[s.botSkill].toLowerCase()} skill.`,
  ];
}

function Toggle({ checked, onChange, title, hint }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint?: string }) {
  return (
    <label class="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

/** The host's own destination: a city, its code, how many nights, and any mix of effects. */
function CustomDestinationFields({ value, onChange }: { value: CustomDestination; onChange: (patch: Partial<CustomDestination>) => void }) {
  const bombs = bombsFor(value.nights);
  return (
    <div class="custom-dest">
      <div class="custom-dest-names">
        <label class="field">
          <span class="label">City</span>
          <input
            class="input"
            value={value.city}
            maxLength={CUSTOM_LIMITS.cityLength}
            placeholder="Atlantis"
            onInput={(e) => onChange({ city: e.currentTarget.value })}
          />
        </label>
        <label class="field code">
          <span class="label">Code</span>
          <input
            class="input"
            value={value.code}
            placeholder="ATL"
            autocapitalize="characters"
            spellcheck={false}
            onInput={(e) => {
              // Letters only, upper-case, three at most (filtered before trimming, so a pasted "k3fx" reads KFX).
              const code = e.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
              e.currentTarget.value = code;
              onChange({ code });
            }}
          />
        </label>
      </div>
      <label class="field">
        <span class="label">
          Nights: {value.nights} <span class="muted">· each Bomber gets {bombs === 1 ? 'one bomb' : `${bombs} bombs`}</span>
        </span>
        <input
          type="range"
          min={CUSTOM_LIMITS.minNights}
          max={CUSTOM_LIMITS.maxNights}
          value={value.nights}
          onInput={(e) => onChange({ nights: Number(e.currentTarget.value) })}
        />
      </label>
      <div class="field">
        <span class="label">Effects</span>
        {TWISTS.map((t) => (
          <Toggle
            key={t.id}
            checked={value.twists.includes(t.id)}
            onChange={(on) => onChange({ twists: TWISTS.map((x) => x.id).filter((id) => (id === t.id ? on : value.twists.includes(id))) })}
            title={t.name}
            hint={`${t.blurb[0].toUpperCase()}${t.blurb.slice(1)}.`}
          />
        ))}
      </div>
    </div>
  );
}

export function SettingsForm({
  initial,
  submitLabel,
  onSubmit,
  extra,
  playerCount = 0,
}: {
  initial: Settings;
  submitLabel: string;
  onSubmit: (settings: Settings) => Promise<string | null> | string | null;
  extra?: ComponentChildren;
  playerCount?: number;
}) {
  const [s, setS] = useState<Settings>(() => structuredClone(initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Settings>) => {
    setS((prev) => ({ ...prev, ...patch }));
    setError(null);
  };
  const custom = s.customDestination ?? defaultCustomDestination();
  const setCustom = (patch: Partial<CustomDestination>) => set({ customDestination: { ...custom, ...patch } });
  const setCard = (card: SpecialCard, delta: number) =>
    set({ cards: { ...s.cards, [card]: Math.max(0, Math.min(MAX_PLAYERS, s.cards[card] + delta)) } });

  const minPlayers = minPlayersFor(s);
  const problem =
    validateSettings(s) ??
    (minPlayers === null
      ? 'These roles can never take off: saboteurs must start as a minority.'
      : minPlayers > s.maxPassengers
        ? `These roles need at least ${minPlayers} passengers.`
        : null) ??
    (s.maxPassengers < playerCount ? `${playerCount} passengers are already aboard.` : null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const result = await onSubmit(s);
    setBusy(false);
    if (result) setError(result);
  };

  const timers = TIMERS[s.timers];
  return (
    <form class="settings" onSubmit={submit}>
      <section class="settings-section">
        <h2>Plane</h2>
        <div class="destinations planes">
          {PLANE_ORDER.map((id) => {
            const p = PLANES[id];
            return (
              <button
                type="button"
                key={id}
                class={`dest plane${s.plane === id ? ' on' : ''}`}
                aria-pressed={s.plane === id}
                onClick={() => set({ plane: id, maxPassengers: Math.min(p.maxPlayers, Math.max(p.minPlayers, s.maxPassengers)) })}
              >
                <span class="dest-city">{p.name}</span>
                <span class="dest-nights">
                  {p.minPlayers}–{p.maxPlayers} passengers
                </span>
                <span class="dest-blurb">{p.blurb}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section class="settings-section">
        <h2>Destination</h2>
        <div class="destinations">
          {DESTINATION_ORDER.map((id) => {
            const d = DESTINATIONS[id];
            return (
              <button type="button" key={id} class={`dest${s.destination === id ? ' on' : ''}`} aria-pressed={s.destination === id} onClick={() => set({ destination: id })}>
                <span class="dest-code">{d.code}</span>
                <span class="dest-city">{d.city}</span>
                <span class="dest-nights">{d.nights} nights</span>
                <span class="dest-blurb">{d.blurb}</span>
              </button>
            );
          })}
          <button
            type="button"
            class={`dest custom${s.destination === 'custom' ? ' on' : ''}`}
            aria-pressed={s.destination === 'custom'}
            onClick={() => set({ destination: 'custom', customDestination: custom })}
          >
            <span class="dest-code">{custom.code || '???'}</span>
            <span class="dest-city">{custom.city.trim() || 'Your own'}</span>
            <span class="dest-nights">{custom.nights} nights</span>
            <span class="dest-blurb">Custom: name it, pick the nights and mix the effects.</span>
          </button>
        </div>
        {s.destination === 'custom' && <CustomDestinationFields value={custom} onChange={setCustom} />}
      </section>

      <section class="settings-section two">
        <div class="stack">
          <h2>Cabin</h2>
          <label class="field">
            <span class="label">Max passengers: {s.maxPassengers}</span>
            <input
              type="range"
              min={PLANES[s.plane].minPlayers}
              max={PLANES[s.plane].maxPlayers}
              value={s.maxPassengers}
              onInput={(e) => set({ maxPassengers: Number(e.currentTarget.value) })}
            />
          </label>
          <div class="field">
            <span class="label">Pace</span>
            <div class="segmented">
              {(Object.keys(TIMERS) as TimerPreset[]).map((t) => (
                <button type="button" key={t} class={s.timers === t ? 'on' : ''} onClick={() => set({ timers: t })}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <p class="hint">
              Nights {timers.night_move + timers.night_act}s · Discussion {timers.day_discuss}s · Vote {timers.day_vote}s
            </p>
          </div>
        </div>
        <div>
          <h2>Rules</h2>
          <Toggle checked={s.revealRoles} onChange={(v) => set({ revealRoles: v })} title="Reveal roles when someone is out" />
          <Toggle
            checked={s.voteMode === 'daily'}
            onChange={(v) => set({ voteMode: v ? 'daily' : 'afterIncident' })}
            title="Vote every day"
            hint="Off: only vote after a night with a death or an explosion."
          />
          <Toggle checked={s.anonymousVotes} onChange={(v) => set({ anonymousVotes: v })} title="Anonymous votes" />
          <Toggle checked={s.whispers} onChange={(v) => set({ whispers: v })} title="Whispers to nearby seats" />
          <Toggle
            checked={s.pilotMustFly}
            onChange={(v) => set({ pilotMustFly: v })}
            title="Pilot must fly"
            hint="If the passengers restrain the Pilot (by vote or handcuffs), nobody can fly the plane and the saboteurs win."
          />
          <h2>Bots</h2>
          <p class="hint">How much bots talk, and how well they reason and lie. Only matters when bots are aboard.</p>
          <div class="field">
            <span class="label">Chatter</span>
            <div class="segmented" role="group" aria-label="Bot chatter">
              {BOT_CHATTERS.map((c) => (
                <button type="button" key={c} class={s.botChatter === c ? 'on' : ''} onClick={() => set({ botChatter: c })}>
                  {BOT_CHATTER_NAMES[c]}
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <span class="label">Skill</span>
            <div class="segmented" role="group" aria-label="Bot skill">
              {BOT_SKILLS.map((k) => (
                <button type="button" key={k} class={s.botSkill === k ? 'on' : ''} onClick={() => set({ botSkill: k })}>
                  {BOT_SKILL_NAMES[k]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <h2>Roles</h2>
        <div class="segmented">
          <button type="button" class={s.rolesMode === 'auto' ? 'on' : ''} onClick={() => set({ rolesMode: 'auto' })}>
            Auto (balanced)
          </button>
          <button
            type="button"
            class={s.rolesMode === 'custom' ? 'on' : ''}
            onClick={() => set({ rolesMode: 'custom', cards: countSpecials(s.cards) > 0 ? s.cards : presetCards(s.maxPassengers) })}
          >
            Custom
          </button>
        </div>
        {s.rolesMode === 'auto' ? (
          <p class="hint">
            Balanced for however many passengers board. With a full cabin of {s.maxPassengers}: {describeCards(presetCards(s.maxPassengers))}.
          </p>
        ) : (
          <>
            <div class="cards">
              {SPECIAL_CARDS.map((card) => (
                <div class="card-count" key={card}>
                  <span>
                    <b>{CARD_NAME[card][0]}</b>
                    <br />
                    <small class="muted">{CARD_NOTE[card]}</small>
                  </span>
                  <div class="stepper">
                    <button type="button" aria-label={`Fewer ${CARD_NAME[card][1]}`} onClick={() => setCard(card, -1)}>
                      −
                    </button>
                    <b>{s.cards[card]}</b>
                    <button type="button" aria-label={`More ${CARD_NAME[card][1]}`} onClick={() => setCard(card, 1)}>
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p class="hint">Everyone else is a Passenger.{minPlayers ? ` Needs at least ${minPlayers} passengers.` : ''}</p>
          </>
        )}
        <label class="field">
          <span class="label">Stewardess turns rogue: {Math.round(s.stewardessRogueChance * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(s.stewardessRogueChance * 100)}
            onInput={(e) => set({ stewardessRogueChance: Number(e.currentTarget.value) / 100 })}
          />
        </label>
        <label class="field">
          <span class="label">Pilot turns rogue: {Math.round(s.pilotRogueChance * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(s.pilotRogueChance * 100)}
            onInput={(e) => set({ pilotRogueChance: Number(e.currentTarget.value) / 100 })}
          />
        </label>
      </section>

      {extra && <section class="settings-section">{extra}</section>}

      <div class="settings-submit">
        {(error ?? problem) && <p class="error-text">{error ?? problem}</p>}
        <button class="btn primary big" type="submit" disabled={busy || problem !== null}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
