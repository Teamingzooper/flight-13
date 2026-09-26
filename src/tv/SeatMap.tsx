import type { VNode } from 'preact';
import { TOP } from '../app/Avatar';
import { useMediaQuery } from '../app/hooks';
import { grid, type PlayerSummary, type PlayerView, type SeatId } from '../engine';
import { shortName } from './format';
import { IconBomb, IconCart } from './icons';

export interface SeatPick {
  /** Seats, aisle spots (crew) and 'washroom' you can go to. */
  options: ReadonlySet<SeatId>;
  selected: SeatId | null;
  onPick: (seat: SeatId) => void;
}

export interface PlayerPick {
  options: ReadonlySet<string>;
  selected: string | null;
  onPick: (playerId: string) => void;
}

/** Places an ability can target: your own seat, the drink cart, the lavatory. */
export type Spot = 'seat' | 'cart' | 'lavatory';

export interface SpotPick {
  spots: ReadonlySet<Spot>;
  selected: Spot | null;
  onPick: (spot: Spot) => void;
}

/** Pick three rows at once (the Pilot's cameras and rough air): tap any seat or row number. */
export interface RowPick {
  /** Valid first rows of a three-row section. */
  options: ReadonlySet<number>;
  selected: number | null;
  onPick: (startRow: number) => void;
}

const LETTERS = ['A', 'B', 'C', '', 'D', 'E', 'F'];

/** The cabin as the seatback TV draws it: front on the left (top when the screen is tall). */
export function SeatMap({
  game,
  seatPick,
  playerPick,
  spotPick,
  rowPick,
  preview,
  tone,
}: {
  game: PlayerView;
  seatPick?: SeatPick;
  playerPick?: PlayerPick;
  spotPick?: SpotPick;
  rowPick?: RowPick;
  preview?: ReadonlySet<SeatId>;
  /** What the highlighted seats mean: somewhere being checked, or a blast. */
  tone?: 'check' | 'blast';
}) {
  const vertical = useMediaQuery('(max-aspect-ratio: 1/1)');
  const { rows, cartRow, cartDestroyed, lavatoryDestroyed } = game.cabin;
  const seatCols: readonly number[] = game.cabin.cols ?? grid.SEAT_COLS;
  const youId = game.you?.id ?? null;
  const saboteurView = game.you?.team === 'saboteurs';
  const occupant = new Map<SeatId, PlayerSummary>();
  for (const p of game.players) if (p.seat) occupant.set(p.seat, p);
  const scorched = new Set(game.cabin.scorched.map((c) => `${c.row}:${c.col}`));
  // (A defused bomb is dead: not shown as a threat.)
  const live = game.bombs.filter((b) => !b.exploded && !b.defused);
  const seatBombs = new Set(live.flatMap((b) => (b.location.kind === 'seat' ? [b.location.seat] : [])));
  const cartBomb = live.some((b) => b.location.kind === 'cart');
  const lavBomb = live.some((b) => b.location.kind === 'lavatory');
  const away = game.washroom;
  const inLav = away ? game.players.find((p) => p.id === away) : undefined;
  // The flight deck: the Pilot, and tonight's guest in the jump seat.
  const pilot = game.players.find((p) => grid.isCockpit(p.seat));
  const guest = game.jumpseat ? game.players.find((p) => p.id === game.jumpseat) : undefined;
  // A tapped row picks the three-row section around it.
  const rowStarts = rowPick ? [...rowPick.options] : [];
  const startFor = (r: number) => Math.min(Math.max(r - 1, Math.min(...rowStarts)), Math.max(...rowStarts));
  const pickRow = rowPick && rowStarts.length > 0 ? (r: number) => rowPick.onPick(startFor(r)) : null;

  /** Cabin row r (-1 = flight deck, 0 = galley, rows + 1 = rear) and column c (-1 = labels) on the CSS grid. */
  const at = (r: number, c: number, span = 1) => {
    const along = `${r + 3}`;
    const across = span > 1 ? `${c + 2} / span ${span}` : `${c + 2}`;
    return vertical ? { gridRow: along, gridColumn: across } : { gridColumn: along, gridRow: across };
  };

  const cells: VNode[] = [];
  for (let r = 1; r <= rows; r++) {
    cells.push(
      pickRow ? (
        <button key={`n${r}`} type="button" class="sm-num pick" style={at(r, -1)} aria-label={`Rows around ${r}`} onClick={() => pickRow(r)}>
          {r}
        </button>
      ) : (
        <div key={`n${r}`} class="sm-num" style={at(r, -1)}>
          {r}
        </div>
      ),
    );
  }
  LETTERS.forEach((letter, c) => {
    if (letter && seatCols.includes(c)) {
      cells.push(
        <div key={`l${c}`} class="sm-letter" style={at(-2, c)}>
          {letter}
        </div>,
      );
    }
  });
  const spotClass = (spot: Spot) =>
    spotPick?.spots.has(spot) ? ` pick${spotPick.selected === spot ? ' selected' : ''}` : '';
  const goWashroom = seatPick?.options.has('washroom') ?? false;
  const lavLabel = (
    <>
      <span>WC</span>
      {inLav && <span class="sm-lav-who">{inLav.id === youId ? 'You' : shortName(inLav.name)}</span>}
      {lavBomb && <IconBomb />}
    </>
  );
  const pilotYou = !!pilot && pilot.id === youId;
  cells.push(
    <div
      key="cockpit"
      class="sm-block sm-cockpit"
      style={at(-1, 0, 7)}
      title={pilot ? `Flight deck · ${pilot.name}${pilotYou ? ' (you)' : ''}, Pilot${guest ? ` · ${guest.name} in the jump seat` : ''}` : 'Flight deck'}
    >
      <span class="sm-cockpit-label">Flight deck</span>
      {pilot && (
        <span
          class={`sm-crew-dot${pilot.status === 'dead' ? ' dead' : ''}${pilotYou ? ' you' : ''}`}
          style={{ background: pilot.status === 'dead' ? undefined : TOP[pilot.look.top] ?? TOP[0] }}
        >
          {pilot.status === 'dead' ? '✕' : pilot.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      {guest && <span class="sm-cockpit-guest">{guest.id === youId ? 'You' : shortName(guest.name)}</span>}
    </div>,
    <div key="galley" class="sm-block sm-galley" style={at(0, 0, 7)}>
      <span>Galley</span>
    </div>,
    spotPick?.spots.has('lavatory') || goWashroom ? (
      <button
        key="lav"
        type="button"
        class={`sm-block sm-lav${goWashroom ? ` pick${seatPick!.selected === 'washroom' ? ' selected' : ''}` : spotClass('lavatory')}`}
        style={at(rows + 1, 0, 3)}
        aria-label={goWashroom ? 'Spend the night in the lavatory' : 'The lavatory'}
        onClick={() => (goWashroom ? seatPick!.onPick('washroom') : spotPick!.onPick('lavatory'))}
      >
        {lavLabel}
      </button>
    ) : (
      <div
        key="lav"
        class={`sm-block sm-lav${lavatoryDestroyed ? ' destroyed' : ''}${inLav ? ' occupied' : ''}`}
        style={at(rows + 1, 0, 3)}
        title={inLav ? `${inLav.name} is locked in the lavatory` : undefined}
      >
        {lavLabel}
      </div>
    ),
    <div key="crew" class="sm-block sm-crew" style={at(rows + 1, 4, 3)}>
      <span>Crew</span>
    </div>,
  );

  for (let r = 1; r <= rows; r++) {
    for (let c = 0; c < 7; c++) {
      if (c === grid.AISLE_COL) {
        const cart = !cartDestroyed && cartRow === r;
        const spot = grid.aisleSpot(r);
        // The Stewardess works the aisle: everyone can see where she stands.
        const crew = occupant.get(spot);
        const crewYou = !!crew && crew.id === youId;
        const pickSpot = seatPick?.options.has(spot) ?? false;
        const pickCrew = !!crew && (playerPick?.options.has(crew.id) ?? false);
        const onPick = pickSpot ? () => seatPick!.onPick(spot) : pickCrew ? () => playerPick!.onPick(crew!.id) : undefined;
        const selected = seatPick?.selected === spot || (!!crew && playerPick?.selected === crew.id);
        const classes = ['sm-aisle'];
        if (scorched.has(`${r}:${c}`)) classes.push('scorched');
        if (onPick) classes.push('pick');
        if (selected) classes.push('selected');
        if (preview?.has(spot)) classes.push('preview');
        const crewDot = crew && (
          <span
            class={`sm-crew-dot${crew.status === 'dead' ? ' dead' : ''}${crewYou ? ' you' : ''}`}
            style={{ background: crew.status === 'dead' ? undefined : TOP[crew.look.top] ?? TOP[0] }}
          >
            {crew.status === 'dead' ? '✕' : game.blackout && !crewYou ? '?' : crew.name.slice(0, 1).toUpperCase()}
          </span>
        );
        const cartIcon =
          cart &&
          (spotPick?.spots.has('cart') && !onPick ? (
            <button type="button" class={`sm-cart${spotClass('cart')}`} title="Drink cart" aria-label="The drink cart" onClick={() => spotPick.onPick('cart')}>
              <IconCart />
              {cartBomb && <IconBomb />}
            </button>
          ) : (
            <span class="sm-cart" title="Drink cart">
              <IconCart />
              {cartBomb && <IconBomb />}
            </span>
          ));
        const label = `Row ${r} aisle${crew ? ` · ${crew.name}${crewYou ? ' (you)' : ''}, stewardess${crew.status === 'dead' ? ' (dead)' : ''}` : ''}${cart ? ' · drink cart' : ''}`;
        cells.push(
          onPick ? (
            <button key={`a${r}`} type="button" class={classes.join(' ')} style={at(r, c)} title={label} aria-label={label} onClick={onPick}>
              {crewDot}
              {cartIcon}
            </button>
          ) : (
            <div key={`a${r}`} class={classes.join(' ')} style={at(r, c)} title={crew || cart ? label : undefined}>
              {crewDot}
              {cartIcon}
            </div>
          ),
        );
        continue;
      }
      // (The private jet has no middle seats: its wide aisle stays empty.)
      if (!seatCols.includes(c)) continue;
      const seat = grid.seatId({ row: r, col: c });
      const p = occupant.get(seat);
      const you = !!p && p.id === youId;
      const gone = !!p && (p.id === away || p.id === game.jumpseat);
      const hidden = game.blackout && !!p && !you;
      const pickSeat = seatPick?.options.has(seat) ?? false;
      const pickPlayer = !!p && (playerPick?.options.has(p.id) ?? false);
      const pickOwn = you && (spotPick?.spots.has('seat') ?? false);
      const selected = seatPick?.selected === seat || (!!p && playerPick?.selected === p.id) || (pickOwn && spotPick?.selected === 'seat');
      const classes = ['sm-seat', p ? (p.status === 'dead' ? 'dead' : 'taken') : 'empty'];
      if (you) classes.push('you');
      if (saboteurView && p && !you && p.team === 'saboteurs') classes.push('mate');
      if (pickSeat || pickPlayer || pickOwn) classes.push('pick');
      if (selected) classes.push('selected');
      if (preview?.has(seat)) classes.push('preview');
      if (gone) classes.push('away');
      if (scorched.has(`${r}:${c}`)) classes.push('scorched');
      const who = !p
        ? 'empty'
        : hidden
          ? 'someone'
          : `${p.name}${p.status === 'dead' ? ' (dead)' : ''}${you ? ' (you)' : ''}${gone ? (p.id === away ? ' (in the lavatory tonight)' : ' (on the flight deck tonight)') : ''}`;
      const onPick = pickSeat
        ? () => seatPick!.onPick(seat)
        : pickPlayer
          ? () => playerPick!.onPick(p!.id)
          : pickOwn
            ? () => spotPick!.onPick('seat')
            : pickRow
              ? () => pickRow(r)
              : undefined;
      if (pickRow) classes.push('row-pick');
      cells.push(
        <button
          key={seat}
          type="button"
          class={classes.join(' ')}
          style={at(r, c)}
          title={`${seat} · ${who}`}
          aria-label={`${seat}, ${who}`}
          disabled={!onPick}
          onClick={onPick}
        >
          {p && !hidden && <span class="sm-stripe" style={{ background: TOP[p.look.top] ?? TOP[0] }} />}
          <span class="sm-name">{!p ? '' : p.status === 'dead' ? '✕' : hidden ? '?' : shortName(p.name)}</span>
          {seatBombs.has(seat) && <IconBomb />}
        </button>,
      );
    }
  }

  return (
    <div class={`seatmap${vertical ? ' vertical' : ''}${tone ? ` tone-${tone}` : ''}`} style={{ '--rows': String(rows) }}>
      {cells}
    </div>
  );
}

export function MapLegend({ game }: { game: PlayerView }) {
  return (
    <div class="sm-legend">
      <span>
        <i class="lg you" />
        You
      </span>
      <span>
        <i class="lg" />
        Passenger
      </span>
      <span>
        <i class="lg empty" />
        Empty seat
      </span>
      <span>
        <i class="lg dead" />
        Dead
      </span>
      {game.you?.team === 'saboteurs' && (
        <span>
          <i class="lg mate" />
          Saboteur ally
        </span>
      )}
      <span>
        <i class="sm-crew-dot lg-crew">S</i>
        Stewardess
      </span>
      <span>
        <IconCart size={14} />
        Drink cart (blocks the aisle)
      </span>
      {game.bombs.some((b) => !b.exploded && !b.defused) && (
        <span>
          <IconBomb />
          Bomb you know about
        </span>
      )}
    </div>
  );
}
