import type { VNode } from 'preact';
import { TOP } from '../app/Avatar';
import { useMediaQuery } from '../app/hooks';
import { grid, type PlayerSummary, type PlayerView, type SeatId } from '../engine';
import { shortName } from './format';
import { IconBomb, IconCart } from './icons';

export interface SeatPick {
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

const LETTERS = ['A', 'B', 'C', '', 'D', 'E', 'F'];

/** The cabin as the seatback TV draws it: front on the left (top when the screen is tall). */
export function SeatMap({
  game,
  seatPick,
  playerPick,
  spotPick,
  preview,
  tone,
}: {
  game: PlayerView;
  seatPick?: SeatPick;
  playerPick?: PlayerPick;
  spotPick?: SpotPick;
  preview?: ReadonlySet<SeatId>;
  /** What the highlighted seats mean: somewhere being checked, or a blast. */
  tone?: 'check' | 'blast';
}) {
  const vertical = useMediaQuery('(max-aspect-ratio: 1/1)');
  const { rows, cartRow, cartDestroyed, lavatoryDestroyed } = game.cabin;
  const youId = game.you?.id ?? null;
  const saboteurView = game.you?.team === 'saboteurs';
  const occupant = new Map<SeatId, PlayerSummary>();
  for (const p of game.players) if (p.seat) occupant.set(p.seat, p);
  const scorched = new Set(game.cabin.scorched.map((c) => `${c.row}:${c.col}`));
  const live = game.bombs.filter((b) => !b.exploded);
  const seatBombs = new Set(live.flatMap((b) => (b.location.kind === 'seat' ? [b.location.seat] : [])));
  const cartBomb = live.some((b) => b.location.kind === 'cart');
  const lavBomb = live.some((b) => b.location.kind === 'lavatory');

  /** Cabin row r (0 = galley, rows + 1 = rear) and column c (-1 = labels) on the CSS grid. */
  const at = (r: number, c: number, span = 1) => {
    const along = `${r + 2}`;
    const across = span > 1 ? `${c + 2} / span ${span}` : `${c + 2}`;
    return vertical ? { gridRow: along, gridColumn: across } : { gridColumn: along, gridRow: across };
  };

  const cells: VNode[] = [];
  for (let r = 1; r <= rows; r++) {
    cells.push(
      <div key={`n${r}`} class="sm-num" style={at(r, -1)}>
        {r}
      </div>,
    );
  }
  LETTERS.forEach((letter, c) => {
    if (letter) {
      cells.push(
        <div key={`l${c}`} class="sm-letter" style={at(-1, c)}>
          {letter}
        </div>,
      );
    }
  });
  const spotClass = (spot: Spot) =>
    spotPick?.spots.has(spot) ? ` pick${spotPick.selected === spot ? ' selected' : ''}` : '';
  cells.push(
    <div key="galley" class="sm-block sm-galley" style={at(0, 0, 7)}>
      <span>Galley</span>
    </div>,
    spotPick?.spots.has('lavatory') ? (
      <button
        key="lav"
        type="button"
        class={`sm-block sm-lav${spotClass('lavatory')}`}
        style={at(rows + 1, 0, 3)}
        aria-label="The lavatory"
        onClick={() => spotPick.onPick('lavatory')}
      >
        <span>WC</span>
        {lavBomb && <IconBomb />}
      </button>
    ) : (
      <div key="lav" class={`sm-block sm-lav${lavatoryDestroyed ? ' destroyed' : ''}`} style={at(rows + 1, 0, 3)}>
        <span>WC</span>
        {lavBomb && <IconBomb />}
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
        cells.push(
          <div key={`a${r}`} class={`sm-aisle${scorched.has(`${r}:${c}`) ? ' scorched' : ''}`} style={at(r, c)}>
            {cart &&
              (spotPick?.spots.has('cart') ? (
                <button type="button" class={`sm-cart${spotClass('cart')}`} title="Drink cart" aria-label="The drink cart" onClick={() => spotPick.onPick('cart')}>
                  <IconCart />
                  {cartBomb && <IconBomb />}
                </button>
              ) : (
                <span class="sm-cart" title="Drink cart">
                  <IconCart />
                  {cartBomb && <IconBomb />}
                </span>
              ))}
          </div>,
        );
        continue;
      }
      const seat = grid.seatId({ row: r, col: c });
      const p = occupant.get(seat);
      const you = !!p && p.id === youId;
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
      if (scorched.has(`${r}:${c}`)) classes.push('scorched');
      const who = !p ? 'empty' : hidden ? 'someone' : `${p.name}${p.status === 'dead' ? ' (dead)' : ''}${you ? ' (you)' : ''}`;
      const onPick = pickSeat
        ? () => seatPick!.onPick(seat)
        : pickPlayer
          ? () => playerPick!.onPick(p!.id)
          : pickOwn
            ? () => spotPick!.onPick('seat')
            : undefined;
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
        <IconCart size={14} />
        Drink cart
      </span>
      {game.bombs.some((b) => !b.exploded) && (
        <span>
          <IconBomb />
          Bomb you know about
        </span>
      )}
    </div>
  );
}
