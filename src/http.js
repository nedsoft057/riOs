// One request handler for both the Node server and Vercel functions.
//   POST /mcp                    MCP endpoint (key in "Authorization: Bearer <key>")
//   POST /mcp/k/<key>            same, key in the path (for clients that can't set headers)
//   GET  /paypal/return          PayPal sends the payer here after approving; we lock the funds
//   GET  /paypal/cancel          PayPal sends the payer here if they cancel
//   GET  /signup, POST /signup   create a riOs account and get an API key
//   POST /cron/renew             daily renewals (Authorization: Bearer <CRON_SECRET>)
//   GET  /health
import { handleMessage, SERVER_INFO } from './mcp.js';
import { ICON_PNG_256, ICON_PNG_48 } from './icon.js';
import { homePage, signupPage, keyPage, coveredPage, messagePage, consolePage, proofPage } from './web.js';
import { runStressStep, stressReport } from './stress.js';
import { timingSafeEqual } from 'node:crypto';
import { docsPage } from './docs.js';

const MAX_BODY = 1_000_000;

export function createHandler({ vault, config, store, paypal }) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    // On Vercel every route is rewritten to /api/index?__path=<original path>.
    const raw = url.searchParams.get('__path') || url.pathname;
    url.searchParams.delete('__path');
    const path = raw.replace(/^\/api\/index(?=\/|$)/, '').replace(/^\/api(?=\/|$)/, '').replace(/\/+$/, '') || '/';
    try {
      if (path === '/health') return json(res, 200, { ok: true, server: { name: SERVER_INFO.name, title: SERVER_INFO.title, version: SERVER_INFO.version }, paypal: config.paypal.env });
      if (path === '/icon.png' || path === '/apple-touch-icon.png') return png(res, ICON_PNG_256);
      if (path === '/favicon.ico' || path === '/favicon.png') return png(res, ICON_PNG_48);
      if (path === '/' && req.method === 'GET') return html(res, 200, homePage());
      if (path === '/app' && req.method === 'GET') return html(res, 200, consolePage(config.publicUrl));
      if (path === '/docs' && req.method === 'GET') return html(res, 200, docsPage(config.publicUrl));
      if (path.startsWith('/v1/')) return api(req, res, path, url);
      if (path === '/proof' && req.method === 'GET') return html(res, 200, proofPage(await stressReport(store)));
      if (path === '/proof.json' && req.method === 'GET') return json(res, 200, await stressReport(store));
      if (path === '/admin/rekey') {
        const k = url.searchParams.get('key') || '';
        if (!config.stressKey || !safeEq(k, config.stressKey)) return json(res, 401, { error: 'Unauthorized' });
        try { return json(res, 200, await vault.rotateKey(url.searchParams.get('user'))); }
        catch (e) { return json(res, e.user ? 404 : 500, { error: e.message }); }
      }
      if (path === '/admin/stress') {
        const k = url.searchParams.get('key') || bearer(req) || '';
        if (!config.stressKey || !safeEq(k, config.stressKey)) return json(res, 401, { error: 'Unauthorized' });
        try { return json(res, 200, await runStressStep({ vault, store, paypal, config }, { payee: url.searchParams.get('payee') })); }
        catch (e) { console.error('[rios] stress step failed:', e); return json(res, 502, { error: e.message, details: e.details || null }); }
      }

      if (path === '/mcp' || path.startsWith('/mcp/k/')) {
        if (req.method === 'GET') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Use POST for MCP requests' }); }
        if (req.method === 'DELETE') return end(res, 204);
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
        const origin = req.headers.origin;
        if (origin && !allowedOrigin(origin, config)) return json(res, 403, { error: 'Origin not allowed' });
        const key = path.startsWith('/mcp/k/') ? decodeURIComponent(path.slice(7)) : bearer(req);
        const user = await vault.authenticate(key);
        if (!user) {
          res.setHeader('WWW-Authenticate', 'Bearer realm="riOs"');
          return json(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: `Missing or invalid riOs API key. Get one at ${config.publicUrl}/signup` } });
        }
        const body = await readJson(req);
        if (body === undefined) return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        if (Array.isArray(body)) {
          const out = (await Promise.all(body.map(m => handleMessage(vault, user, m)))).filter(Boolean);
          return out.length ? json(res, 200, out) : end(res, 202);
        }
        const out = await handleMessage(vault, user, body);
        return out ? json(res, 200, out) : end(res, 202);
      }

      if (path === '/paypal/return') {
        const depositId = url.searchParams.get('deposit'); const orderId = url.searchParams.get('token');
        if (!depositId || !orderId) return html(res, 400, messagePage('Missing details', 'This link is incomplete. Go back to your AI and ask it to check your funding.'));
        try {
          const d = await vault.confirmFunding(depositId, { orderId });
          if (d.status === 'locked') return html(res, 200, coveredPage(d));
          return html(res, 200, messagePage('Almost there', "PayPal hasn't completed this payment yet. Ask your AI to check the funding again in a minute."));
        } catch (e) {
          if (!e.user) console.error('[rios] paypal return failed:', e);
          return html(res, e.user ? 404 : 502, messagePage('Something went wrong', `${esc(e.user ? e.message : 'We could not confirm the payment with PayPal right now.')} Your money is safe. Ask your AI to check the funding again.`));
        }
      }

      if (path === '/paypal/cancel') {
        const depositId = url.searchParams.get('deposit');
        if (depositId) await vault.markFundingCancelled(depositId);
        return html(res, 200, messagePage('Payment cancelled', 'No money was taken. You can start a new funding from your AI or your console any time.', 'Nothing charged'));
      }

      if (path === '/signup') {
        if (!config.allowSignup) return html(res, 403, messagePage('Sign-ups are closed', 'New accounts are not open right now.'));
        if (req.method === 'GET') return html(res, 200, signupPage());
        if (req.method === 'POST') {
          const body = await readForm(req);
          const { user, apiKey } = await vault.createUser(body.name);
          return html(res, 200, keyPage(config.publicUrl, user, apiKey));
        }
      }

      if (path === '/cron/renew') {
        if (!config.cronSecret || bearer(req) !== config.cronSecret) return json(res, 401, { error: 'Unauthorized' });
        return json(res, 200, await vault.runRenewals());
      }

      return json(res, 404, { error: 'Not found' });
    } catch (e) {
      console.error('[rios] request failed:', e);
      return json(res, 500, { error: 'Internal error' });
    }
  };

  // JSON API for the console (/v1/...; /api is taken by Vercel's function path). Same key as MCP, sent as "Authorization: Bearer <key>".
  async function api(req, res, path, url) {
    const user = await vault.authenticate(bearer(req));
    if (!user) return json(res, 401, { error: 'Missing or invalid riOs key' });
    const m = req.method, parts = path.split('/').filter(Boolean).slice(1); // after "v1"
    try {
      if (m === 'POST' && parts[0] === 'key' && parts[1] === 'rotate') return json(res, 200, await vault.rotateKey(user.id));
      if (m === 'GET' && parts[0] === 'me') return json(res, 200, { name: user.name });
      if (m === 'GET' && parts[0] === 'subscriptions') return json(res, 200, await vault.listSubscriptions(user));
      if (m === 'GET' && parts[0] === 'activity') return json(res, 200, await vault.activity(user, url.searchParams.get('limit')));
      if (m === 'POST' && parts[0] === 'subscriptions' && parts.length === 1) return json(res, 200, await vault.addSubscription(user, (await readJson(req)) || {}));
      if (m === 'POST' && parts[0] === 'subscriptions' && parts[2] === 'quote') return json(res, 200, await vault.quoteFunding(user, parts[1], ((await readJson(req)) || {}).months));
      if (m === 'POST' && parts[0] === 'subscriptions' && parts[2] === 'fund') return json(res, 200, await vault.startFunding(user, parts[1], ((await readJson(req)) || {}).months));
      if (m === 'DELETE' && parts[0] === 'subscriptions' && parts[1]) return json(res, 200, await vault.removeSubscription(user, parts[1]));
      if (m === 'POST' && parts[0] === 'deposits' && parts[2] === 'cancel') return json(res, 200, await vault.cancelDeposit(user, parts[1]));
      if (m === 'POST' && parts[0] === 'deposits' && parts[2] === 'check') return json(res, 200, await vault.confirmFunding(parts[1], { userId: user.id }));
      return json(res, 404, { error: 'Not found' });
    } catch (e) {
      if (e.user) return json(res, e.code === 'not_found' ? 404 : 400, { error: e.message });
      console.error('[rios] api failed:', e);
      return json(res, 502, { error: e.message || 'Request failed' });
    }
  }
}

function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }
function bearer(req) { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7).trim() : null; }
function allowedOrigin(origin, config) {
  try { const o = new URL(origin); return o.hostname === 'localhost' || o.hostname === '127.0.0.1' || origin === new URL(config.publicUrl).origin || /(^|\.)claude\.ai$|(^|\.)anthropic\.com$|(^|\.)openai\.com$|(^|\.)chatgpt\.com$/.test(o.hostname); }
  catch { return false; }
}

async function readRaw(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new Error('Body too large'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
async function readJson(req) {
  const raw = await readRaw(req);
  if (raw && typeof raw === 'object') return raw; // Vercel already parsed it
  try { return JSON.parse(raw); } catch { return undefined; }
}
async function readForm(req) {
  const raw = await readRaw(req);
  if (raw && typeof raw === 'object') return raw;
  return Object.fromEntries(new URLSearchParams(raw));
}

function json(res, status, data) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data)); }
function html(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(body); }
function end(res, status) { res.statusCode = status; res.end(); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/icon.png"><title>${esc(title)} · riOs</title>
<style>:root{--ink:#0B121A;--muted:#4A5A6A;--sky:#98D5FD;--cobalt:#2F7BFF;--bg:#F2F7FB}@media (prefers-color-scheme:dark){:root{--ink:#EAF2F9;--muted:#9DB0C1;--bg:#0B121A;--cobalt:#6EB2FF}}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:620px;margin:0 auto;padding:48px 20px}
h1{font-size:30px;margin:0 0 16px}.brand{font-weight:700;font-size:22px;margin-bottom:32px;display:block;color:var(--ink);text-decoration:none}p{color:var(--muted)}.big{font-size:21px;color:var(--ink)}
code,pre{background:rgba(127,160,200,.15);border-radius:8px;padding:2px 6px;font-family:ui-monospace,Menlo,monospace;font-size:14px;word-break:break-all}pre{padding:14px;white-space:pre-wrap}
input{font:inherit;padding:12px 14px;border-radius:10px;border:1px solid #9DB0C1;width:100%;box-sizing:border-box;background:transparent;color:inherit}button{font:inherit;font-weight:600;margin-top:12px;padding:12px 20px;border-radius:999px;border:0;background:var(--cobalt);color:#fff;cursor:pointer}
.warn{border-left:3px solid var(--cobalt);padding-left:12px}</style></head><body><main><a class="brand" href="https://riospay.xyz">riOs</a><h1>${esc(title)}</h1>${body}</main></body></html>`;
}
function png(res, b64) {
  const buf = Buffer.from(b64, 'base64');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', buf.length);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(buf);
}
