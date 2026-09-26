import * as THREE from 'three';
import { getPrefs } from '../app/prefs';
import type { Look } from '../engine';
import type { LessonId } from '../tutorial/lessons';
import { cabinAudio } from './audio';
import { SceneStage } from './sceneStage';
import { SafetyCardSet, type SafetyCardEvents } from './sets/safetyCard';

/** The Terminal's tutorial picker, running: the safety card scene on its own renderer. */
export interface PickerHandle {
  /** Start the sequence (as the view pans across to it). */
  begin(): void;
  /** The pointer over the view (normalised device coordinates; null when it leaves): the panel it is on, if any. */
  pointer(ndc: { x: number; y: number } | null): LessonId | null;
  hover(lesson: LessonId): void;
  pick(lesson?: LessonId): void;
  /** Jump to the card held open. */
  skip(): void;
  readonly choosing: boolean;
  dispose(): void;
}

/** Build the scene into `container` and compile it, so the first frames are ready before it slides into view. */
export async function startPicker(container: HTMLElement, look: Look, events: SafetyCardEvents): Promise<PickerHandle> {
  const set = new SafetyCardSet(events);
  set.setLook(look);
  const stage = new SceneStage(
    container,
    set.scene,
    set.camera,
    (profile) => set.applyProfile(profile, Math.min(devicePixelRatio, profile.pixelRatio)),
    (width, height) => set.resize(width, height, getPrefs().fov),
  );
  await stage.warm();
  const timer = new THREE.Timer();
  timer.connect(document);
  let running = false;
  stage.renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(0.1, timer.getDelta());
    if (running) set.update(dt);
    stage.present(dt);
  });
  if (import.meta.env.DEV) {
    // Development: step the scene by hand and grab frames (the animation loop stops while you do).
    Object.assign(window, {
      __picker: {
        set,
        step(seconds: number, fps = 60) {
          stage.renderer.setAnimationLoop(null);
          running = true;
          for (let i = 0; i < Math.round(seconds * fps); i++) set.update(1 / fps);
          stage.present(1 / fps);
          return stage.renderer.domElement.toDataURL('image/jpeg', 0.85);
        },
      },
    });
  }
  return {
    begin() {
      if (running) return;
      running = true;
      cabinAudio.start();
      cabinAudio.setEngine(0.45, 0.1);
      if (getPrefs().reduceMotion) set.skip();
    },
    pointer: (ndc) => set.pointer(ndc ? new THREE.Vector2(ndc.x, ndc.y) : null),
    hover: (lesson) => set.hover(lesson),
    pick: (lesson) => set.pick(lesson),
    skip: () => set.skip(),
    get choosing() {
      return set.stage === 'choose';
    },
    dispose() {
      if (import.meta.env.DEV) delete (window as { __picker?: unknown }).__picker;
      stage.renderer.setAnimationLoop(null);
      timer.dispose();
      cabinAudio.stop();
      set.dispose();
      stage.dispose();
    },
  };
}
