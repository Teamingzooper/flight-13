import { useEffect, useRef, useState } from 'preact/hooks';
import { TOP } from '../app/Avatar';
import { CHAT_MAX_LENGTH, type ChatMessage, type PlayerView } from '../engine';
import type { TVContext } from './context';
import { captainName, nameOf, nameWithSeat, playerById } from './format';

type Channel = 'cabin' | 'saboteurs' | 'ghosts' | 'whisper';

const LABEL: Record<Channel, string> = { cabin: 'Cabin', saboteurs: 'Saboteurs', ghosts: 'Ghosts', whisper: 'Whisper' };
const EMPTY: Record<Channel, string> = {
  cabin: 'No one has said anything yet.',
  saboteurs: 'Your private channel. Plan in the dark.',
  ghosts: 'Only the dead can read this.',
  whisper: 'Whispers you send or receive show up here.',
};

export function ChatTab({ ctx }: { ctx: TVContext }) {
  const { game, send } = ctx;
  const you = game.you;
  const alive = you?.status === 'alive';
  const kind = game.phase.kind;
  const night = kind === 'night_move' || kind === 'night_act';
  const day = kind === 'day_discuss' || kind === 'day_vote';
  const channels: Channel[] = ['cabin'];
  if (you?.team === 'saboteurs') channels.push('saboteurs');
  if (you && !alive) channels.push('ghosts');
  if (alive && game.settings.whispers) channels.push('whisper');

  const [picked, setPicked] = useState<Channel>(() => (alive && night && you?.team === 'saboteurs' ? 'saboteurs' : you && !alive ? 'ghosts' : 'cabin'));
  const [to, setTo] = useState<string | null>(null);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const channel: Channel = channels.includes(picked) ? picked : 'cabin';
  const whisperTargets = game.options?.whisper ?? [];
  const shown = game.chat.filter((m) => {
    if (channel === 'cabin') return m.channel === 'cabin' || m.channel === 'whisper' || m.channel === 'pa';
    if (channel === 'whisper') return m.channel === 'whisper' && (m.from === you?.id || m.to === you?.id);
    return m.channel === channel;
  });
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, channel]);

  let blocked: string | null = null;
  if (!you) blocked = 'The control tower listens but cannot talk.';
  else if (channel === 'cabin') blocked = kind === 'ended' ? null : !alive ? 'Ghosts cannot talk to the living.' : night ? 'Lights out. The cabin is silent at night.' : null;
  else if (channel === 'saboteurs') blocked = !alive ? 'You are out.' : night ? null : 'The saboteur channel only works at night.';
  else if (channel === 'whisper') {
    if (!day) blocked = 'You can only whisper during the day.';
    else if (whisperTargets.length === 0) blocked = 'Nobody is close enough to whisper to.';
    else if (!to || !whisperTargets.includes(to)) blocked = 'Pick someone nearby to whisper to.';
  }

  const submit = async (e: Event) => {
    e.preventDefault();
    if (blocked || !text.trim()) return;
    const ok = channel === 'whisper' ? await send({ kind: 'whisper', to: to!, text }) : await send({ kind: 'chat', channel, text });
    if (ok) setText('');
  };

  const ready = game.mine?.ready ?? false;
  return (
    <div class="tab chat-tab">
      <div class="chips">
        {channels.map((c) => (
          <button key={c} class={`chip${channel === c ? ' on' : ''}`} onClick={() => setPicked(c)}>
            {LABEL[c]}
          </button>
        ))}
        {alive && kind === 'day_discuss' && (
          <button class={`chip ready-chip${ready ? ' on' : ''}`} disabled={ready} onClick={() => void send({ kind: 'ready' })}>
            {ready ? 'Ready ✓ waiting for the others' : 'Ready to vote'}
          </button>
        )}
      </div>
      {channel === 'whisper' && whisperTargets.length > 0 && (
        <div class="chips whisper-to">
          <span class="label">To</span>
          {whisperTargets.map((id) => (
            <button key={id} class={`chip small${to === id ? ' on' : ''}`} onClick={() => setTo(id)}>
              {nameWithSeat(game, id)}
            </button>
          ))}
        </div>
      )}
      <ol class="chat-log tv-chat" ref={listRef}>
        {shown.length === 0 && <li class="muted empty">{EMPTY[channel]}</li>}
        {shown.map((m) => (
          <ChatLine key={m.id} game={game} m={m} />
        ))}
      </ol>
      <form class="chat-input" onSubmit={submit}>
        <input
          class="input"
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={blocked ?? 'Type a message…'}
          disabled={blocked !== null}
          aria-label="Message"
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <button class="btn primary" type="submit" disabled={blocked !== null || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function ChatLine({ game, m }: { game: PlayerView; m: ChatMessage }) {
  const from = nameOf(game, m.from);
  if (m.channel === 'pa') {
    return (
      <li class="msg pa">
        <b>📢 {captainName(from)}</b>
        {m.text}
      </li>
    );
  }
  if (m.channel === 'whisper') {
    const to = nameOf(game, m.to);
    return m.text ? (
      <li class="msg whisper">
        <b>
          {from} → {to}
        </b>
        {m.text}
      </li>
    ) : (
      <li class="msg notice">
        {from} whispered something to {to}.
      </li>
    );
  }
  const color = TOP[playerById(game, m.from)?.look.top ?? 0];
  return (
    <li class={`msg ${m.channel}`}>
      <span class="dot" style={{ background: color }} />
      <b>{from}</b>
      {m.text}
    </li>
  );
}
