import type { TVContext } from './context';
import { MapLegend, SeatMap } from './SeatMap';

export function MapTab({ ctx }: { ctx: TVContext }) {
  const { game } = ctx;
  const inPlay = game.players.filter((p) => p.status === 'alive').length;
  return (
    <div class="tab map-tab">
      <div class="panel-title">
        Seat map
        <span class="muted">
          {inPlay} still in play{game.blackout ? ' · Blackout: names are hidden today' : ''}
        </span>
      </div>
      <SeatMap game={game} />
      <MapLegend game={game} />
    </div>
  );
}
