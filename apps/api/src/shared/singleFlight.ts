/**
 * Collapses concurrent identical work into one call. Idempotency keys stop a retried request from
 * *storing* twice, but a request that awaits an external provider (AI coach, food recognition)
 * would still *call* it twice if a retry arrives while the first is in flight — double cost, and
 * two different answers for one message. With a single flight, the second caller waits for the
 * first and gets the same result. Keys must include the user id.
 */
export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;
    const p = fn().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  get size(): number {
    return this.inFlight.size;
  }
}
