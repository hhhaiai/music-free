export type SourceHealthRecord = {
  sourceId: string;
  failures: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  retryAt: number | null;
  lastError: string | null;
};

export class SourceHealthRegistry {
  private readonly records = new Map<string, SourceHealthRecord>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) { this.now = now; }

  recordSuccess(sourceId: string): SourceHealthRecord {
    const next: SourceHealthRecord = {
      sourceId, failures: 0, lastFailureAt: null, lastSuccessAt: this.now(), retryAt: null, lastError: null,
    };
    this.records.set(sourceId, next);
    return next;
  }

  recordFailure(sourceId: string, error: string): SourceHealthRecord {
    const previous = this.records.get(sourceId);
    const failures = (previous?.failures || 0) + 1;
    const cooldown = Math.min(10 * 60_000, 15_000 * (2 ** Math.min(failures - 1, 6)));
    const next: SourceHealthRecord = {
      sourceId, failures, lastFailureAt: this.now(), lastSuccessAt: previous?.lastSuccessAt || null,
      retryAt: this.now() + cooldown, lastError: String(error || "音源播放失败").slice(0, 240),
    };
    this.records.set(sourceId, next);
    return next;
  }

  get(sourceId: string): SourceHealthRecord | null {
    return this.records.get(sourceId) || null;
  }

  retryAfterMs(sourceId: string): number {
    const retryAt = this.records.get(sourceId)?.retryAt;
    return retryAt ? Math.max(0, retryAt - this.now()) : 0;
  }

  canAutoRetry(sourceId: string): boolean {
    return this.retryAfterMs(sourceId) <= 0;
  }

  clear(sourceId?: string): void {
    if (sourceId) this.records.delete(sourceId);
    else this.records.clear();
  }

  list(): SourceHealthRecord[] {
    return [...this.records.values()].sort((a, b) => (b.lastFailureAt || 0) - (a.lastFailureAt || 0));
  }
}

export const sourceHealth = new SourceHealthRegistry();
