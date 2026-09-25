import { useEffect, useState } from 'preact/hooks';
import type { ClientState } from '../net/protocol';
import { FOV_RANGE, QUALITIES, TEXT_SIZES, personVolume, setPersonVolume, setPrefs, usePrefs, type Quality, type TextSize } from './prefs';
import { Toggle } from './SettingsForm';

const QUALITY_NAMES: Record<Quality, string> = { basic: 'Basic', low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };
const QUALITY_HINTS: Record<Quality, string> = {
  basic: 'For older computers and phones: fewer pixels, no shadows, no effects.',
  low: 'Sharp, with a light colour grade; no shadows.',
  medium: 'Shadows, surface detail and bloom.',
  high: 'Soft shadows, ambient occlusion, sunbeams through the windows, and smoother edges.',
  ultra: 'Everything at full resolution: finer shadows and occlusion, dust in the sunbeams, multisampled edges. For a strong graphics card.',
};
const TEXT_NAMES: Record<TextSize, string> = { normal: 'Normal', large: 'Large', larger: 'Larger' };

/** The microphones this browser has (named once you have allowed one). */
function useMicrophones(): MediaDeviceInfo[] {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const devices = navigator.mediaDevices;
    if (!devices?.enumerateDevices) return;
    const load = () => void devices.enumerateDevices().then((all) => setMics(all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')));
    load();
    devices.addEventListener?.('devicechange', load);
    return () => devices.removeEventListener?.('devicechange', load);
  }, []);
  return mics;
}

function Slider({ label, value, onChange, format }: { label: string; value: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label class="field pref-slider">
      <span class="label">
        {label} <b>{format ? format(value) : `${Math.round(value * 100)}%`}</b>
      </span>
      <input type="range" min={0} max={100} step={5} value={Math.round(value * 100)} onInput={(e) => onChange(Number(e.currentTarget.value) / 100)} />
    </label>
  );
}

/**
 * Your settings: sound and voice, the people aboard (turn anyone down or mute them), graphics and accessibility. On the
 * home page (#/settings), and as a tab on the seatback TV, where `state` adds the people on your flight.
 */
export function SettingsPanel({ state }: { state?: ClientState | null }) {
  const prefs = usePrefs();
  const mics = useMicrophones();
  const people = state ? state.players.filter((p) => !p.bot && p.id !== state.you) : [];
  return (
    <div class="prefs">
      <section class="prefs-section">
        <h3>Sound and voice</h3>
        <Slider label="Cabin sounds" value={prefs.sound} onChange={(sound) => setPrefs({ sound })} />
        <Slider label="Voices" value={prefs.voice} onChange={(voice) => setPrefs({ voice })} />
        <label class="field">
          <span class="label">Microphone</span>
          <select class="input" value={prefs.mic} onChange={(e) => setPrefs({ mic: e.currentTarget.value })}>
            <option value="">Your browser's default</option>
            {mics.map((m, i) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        <Toggle
          checked={prefs.pushToTalk}
          onChange={(pushToTalk) => setPrefs({ pushToTalk })}
          title="Push to talk"
          hint="Your microphone only opens while you hold V (or the Talk button)."
        />
      </section>

      {state && (
        <section class="prefs-section">
          <h3>People on this flight</h3>
          {people.length === 0 ? (
            <p class="muted">Nobody else is aboard yet. (Bots have no voices.)</p>
          ) : (
            <ul class="people-volumes">
              {people.map((p) => {
                const volume = personVolume(prefs, state.code, p.id);
                return (
                  <li key={p.id}>
                    <span class="person-name">{p.name}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(volume * 100)}
                      aria-label={`${p.name}'s volume`}
                      onInput={(e) => setPersonVolume(state.code, p.id, Number(e.currentTarget.value) / 100)}
                    />
                    <button
                      class={`btn small${volume === 0 ? ' danger' : ' ghost'}`}
                      aria-pressed={volume === 0}
                      onClick={() => setPersonVolume(state.code, p.id, volume === 0 ? 1 : 0)}
                    >
                      {volume === 0 ? 'Muted' : 'Mute'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section class="prefs-section">
        <h3>Graphics</h3>
        <div class="field">
          <span class="label">Quality</span>
          <div class="segmented" role="group" aria-label="Graphics quality">
            {QUALITIES.map((q) => (
              <button type="button" key={q} class={prefs.quality === q ? 'on' : ''} onClick={() => setPrefs({ quality: q })}>
                {QUALITY_NAMES[q]}
              </button>
            ))}
          </div>
          <small class="hint">{QUALITY_HINTS[prefs.quality]}</small>
        </div>
        <label class="field pref-slider">
          <span class="label">
            Field of view <b>{68 + prefs.fov}°</b>
          </span>
          <input type="range" min={FOV_RANGE.min} max={FOV_RANGE.max} step={1} value={prefs.fov} onInput={(e) => setPrefs({ fov: Number(e.currentTarget.value) })} />
        </label>
      </section>

      <section class="prefs-section">
        <h3>Accessibility</h3>
        <div class="field">
          <span class="label">Text size</span>
          <div class="segmented" role="group" aria-label="Text size">
            {(Object.keys(TEXT_SIZES) as TextSize[]).map((t) => (
              <button type="button" key={t} class={prefs.textSize === t ? 'on' : ''} onClick={() => setPrefs({ textSize: t })}>
                {TEXT_NAMES[t]}
              </button>
            ))}
          </div>
        </div>
        <Toggle
          checked={prefs.reduceMotion}
          onChange={(reduceMotion) => setPrefs({ reduceMotion })}
          title="Reduce motion"
          hint="No camera shake or head bob, and no blinking or sliding on screens."
        />
        <Toggle checked={prefs.highContrast} onChange={(highContrast) => setPrefs({ highContrast })} title="High contrast" hint="Brighter text and outlines." />
        <Toggle
          checked={prefs.fewerFlashes}
          onChange={(fewerFlashes) => setPrefs({ fewerFlashes })}
          title="Fewer flashes"
          hint="Explosions and lightning only glow instead of flashing the screen white."
        />
      </section>
    </div>
  );
}
