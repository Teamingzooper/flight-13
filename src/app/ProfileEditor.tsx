import { NAME_MAX_LENGTH, randomLook } from '../net/protocol';
import { Avatar } from './Avatar';
import type { Profile } from './profile';

export function ProfileEditor({ profile, onChange }: { profile: Profile; onChange: (profile: Profile) => void }) {
  return (
    <div class="profile-editor">
      <Avatar look={profile.look} size={64} />
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
        <button type="button" class="btn ghost small" onClick={() => onChange({ ...profile, look: randomLook(Math.random) })}>
          New look
        </button>
      </div>
    </div>
  );
}
