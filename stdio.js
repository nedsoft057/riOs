// Run riOs as a local MCP server over stdio (Claude Desktop, Cursor...).
// Set RIOS_API_KEY to your key. Logs go to stderr so stdout stays pure JSON-RPC.
import { createInterface } from 'node:readline';
import { getApp } from './src/app.js';
import { handleMessage } from './src/mcp.js';

console.log = (...a) => console.error(...a);
const { vault } = getApp();
const user = await vault.authenticate(process.env.RIOS_API_KEY);
if (!user) { console.error('riOs: set RIOS_API_KEY to a valid key (create one with: npm run create-user -- "Your name")'); process.exit(1); }

const rl = createInterface({ input: process.stdin });
rl.on('line', async line => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
  const msgs = Array.isArray(msg) ? msg : [msg];
  const out = (await Promise.all(msgs.map(m => handleMessage(vault, user, m)))).filter(Boolean);
  if (out.length) process.stdout.write(JSON.stringify(Array.isArray(msg) ? out : out[0]) + '\n');
});
