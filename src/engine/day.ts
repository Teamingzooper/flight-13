import { serveLunch } from './meal';
import { emptyDay } from './setup';
import { activePlayers, addLog, getPlayer, label, readNote, removeFromPlay, setPhase } from './state';
import type { GameState } from './types';

export function startDay(s: GameState, now: number): void {
  setPhase(s, 'day_discuss', now);
  s.day = emptyDay();
  serveLunch(s, now);
}

/** How much a vote weighs today (a frequent-flyer card doubles it). */
export function voteWeight(s: GameState, voter: string): number {
  return s.day.doubled[voter] ? 2 : 1;
}

/** Every active player counts once (twice with a card); non-votes and votes for players out of play count as Skip. */
export function tallyVotes(s: GameState): Record<string, number> {
  const tally: Record<string, number> = { skip: 0 };
  for (const p of activePlayers(s)) {
    const vote = s.day.votes[p.id];
    const key = vote && vote !== 'skip' && getPlayer(s, vote)?.status === 'alive' ? vote : 'skip';
    tally[key] = (tally[key] ?? 0) + voteWeight(s, p.id);
  }
  return tally;
}

/** A player is restrained only with strictly the most votes and more votes than Skip. */
export function resolveVote(s: GameState, now: number): void {
  const tally = tallyVotes(s);
  let leader: string | null = null;
  let leaderVotes = 0;
  let tied = false;
  for (const [id, votes] of Object.entries(tally)) {
    if (id === 'skip') continue;
    if (votes > leaderVotes) {
      leader = id;
      leaderVotes = votes;
      tied = false;
    } else if (votes === leaderVotes) {
      tied = true;
    }
  }
  const restrained = leader !== null && !tied && leaderVotes > tally.skip ? getPlayer(s, leader)! : null;
  // Who voted for whom goes on record when votes are open (everyone saw it anyway).
  const votes = s.settings.anonymousVotes ? {} : { votes: { ...s.day.votes } };
  if (restrained) {
    removeFromPlay(s, restrained, 'restrained', s.phase.night);
    addLog(s, now, 'all', 'verdict', `The passengers restrained ${label(s, restrained)} and walked them to the rear galley.`, {
      player: restrained.id,
      ...votes,
    });
    readNote(s, restrained, now);
  } else {
    addLog(s, now, 'all', 'verdict', 'No one was restrained.', s.settings.anonymousVotes ? undefined : votes);
  }
  s.verdict = { night: s.phase.night, restrained: restrained?.id ?? null, tally };
}
