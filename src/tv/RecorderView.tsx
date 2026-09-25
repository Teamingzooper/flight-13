import { useEffect, useMemo, useState } from 'preact/hooks';
import { grid, type NightRecord, type PlayerView, type SeatId } from '../engine';
import { planReels } from '../world/recorder';
import type { Clip, Tape } from '../world/tape';
import { SeatMap } from './SeatMap';

const STEP_MS = 2500;

/** The cabin as it was that night, for the seat map: that night's seats, and whoever has fallen so far in the reel. */
function nightView(game: PlayerView, record: NightRecord, reel: Tape, step: number): PlayerView {
  const fallen = new Map<string, 'explosion' | 'poison'>();
  for (const c of reel.clips.slice(0, step + 1)) for (const id of c.victims ?? []) fallen.set(id, c.kind === 'blast' ? 'explosion' : 'poison');
  const players = game.players.map((p) => {
    const seat = record.seats[p.id];
    if (!seat) return { ...p, seat: null, status: p.status === 'alive' ? ('dead' as const) : p.status };
    const cause = fallen.get(p.id);
    return { ...p, seat, status: cause ? ('dead' as const) : ('alive' as const), cause: cause ?? null };
  });
  return {
    ...game,
    players,
    bombs: [],
    washroom: record.washroom,
    jumpseat: record.jumpseat,
    cabin: { ...game.cabin, cartRow: record.cartRow },
  };
}

/** The seats a clip is about: who did it and to whom, or everywhere a blast reached. */
function highlight(game: PlayerView, reel: Tape, clip: Clip): Set<SeatId> {
  if (clip.kind === 'blast' && clip.cells?.length) return new Set(grid.placesWithin(clip.cells, grid.BLAST_RADIUS, game.cabin.rows, game.cabin.cols));
  const out = new Set<SeatId>();
  for (const id of [clip.actor, clip.target, ...(clip.victims ?? [])]) {
    const seat = id ? reel.seats.get(id) : undefined;
    if (seat && !grid.isCockpit(seat)) out.add(seat);
  }
  if (clip.seat) out.add(clip.seat);
  return out;
}

/** The end screen's flight recorder: each night on the seat map, one line of the black box at a time. */
export function RecorderView({ game, onWatch3D }: { game: PlayerView; onWatch3D?: () => void }) {
  const reels = useMemo(() => planReels(game), [game.gameId, game.recorder?.length]);
  const [night, setNight] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const reel = reels[night];

  // Step through the night's clips, and on through the nights, until the end of the flight.
  useEffect(() => {
    if (!playing || !reel) return undefined;
    const id = setTimeout(() => {
      if (step + 1 < reel.clips.length) setStep(step + 1);
      else if (night + 1 < reels.length) {
        setNight(night + 1);
        setStep(0);
      } else setPlaying(false);
    }, STEP_MS);
    return () => clearTimeout(id);
  }, [playing, night, step, reels.length]);

  if (!reel || !game.recorder) return <p class="muted">The flight recorder is empty.</p>;
  const clip = reel.clips[step] ?? null;
  const record = game.recorder[night];
  return (
    <div class="recorder">
      <div class="recorder-nights" role="tablist" aria-label="Nights">
        {reels.map((r, i) => (
          <button
            key={r.night}
            role="tab"
            aria-selected={i === night}
            class={i === night ? 'on' : ''}
            onClick={() => {
              setNight(i);
              setStep(0);
            }}
          >
            Night {r.night}
          </button>
        ))}
      </div>
      <SeatMap game={nightView(game, record, reel, step)} preview={clip ? highlight(game, reel, clip) : undefined} tone={clip?.kind === 'blast' ? 'blast' : 'check'} />
      <ol class="notes recorder-clips">
        {reel.clips.length === 0 && <li class="note">A quiet night.</li>}
        {reel.clips.map((c, i) => (
          <li
            key={c.at}
            class={`note${i === step ? ' on' : ''}`}
            onClick={() => {
              setStep(i);
              setPlaying(false);
            }}
          >
            <span class="when">{c.clock}</span>
            {c.text}
          </li>
        ))}
      </ol>
      <div class="row">
        <button type="button" class="btn small" onClick={() => setPlaying(!playing)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        {onWatch3D && (
          <button type="button" class="btn small primary" onClick={onWatch3D}>
            Watch it in the cabin
          </button>
        )}
      </div>
    </div>
  );
}
