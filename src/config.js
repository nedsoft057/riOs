// Configuration from environment variables (and a local .env file when present).
import { readFileSync, existsSync } from 'node:fs';

function loadDotEnv(path = '.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export function loadConfig(env = process.env) {
  if (env === process.env) loadDotEnv();
  const paypalEnv = (env.PAYPAL_ENV || 'sandbox').toLowerCase();
  if (paypalEnv === 'live' && env.RIOS_ALLOW_LIVE !== 'yes') {
    throw new Error('PAYPAL_ENV=live is blocked. riOs must be tested and audited first. Set RIOS_ALLOW_LIVE=yes only when you are ready.');
  }
  const defaultBase = paypalEnv === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  return {
    paypal: {
      clientId: env.PAYPAL_CLIENT_ID || '',
      clientSecret: env.PAYPAL_CLIENT_SECRET || '',
      env: paypalEnv,
      apiBase: (env.PAYPAL_API_BASE || defaultBase).replace(/\/$/, ''),
    },
    publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 8787}`).replace(/\/$/, ''),
    port: Number(env.PORT || 8787),
    currency: env.RIOS_CURRENCY || 'USD',
    // Fee in basis points of the deposit (200 = 2%). Off for the hackathon.
    feeBps: Number(env.RIOS_FEE_BPS || 0),
    cancelWindowHours: Number(env.RIOS_CANCEL_WINDOW_HOURS || 72),
    maxMonths: Number(env.RIOS_MAX_MONTHS || 24),
    maxMonthlyCents: Number(env.RIOS_MAX_MONTHLY_CENTS || 100000),
    cronSecret: env.CRON_SECRET || '',
    allowSignup: env.RIOS_ALLOW_SIGNUP !== 'no',
    store: {
      upstashUrl: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '',
      upstashToken: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '',
      file: env.RIOS_DATA_FILE || '.data/rios.json',
    },
  };
}
