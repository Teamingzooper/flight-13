import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import type { Look } from '../engine';
import { randomLook } from '../net/protocol';
import { Avatar, BOTTOM, BUILDS, HAIR_COLOR, HAIR_STYLES, SKIN, SKIN_ORDER, TOP, TOP_STYLES } from './Avatar';
import { CharacterPreview } from './CharacterPreview';
import { FaceEditor } from './FaceEditor';
import type { Profile } from './profile';

type Section = 'face' | 'hair' | 'skin' | 'outfit' | 'build';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'face', label: 'Face' },
  { id: 'hair', label: 'Hair' },
  { id: 'skin', label: 'Skin' },
  { id: 'outfit', label: 'Outfit' },
  { id: 'build', label: 'Build' },
];

function Swatches({ colors, selected, order, onPick, label }: { colors: string[]; selected: number; order?: number[]; onPick: (i: number) => void; label: string }) {
  return (
    <div class="swatches" role="radiogroup" aria-label={label}>
      {(order ?? colors.map((_, i) => i)).map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={selected === i}
          class={`swatch${selected === i ? ' on' : ''}`}
          style={{ background: colors[i] }}
          aria-label={`${label} ${i + 1}`}
          onClick={() => onPick(i)}
        />
      ))}
    </div>
  );
}

function Tile({ on, onClick, children }: { on: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class={`tile${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

/** Dress your passenger: paint a face, pick hair, skin, clothes and build. Changes apply as you go. */
export function Wardrobe({ profile, onChange, onClose }: { profile: Profile; onChange: (profile: Profile) => void; onClose: () => void }) {
  const [section, setSection] = useState<Section>('face');
  const look = profile.look;
  const set = (patch: Partial<Look>) => onChange({ ...profile, look: { ...look, ...patch } });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div class="wardrobe-backdrop" role="dialog" aria-modal="true" aria-label="Customize your passenger" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="wardrobe">
        <header class="wardrobe-head">
          <div>
            <div class="label">Wardrobe</div>
            <h2>{profile.name.trim() || 'Your passenger'}</h2>
          </div>
          <button type="button" class="btn primary" onClick={onClose}>
            Done
          </button>
        </header>
        <div class="wardrobe-body">
          <div class="wardrobe-preview">
            <CharacterPreview look={look} face={profile.face} framing={section === 'outfit' || section === 'build' ? 'body' : section === 'hair' ? 'hair' : 'face'} />
            <button type="button" class="btn ghost small" onClick={() => onChange({ ...profile, look: randomLook(Math.random) })}>
              Surprise me
            </button>
          </div>
          <div class="wardrobe-main">
            <nav class="wardrobe-tabs" role="tablist">
              {SECTIONS.map((s) => (
                <button key={s.id} type="button" role="tab" aria-selected={section === s.id} class={section === s.id ? 'on' : ''} onClick={() => setSection(s.id)}>
                  {s.label}
                </button>
              ))}
            </nav>
            <div class="wardrobe-panel">
              {section === 'face' && (
                <FaceEditor face={profile.face} skin={SKIN[look.skin] ?? SKIN[0]} hair={look.hair} onChange={(face) => onChange({ ...profile, face })} />
              )}
              {section === 'hair' && (
                <>
                  <div class="label">Style</div>
                  <div class="tile-grid">
                    {HAIR_STYLES.map((name, i) => (
                      <Tile key={name} on={look.hair === i} onClick={() => set({ hair: i })}>
                        <Avatar look={{ ...look, hair: i }} face={profile.face} size={56} />
                        <span>{name}</span>
                      </Tile>
                    ))}
                  </div>
                  <div class="label">Colour</div>
                  <Swatches label="Hair colour" colors={HAIR_COLOR} selected={look.hairColor} onPick={(i) => set({ hairColor: i })} />
                </>
              )}
              {section === 'skin' && (
                <>
                  <div class="label">Skin tone</div>
                  <Swatches label="Skin tone" colors={SKIN} order={SKIN_ORDER} selected={look.skin} onPick={(i) => set({ skin: i })} />
                </>
              )}
              {section === 'outfit' && (
                <>
                  <div class="label">Top</div>
                  <div class="tile-grid">
                    {TOP_STYLES.map((name, i) => (
                      <Tile key={name} on={look.topStyle === i} onClick={() => set({ topStyle: i })}>
                        <Avatar look={{ ...look, topStyle: i }} face={profile.face} size={56} />
                        <span>{name}</span>
                      </Tile>
                    ))}
                  </div>
                  <div class="label">Top colour</div>
                  <Swatches label="Top colour" colors={TOP} selected={look.top} onPick={(i) => set({ top: i })} />
                  <div class="label">Trousers</div>
                  <Swatches label="Trouser colour" colors={BOTTOM} selected={look.bottom} onPick={(i) => set({ bottom: i })} />
                </>
              )}
              {section === 'build' && (
                <>
                  <div class="label">Build</div>
                  <div class="tile-grid">
                    {BUILDS.map((name, i) => (
                      <Tile key={name} on={look.body === i} onClick={() => set({ body: i })}>
                        <span class="build-icon" style={{ '--w': String(0.8 + i * 0.2) }} />
                        <span>{name}</span>
                      </Tile>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
