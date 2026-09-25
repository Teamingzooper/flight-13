import { useEffect, useState } from 'preact/hooks';
import { usePrefs } from '../app/prefs';
import type { OpenFlight } from '../app/sessions';
import { voiceAllowed, voiceFor, type VoiceChat } from '../net/voice';

/** This flight's voice chat, re-rendering when it turns on, off, or mutes. */
export function useVoice(flight: OpenFlight): VoiceChat | null {
  const voice = voiceFor(flight.code, flight.client, flight.media);
  const [, setVersion] = useState(0);
  useEffect(() => voice?.subscribe(() => setVersion((n) => n + 1)), [voice]);
  return voice;
}

/** Join proximity voice chat, mute yourself, or leave it. */
export function VoiceButton({ flight, className = '' }: { flight: OpenFlight; className?: string }) {
  const voice = useVoice(flight);
  const { pushToTalk } = usePrefs();
  if (!voice) return null;
  const status = voice.status;
  if (!voiceAllowed(flight.client)) {
    return (
      <button class={`voice-button ${className}`} disabled title="The captain turned voice chat off for this flight">
        <span aria-hidden="true">🔇</span> No voice
      </button>
    );
  }
  if (status === 'off' || status === 'starting') {
    return (
      <button
        class={`voice-button ${className}`}
        disabled={status === 'starting'}
        onClick={() => void voice.start()}
        title="Talk out loud with the people near you in the cabin (headphones stop the echo)"
      >
        <span aria-hidden="true">🎙️</span> {status === 'starting' ? 'Joining…' : 'Voice'}
      </button>
    );
  }
  const listening = status === 'listening';
  return (
    <span class={`voice-controls ${className}`}>
      <button
        class={`voice-button on${voice.muted || listening ? ' muted' : ''}`}
        disabled={listening}
        onClick={() => voice.setMuted(!voice.muted)}
        title={listening ? 'Your microphone is blocked: you can listen, not talk' : voice.muted ? 'Unmute (M)' : 'Mute (M)'}
        aria-label={voice.muted ? 'Unmute your microphone' : 'Mute your microphone'}
      >
        <span aria-hidden="true">{listening ? '🎧' : voice.muted ? '🔇' : '🎙️'}</span>
        {listening ? ' Listening' : voice.muted ? ' Muted' : ' On'}
      </button>
      {pushToTalk && !listening && !voice.muted && (
        <button
          class={`voice-button talk${voice.talking ? ' on' : ''}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            voice.setTalking(true);
          }}
          onPointerUp={() => voice.setTalking(false)}
          onPointerCancel={() => voice.setTalking(false)}
          title="Hold to talk (or hold V)"
        >
          {voice.talking ? 'Talking…' : 'Hold to talk'}
        </button>
      )}
      <button class="voice-button leave" onClick={() => voice.stop()} title="Leave voice chat" aria-label="Leave voice chat">
        ✕
      </button>
    </span>
  );
}
