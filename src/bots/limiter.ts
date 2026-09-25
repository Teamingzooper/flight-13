/**
 * Keeps bots from flooding the chat: at most one bot line every 2.5 s across all bots, and 6 s between one
 * bot's own lines. Answers to a player skip the shared gap (but not their own), keeping just a short
 * breath between speakers.
 */
export class TalkLimiter {
  private last = -Infinity;
  private readonly byBot = new Map<string, number>();

  constructor(
    private readonly globalMs = 2500,
    private readonly perBotMs = 6000,
  ) {}

  may(botId: string, now: number, reply: boolean): boolean {
    if (now - (this.byBot.get(botId) ?? -Infinity) < this.perBotMs) return false;
    return now - this.last >= (reply ? 900 : this.globalMs);
  }

  spoke(botId: string, now: number): void {
    this.last = now;
    this.byBot.set(botId, now);
  }
}
