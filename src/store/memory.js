import { emptyDb } from './index.js';

// In-memory store for tests.
export class MemoryStore {
  constructor() { this.db = emptyDb(); this.queue = Promise.resolve(); }
  transact(fn) {
    const run = this.queue.then(async () => {
      const copy = structuredClone(this.db);
      const out = await fn(copy);
      this.db = copy;
      return out;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
