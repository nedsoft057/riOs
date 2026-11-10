// Upstash Redis over its REST API. The ledger is one JSON value; a short lock
// key makes changes one-at-a-time across serverless instances.
import { randomBytes } from 'node:crypto';
import { emptyDb } from './index.js';

const KEY = 'rios:db';
const LOCK = 'rios:lock';
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export class UpstashStore {
  constructor(url, token) { this.url = url.replace(/\/$/, ''); this.token = token; }

  async cmd(...args) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`Upstash error: ${body.error || res.status}`);
    return body.result;
  }

  async transact(fn) {
    const token = randomBytes(12).toString('hex');
    const deadline = Date.now() + 15000;
    while ((await this.cmd('SET', LOCK, token, 'NX', 'PX', '20000')) !== 'OK') {
      if (Date.now() > deadline) throw new Error('riOs is busy, please try again in a moment.');
      await new Promise(r => setTimeout(r, 120 + Math.random() * 200));
    }
    try {
      const raw = await this.cmd('GET', KEY);
      const db = raw ? JSON.parse(raw) : emptyDb();
      const out = await fn(db);
      await this.cmd('SET', KEY, JSON.stringify(db));
      return out;
    } finally {
      await this.cmd('EVAL', RELEASE, '1', LOCK, token).catch(() => {});
    }
  }
}
