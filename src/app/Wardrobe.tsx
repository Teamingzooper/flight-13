import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import type { Look } from '../engine';
import { ACCESSORIES, ACCESSORY_SLOTS } from '../meta/accessories';
import { buyAccessory, ownsAccessory } from '../meta/bag';
import { Credits } from '../meta/Credits';
import { updateBag, useBag } from '../meta/store';
import { randomLook } from '../net/protocol';
import { Avatar, BOTTOM, BUILDS, HAIR_COLOR, HAIR_STYLES, SKIN, SKIN_ORDER, TOP, TOP_STYLES } from './Avatar';
import { CharacterPreview } from './CharacterPreview';
import { FaceEditor } from './FaceEditor';
import type { Profile } from './profile';

type Section = 'face' | 'hair' | 'skin' | 'outfit' | 'build' | 'extras';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'face', label: 'Face' },
  { id: 'hair', label: 'Hair' },
  { id: 'skin', label: 'Skin' },
  { id: 'outfit', label: 'Outfit' },
  { id: 'build', label: 'Build' },
  { id: 'extras', label: 'Extras' },
];

/** Accessories: a row per slot. Yours to pick; the rest show their price, and can be bought right here. */
function Extras({ look, face, onPick }: { look: Look; face: string; onPick: (patch: Partial<Look>) => void }) {
  const bag = useBag();
  return (
    <>
      {ACCESSORY_SLOTS.map(({ slot, label }) => (
        <div key={slot}>
          <div class="label">{label}</div>
          <div class="tile-grid">
            <Tile on={!look[slot]} onClick={() => onPick({ [slot]: 0 })}>
              <Avatar look={{ ...look, [slot]: 0 }} face={face} size={56} />
              <span>None</span>
            </Tile>
            {ACCESSORIES.filter((a) => a.slot === slot).map((a) => {
              const owned = ownsAccessory(bag, a.id);
              const afford = bag.credits >= a.price;
              return (
                <Tile
                  key={a.id}
                  on={look[slot] === a.index}
                  locked={!owned}
                  disabled={!owned && !afford}
                  onClick={() => {
                    if (!owned && !updateBag((b) => buyAccessory(b, a.id) ?? b).wardrobe.includes(a.id)) return;
                    onPick({ [slot]: a.index });
                  }}
                >
                  <Avatar look={{ ...look, [slot]: a.index }} face={face} size={56} />
                  <span>{a.name}</span>
                  {!owned && (
                    <small class="tile-price">
                      🔒 <Credits amount={a.price} />
                    </small>
                  )}
                </Tile>
              );
            })}
          </div>
        </div>
      ))}
      <p class="hint">
        You have <Credits amount={bag.credits} />. Locked ones are bought (once) as you pick them; earn credits by flying.
      </p>
    </>
  );
}

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

function Tile({
  on,
  onClick,
  children,
  locked = false,
  disabled = false,
}: {
  on: boolean;
  onClick: () => void;
  children: ComponentChildren;
  locked?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type="button" class={`tile${on ? ' on' : ''}${locked ? ' locked' : ''}`} aria-pressed={on} disabled={disabled} onClick={onClick}>
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
            <CharacterPreview
              look={look}
              face={profile.face}
              framing={section === 'outfit' || section === 'build' ? 'body' : section === 'hair' || section === 'extras' ? 'hair' : 'face'}
            />
            <button type="button" class="btn ghost small" onClick={() => onChange({ ...profile, look: { ...randomLook(Math.random), hat: look.hat, eyes: look.eyes, neck: look.neck } })}>
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
              {section === 'extras' && <Extras look={look} face={profile.face} onPick={set} />}
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
