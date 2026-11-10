import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyDb } from './index.js';

export class FileStore {
  constructor(path) { this.path = path; this.queue = Promise.resolve(); }
  async read() {
    try { return JSON.parse(await readFile(this.path, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return emptyDb(); throw e; }
  }
  async write(db) {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2));
    await rename(tmp, this.path);
  }
  // Run fn(db) with exclusive access; save if it returns without throwing.
  transact(fn) {
    const run = this.queue.then(async () => {
      const db = await this.read();
      const out = await fn(db);
      await this.write(db);
      return out;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
