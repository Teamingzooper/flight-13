import { ITEMS, ITEM_ORDER, MAX_PACKED, isNightPhase, type ItemId, type ItemUse, type PlayerView } from '../engine';
import { ItemIcon } from '../meta/ItemIcon';
import { whenLabel } from '../meta/shop';
import type { TVContext } from './context';
import { nameWithSeat } from './format';
import type { Packing } from './packing';

/** Why an item cannot be used right now. */
function waitingFor(game: PlayerView, item: ItemId): string {
  const info = ITEMS[item];
  if (info.automatic) return 'Works by itself';
  const kind = game.phase.kind;
  const night = kind === 'night_move' || kind === 'night_act';
  const day = kind === 'day_discuss' || kind === 'day_vote';
  if (info.when === 'night' && !night) return 'Night only';
  if (info.when === 'day' && !day) return 'Day only';
  switch (item) {
    case 'defuser':
      return 'Find a bomb within reach first';
    case 'pills':
      return kind === 'night_move' ? 'After seats change' : 'No neighbour to give one to';
    case 'extender':
    case 'mirror':
    case 'ffcard':
    case 'flashlight':
      return 'In use';
    default:
      return 'Not now';
  }
}

/** Your packed items: what they do, when they work, and buttons for the ones you can use now. */
export function CarryOn({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const you = game.you;
  if (!you) return null;
  const uses = game.options?.items ?? [];
  const kinds = ITEM_ORDER.filter((id) => you.items.includes(id));
  if (kinds.length === 0 && you.usedItems.length === 0) return null;
  const use = (u: ItemUse) => void send({ kind: 'use', ...u });
  return (
    <section class="carry-on">
      <div class="panel-title">
        Your carry-on
        <span class="muted">Items work even while the seatbelt sign is on.</span>
      </div>
      {kinds.length === 0 && <p class="muted">Everything you packed is used up.</p>}
      <ul class="carry-list">
        {kinds.map((id) => {
          const info = ITEMS[id];
          const count = you.items.filter((x) => x === id).length;
          const mine = uses.filter((u) => u.item === id);
          return (
            <li key={id} class="carry-item">
              <span class="carry-icon">
                <ItemIcon item={id} size={26} />
              </span>
              <div class="carry-text">
                <div class="carry-name">
                  {info.name}
                  {count > 1 && <span class="muted"> × {count}</span>}
                  <span class={`when when-${info.automatic ? 'auto' : info.when}`}>{whenLabel(info.when, info.automatic)}</span>
                </div>
                <p>{info.blurb}</p>
                {mine.length === 0 ? (
                  <span class="carry-wait">{waitingFor(game, id)}</span>
                ) : mine.length === 1 && !mine[0].seat && !mine[0].target ? (
                  <button class="btn primary small" onClick={() => use(mine[0])}>
                    Use {info.name.toLowerCase()}
                  </button>
                ) : (
                  <div class="carry-targets">
                    <span class="muted">{id === 'flashlight' ? 'Look under:' : 'Give one to:'}</span>
                    {mine.map((u) => (
                      <button key={u.seat ?? u.target} class="btn small" onClick={() => use(u)}>
                        {u.seat ?? nameWithSeat(game, u.target!)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {you.usedItems.length > 0 && <p class="carry-used muted">Used: {you.usedItems.map((id) => ITEMS[id].name).join(', ')}</p>}
      {/* What your items turned up tonight, right where you used them (not only in the morning report). */}
      {game.log
        .filter((e) => e.tag === 'item' && e.night === game.phase.night && e.to !== 'end' && isNightPhase(game.phase.kind))
        .slice(-2)
        .map((e) => (
          <p key={e.id} class="carry-result" role="status">
            {e.text}
          </p>
        ))}
    </section>
  );
}

/** Pick up to three items from your bag in the 2D screen (the 3D view packs in the hotel room). */
export function PackingPanel({ ctx, packing }: { ctx: TVContext; packing: Packing }) {
  const { game } = ctx;
  const owned = ITEM_ORDER.filter((id) => packing.owned[id] > 0);
  const progress = game.packing;
  return (
    <div class="tab packing-tab">
      <div class="panel-title">
        Pack your carry-on
        <span class="muted">
          Up to {MAX_PACKED} items. Whatever is in the bag when time runs out flies with you.
          {progress && ` ${progress.done}/${progress.total} passengers packed.`}
        </span>
      </div>
      <ol class="pack-slots">
        {Array.from({ length: MAX_PACKED }, (_, slot) => {
          const id = packing.packed[slot];
          return (
            <li key={slot} class={id ? 'filled' : ''}>
              {id ? (
                <button class="pack-slot" disabled={packing.ready} onClick={() => packing.remove(slot)} title="Take it out">
                  <ItemIcon item={id} size={30} />
                  <span>{ITEMS[id].name}</span>
                </button>
              ) : (
                <span class="pack-slot empty">Empty</span>
              )}
            </li>
          );
        })}
      </ol>
      {owned.length === 0 ? (
        <p class="muted">Your bag is empty. Win flights, unlock achievements or visit Duty Free to get items.</p>
      ) : (
        <ul class="pack-shelf">
          {owned.map((id) => {
            const left = packing.left(id);
            return (
              <li key={id}>
                <button class="pack-item" disabled={packing.ready || packing.full || left <= 0} onClick={() => packing.add(id)}>
                  <ItemIcon item={id} size={26} />
                  <span class="pack-item-name">{ITEMS[id].name}</span>
                  <span class="muted">× {left}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div class="row">
        {packing.ready ? (
          <>
            <span class="callout green">Bag packed. Waiting for the others.</span>
            <button class="btn ghost small" onClick={packing.reopen}>
              Change something
            </button>
          </>
        ) : (
          <button class="btn primary" onClick={packing.done}>
            Done packing
          </button>
        )}
      </div>
    </div>
  );
}

/** While everyone boards (the 3D view plays the boarding sequence). */
export function BoardingPanel() {
  return (
    <div class="tab boarding-tab">
      <div class="panel-title">Now boarding</div>
      <p>Bags zipped, boarding passes out. Find your seat and fasten your seatbelt: we take off in a moment.</p>
    </div>
  );
}
