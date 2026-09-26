import { useEffect, useState } from 'preact/hooks';
import { NOTE_MAX_LENGTH, bombsFor, customAbility, roleInfo, type CustomAbility, type RoleId, describeLocation, destinationOf, grid, isPilot, type NightAction, type PlayerView } from '../engine';
import { CarryOn } from './CarryOn';
import { LunchPanel } from './Lunch';
import type { TVContext } from './context';
import { describeAction, nameWithSeat, placeLabel, roleName, shortName, teamName, whenLabel } from './format';
import { CameraPanel, ControlsCard, FlightDeckPanel, JumpSeatPanel, PaPanel } from './PilotPanels';
import { SeatMap, type Spot } from './SeatMap';

type TargetAction = Extract<NightAction, { target: string }>;
type Check = 'sweep' | 'cart' | 'lavatory';
type BombSpot = 'seat' | 'cart' | 'lavatory';

export function ActionTab({ ctx }: { ctx: TVContext }) {
  const { game } = ctx;
  const you = game.you;
  if (!you) {
    return (
      <div class="tab">
        <TowerPanel />
      </div>
    );
  }
  if (you.status !== 'alive') {
    return (
      <div class="tab">
        <GhostPanel game={game} />
      </div>
    );
  }
  const kind = game.phase.kind;
  const pilot = isPilot(you.role);
  const day = kind === 'dawn' || kind === 'day_discuss' || kind === 'day_vote' || kind === 'verdict';
  // In the 3D cockpit the captain's calls are made on the flight deck itself, not on this screen.
  const deck = pilot && !!ctx.embedded && grid.isCockpit(you.seat);
  return (
    <div class="tab action-tab">
      <RoleStrip game={game} />
      <BlackBoxNote ctx={ctx} />
      {deck && (day || ((kind === 'night_move' || kind === 'night_act') && !you.drowsy)) && <ControlsCard ctx={ctx} />}
      {pilot && day && !deck && <PaPanel ctx={ctx} />}
      {day && game.meal && <LunchPanel ctx={ctx} />}
      {(kind === 'night_move' || kind === 'night_act') && you.drowsy && <FastAsleep />}
      {kind === 'night_move' &&
        !you.drowsy &&
        (deck ? null : pilot ? <FlightDeckPanel ctx={ctx} /> : you.buckled ? <Buckled game={game} /> : <MovePanel ctx={ctx} />)}
      {kind === 'night_act' &&
        !you.drowsy &&
        (deck ? null : pilot ? (
          <CameraPanel ctx={ctx} />
        ) : you.inJumpSeat ? (
          <JumpSeatPanel ctx={ctx} />
        ) : you.buckled ? (
          <Buckled game={game} />
        ) : (
          <AbilityPanel ctx={ctx} />
        ))}
      <CarryOn ctx={ctx} />
      {kind !== 'night_move' && kind !== 'night_act' && <Notes game={game} />}
    </div>
  );
}

function RoleStrip({ game }: { game: PlayerView }) {
  const you = game.you!;
  const info = roleInfo(you.role, game.settings);
  return (
    <div class={`role-strip ${you.team}`}>
      <div>
        <div class="label">Your role</div>
        <div class="role-name">{info.name}</div>
        <div class="role-meta">
          <span class={`team-tag ${you.team}`}>{teamName(you.team)}</span>
          <span>{isPilot(you.role) ? 'On the flight deck' : crewRow(game) !== null ? `Working row ${crewRow(game)}` : `Seat ${you.seat ?? '—'}`}</span>
          {!isPilot(you.role) && <span>{you.washroomUsed ? 'Washroom trip used' : 'Washroom trip left'}</span>}
        </div>
      </div>
      <p class="role-how">{info.howTo}</p>
      {you.role === 'pilot' && game.settings.pilotMustFly && (
        <div class="callout amber">
          <b>Pilot must fly.</b> If the passengers restrain you, nobody can fly the plane and the saboteurs win.
        </div>
      )}
      {you.poisoned &&
        (isPilot(you.role) ? (
          <div class="callout red">
            <b>You were poisoned.</b> Call the Nurse up to the jump seat tonight so they can treat you, or you will not survive the next dawn.
          </div>
        ) : (
          <div class="callout red">
            <b>You were poisoned.</b> Get the Nurse to sit next to you and treat you tonight
            {you.washroomUsed ? '' : ', or wash it out in the lavatory (your one trip this flight)'}, or you will not survive the next dawn.
          </div>
        ))}
    </div>
  );
}

/** The row the Stewardess is working, or null for everyone else. */
function crewRow(game: PlayerView): number | null {
  const you = game.you;
  return you && (you.role === 'stewardess_loyal' || you.role === 'stewardess_rogue') ? grid.aisleRow(you.seat) : null;
}

/** Drugged at lunch: nothing to do but sleep. */
function FastAsleep() {
  return (
    <div class="callout amber">
      <b>Zzz.</b> Something in your lunch knocked you out. You sleep straight through tonight: no seat change, no ability. Whoever sat near you
      at lunch had the chance to drug it.
    </div>
  );
}

function Buckled({ game }: { game: PlayerView }) {
  const turbulence = game.you!.buckled === 'turbulence';
  return (
    <div class="callout amber">
      {crewRow(game) !== null && !turbulence ? (
        <>
          <b>Ding.</b> The captain told the crew to stay put. You cannot walk the cart or use an ability tonight.
        </>
      ) : (
        <>
          <b>Ding.</b> The seatbelt sign is on over your seat{turbulence ? ' because of turbulence' : ''}. You cannot move or use an ability
          tonight.
        </>
      )}
      {game.you!.items.includes('extender') && ' Your seatbelt extender can free you: see your carry-on below.'}
    </div>
  );
}

function MovePanel({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const you = game.you!;
  const chosen = game.mine?.move ?? null;
  const row = crewRow(game);
  const here = row !== null ? `row ${row}` : you.seat;
  const options = new Set<string>(game.options?.seats ?? []);
  if (game.options?.washroom === null) options.add('washroom');
  const { cartRow, cartDestroyed } = game.cabin;
  const yourRow = you.seat ? grid.parsePlace(you.seat)?.row ?? null : null;
  const blocked = row === null && !cartDestroyed && yourRow !== null && (cartRow > yourRow || (cartRow < yourRow && cartRow > 1));
  const status =
    chosen === null
      ? 'Choose before time runs out, or you stay put.'
      : chosen === 'stay'
        ? 'You will stay put.'
        : chosen === 'washroom'
          ? `You will spend the night locked in the lavatory, and be back ${row !== null ? `at row ${row}` : `in ${you.seat}`} by morning.`
          : grid.isAisleSpot(chosen)
            ? `You will walk the cart to row ${grid.aisleRow(chosen)}.`
            : `You will move to ${chosen}.`;
  return (
    <div class="stack">
      <div class="panel-title">
        {row !== null ? 'Walk the cart?' : 'Change seats?'}
        <span class="muted">
          {row !== null
            ? `Tap any row in the aisle, or stay at row ${row}. You can only work the six seats beside you.`
            : `Tap an empty seat, or stay in ${you.seat}.`}
        </span>
      </div>
      <SeatMap
        game={game}
        seatPick={{ options, selected: chosen && chosen !== 'stay' ? chosen : null, onPick: (seat) => void send({ kind: 'move', to: seat }) }}
      />
      {blocked && (
        <p class="muted cart-note">
          The drink cart at row {cartRow} fills the aisle: nobody can walk past it{cartRow > (yourRow ?? 0) ? ', not even to the lavatory' : ''}.
        </p>
      )}
      <div class="row">
        <button class={`btn${chosen === 'stay' ? ' primary' : ''}`} onClick={() => void send({ kind: 'move', to: 'stay' })}>
          Stay {row !== null ? 'at' : 'in'} {here}
        </button>
        <span class="muted">{status}</span>
      </div>
      <WashroomCard ctx={ctx} />
    </div>
  );
}

/**
 * The Mastermind, once per flight and instead of planting: take your phone off airplane mode, and the Pilot's cabin
 * cameras show nothing but static tonight.
 */
function JamCard({ ctx, actions }: { ctx: TVContext; actions: NightAction[] }) {
  const { game, send } = ctx;
  const you = game.you!;
  const jam = actions.find((a) => a.kind === 'jam');
  const chosen = game.mine?.action?.kind === 'jam';
  if (you.jamUsed) return <p class="muted used-note">Airplane mode: already switched off on this flight.</p>;
  return (
    <div class={`ability-card jam-card${chosen ? ' on' : ''}`}>
      <div class="ability-title">Take your phone off airplane mode</div>
      <p class="muted">
        Once per flight, instead of planting. Your phone floods the cabin with signal and the Pilot’s cameras show nothing but static tonight: cover
        for whatever your team is up to. The Pilot finds out the cameras were jammed, not who jammed them.
      </p>
      <div class="row">
        <button class={`btn${chosen ? ' primary' : ''}`} disabled={!jam} onClick={() => void send({ kind: 'act', action: { kind: 'jam' } })}>
          {chosen ? '✓ Airplane mode off tonight' : 'Switch airplane mode off'}
        </button>
        {!jam && <span class="muted">No Pilot is watching the cameras.</span>}
      </div>
    </div>
  );
}

/** Once per flight: hide in the lavatory for the night instead of moving. */
function WashroomCard({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const you = game.you!;
  const why = game.options?.washroom ?? 'Not now.';
  const chosen = game.mine?.move === 'washroom';
  if (you.washroomUsed) return null;
  return (
    <div class={`ability-card washroom-card${chosen ? ' on' : ''}`}>
      <div class="ability-title">Go to the washroom</div>
      <p class="muted">
        Once per flight, instead of moving. Lock yourself in the lavatory for the night: nobody can poison, cuff or treat you, a bomb at your seat
        misses you, and any poison washes out. You can only search the lavatory tonight, and a bomb in there would still get you. Everyone
        sees you go.
      </p>
      <div class="row">
        <button class={`btn${chosen ? ' primary' : ''}`} disabled={why !== null} onClick={() => void send({ kind: 'move', to: 'washroom' })}>
          {chosen ? '✓ Going tonight' : 'Spend the night in the lavatory'}
        </button>
        {why && <span class="muted">{why}</span>}
        {chosen && (
          <button class="btn ghost small" onClick={() => void send({ kind: 'move', to: 'stay' })}>
            Never mind
          </button>
        )}
      </div>
    </div>
  );
}

function AbilityPanel({ ctx }: { ctx: TVContext }) {
  const { game } = ctx;
  const you = game.you!;
  const mine = game.mine!;
  const actions = game.options?.actions ?? [];
  // Looking under your seat is answered at once and spends the night.
  if (you.searched) return <SearchResult game={game} />;
  const canSearch = actions.some((a) => a.kind === 'search');
  if (you.inWashroom) return <WashroomNight ctx={ctx} actions={actions} />;
  let hasAbility = true;
  let body;
  // The host's own roles use the panel of the role they borrowed their ability from.
  const custom = customAbility(game.settings, you.role);
  const as = custom === null ? you.role : CUSTOM_PANEL[custom];
  if (you.usesLeft === 0) {
    return (
      <div class="stack">
        <p class="muted">You have used up your ability for this flight. Keep your eyes open.</p>
        {canSearch && <SearchCard ctx={ctx} instead={false} />}
        <RestRow ctx={ctx} hasAbility={false} />
      </div>
    );
  }
  switch (as) {
    case 'poison':
      body = (
        <TargetPicker
          ctx={ctx}
          title="Slip someone poison"
          hint="Anyone within 1 seat. They fall sick at dawn and die the next dawn unless they are treated, wash it out in the lavatory, or carry an antidote. On the cameras it looks like leaning over."
          actions={actions.filter((a) => a.kind === 'poison')}
          empty="Nobody is within 1 seat. Sit next to someone tomorrow night."
        />
      );
      break;
    case 'nurse':
      body = <TargetPicker ctx={ctx} title="Treat someone" actions={actions} empty="Nobody is within reach. Sit next to someone tomorrow night." />;
      break;
    case 'stewardess_loyal':
      body = <RowCheckPicker ctx={ctx} actions={actions} />;
      break;
    case 'stewardess_rogue':
      body = (
        <TargetPicker
          ctx={ctx}
          title="Serve a poisoned drink"
          hint={`Only to someone sitting in row ${crewRow(game)}, beside your cart.`}
          actions={actions}
          empty={`Nobody is sitting in row ${crewRow(game)} tonight. Walk the cart to a busier row tomorrow night.`}
        />
      );
      break;
    case 'investigator':
      body = <InvestigatorPicker ctx={ctx} actions={actions} />;
      break;
    case 'bomber':
      body = <BombPicker ctx={ctx} actions={actions} />;
      break;
    case 'mastermind':
      body = (
        <>
          <BombPicker ctx={ctx} actions={actions} />
          <JamCard ctx={ctx} actions={actions} />
        </>
      );
      break;
    case 'marshal':
      body = you.cuffsUsed && you.usesLeft === null ? (
        <p class="muted">You already used your handcuffs. Keep your eyes open.</p>
      ) : (
        <TargetPicker
          ctx={ctx}
          title="Handcuff someone"
          hint="Once per game, anyone within 2 seats. They cannot act tonight and are walked to the rear galley at dawn. Cuff a passenger and the passengers lose a player."
          actions={actions.filter((a) => a.kind === 'cuff')}
          empty="Nobody is within 2 seats. Move closer to your suspect tomorrow night."
        />
      );
      break;
    case 'pilot':
      hasAbility = false;
      body = <p class="muted">Your seatbelt call is in.</p>;
      break;
    default:
      hasAbility = false;
      body = <p class="muted">You have no special ability.</p>;
  }
  return (
    <div class="stack">
      {body}
      {hasAbility && you.usesLeft !== null && custom !== 'bomb' && (
        <p class="muted small">
          {you.usesLeft === 1 ? 'Your last use this flight.' : `${you.usesLeft} uses left this flight.`}
        </p>
      )}
      {/* Looking under your seat is the other option, until you have picked your ability tonight. */}
      {canSearch && !(hasAbility && mine.action) && <SearchCard ctx={ctx} instead={hasAbility} />}
      <RestRow ctx={ctx} hasAbility={hasAbility} />
    </div>
  );
}

/** The panel a custom ability uses (the built-in role it borrowed it from). */
const CUSTOM_PANEL: Record<CustomAbility, RoleId | 'poison'> = {
  none: 'passenger',
  treat: 'nurse',
  sweep: 'investigator',
  cuff: 'marshal',
  bomb: 'bomber',
  poison: 'poison',
};

/** What you are doing tonight, and Rest. */
function RestRow({ ctx, hasAbility }: { ctx: TVContext; hasAbility: boolean }) {
  const { game, send } = ctx;
  const mine = game.mine!;
  return (
    <div class="done-row">
      {mine.acted ? (
        mine.action ? (
          <span class="done-ok">✓ Tonight you will {describeAction(game, mine.action)}. You can change your mind until dawn.</span>
        ) : (
          <span>You are resting tonight. Changed your mind? Pick something above.</span>
        )
      ) : (
        <>
          <span>{hasAbility ? 'Pick what to do above, or rest tonight.' : 'Nothing you want to do? Rest, so the night can end sooner.'}</span>
          <button class="btn" onClick={() => void send({ kind: 'act', action: null })}>
            Rest tonight
          </button>
        </>
      )}
    </div>
  );
}

function TargetPicker({ ctx, title, hint, actions, empty }: { ctx: TVContext; title: string; hint?: string; actions: NightAction[]; empty: string }) {
  const { game, send } = ctx;
  const targeted = actions.filter((a): a is TargetAction => 'target' in a);
  const byTarget = new Map(targeted.map((a) => [a.target, a]));
  const current = game.mine?.action;
  const selected = current && 'target' in current ? current.target : null;
  const choose = (id: string) => {
    const action = byTarget.get(id);
    if (action) void send({ kind: 'act', action });
  };
  if (targeted.length === 0) return <p class="muted">{empty}</p>;
  return (
    <div class="stack">
      <div class="panel-title">
        {title}
        {hint && <span class="muted">{hint}</span>}
      </div>
      <div class="chips">
        {targeted.map((a) => (
          <button key={a.target} class={`chip${selected === a.target ? ' on' : ''}`} onClick={() => choose(a.target)}>
            {a.target === game.you?.id ? 'Yourself' : nameWithSeat(game, a.target)}
          </button>
        ))}
      </div>
      <SeatMap game={game} playerPick={{ options: new Set(byTarget.keys()), selected, onPick: choose }} />
    </div>
  );
}

/** The loyal Stewardess checks under the three seats on one side of her row. */
function RowCheckPicker({ ctx, actions }: { ctx: TVContext; actions: NightAction[] }) {
  const { game, send } = ctx;
  const [focus, setFocus] = useState<'left' | 'right' | null>(null);
  const row = crewRow(game);
  const current = game.mine?.action ?? null;
  const chosen = current?.kind === 'check' ? current.side : null;
  if (row === null) return <p class="muted">Walk the cart to a row first.</p>;
  const sides = (['left', 'right'] as const).map((side) => {
    const seats = grid.rowSeats(row, side, game.cabin.cols);
    const sitters = seats.flatMap((seat) => {
      const p = game.players.find((q) => q.seat === seat && q.status === 'alive');
      return p ? [p.id === game.you?.id ? 'you' : shortName(p.name)] : [];
    });
    return { side, seats, sitters, action: actions.find((a) => a.kind === 'check' && a.side === side) };
  });
  const shown = focus ?? chosen ?? 'left';
  return (
    <div class="stack">
      <div class="panel-title">
        Check under the seats <span class="muted">One side of row {row} tonight. You find out at dawn.</span>
      </div>
      <div class="choice-grid two">
        {sides.map((c) => (
          <button
            key={c.side}
            class={`choice${chosen === c.side ? ' on' : ''}`}
            disabled={!c.action}
            onMouseEnter={() => setFocus(c.side)}
            onMouseLeave={() => setFocus(null)}
            onFocus={() => setFocus(c.side)}
            onBlur={() => setFocus(null)}
            onClick={() => c.action && void send({ kind: 'act', action: c.action })}
          >
            <span class="choice-head">
              <b>
                {c.side === 'left' ? 'Left' : 'Right'}: {c.seats.join(', ')}
              </b>
              <span class="choice-tag">{chosen === c.side ? '✓ Tonight' : 'Check'}</span>
            </span>
            <span class="choice-sub">{c.sitters.length ? `Sitting there: ${c.sitters.join(', ')}.` : 'Nobody sitting there.'}</span>
          </button>
        ))}
      </div>
      <SeatMap game={game} preview={new Set(grid.rowSeats(row, shown, game.cabin.cols))} tone="check" />
    </div>
  );
}

/** Locked in the lavatory: search it (or, for a bomber, leave a bomb in it). */
function WashroomNight({ ctx, actions }: { ctx: TVContext; actions: NightAction[] }) {
  const { game, send } = ctx;
  const mine = game.mine!;
  const canPlant = actions.some((a) => a.kind === 'plant');
  return (
    <div class="stack">
      <div class="callout green">
        <b>You are locked in the lavatory.</b> Nobody can reach you tonight, and you will be back in your seat by morning.
      </div>
      {canPlant && <BombPicker ctx={ctx} actions={actions} />}
      <div class="ability-card search-card">
        <div class="ability-title">Search the lavatory</div>
        <p class="muted">Check every panel for anything left behind. You find out at once, but it uses up your night{canPlant ? ' instead of planting' : ''}.</p>
        <div class="row">
          <button class={`btn${canPlant ? '' : ' primary'}`} onClick={() => void send({ kind: 'act', action: { kind: 'search' } })}>
            Search it
          </button>
        </div>
      </div>
      <div class="done-row">
        {mine.acted ? (
          mine.action ? (
            <span class="done-ok">✓ Tonight you will {describeAction(game, mine.action)}.</span>
          ) : (
            <span>You are waiting out the night.</span>
          )
        ) : (
          <>
            <span>Or just wait for morning.</span>
            <button class="btn" onClick={() => void send({ kind: 'act', action: null })}>
              Wait it out
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The Investigator checks one place a night: tap a card (or the place on the map). */
function InvestigatorPicker({ ctx, actions }: { ctx: TVContext; actions: NightAction[] }) {
  const { game, send } = ctx;
  const [focus, setFocus] = useState<Check | null>(null);
  const you = game.you!;
  const { rows, cartRow, cartDestroyed, lavatoryDestroyed } = game.cabin;
  const current = game.mine?.action ?? null;
  const chosen: Check | null = current?.kind === 'sweep' ? 'sweep' : current?.kind === 'inspect' ? current.what : null;
  const find = (key: Check) => actions.find((a) => (key === 'sweep' ? a.kind === 'sweep' : a.kind === 'inspect' && a.what === key));
  const areas: Record<Check, Set<string>> = {
    sweep: new Set(grid.seatsWithin([grid.parseSeat(you.seat!)!], grid.SWEEP_RADIUS, rows, game.cabin.cols)),
    cart: new Set(grid.seatsWithin([grid.cartCell(cartRow)], 1, rows, game.cabin.cols)),
    lavatory: new Set(grid.seatsWithin(grid.lavatoryCells(rows), 1, rows, game.cabin.cols)),
  };
  const choices: { key: Check; title: string; ok: string; no: string }[] = [
    { key: 'sweep', title: `The seats around ${you.seat}`, ok: 'Your seat and every seat touching it.', no: '' },
    {
      key: 'cart',
      title: 'The drink cart',
      ok: `Row ${cartRow}, right next to you.`,
      no: cartDestroyed ? 'The cart is gone.' : `Too far. Sit in an aisle seat by row ${cartRow} first.`,
    },
    {
      key: 'lavatory',
      title: 'The lavatory',
      ok: 'Right next to you.',
      no: lavatoryDestroyed ? 'The lavatory is destroyed.' : `Too far. Sit in row ${rows}, seats A–C, first.`,
    },
  ];
  const pick = (key: Check) => {
    const action = find(key);
    if (action) void send({ kind: 'act', action });
  };
  const spots = new Set<Spot>();
  if (find('sweep')) spots.add('seat');
  if (find('cart')) spots.add('cart');
  if (find('lavatory')) spots.add('lavatory');
  const shown: Check = focus ?? chosen ?? 'sweep';
  return (
    <div class="stack">
      <div class="panel-title">
        Check one place for bombs <span class="muted">Tap a card or the place on the map. You find out at dawn.</span>
      </div>
      <div class="choice-grid">
        {choices.map((c) => {
          const available = !!find(c.key);
          const on = chosen === c.key;
          return (
            <button
              key={c.key}
              class={`choice${on ? ' on' : ''}`}
              disabled={!available}
              onMouseEnter={() => setFocus(c.key)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(c.key)}
              onBlur={() => setFocus(null)}
              onClick={() => pick(c.key)}
            >
              <span class="choice-head">
                <b>{c.title}</b>
                <span class="choice-tag">{on ? '✓ Tonight' : available ? 'Check' : 'Out of reach'}</span>
              </span>
              <span class="choice-sub">{available ? c.ok : c.no}</span>
            </button>
          );
        })}
      </div>
      <SeatMap
        game={game}
        preview={areas[shown]}
        tone="check"
        spotPick={{ spots, selected: chosen === 'sweep' ? 'seat' : chosen, onPick: (spot) => pick(spot === 'seat' ? 'sweep' : spot) }}
      />
    </div>
  );
}

/** The Bomber picks where and when, sees who would be caught, and plants with one button. */
function BombPicker({ ctx, actions }: { ctx: TVContext; actions: NightAction[] }) {
  const { game, send } = ctx;
  const you = game.you!;
  const night = game.phase.night;
  const { rows, cartRow, cartDestroyed, lavatoryDestroyed } = game.cabin;
  const current = game.mine?.action ?? null;
  const planned = current?.kind === 'plant' ? current : null;
  const [where, setWhere] = useState<BombSpot>(planned?.where ?? 'seat');
  const [fuse, setFuse] = useState<1 | 2>(planned?.fuse ?? 2);
  const [editing, setEditing] = useState(false);
  const total = bombsFor(destinationOf(game.settings).nights);
  const ticking = game.bombs.filter((b) => !b.exploded && !b.defused && b.planterId === you.id);
  const tickingText = ticking.map((b) => `${describeLocation(b.location)} (the end of night ${b.detonateNight})`).join(', ');
  if (you.bombsLeft <= 0 && !planned) {
    return (
      <p class="muted">
        {total === 1 ? 'Your bomb is' : `All ${total} of your bombs are`} planted{tickingText ? `. Still ticking: ${tickingText}` : ''}. Stay hidden, and stay out of
        the blast.
      </p>
    );
  }
  const can = (w: BombSpot) => actions.some((a) => a.kind === 'plant' && a.where === w);
  // One live bomb per spot: yours (or a teammate's) may already be there.
  const taken = (w: BombSpot) =>
    game.bombs.some((b) => !b.exploded && !b.defused && b.location.kind === w && (b.location.kind !== 'seat' || b.location.seat === you.seat));
  // The chosen spot, or the first one open tonight (your seat may already have a bomb under it).
  const place: BombSpot = can(where) ? where : ((['seat', 'cart', 'lavatory'] as const).find(can) ?? (you.inWashroom ? 'lavatory' : 'seat'));
  const placeName: Record<BombSpot, string> = { seat: `under ${you.seat}`, cart: 'on the drink cart', lavatory: 'in the lavatory' };
  const when = (f: 1 | 2) => `the end of night ${night + f}`;
  const blastOf = (spot: BombSpot) => {
    const centers = spot === 'seat' ? [grid.parseSeat(you.seat!)!] : spot === 'cart' ? [grid.cartCell(cartRow)] : grid.lavatoryCells(rows);
    return new Set(grid.placesWithin(centers, grid.BLAST_RADIUS, rows, game.cabin.cols));
  };

  if (planned && !editing) {
    const blast = blastOf(planned.where);
    const youIn = !!you.seat && blast.has(you.seat);
    return (
      <div class="plan-card">
        <div class="plan-title">✓ Bomb planted {placeName[planned.where]}</div>
        <p>
          It goes off at {when(planned.fuse)} ({planned.fuse === 1 ? 'tomorrow night' : 'the night after tomorrow'}), after everyone has
          changed seats.
        </p>
        {youIn && <p class="plan-warn">You are sitting in the blast. Move at least 3 seats away before it goes off.</p>}
        <div class="row">
          <button
            class="btn small"
            onClick={() => {
              setWhere(planned.where);
              setFuse(planned.fuse);
              setEditing(true);
            }}
          >
            Change the plan
          </button>
          <button class="btn ghost small" onClick={() => void send({ kind: 'act', action: null })}>
            Don’t plant tonight
          </button>
        </div>
      </div>
    );
  }

  const blast = blastOf(place);
  const caught = game.players.filter((p) => p.status === 'alive' && p.seat && blast.has(p.seat) && p.id !== you.id && p.id !== game.washroom);
  const youIn = !!you.seat && blast.has(you.seat) && !you.inWashroom;
  const allSpots: { key: BombSpot; title: string; ok: string; no: string }[] = [
    { key: 'seat', title: `Under your seat (${you.seat})`, ok: 'Hits everyone within 2 seats of it.', no: taken('seat') ? 'There is already a bomb under it.' : '' },
    {
      key: 'cart',
      title: 'On the drink cart',
      ok: `At row ${cartRow} now; it goes off wherever the cart has rolled to.`,
      no: cartDestroyed
        ? 'The cart is gone.'
        : taken('cart')
          ? 'There is already a bomb on it.'
          : `Too far. Sit in an aisle seat next to the cart (row ${cartRow}) first.`,
    },
    {
      key: 'lavatory',
      title: 'In the lavatory',
      ok: you.inWashroom ? 'You are in it right now. It destroys the lavatory and hits the back rows.' : 'Destroys it and hits the back rows.',
      no: lavatoryDestroyed
        ? 'The lavatory is already destroyed.'
        : taken('lavatory')
          ? 'There is already a bomb in it.'
          : `Too far. Sit in row ${rows}, seats A–C, first.`,
    },
  ];
  // From inside the lavatory, the lavatory is the only place within reach.
  const spots = you.inWashroom ? allSpots.filter((c) => c.key === 'lavatory') : allSpots;
  const plant = async () => {
    const ok = await send({ kind: 'act', action: { kind: 'plant', where: place, fuse } });
    if (ok) setEditing(false);
  };
  return (
    <div class="stack">
      <div class="panel-title">
        {total === 1 ? 'Plant your bomb' : 'Plant a bomb'}{' '}
        <span class="muted">
          {total === 1 ? 'One per game.' : `${you.bombsLeft} of ${total} left, one a night.`} Choose where and when, then plant it.
        </span>
      </div>
      {ticking.length > 0 && <p class="muted">Already ticking: {tickingText}.</p>}
      <div class="step-label">Where</div>
      <div class="choice-grid">
        {spots.map((c) => {
          const available = can(c.key);
          return (
            <button key={c.key} class={`choice${place === c.key ? ' on' : ''}`} disabled={!available} onClick={() => setWhere(c.key)}>
              <span class="choice-head">
                <b>{c.title}</b>
              </span>
              <span class="choice-sub">{available ? c.ok : c.no}</span>
            </button>
          );
        })}
      </div>
      <div class="step-label">When it goes off</div>
      <div class="choice-grid two">
        {([1, 2] as const).map((f) => (
          <button key={f} class={`choice${fuse === f ? ' on' : ''}`} onClick={() => setFuse(f)}>
            <span class="choice-head">
              <b>{f === 1 ? 'Tomorrow night' : 'The night after'}</b>
            </span>
            <span class="choice-sub">At {when(f)}, after everyone changes seats.</span>
          </button>
        ))}
      </div>
      <SeatMap
        game={game}
        preview={blast}
        tone="blast"
        spotPick={{ spots: new Set((['seat', 'cart', 'lavatory'] as const).filter(can)), selected: place, onPick: (spot) => setWhere(spot) }}
      />
      <p class={`blast-list${youIn ? ' warn' : ''}`}>
        {caught.length
          ? `Caught in the blast right now: ${caught.map((p) => `${p.name} (${placeLabel(p.seat!)})`).join(', ')}.`
          : 'Nobody else is in the blast right now.'}
        {youIn ? ' So are you: move away before it goes off.' : ''}
      </p>
      <div class="row">
        <button class="btn danger" disabled={!can(place)} onClick={() => void plant()}>
          Plant it {placeName[place]} for {when(fuse)}
        </button>
        {planned && (
          <button class="btn ghost small" onClick={() => setEditing(false)}>
            Keep the current plan
          </button>
        )}
      </div>
    </div>
  );
}

/** Look under your own seat: the answer comes at once, but it is the whole night's action. */
function SearchCard({ ctx, instead }: { ctx: TVContext; instead: boolean }) {
  const { game, send } = ctx;
  const seat = game.you!.seat;
  const [sure, setSure] = useState(false);
  const look = () => {
    if (instead && !sure) return setSure(true);
    void send({ kind: 'act', action: { kind: 'search' } });
  };
  return (
    <div class="ability-card search-card">
      <div class="ability-title">Look under your seat</div>
      <p class="muted">
        Check {seat} for anything a previous passenger left behind. You find out at once, but it uses up your night
        {instead ? ' instead of your ability' : ''}.
      </p>
      <div class="row">
        <button class={`btn${instead ? '' : ' primary'}`} onClick={look}>
          {sure ? 'Yes, look under it' : `Look under ${seat}`}
        </button>
        {sure && (
          <button class="btn ghost small" onClick={() => setSure(false)}>
            Never mind
          </button>
        )}
      </div>
    </div>
  );
}

function SearchResult({ game }: { game: PlayerView }) {
  const entry = [...game.log].reverse().find((e) => e.tag === 'search' && Array.isArray(e.to));
  const found = ((entry?.data?.bombs as string[] | undefined) ?? []).length > 0;
  const lavatory = entry?.data?.lavatory === true;
  const headline = lavatory
    ? found
      ? 'There is a bomb in the lavatory.'
      : 'Nothing in the lavatory.'
    : found
      ? 'There is a bomb under your seat.'
      : 'Nothing under your seat.';
  return (
    <div class="stack">
      <div class={`callout ${found ? 'red' : 'amber'}`}>
        <b>{headline}</b> {entry?.text}
      </div>
      <div class="done-row">
        <span>Your night is spent. Wait for dawn{found ? ', and warn the cabin if you live to see it' : ''}.</span>
      </div>
    </div>
  );
}

/** A private note, read out to everyone if you die or are restrained. */
function BlackBoxNote({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const saved = game.you?.note ?? '';
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) setDraft(saved);
  }, [saved, open]);
  if (!open) {
    return (
      <button class="blackbox-row" onClick={() => setOpen(true)}>
        <span class="label">Black box note</span>
        <span class="blackbox-preview">{saved ? `\u201c${saved}\u201d` : 'Leave a note for the cabin in case you are taken out.'}</span>
        <span class="blackbox-edit">{saved ? 'Edit' : 'Write'}</span>
      </button>
    );
  }
  const save = async () => {
    setBusy(true);
    const ok = await send({ kind: 'note', text: draft });
    setBusy(false);
    if (ok) setOpen(false);
  };
  return (
    <div class="ability-card blackbox">
      <div class="ability-title">Black box note</div>
      <p class="muted">Private until you die or are restrained. Then it is read out to the whole cabin.</p>
      <textarea
        class="input blackbox-input"
        rows={3}
        maxLength={NOTE_MAX_LENGTH}
        value={draft}
        placeholder="What you know, who you suspect, what you did…"
        onInput={(e) => setDraft(e.currentTarget.value)}
      />
      <div class="row">
        <button class="btn primary" disabled={busy || draft.trim() === saved} onClick={() => void save()}>
          Save note
        </button>
        <button
          class="btn ghost small"
          onClick={() => {
            setDraft(saved);
            setOpen(false);
          }}
        >
          Cancel
        </button>
        <span class="muted">
          {draft.trim().length}/{NOTE_MAX_LENGTH}
        </span>
      </div>
    </div>
  );
}

function Notes({ game }: { game: PlayerView }) {
  const notes = game.log.filter((e) => Array.isArray(e.to) || e.to === 'saboteurs').slice().reverse();
  return (
    <div class="stack">
      <div class="panel-title">
        Your log <span class="muted">Private results and messages only you can see.</span>
      </div>
      {notes.length === 0 ? (
        <p class="muted">Nothing yet. Your night results will show up here.</p>
      ) : (
        <ol class="notes">
          {notes.map((e) => (
            <li key={e.id} class={`note tag-${e.tag}`}>
              <span class="when">{whenLabel(e)}</span>
              {e.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GhostPanel({ game }: { game: PlayerView }) {
  const you = game.you!;
  const cause = game.players.find((p) => p.id === you.id)?.cause;
  const how =
    cause === 'restrained' ? 'The passengers restrained you.' : cause === 'poison' ? 'The poison got you.' : 'You were caught in an explosion.';
  return (
    <div class="stack">
      <div class="ghost-card">
        <div class="label">You are out</div>
        <h2>{how}</h2>
        <p>
          You were the <b>{roleName(you.role, game.settings)}</b> ({teamName(you.team)}). Keep watching, and talk with the other ghosts in Chat.
        </p>
        {you.note && (
          <blockquote class="blackbox-quote">
            “{you.note}”<cite>Your black box note was read out</cite>
          </blockquote>
        )}
      </div>
      <Notes game={game} />
    </div>
  );
}

function TowerPanel() {
  return (
    <div class="ghost-card">
      <div class="label">Control tower</div>
      <h2>You are running this flight</h2>
      <p>You see only what the whole cabin can see. Follow along on the Map and Flight tabs.</p>
    </div>
  );
}
