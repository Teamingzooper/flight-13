import { useState } from 'preact/hooks';
import { PA_COOLDOWN_MS, PA_MAX_LENGTH, grid, type PlayerView } from '../engine';
import type { TVContext } from './context';
import { describeAction, nameWithSeat } from './format';
import { SeatMap } from './SeatMap';

/** Seats (and crew spots) in the three rows from `start`, for previews on the map. */
function sectionPlaces(game: PlayerView, start: number): Set<string> {
  const out = new Set<string>();
  for (let row = start; row < start + 3 && row <= game.cabin.rows; row++) {
    for (const seat of grid.rowSeats(row)) out.add(seat);
    out.add(grid.aisleSpot(row));
  }
  return out;
}

const rowsText = (start: number) => `rows ${start}–${start + 2}`;

/** Lights out on the flight deck: the seatbelt sign, the jump seat, rough air and the course, all in one night. */
export function FlightDeckPanel({ ctx }: { ctx: TVContext }) {
  const { game } = ctx;
  const you = game.you!;
  const mine = game.mine!;
  if (you.buckled) {
    return (
      <div class="callout amber">
        <b>Turbulence.</b> You are fighting the controls all night: no calls tonight.
      </div>
    );
  }
  if (you.knockedOut) {
    return (
      <div class="callout red">
        <b>You are out cold.</b> The plane flies itself tonight: no calls, and no cameras.
      </div>
    );
  }
  return (
    <div class="stack flight-deck">
      <div class="panel-title">
        Flight deck <span class="muted">Every call below, every night. They take effect when seats change.</span>
      </div>
      <SeatbeltPicker ctx={ctx} />
      <JumpSeatPicker ctx={ctx} />
      <RoughAirPicker ctx={ctx} />
      <CoursePicker ctx={ctx} />
      <div class="done-row">
        {mine.seatbelt === null ? (
          <span>Pick someone for the seatbelt sign (or No one) to finish your calls.</span>
        ) : (
          <span class="done-ok">✓ Your calls are in. You can change them until the seats change.</span>
        )}
      </div>
    </div>
  );
}

function SeatbeltPicker({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const chosen = game.mine?.seatbelt ?? null;
  const targets = game.options?.seatbelt ?? [];
  const last = game.you?.lastSeatbeltTarget;
  return (
    <div class="ability-card">
      <div class="ability-title">Seatbelt sign</div>
      <p class="muted">
        Lock one passenger in tonight: no moving and no ability.{last ? ` You cannot pick ${nameWithSeat(game, last)} two nights running.` : ''}
      </p>
      <div class="chips">
        {targets.map((id) => (
          <button key={id} class={`chip${chosen === id ? ' on' : ''}`} onClick={() => void send({ kind: 'seatbelt', target: id })}>
            {nameWithSeat(game, id)}
          </button>
        ))}
        <button class={`chip${chosen === 'none' ? ' on' : ''}`} onClick={() => void send({ kind: 'seatbelt', target: 'none' })}>
          No one
        </button>
      </div>
    </div>
  );
}

function JumpSeatPicker({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const targets = game.options?.jumpseat ?? [];
  const chosen = game.mine?.jumpseat ?? null;
  const call = (target: string) => void send({ kind: 'jumpseat', target });
  return (
    <div class="ability-card">
      <div class="ability-title">Jump seat</div>
      <p class="muted">
        Call one person up to the flight deck for the night. Nobody in the cabin can reach them, but they lose their own ability, and everyone sees
        them go. A saboteur up here can knock you out; a Nurse can treat you.
      </p>
      <div class="chips">
        {targets.map((id) => (
          <button key={id} class={`chip${chosen === id ? ' on' : ''}`} onClick={() => call(id)}>
            {nameWithSeat(game, id)}
          </button>
        ))}
        <button class={`chip${chosen === null || chosen === 'none' ? ' on' : ''}`} onClick={() => call('none')}>
          Nobody
        </button>
      </div>
    </div>
  );
}

function RoughAirPicker({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const you = game.you!;
  const starts = game.options?.roughair ?? [];
  const chosen = game.mine?.roughair ?? null;
  const [focus, setFocus] = useState<number | null>(null);
  if (you.roughAirUsed) return <p class="muted used-note">Rough air: used on this flight.</p>;
  if (starts.length === 0) return null;
  const shown = focus ?? chosen;
  return (
    <div class="ability-card">
      <div class="ability-title">
        Rough air <span class="once-tag">Once per flight</span>
      </div>
      <p class="muted">Fly through turbulence over three rows: everyone there is buckled in tonight, allies included. Tap a row on the map.</p>
      <SeatMap
        game={game}
        rowPick={{ options: new Set(starts), selected: shown, onPick: setFocus }}
        preview={shown !== null ? sectionPlaces(game, shown) : undefined}
        tone="blast"
      />
      <div class="row">
        {focus !== null && focus !== chosen && (
          <button
            class="btn"
            onClick={() => {
              void send({ kind: 'roughair', startRow: focus });
              setFocus(null);
            }}
          >
            Fly rough air over {rowsText(focus)}
          </button>
        )}
        {chosen !== null && (
          <>
            <span class="done-ok">✓ Rough air over {rowsText(chosen)} tonight.</span>
            <button class="btn ghost small" onClick={() => void send({ kind: 'roughair', startRow: null })}>
              Call it off
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CoursePicker({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const you = game.you!;
  const offered = game.options?.course ?? [];
  const chosen = game.mine?.course ?? null;
  const nights = game.phase.nights;
  if (you.courseUsed) return <p class="muted used-note">Course change: used on this flight. We land after night {nights}.</p>;
  if (offered.length === 0 && chosen === null) return null;
  const choices = [
    { key: 'hold', title: 'Hold', sub: `Circle for a night: land after night ${nights + 1} instead of ${nights}.` },
    {
      key: 'shortcut',
      title: 'Shortcut',
      sub: offered.includes('shortcut') ? `Land after night ${nights - 1} instead of ${nights}.` : 'Too late: we land after tonight.',
    },
  ] as const;
  return (
    <div class="ability-card">
      <div class="ability-title">
        Change course <span class="once-tag">Once per flight</span>
      </div>
      <p class="muted">The whole plane hears when the landing changes.</p>
      <div class="choice-grid two">
        {choices.map((c) => (
          <button
            key={c.key}
            class={`choice${chosen === c.key ? ' on' : ''}`}
            disabled={!offered.includes(c.key) && chosen !== c.key}
            onClick={() => void send({ kind: 'course', change: chosen === c.key ? null : c.key })}
          >
            <span class="choice-head">
              <b>{c.title}</b>
              <span class="choice-tag">{chosen === c.key ? '✓ Tonight' : 'Change'}</span>
            </span>
            <span class="choice-sub">{c.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** In the dark: aim the cabin cameras at three rows. */
export function CameraPanel({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const you = game.you!;
  const mine = game.mine!;
  const [focus, setFocus] = useState<number | null>(null);
  if (you.buckled) {
    return (
      <div class="callout amber">
        <b>Turbulence.</b> No time for the cameras tonight.
      </div>
    );
  }
  if (you.knockedOut) {
    return (
      <div class="callout red">
        <b>You are out cold.</b> The cameras will have to wait.
      </div>
    );
  }
  const starts = (game.options?.actions ?? []).flatMap((a) => (a.kind === 'watch' ? [a.startRow] : []));
  const current = mine.action?.kind === 'watch' ? mine.action.startRow : null;
  const shown = focus ?? current;
  return (
    <div class="stack">
      <div class="panel-title">
        Cabin cameras <span class="muted">Watch three rows tonight. At dawn you see who did what there, and to whom.</span>
      </div>
      <SeatMap
        game={game}
        rowPick={{ options: new Set(starts), selected: shown, onPick: setFocus }}
        preview={shown !== null ? sectionPlaces(game, shown) : undefined}
        tone="check"
      />
      <div class="done-row">
        {focus !== null && focus !== current ? (
          <button
            class="btn primary"
            onClick={() => {
              void send({ kind: 'act', action: { kind: 'watch', startRow: focus } });
              setFocus(null);
            }}
          >
            Watch {rowsText(focus)}
          </button>
        ) : mine.acted ? (
          mine.action ? (
            <span class="done-ok">✓ Tonight you will {describeAction(game, mine.action)}.</span>
          ) : (
            <span>You are resting tonight. Tap a row to aim the cameras after all.</span>
          )
        ) : (
          <>
            <span>Tap a row on the map to aim the cameras.</span>
            <button class="btn" onClick={() => void send({ kind: 'act', action: null })}>
              Rest tonight
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Up in the jump seat: treat the Pilot (a Nurse), knock him out (a saboteur), or sit tight. */
export function JumpSeatPanel({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const mine = game.mine!;
  const actions = game.options?.actions ?? [];
  const knock = actions.find((a) => a.kind === 'knockout');
  const treat = actions.find((a) => a.kind === 'treat');
  return (
    <div class="stack">
      <div class="callout green">
        <b>You are up on the flight deck.</b> The captain called you to the jump seat for the night: nobody in the cabin can reach you, and you will be
        back in your seat by morning. Your own ability waits until then.
      </div>
      {(treat || knock) && (
        <div class="row">
          {treat && (
            <button class={`btn${mine.action?.kind === 'treat' ? ' primary' : ''}`} onClick={() => void send({ kind: 'act', action: treat })}>
              Treat the Pilot
            </button>
          )}
          {knock && (
            <button class={`btn danger${mine.action?.kind === 'knockout' ? ' on' : ''}`} onClick={() => void send({ kind: 'act', action: knock })}>
              Knock the Pilot out cold
            </button>
          )}
        </div>
      )}
      {knock && <p class="muted">He is out of action tomorrow night too, and he will know it was you.</p>}
      <div class="done-row">
        {mine.acted ? (
          mine.action ? (
            <span class="done-ok">✓ Tonight you will {describeAction(game, mine.action)}.</span>
          ) : (
            <span>You are sitting tight tonight.</span>
          )
        ) : (
          <>
            <span>Nothing to do up here? Sit tight so the night can end sooner.</span>
            <button class="btn" onClick={() => void send({ kind: 'act', action: null })}>
              Sit tight
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** By day: an announcement over the PA, for the whole plane. */
export function PaPanel({ ctx }: { ctx: TVContext }) {
  const { send } = ctx;
  const [text, setText] = useState('');
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await send({ kind: 'chat', channel: 'pa', text })) setText('');
  };
  return (
    <form class="ability-card pa-card" onSubmit={(e) => void submit(e)}>
      <div class="ability-title">📢 PA announcement</div>
      <p class="muted">
        Everyone on board sees it, the dead included. The PA needs {PA_COOLDOWN_MS / 1000} seconds between announcements.
      </p>
      <div class="row pa-row">
        <input
          class="input"
          value={text}
          maxLength={PA_MAX_LENGTH}
          placeholder="Ladies and gentlemen, this is your captain…"
          aria-label="Announcement"
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <button class="btn primary" type="submit" disabled={!text.trim()}>
          Announce
        </button>
      </div>
    </form>
  );
}
