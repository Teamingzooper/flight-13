import { useEffect, useRef, useState } from 'preact/hooks';
import type { Look } from '../engine';
import { LESSONS, LESSON_ORDER, type LessonId } from '../tutorial/lessons';
import type { PickerHandle } from '../world/picker';

/**
 * Flight School's lessons, picked from the safety card in the seat pocket (world/sets/safetyCard.ts). It builds
 * off-screen; once it is ready (`onWarm`) the Terminal pans across to it. Point at a panel (or its button), click it,
 * and the card comes up close on it before `onPick` boards that lesson.
 */
export function TutorialPicker({
  look,
  open,
  onWarm,
  onBack,
  onPick,
}: {
  look: Look;
  /** Panned into view. */
  open: boolean;
  onWarm: () => void;
  onBack: () => void;
  onPick: (lesson: LessonId) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<PickerHandle | null>(null);
  const [hovered, setHovered] = useState<LessonId>('passenger');
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const calls = useRef({ onWarm, onPick });
  calls.current = { onWarm, onPick };

  useEffect(() => {
    let cancelled = false;
    let created: PickerHandle | null = null;
    import('../world/picker')
      .then(({ startPicker }) =>
        startPicker(host.current!, look, {
          onHover: setHovered,
          onReady: () => setReady(true),
          onPicked: (lesson) => {
            setLeaving(true);
            // The panel fills the view; then black, and on board.
            setTimeout(() => calls.current.onPick(lesson), 450);
          },
        }),
      )
      .then((made) => {
        created = made;
        if (cancelled) {
          made.dispose();
          return;
        }
        handle.current = made;
        calls.current.onWarm();
      })
      .catch((err: unknown) => {
        console.warn('Safety card unavailable', err);
        if (!cancelled) {
          setFailed(true);
          setReady(true);
          calls.current.onWarm();
        }
      });
    return () => {
      cancelled = true;
      created?.dispose();
      handle.current = null;
    };
  }, []);

  useEffect(() => {
    if (open) handle.current?.begin();
  }, [open, handle.current]);

  const pick = (lesson: LessonId) => {
    if (failed) {
      setLeaving(true);
      setTimeout(() => calls.current.onPick(lesson), 300);
      return;
    }
    handle.current?.pick(lesson);
  };
  const hover = (lesson: LessonId) => {
    setHovered(lesson);
    handle.current?.hover(lesson);
  };

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (leaving) return;
      if (e.key === 'Escape') onBack();
      else if (!ready) {
        if (e.key === 'Enter' || e.key === ' ') handle.current?.skip();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = LESSON_ORDER.indexOf(hovered);
        hover(LESSON_ORDER[(i + (e.key === 'ArrowRight' ? 1 : LESSON_ORDER.length - 1)) % LESSON_ORDER.length]);
      } else if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'BUTTON') pick(hovered);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [open, ready, hovered, leaving]);

  const ndc = (e: PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * 2 - 1, y: -((e.clientY - rect.top) / rect.height) * 2 + 1 };
  };
  const [overPanel, setOverPanel] = useState(false);
  const down = useRef<{ x: number; y: number } | null>(null);
  const lesson = LESSONS[hovered];

  return (
    <div class={`picker${leaving ? ' leaving' : ''}`} aria-hidden={!open}>
      <div
        class={`picker-gl${overPanel ? ' pointing' : ''}`}
        ref={host}
        onPointerMove={(e) => setOverPanel(!!handle.current?.pointer(ndc(e)))}
        onPointerLeave={() => setOverPanel(false)}
        onPointerDown={(e) => {
          down.current = { x: e.clientX, y: e.clientY };
          // (Touch has no hover: the finger goes where you touch.)
          setOverPanel(!!handle.current?.pointer(ndc(e)));
        }}
        onPointerUp={(e) => {
          const d = down.current;
          down.current = null;
          if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || leaving) return;
          if (!handle.current?.choosing) {
            handle.current?.skip();
            return;
          }
          const on = handle.current.pointer(ndc(e));
          if (on) pick(on);
        }}
      />
      <button class="picker-back btn" onClick={onBack} disabled={leaving}>
        ← Terminal
      </button>
      <div class={`picker-bar${ready ? ' shown' : ''}`}>
        <div class="picker-caption" aria-live="polite">
          <span class={`picker-num${hovered === 'bomber' ? ' saboteur' : ''}`}>{LESSON_ORDER.indexOf(hovered) + 1}</span>
          <div>
            <b>{lesson.title}</b>
            <p>{lesson.line}</p>
          </div>
        </div>
        <div class="picker-roles" role="group" aria-label="Lessons">
          {LESSON_ORDER.map((id, i) => (
            <button
              key={id}
              class={`chip${id === hovered ? ' on' : ''}${id === 'bomber' ? ' saboteur' : ''}`}
              aria-pressed={id === hovered}
              onMouseEnter={() => hover(id)}
              onFocus={() => hover(id)}
              onClick={() => pick(id)}
              disabled={!ready || leaving}
            >
              {i + 1} {LESSONS[id].title}
            </button>
          ))}
        </div>
        <button class="btn primary picker-go" onClick={() => pick(hovered)} disabled={!ready || leaving}>
          Start the {lesson.title} lesson
        </button>
      </div>
      {!ready && !failed && (
        <p class="picker-hint" aria-live="polite">
          Take out the safety card… <span>(click to skip)</span>
        </p>
      )}
      <div class="picker-fade" />
    </div>
  );
}
