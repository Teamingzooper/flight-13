import { useState } from 'preact/hooks';
import { NAME_MAX_LENGTH } from '../net/protocol';
import { Avatar } from './Avatar';
import type { Profile } from './profile';
import { Wardrobe } from './Wardrobe';

export function ProfileEditor({ profile, onChange }: { profile: Profile; onChange: (profile: Profile) => void }) {
  const [dressing, setDressing] = useState(false);
  return (
    <div class="profile-editor">
      <button type="button" class="avatar-button" aria-label="Customize your passenger" onClick={() => setDressing(true)}>
        <Avatar look={profile.look} face={profile.face} size={64} />
      </button>
      <div class="stack tight">
        <input
          class="input name-input"
          placeholder="Your name"
          value={profile.name}
          maxLength={NAME_MAX_LENGTH}
          autocomplete="nickname"
          aria-label="Your name"
          onInput={(e) => onChange({ ...profile, name: e.currentTarget.value })}
        />
        <button type="button" class="btn ghost small" onClick={() => setDressing(true)}>
          Customize
        </button>
      </div>
      {dressing && <Wardrobe profile={profile} onChange={onChange} onClose={() => setDressing(false)} />}
    </div>
  );
}
