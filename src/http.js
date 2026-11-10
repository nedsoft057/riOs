// One request handler for both the Node server and Vercel functions.
//   POST /mcp                    MCP endpoint (key in "Authorization: Bearer <key>")
//   POST /mcp/k/<key>            same, key in the path (for clients that can't set headers)
//   GET  /paypal/return          PayPal sends the payer here after approving; we lock the funds
//   GET  /paypal/cancel          PayPal sends the payer here if they cancel
//   GET  /signup, POST /signup   create a riOs account and get an API key
//   POST /cron/renew             daily renewals (Authorization: Bearer <CRON_SECRET>)
//   GET  /health
import { handleMessage, SERVER_INFO } from './mcp.js';

const MAX_BODY = 1_000_000;

export function createHandler({ vault, config }) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    // On Vercel every route is rewritten to /api/index?__path=<original path>.
    const raw = url.searchParams.get('__path') || url.pathname;
    url.searchParams.delete('__path');
    const path = raw.replace(/^\/api\/index(?=\/|$)/, '').replace(/^\/api(?=\/|$)/, '').replace(/\/+$/, '') || '/';
    try {
      if (path === '/health') return json(res, 200, { ok: true, server: SERVER_INFO, paypal: config.paypal.env });
      if (path === '/' && req.method === 'GET') return html(res, 200, page('riOs MCP server', `<p>This is the riOs MCP server. Connect your AI assistant to <code>${esc(config.publicUrl)}/mcp</code>.</p><p><a href="/signup">Get an API key</a></p>`));

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
        if (!depositId || !orderId) return html(res, 400, page('Missing details', '<p>This link is incomplete. Go back to your AI assistant and ask it to check your funding.</p>'));
        try {
          const d = await vault.confirmFunding(depositId, { orderId });
          if (d.status === 'locked') {
            return html(res, 200, page('You\'re covered', `<p class="big">✓ ${esc(d.subscription)} is funded for ${d.months} month${d.months > 1 ? 's' : ''}.</p><p>${esc(d.covers)} is now locked and riOs will pay each renewal on time.</p><p>You can close this page and go back to your AI assistant.</p>`));
          }
          return html(res, 200, page('Almost there', `<p>PayPal hasn't completed this payment yet. Ask your AI assistant to check the funding again in a minute.</p>`));
        } catch (e) {
          if (!e.user) console.error('[rios] paypal return failed:', e);
          return html(res, e.user ? 404 : 502, page('Something went wrong', `<p>${esc(e.user ? e.message : 'We could not confirm the payment with PayPal right now.')}</p><p>Your money is safe. Ask your AI assistant to check the funding again.</p>`));
        }
      }

      if (path === '/paypal/cancel') {
        const depositId = url.searchParams.get('deposit');
        if (depositId) await vault.markFundingCancelled(depositId);
        return html(res, 200, page('Payment cancelled', '<p>No money was taken. You can start a new funding from your AI assistant any time.</p>'));
      }

      if (path === '/signup') {
        if (!config.allowSignup) return html(res, 403, page('Sign-ups are closed', '<p>New accounts are not open right now.</p>'));
        if (req.method === 'GET') return html(res, 200, page('Get your riOs key', signupForm()));
        if (req.method === 'POST') {
          const body = await readForm(req);
          const { user, apiKey } = await vault.createUser(body.name);
          return html(res, 200, page('Your riOs key', keyPage(config, user, apiKey)));
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
}

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · riOs</title>
<style>:root{--ink:#0B121A;--muted:#4A5A6A;--sky:#98D5FD;--cobalt:#2F7BFF;--bg:#F2F7FB}@media (prefers-color-scheme:dark){:root{--ink:#EAF2F9;--muted:#9DB0C1;--bg:#0B121A;--cobalt:#6EB2FF}}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:620px;margin:0 auto;padding:48px 20px}
h1{font-size:30px;margin:0 0 16px}.brand{font-weight:700;font-size:22px;margin-bottom:32px;display:block;color:var(--ink);text-decoration:none}p{color:var(--muted)}.big{font-size:21px;color:var(--ink)}
code,pre{background:rgba(127,160,200,.15);border-radius:8px;padding:2px 6px;font-family:ui-monospace,Menlo,monospace;font-size:14px;word-break:break-all}pre{padding:14px;white-space:pre-wrap}
input{font:inherit;padding:12px 14px;border-radius:10px;border:1px solid #9DB0C1;width:100%;box-sizing:border-box;background:transparent;color:inherit}button{font:inherit;font-weight:600;margin-top:12px;padding:12px 20px;border-radius:999px;border:0;background:var(--cobalt);color:#fff;cursor:pointer}
.warn{border-left:3px solid var(--cobalt);padding-left:12px}</style></head><body><main><a class="brand" href="https://riospay.xyz">riOs</a><h1>${esc(title)}</h1>${body}</main></body></html>`;
}
function signupForm() {
  return `<p>Create a riOs account and connect it to your AI assistant. This runs on PayPal's sandbox: no real money moves.</p>
<form method="post"><label for="name">Your name</label><input id="name" name="name" maxlength="60" required placeholder="Favour"><button type="submit">Create my key</button></form>`;
}
function keyPage(config, user, key) {
  const mcp = `${config.publicUrl}/mcp`;
  return `<p class="big">Welcome, ${esc(user.name)}. Here's your riOs API key.</p><pre>${esc(key)}</pre>
<p class="warn">Copy it now: riOs only stores a fingerprint of it and can't show it again. Treat it like a password.</p>
<h2>Connect your AI</h2>
<p><b>Claude Code</b></p><pre>claude mcp add --transport http rios ${esc(mcp)} --header "Authorization: Bearer ${esc(key)}"</pre>
<p><b>Claude (custom connector) and other apps that only take a URL</b></p><pre>${esc(config.publicUrl)}/mcp/k/${esc(key)}</pre>
<p><b>Cursor / other MCP clients</b>: server URL <code>${esc(mcp)}</code>, header <code>Authorization: Bearer ${esc(key)}</code></p>`;
}
