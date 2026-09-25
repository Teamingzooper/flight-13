import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TVContext } from '../tv/context';
import type { Cabin3D } from './Cabin3D';
import { planReels } from './recorder';
import { clipAt } from './tape';

/**
 * The flight recorder in the cabin: each night played back through a ceiling camera that cuts to wherever it
 * happens, with that night's people acting out the black box, night after night to landing.
 */
export function RecorderScreen({ ctx, cabin, onClose }: { ctx: TVContext; cabin: Cabin3D; onClose: () => void }) {
  const { game } = ctx;
  const reels = useMemo(() => planReels(game), [game.gameId, game.recorder?.length]);
  const screen = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [t, setT] = useState(0);
  const reel = reels[index] ?? null;

  useEffect(() => {
    cabin.setConsole(reel ? { screen: screen.current!, startRow: reel.clips[0]?.row ?? 1, tape: reel, recorder: true } : null);
    setT(0);
  }, [reel]);
  useEffect(() => () => cabin.setConsole(null), []);
  useEffect(() => {
    const id = setInterval(() => setT(cabin.tapeTime ?? 0), 100);
    return () => clearInterval(id);
  }, []);
  // At the end of a night, roll straight on to the next.
  useEffect(() => {
    if (reel && t >= reel.length && index + 1 < reels.length) setIndex(index + 1);
  }, [t]);

  if (!reel) {
    return (
      <div class="cctv-console recorder-screen" role="dialog" aria-label="Flight recorder">
        <div class="cctv-head">
          <span class="cctv-title">Flight recorder</span>
          <button type="button" class="cctv-close" onClick={onClose} aria-label="Close (Esc)">
            ✕
          </button>
        </div>
        <p class="muted">The flight recorder is empty.</p>
      </div>
    );
  }
  const clip = clipAt(reel, t);
  const over = t >= reel.length && index + 1 >= reels.length;
  const into = clip ? t - clip.at : 0;
  const flash = clip?.kind === 'blast' && into > 0.5 && into < 1.3 ? 1 - (into - 0.5) / 0.8 : 0;
  const clock = clip?.clock ?? (t < (reel.clips[0]?.at ?? 0) ? 'LIGHTS OUT' : (reel.clips.at(-1)?.clock ?? ''));
  const cast = reel.cast.map((c) => game.players.find((p) => p.id === c.id)).filter((p) => !!p);

  return (
    <div class="cctv-console recorder-screen" role="dialog" aria-label="Flight recorder">
      <div class="cctv-head">
        <span class="cctv-title">Flight recorder</span>
        <button type="button" class="cctv-close" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)">
          ✕
        </button>
      </div>
      <div class="cctv-screen" ref={screen}>
        <div class="cctv-tint" aria-hidden="true" />
        <div class="cctv-flash" aria-hidden="true" style={{ opacity: flash }} />
        <div class="cctv-osd" aria-hidden="true">
          <span>{`FLIGHT RECORDER  ·  NIGHT ${reel.night}  ·  ${over ? 'END' : clock}`}</span>
          <i class="rec" />
        </div>
        {cast.map((p) => (
          <span key={p.id} data-cctv-tag={p.id} class="cctv-tag" hidden>
            {p.name}
          </span>
        ))}
        {clip && <div class="cctv-caption">{clip.text}</div>}
        {!clip && t < (reel.clips[0]?.at ?? 0) && <div class="cctv-caption">Night {reel.night}</div>}
      </div>
      <div class="cctv-bar">
        <div class="cctv-rows" role="group" aria-label="Night">
          <button type="button" class="btn small" disabled={index === 0} onClick={() => setIndex(index - 1)} aria-label="Night before">
            ◀
          </button>
          <span>
            Night {reel.night} of {reels.length}
          </span>
          <button type="button" class="btn small" disabled={index + 1 >= reels.length} onClick={() => setIndex(index + 1)} aria-label="Night after">
            ▶
          </button>
        </div>
        <div class="cctv-actions">
          <button
            type="button"
            class="btn small"
            onClick={() => {
              cabin.replayTape();
              setT(0);
            }}
          >
            Replay night {reel.night}
          </button>
        </div>
      </div>
      <ol class="cctv-log">
        {reel.clips.length === 0 && <li>A quiet night.</li>}
        {reel.clips.map((c) => (
          <li
            key={c.at}
            class={clip === c ? 'on' : ''}
            onClick={() => {
              cabin.replayTape(c.at);
              setT(c.at);
            }}
          >
            <span class="cctv-time">{c.clock}</span> {c.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
