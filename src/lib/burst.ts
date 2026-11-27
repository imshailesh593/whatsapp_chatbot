/**
 * Holds the messages a customer sends in quick succession ("hi", "hello", "anyone there?") and hands them over together once
 * they stop, so the bot answers once instead of once per message. Each new message restarts the wait, but never past maxWaitMs
 * from the first one, so a long stream of messages is still answered.
 */
export interface BurstItem {
  text: string;
  id: string;
  name?: string;
}

export class MessageBurst {
  private readonly pending = new Map<string, { items: BurstItem[]; first: number; timer: NodeJS.Timeout }>();

  constructor(
    private readonly onReady: (key: string, items: BurstItem[]) => void,
    private readonly waitMs: () => number,
    private readonly maxWaitMs = 8000
  ) {}

  add(key: string, item: BurstItem): void {
    const entry = this.pending.get(key);
    if (entry) clearTimeout(entry.timer);
    const first = entry?.first ?? Date.now();
    const items = [...(entry?.items ?? []), item];
    const delay = Math.max(0, Math.min(this.waitMs(), this.maxWaitMs - (Date.now() - first)));
    const timer = setTimeout(() => {
      const e = this.pending.get(key);
      this.pending.delete(key);
      if (e) this.onReady(key, e.items);
    }, delay);
    this.pending.set(key, { items, first, timer });
  }

  /** Messages still waiting for their moment (used by tests and on shutdown). */
  size(): number {
    return this.pending.size;
  }
}
