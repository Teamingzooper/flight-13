import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useNow, useToast } from '../app/hooks';
import { navigate } from '../app/router';
import { endFlight, type OpenFlight } from '../app/sessions';
import { isNightPhase, type ChatMessage, type Intent, type PhaseKind, type PlayerView } from '../engine';
import { msLeft, type ClientSnapshot } from '../net/client';
import type { ClientState } from '../net/protocol';
import { ActionTab } from './ActionTab';
import { BoardingPanel, PackingPanel } from './CarryOn';
import { ChatTab } from './ChatTab';
import type { TVContext } from './context';
import { FlightTab } from './FlightTab';
import { captainName } from './format';
import { Header } from './Header';
import { TutorialCoach } from '../tutorial/Coach';
import { CaptainMenu, PausedBanner } from './CaptainMenu';
import { VoiceButton } from './VoiceButton';
import { IconBolt, IconChat, IconMap, IconPlane, IconVote } from './icons';
import { MapTab } from './MapTab';
import { PhaseOverlay } from './Overlays';
import { usePacking } from './packing';
import { VoteTab } from './VoteTab';

export type TabId = 'map' | 'action' | 'chat' | 'vote' | 'flight';

/** The captain's latest announcement, for a few seconds after it comes in. */
function PaBanner({ game }: { game: PlayerView }) {
  const latest = [...game.chat].reverse().find((m) => m.channel === 'pa') ?? null;
  // Announcements made before you opened the screen stay in the chat.
  const seen = useRef<number | null>(latest?.id ?? null);
  const [shown, setShown] = useState<ChatMessage | null>(null);
  useEffect(() => {
    if (!latest || latest.id === seen.current) return undefined;
    seen.current = latest.id;
    setShown(latest);
    const id = setTimeout(() => setShown(null), 8000);
    return () => clearTimeout(id);
  }, [latest?.id]);
  if (!shown) return null;
  const who = game.players.find((p) => p.id === shown.from)?.name ?? '';
  return (
    <div class="pa-banner" role="status">
      <b>📢 {captainName(who)}</b> {shown.text}
    </div>
  );
}

const TABS: { id: TabId; label: string; Icon: () => VNode }[] = [
  { id: 'map', label: 'Map', Icon: IconMap },
  { id: 'action', label: 'Action', Icon: IconBolt },
  { id: 'chat', label: 'Chat', Icon: IconChat },
  { id: 'vote', label: 'Vote', Icon: IconVote },
  { id: 'flight', label: 'Flight', Icon: IconPlane },
];

const AUTO_TAB: Partial<Record<PhaseKind, TabId>> = { night_move: 'action', night_act: 'action', day_discuss: 'chat', day_vote: 'vote' };

/** Everything the TV and the 3D HUD need to talk to the flight. */
export function useTVContext(flight: OpenFlight, snap: ClientSnapshot, state: ClientState): { ctx: TVContext; toast: string | null } {
  const now = useNow(250);
  const [toast, showToast] = useToast();
  const send = async (intent: Intent) => {
    const result = await flight.client.sendIntent(intent);
    if (!result.ok) showToast(result.error);
    return result.ok;
  };
  return { ctx: { flight, state, game: state.game!, snap, left: msLeft(snap, now), send, toast: showToast }, toast };
}

export function TV({
  flight,
  snap,
  state,
  embedded = false,
  onClose,
  onUse3D,
}: {
  flight: OpenFlight;
  snap: ClientSnapshot;
  state: ClientState;
  /** Drawn inside the 3D seatback screen (no bezel; the close button sits you back). */
  embedded?: boolean;
  onClose?: () => void;
  onUse3D?: () => void;
}) {
  const game = state.game!;
  const { ctx: shared, toast } = useTVContext(flight, snap, state);
  const ctx = embedded ? { ...shared, embedded } : shared;
  const [tab, setTab] = useState<TabId>(() => AUTO_TAB[game.phase.kind] ?? 'action');
  const [leaving, setLeaving] = useState(false);
  const phaseKey = `${game.phase.kind}:${game.phase.night}`;
  const lastPhase = useRef(phaseKey);
  useEffect(() => {
    if (lastPhase.current === phaseKey) return;
    lastPhase.current = phaseKey;
    const next = AUTO_TAB[game.phase.kind];
    if (next) setTab(next);
  }, [phaseKey]);
  const unread = useUnread(game, tab === 'chat');

  const you = game.you;
  const acting = !!you && you.status === 'alive' && !you.buckled;
  const pendingAction =
    acting &&
    ((game.phase.kind === 'night_move' && (game.mine?.move === null || (you.role === 'pilot' && game.mine?.seatbelt === null))) ||
      (game.phase.kind === 'night_act' && !game.mine?.acted));
  const pendingVote = game.phase.kind === 'day_vote' && game.options !== null && game.mine?.vote === null;
  const preflight = game.phase.kind === 'packing' || game.phase.kind === 'boarding';
  const badges: Partial<Record<TabId, string>> = {
    action: pendingAction ? '!' : undefined,
    vote: pendingVote ? '!' : undefined,
    chat: unread > 0 ? String(Math.min(unread, 99)) : undefined,
  };

  return (
    <div class={`tv ${isNightPhase(game.phase.kind) ? 'night' : 'day'}${embedded ? ' embedded' : ''}`}>
      <div class="tv-bezel">
        <div class="tv-screen">
          <Header
            ctx={ctx}
            onLeave={embedded && onClose ? onClose : () => setLeaving(true)}
            closeLabel={embedded ? 'Back to your seat (Esc)' : 'Leave the flight'}
            onUse3D={onUse3D}
            tools={
              embedded ? null : (
                <>
                  <CaptainMenu flight={flight} state={state} buttonClass="btn ghost small" />
                  <VoiceButton flight={flight} />
                </>
              )
            }
          />
          <PaBanner game={game} />
          <TutorialCoach state={state} className="tv-coach" />
          <PausedBanner state={state} className="tv-paused" />
          <main class="tv-body">
            {game.phase.kind === 'packing' ? (
              you ? (
                <PackingScreen ctx={ctx} />
              ) : (
                <BoardingPanel />
              )
            ) : game.phase.kind === 'boarding' ? (
              <BoardingPanel />
            ) : (
              <>
                {tab === 'map' && <MapTab ctx={ctx} />}
                {tab === 'action' && <ActionTab ctx={ctx} />}
                {tab === 'chat' && <ChatTab ctx={ctx} />}
                {tab === 'vote' && <VoteTab ctx={ctx} />}
                {tab === 'flight' && <FlightTab ctx={ctx} />}
              </>
            )}
          </main>
          {!preflight && (
            <nav class="tv-tabs" aria-label="Seatback menu">
              {TABS.map(({ id, label, Icon }) => (
                <button key={id} class={`tv-tab${tab === id ? ' on' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
                  <Icon />
                  <span>{label}</span>
                  {badges[id] && <em class="tv-badge">{badges[id]}</em>}
                </button>
              ))}
            </nav>
          )}
          <PhaseOverlay ctx={ctx} onLeave={() => setLeaving(true)} />
          {leaving && <LeaveDialog flight={flight} onStay={() => setLeaving(false)} />}
          {toast && (
            <div class="tv-toast" role="alert">
              {toast}
            </div>
          )}
        </div>
        <div class="tv-brand">Flight 13 · In-flight system</div>
      </div>
    </div>
  );
}

function PackingScreen({ ctx }: { ctx: TVContext }) {
  const packing = usePacking(ctx);
  return <PackingPanel ctx={ctx} packing={packing} />;
}

function useUnread(game: PlayerView, reading: boolean): number {
  const latest = game.chat.at(-1)?.id ?? 0;
  const lastSeen = useRef(latest);
  useEffect(() => {
    if (reading) lastSeen.current = latest;
  }, [reading, latest]);
  if (reading) return 0;
  return game.chat.filter((m) => m.id > lastSeen.current && m.from !== game.you?.id).length;
}

export function LeaveDialog({ flight, onStay }: { flight: OpenFlight; onStay: () => void }) {
  const hosting = flight.host !== null;
  return (
    <div class="tv-overlay" role="dialog" aria-modal="true">
      <div class="tv-card">
        <h2>Leave the flight?</h2>
        <p>
          {hosting
            ? 'You are the host. If you leave, the flight pauses for everyone until you come back to this page.'
            : 'You can come back with the same link and take your seat again.'}
        </p>
        <div class="row">
          <button class="btn primary" onClick={onStay}>
            Stay aboard
          </button>
          <button class="btn ghost" onClick={() => navigate('/')}>
            Leave
          </button>
          {hosting && (
            <button
              class="btn danger"
              onClick={() => {
                endFlight(flight.code);
                navigate('/');
              }}
            >
              End flight for everyone
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
