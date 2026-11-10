// Run riOs as a normal Node server (local dev, Render, a VPS...).
// Renewals run every hour here; on Vercel a daily cron calls /cron/renew instead.
import { createServer } from 'node:http';
import { getApp } from './src/app.js';

const { config, vault, handler } = getApp();
createServer(handler).listen(config.port, () => {
  console.log(`riOs MCP server on ${config.publicUrl}/mcp (PayPal ${config.paypal.env})`);
});

async function renew() {
  try { const r = await vault.runRenewals(); if (r.submitted || r.paid || r.failed || r.errors.length) console.log('[rios] renewals', r); }
  catch (e) { console.error('[rios] renewals failed', e); }
}
setTimeout(renew, 5000);
setInterval(renew, Number(process.env.RIOS_RENEW_INTERVAL_MIN || 60) * 60000);
