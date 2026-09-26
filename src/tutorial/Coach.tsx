import type { ClientState } from '../net/protocol';
import { TUTORIAL_WAITS } from './script';
import { tutorialCoach } from './lessons';

/** The Flight School coach: what to do now, on the tutorial flight only. */
export function TutorialCoach({ state, className = '' }: { state: ClientState; className?: string }) {
  if (!state.tutorial) return null;
  const step = tutorialCoach(state.game, state.lesson);
  if (!step) return null;
  return (
    <div class={`coach ${className}`} role="status" aria-live="polite">
      <span class="coach-badge">Flight School</span>
      <b>{step.title}</b>
      <p>{step.text}</p>
    </div>
  );
}

/** The tutorial waits for you in this phase: its countdown means nothing, so it is not shown. */
export function tutorialWaits(state: ClientState): boolean {
  return !!state.tutorial && !!state.game && TUTORIAL_WAITS.has(state.game.phase.kind);
}
