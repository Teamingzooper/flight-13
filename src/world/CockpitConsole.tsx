import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { grid } from '../engine';
import type { TVContext } from '../tv/context';
import { nameWithSeat } from '../tv/format';
import type { Cabin3D } from './Cabin3D';
import type { ConsoleMode } from './cockpit';
import { TAPE_INTRO, clipAt, lastWatch, planTape, type Tape } from './tape';

const TITLES: Record<ConsoleMode, string> = {
  live: 'Cabin cameras',
  watch: 'Aim tonight’s cameras',
  seatbelt: 'Seatbelt sign: who stays buckled in?',
  jumpseat: 'Cabin intercom: who comes up to the jump seat?',
  roughair: 'Rough air: which three rows?',
  replay: 'Last night’s tape',
};

const rowsText = (start: number) => `rows ${start}–${start + 2}`;

/** Where the camera starts: tonight's call if there is one, or the front of the cabin. */
function firstRow(ctx: TVContext, mode: ConsoleMode, tape: Tape | null): number {
  const { game } = ctx;
  if (mode === 'replay' && tape) return tape.rows[0];
  if (mode === 'watch') {
    const action = game.mine?.action;
    if (action?.kind === 'watch') return action.startRow;
  }
  if (mode === 'roughair' && game.mine?.roughair != null) return game.mine.roughair;
  return 1;
}

/** The camera clock while a tape plays: the clip's time, or the time of the last one seen. */
function tapeClockAt(tape: Tape, t: number): string {
  const clip = clipAt(tape, t);
  if (clip) return clip.clock;
  const before = tape.clips.filter((c) => c.at <= t).at(-1);
  return before?.clock ?? (t < TAPE_INTRO ? '00:05' : '04:40');
}

/**
 * The camera console on the flight deck: the cabin cameras full size, with name tags over the passengers. It aims
 * tonight's cameras, picks who the seatbelt sign or the jump seat is for, flies rough air, and replays last night's tape.
 */
export function CockpitConsole({ ctx, cabin, mode, onClose }: { ctx: TVContext; cabin: Cabin3D; mode: ConsoleMode; onClose: () => void }) {
  const { game, send } = ctx;
  const screen = useRef<HTMLDivElement>(null);
  const rows = game.cabin.rows;
  const watchEntry = game.you ? lastWatch(game.log, game.you.id) : null;
  // One tape per camera report (a new object would restart it).
  const tape = useMemo(() => (mode === 'replay' ? planTape(game, (night) => cabin.seatsOn(night)) : null), [mode, watchEntry?.id]);
  const [start, setStart] = useState(() => firstRow(ctx, mode, tape));
  const [t, setT] = useState(0);

  useEffect(() => {
    cabin.setConsole({ screen: screen.current!, startRow: start, tape });
  }, [start, tape]);
  useEffect(() => () => cabin.setConsole(null), []);
  // The caption and the clock follow the tape as the 3D view plays it.
  useEffect(() => {
    if (!tape) return undefined;
    const id = setInterval(() => setT(cabin.tapeTime ?? 0), 100);
    return () => clearInterval(id);
  }, [tape]);

  const mine = game.mine;
  const options = game.options;
  const clip = tape ? clipAt(tape, t) : null;
  const over = !!tape && t >= tape.length;
  const header = tape
    ? `NIGHT ${tape.night}  ·  ${tapeClockAt(tape, t)}  ·  ${over ? 'END OF TAPE' : 'REPLAY'}`
    : `CAM ${Math.ceil(start / 3)}  ·  ROWS ${start}–${Math.min(rows, start + 2)}  ·  LIVE`;

  // Name tags over everyone the camera can see; in the pickers, the ones you can choose are buttons.
  const picking = mode === 'seatbelt' || mode === 'jumpseat';
  const allowed = new Set(mode === 'seatbelt' ? (options?.seatbelt ?? []) : mode === 'jumpseat' ? (options?.jumpseat ?? []) : []);
  const chosen = mode === 'seatbelt' ? mine?.seatbelt : mode === 'jumpseat' ? mine?.jumpseat : null;
  // (Live, only the three rows this camera covers: further back, heads are tiny and half behind the seats.)
  const inRows = (seat: string | null) => {
    const row = seat ? grid.parsePlace(seat)?.row : undefined;
    return row !== undefined && row >= start && row <= start + 2;
  };
  const tagged = tape
    ? tape.cast.map((c) => game.players.find((p) => p.id === c.id)).filter((p) => !!p)
    : game.players.filter((p) => p.status === 'alive' && p.id !== game.you?.id && inRows(p.seat));
  const why = (id: string) =>
    mode === 'seatbelt' && id === game.you?.lastSeatbeltTarget ? 'Not two nights running.' : mode === 'jumpseat' ? 'Not tonight.' : '';
  const pick = (id: string) => void send(mode === 'seatbelt' ? { kind: 'seatbelt', target: id } : { kind: 'jumpseat', target: id });

  const watchStarts = new Set((options?.actions ?? []).flatMap((a) => (a.kind === 'watch' ? [a.startRow] : [])));
  const watching = mine?.action?.kind === 'watch' ? mine.action.startRow : null;
  const roughStarts = new Set(options?.roughair ?? []);

  return (
    <div class="cctv-console" role="dialog" aria-label={TITLES[mode]}>
      <div class="cctv-head">
        <span class="cctv-title">{TITLES[mode]}</span>
        <button type="button" class="cctv-close" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)">
          ✕
        </button>
      </div>
      <div class="cctv-screen" ref={screen}>
        <div class="cctv-tint" aria-hidden="true" />
        <div class="cctv-osd" aria-hidden="true">
          <span>{header}</span>
          <i class="rec" />
        </div>
        {tagged.map((p) =>
          picking && allowed.has(p.id) ? (
            <button
              type="button"
              key={p.id}
              data-cctv-tag={p.id}
              class={`cctv-tag pick${chosen === p.id ? ' on' : ''}`}
              hidden
              onClick={() => pick(p.id)}
            >
              {p.name}
            </button>
          ) : (
            <span key={p.id} data-cctv-tag={p.id} class={`cctv-tag${picking ? ' off' : ''}`} title={picking ? why(p.id) : undefined} hidden>
              {p.name}
            </span>
          ),
        )}
        {clip && <div class="cctv-caption">{clip.text}.</div>}
        {tape && tape.clips.length === 0 && t > 0.8 && <div class="cctv-caption">Nobody stirred in {rowsText(tape.rows[0])}.</div>}
      </div>
      <div class="cctv-bar">
        {mode !== 'replay' && (
          <div class="cctv-rows" role="group" aria-label="Camera">
            <button type="button" class="btn small" disabled={start <= 1} onClick={() => setStart(start - 1)} aria-label="Camera forward">
              ◀
            </button>
            <span>{rowsText(start)}</span>
            <button type="button" class="btn small" disabled={start >= rows - 2} onClick={() => setStart(start + 1)} aria-label="Camera back">
              ▶
            </button>
          </div>
        )}
        <div class="cctv-actions">
          {mode === 'seatbelt' && (
            <>
              <span class="muted">
                {chosen && chosen !== 'none' ? `Sign on for ${nameWithSeat(game, chosen)}.` : 'Click a name on the screen (◀ ▶ for other rows).'}
              </span>
              <button type="button" class={`btn small${chosen === 'none' ? ' primary' : ''}`} onClick={() => pick('none')}>
                No one
              </button>
            </>
          )}
          {mode === 'jumpseat' && (
            <>
              <span class="muted">
                {chosen && chosen !== 'none' ? `Calling ${nameWithSeat(game, chosen)} up.` : 'Click a name on the screen (◀ ▶ for other rows).'}
              </span>
              <button type="button" class={`btn small${!chosen || chosen === 'none' ? ' primary' : ''}`} onClick={() => pick('none')}>
                Nobody
              </button>
            </>
          )}
          {mode === 'watch' && (
            <>
              <button
                type="button"
                class={`btn small${watching === start ? ' primary' : ''}`}
                disabled={!watchStarts.has(start)}
                onClick={() => void send({ kind: 'act', action: { kind: 'watch', startRow: start } })}
              >
                {watching === start ? `✓ Watching ${rowsText(start)}` : `Watch ${rowsText(start)} tonight`}
              </button>
              <button type="button" class="btn small ghost" onClick={() => void send({ kind: 'act', action: null })}>
                Rest tonight
              </button>
            </>
          )}
          {mode === 'roughair' && (
            <>
              <button
                type="button"
                class={`btn small${mine?.roughair === start ? ' primary' : ''}`}
                disabled={!roughStarts.has(start)}
                onClick={() => void send({ kind: 'roughair', startRow: start })}
              >
                {mine?.roughair === start ? `✓ Rough air over ${rowsText(start)}` : `Fly rough air over ${rowsText(start)}`}
              </button>
              {mine?.roughair != null && (
                <button type="button" class="btn small ghost" onClick={() => void send({ kind: 'roughair', startRow: null })}>
                  Call it off
                </button>
              )}
            </>
          )}
          {mode === 'replay' && tape && (
            <button
              type="button"
              class="btn small"
              onClick={() => {
                cabin.replayTape();
                setT(0);
              }}
            >
              {over ? 'Watch again' : 'Replay'}
            </button>
          )}
        </div>
      </div>
      {mode === 'replay' && tape && tape.clips.length > 0 && (
        <ol class="cctv-log">
          {tape.clips.map((c) => (
            <li key={c.at} class={clip === c ? 'on' : ''}>
              <span class="cctv-time">{c.clock}</span> {c.text}.
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
