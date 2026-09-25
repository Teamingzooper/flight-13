import { ITEMS, MAX_PACKED, roleNameIn, type PlayerView } from '../engine';
import { ItemIcon } from '../meta/ItemIcon';
import type { Packing } from '../tv/packing';

const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Over the hotel room: your role, the three pockets of your carry-on, and Done. */
export function PackingHud({ game, packing, onRole }: { game: PlayerView; packing: Packing; onRole: () => void }) {
  const you = game.you!;
  const owned = Object.values(packing.owned).some((n) => n > 0);
  const progress = game.packing;
  return (
    <div class="packing-hud">
      <div class="packing-top">
        <button class="hud-chip hud-button packing-role" onClick={onRole} title="Read your boarding pass again">
          <span class="label">Your role</span>
          <b class={you.team}>{roleNameIn(you.role, game.settings)}</b>
        </button>
      </div>
      {!owned && (
        <p class="packing-empty">Your bag is empty. Win flights, unlock achievements or visit Duty Free, and next time there will be things to pack.</p>
      )}
      <div class="packing-bottom">
        <div class="packing-slots" aria-label="Your carry-on">
          {Array.from({ length: MAX_PACKED }, (_, slot) => {
            const id = packing.packed[slot];
            return id ? (
              <button key={slot} class="packing-slot filled" disabled={packing.ready} onClick={() => packing.remove(slot)} title="Take it out">
                <ItemIcon item={id} size={22} />
                <span>{ITEMS[id].name}</span>
              </button>
            ) : (
              <span key={slot} class="packing-slot">
                {slot + 1}
              </span>
            );
          })}
        </div>
        <div class="packing-actions">
          {progress && <span class="packing-progress">{`${progress.done}/${progress.total} packed`}</span>}
          {packing.ready ? (
            <button class="btn ghost small" onClick={packing.reopen}>
              Change something
            </button>
          ) : (
            <button class="btn primary" onClick={packing.done}>
              Done packing
            </button>
          )}
        </div>
      </div>
      {!packing.ready && owned && (
        <p class="packing-hint">{TOUCH ? 'Tap an item to pack it · tap it in the bag to take it out' : 'Click an item to pack it · click it in the bag to take it out'}</p>
      )}
    </div>
  );
}
