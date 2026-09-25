import { useState } from 'preact/hooks';
import { DISHES, type Dish, type PlayerView } from '../engine';
import type { TVContext } from './context';
import { DISH_ICON, nameWithSeat } from './format';
const DISH_NAME: Record<Dish, string> = { chicken: 'Chicken', pasta: 'Pasta' };

/** Rows `row - 1` to `row + 1`, as far as the cabin goes. */
function reachLabel(game: PlayerView, row: number): string {
  const from = Math.max(1, row - 1);
  const to = Math.min(game.cabin.rows, row + 1);
  return from === to ? `row ${from}` : `rows ${from}–${to}`;
}

/** The chat tab's lunch bar: order in one tap while you talk. */
export function LunchBar({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const meal = game.meal;
  const you = game.you;
  if (!meal?.open || !you || you.status !== 'alive') return null;
  const mine = meal.orders[you.id];
  return (
    <div class="lunch-bar" role="group" aria-label="Lunch">
      <span class="lunch-title">🍽 Lunch is served</span>
      {DISHES.map((d) => (
        <button key={d} class={`chip${mine === d ? ' on' : ''}`} aria-pressed={mine === d} onClick={() => void send({ kind: 'order', dish: d })}>
          {DISH_ICON[d]} {DISH_NAME[d]}
        </button>
      ))}
      <span class="muted small">{Object.keys(meal.orders).length} ordered</span>
    </div>
  );
}

/** The action tab's lunch card: your order, everyone's (they are said out loud), and for saboteurs, the food. */
export function LunchPanel({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const meal = game.meal;
  const you = game.you;
  if (!meal || !you || you.status !== 'alive') return null;
  const mine = meal.orders[you.id];
  const byDish = (dish: Dish) => game.players.filter((p) => meal.orders[p.id] === dish);
  return (
    <section class="ability-card lunch-panel">
      <div class="ability-title">🍽 {meal.open ? 'Lunch is served' : 'Lunch'}</div>
      {meal.open ? (
        <>
          <p class="muted">Chicken or pasta? Everyone hears what you order. If you do not choose, the crew hands you whatever is on the cart.</p>
          <div class="lunch-choice">
            {DISHES.map((d) => (
              <button key={d} class={`btn${mine === d ? ' primary' : ''}`} aria-pressed={mine === d} onClick={() => void send({ kind: 'order', dish: d })}>
                <span class="dish-icon">{DISH_ICON[d]}</span> {DISH_NAME[d]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p class="muted">The trays are cleared away.{mine ? ` You had the ${mine}.` : ''}</p>
      )}
      <div class="lunch-orders">
        {DISHES.map((d) => {
          const eaters = byDish(d);
          return (
            <div key={d}>
              <div class="label">
                {DISH_ICON[d]} {DISH_NAME[d]} · {eaters.length}
              </div>
              <p class="small">{eaters.length === 0 ? <span class="muted">Nobody yet.</span> : eaters.map((p) => nameWithSeat(game, p.id)).join(', ')}</p>
            </div>
          );
        })}
      </div>
      {meal.reach !== null && <Tamper ctx={ctx} />}
      {meal.reach === null && meal.tamper && <TamperDone game={game} />}
    </section>
  );
}

/** A saboteur's go at the food (one for the whole team). */
function Tamper({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const meal = game.meal!;
  const you = game.you!;
  const reach = meal.reach!;
  const [row, setRow] = useState(1);
  const done = meal.tamper;
  if (done && done.by !== you.id) return <TamperDone game={game} />;
  if (!meal.open) return done ? <TamperDone game={game} /> : null;
  const where = reach === 'any' ? row : reach;
  return (
    <div class="callout red lunch-tamper">
      <b>Drug the food.</b>{' '}
      {done ? (
        <>
          You slipped a sleeping draught into the {done.dish} around {reachLabel(game, done.row)}. Whoever eats it there sleeps through tonight.
        </>
      ) : (
        <>
          Slip a sleeping draught into one dish around {reach === 'any' ? 'any row you serve' : reachLabel(game, reach)}. Whoever eats it there
          sleeps through tonight: no seat change, no ability. Your team gets one go, and the orders are out loud, so pick the dish your targets
          chose (and maybe not your own).
        </>
      )}
      {reach === 'any' && !done && (
        <label class="field lunch-row">
          <span class="label">Around row</span>
          <select class="input" value={row} onChange={(e) => setRow(Number(e.currentTarget.value))}>
            {Array.from({ length: game.cabin.rows }, (_, i) => i + 1).map((r) => (
              <option key={r} value={r}>
                {reachLabel(game, r)}
                {r === 1 ? ' and the flight deck' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <div class="row">
        {done ? (
          <button class="btn ghost small" onClick={() => void send({ kind: 'tamper', dish: null })}>
            Leave the food alone after all
          </button>
        ) : (
          DISHES.map((d) => (
            <button key={d} class="btn small danger" onClick={() => void send({ kind: 'tamper', dish: d, ...(reach === 'any' ? { row: where } : {}) })}>
              Drug the {d}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function TamperDone({ game }: { game: PlayerView }) {
  const t = game.meal!.tamper!;
  return (
    <div class="callout red lunch-tamper">
      <b>{nameWithSeat(game, t.by)}</b> drugged the {t.dish} around {reachLabel(game, t.row)}.
    </div>
  );
}
