// Storage: one JSON document holding the whole ledger, changed under a lock.
// Locally it's a file; on Vercel it's Upstash Redis (free tier), which keeps
// data between serverless calls.
import { FileStore } from './file.js';
import { UpstashStore } from './upstash.js';
import { MemoryStore } from './memory.js';

export function emptyDb() {
  return { version: 1, users: [], subscriptions: [], deposits: [], payments: [], events: [] };
}

export function createStore(cfg) {
  if (cfg.store.upstashUrl && cfg.store.upstashToken) return new UpstashStore(cfg.store.upstashUrl, cfg.store.upstashToken);
  if (process.env.VERCEL) throw new Error('On Vercel, riOs needs Upstash Redis: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  return new FileStore(cfg.store.file);
}

export { FileStore, UpstashStore, MemoryStore };
