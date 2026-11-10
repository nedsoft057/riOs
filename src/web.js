// Web pages for api.riospay.xyz: sign-in, signup, key, PayPal return pages and the riOs console.
// Everything is server-rendered HTML; the console is a small client app that talks to /api/* with the user's key.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MARK = `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="120" height="120" rx="26" fill="#EAF6FF"/><g transform="translate(60 60) scale(.82) translate(-60 -62)"><g transform="translate(60 62)"><rect x="-34" y="-40" width="64" height="74" rx="14" fill="#BFE3FB" transform="translate(-14 -10) rotate(-34) skewY(6)"/><rect x="-34" y="-40" width="64" height="74" rx="14" fill="#98D5FD" transform="translate(-7 -5) rotate(-24) skewY(6)"/><g transform="skewY(-17)"><rect x="-30" y="-30" width="66" height="72" rx="14" fill="#111A24"/><path d="M-8 26 V4 Q-8 -8 4 -10 L18 -12" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></g></g></g></svg>`;

const CSS = `
:root{--ink:#070D14;--card:rgba(16,28,42,.62);--line:rgba(152,213,253,.14);--text:#EEF5FB;--muted:#93A6B8;--sky:#98D5FD;--cobalt:#2F7BFF;--ok:#7BE0B0;--warn:#FFC978;--bad:#FF8A8A;
  --display:"Inter Tight","Inter",ui-sans-serif,system-ui,sans-serif;--body:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100svh;background:radial-gradient(80% 60% at 85% -10%,rgba(47,123,255,.28),transparent 60%),radial-gradient(70% 50% at -10% 110%,rgba(152,213,253,.12),transparent 60%),var(--ink);background-attachment:fixed;
  color:var(--text);font:16px/1.55 var(--body);-webkit-font-smoothing:antialiased}
body::after{content:"";position:fixed;inset:0;pointer-events:none;opacity:.06;mix-blend-mode:overlay;z-index:50;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
a{color:inherit}button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
h1,h2,h3{font-family:var(--display);letter-spacing:-.03em;line-height:1.05}
em.s{font-family:"Instrument Serif",serif;font-style:italic;font-weight:400;color:var(--sky);letter-spacing:-.01em}
.top{display:flex;align-items:center;justify-content:space-between;max-width:1080px;margin:0 auto;padding:16px 20px}
.brand{display:flex;align-items:center;gap:10px;font:700 21px var(--display);letter-spacing:-.02em;text-decoration:none}
.brand svg{width:30px;height:30px}
.badge{font:600 11px var(--body);letter-spacing:.1em;text-transform:uppercase;padding:5px 9px;border-radius:999px;background:rgba(255,201,120,.12);color:var(--warn);border:1px solid rgba(255,201,120,.25)}
.wrap{max-width:560px;margin:0 auto;padding:24px 20px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:24px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
.eyebrow{font:700 12px var(--body);letter-spacing:.18em;text-transform:uppercase;color:var(--sky)}
.title{font-size:clamp(34px,7vw,48px);font-weight:700;margin:12px 0 10px}
.lead{color:var(--muted);font-size:17px}
label{display:block;font-size:14px;font-weight:600;margin:20px 0 8px;color:#CFE0EE}
input,select{width:100%;font:inherit;padding:14px 16px;border-radius:14px;border:1px solid rgba(152,213,253,.22);background:rgba(4,9,15,.55);color:var(--text);outline:none}
input:focus,select:focus{border-color:var(--sky);box-shadow:0 0 0 3px rgba(152,213,253,.15)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 20px;border-radius:999px;background:#F4F8FB;color:#0B121A;font-weight:650;font-size:15px;text-decoration:none;transition:transform .15s}
.btn:active{transform:scale(.98)}.btn.full{width:100%;margin-top:18px}
.btn.ghost{background:rgba(255,255,255,.06);color:var(--text);border:1px solid rgba(255,255,255,.14)}
.btn.blue{background:var(--cobalt);color:#fff}
.btn.sm{padding:8px 14px;font-size:13px}
.muted{color:var(--muted)}.small{font-size:13px}
.mono{font:500 13px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.field{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:rgba(4,9,15,.6);border:1px solid var(--line);margin-top:10px}
.field .mono{flex:1}
.copy{flex:none;padding:7px 11px;border-radius:9px;background:rgba(152,213,253,.12);color:var(--sky);font:600 12px var(--body)}
.note{margin-top:16px;padding:14px 16px;border-radius:14px;background:rgba(47,123,255,.12);border:1px solid rgba(47,123,255,.25);font-size:14px;color:#CFE2F6}
.note.warn{background:rgba(255,201,120,.08);border-color:rgba(255,201,120,.25);color:#F6E1BE}
.center{text-align:center}
.check{width:86px;height:86px;margin:6px auto 18px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 30% 30%,#5C9BFF,var(--cobalt));box-shadow:0 20px 60px rgba(47,123,255,.45);animation:pop .6s cubic-bezier(.2,1.4,.4,1) both}
.check svg{width:42px;height:42px;stroke:#fff;stroke-width:3.2;fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:30;stroke-dashoffset:30;animation:draw .5s .35s ease forwards}
@keyframes pop{from{transform:scale(.4);opacity:0}}@keyframes draw{to{stroke-dashoffset:0}}
.rows{margin-top:18px;border-top:1px solid var(--line)}
.rows div{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);font-size:15px}
.rows span:first-child{color:var(--muted)}
.tabs{display:flex;gap:6px;padding:4px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid var(--line);margin:18px 0}
.tabs button{flex:1;padding:9px 6px;border-radius:999px;font-weight:600;font-size:14px;color:var(--muted)}
.tabs button.on{background:rgba(255,255,255,.92);color:#0B121A}
ol.steps{list-style:none;counter-reset:s;display:grid;gap:14px;margin-top:6px}
ol.steps li{counter-increment:s;display:grid;grid-template-columns:28px 1fr;gap:8px;font-size:15px}
ol.steps li::before{content:counter(s,decimal-leading-zero);font:700 12px var(--body);color:var(--sky);padding-top:3px}
.foot{max-width:1080px;margin:0 auto;padding:30px 20px 40px;color:#5E7385;font-size:13px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.fade{animation:fin .6s ease both}@keyframes fin{from{opacity:0;transform:translateY(12px)}}
`;

export function shell(title, body, { wide = false, script = '' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)} · riOs</title><meta name="theme-color" content="#070D14"><link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@600;700;800&family=Instrument+Serif:ital@0;1&display=swap">
<style>${CSS}</style></head><body>
<header class="top"><a class="brand" href="/">${MARK}riOs</a><span class="badge">Sandbox</span></header>
<main class="${wide ? '' : 'wrap'} fade">${body}</main>
<footer class="foot"><span>riOs · prepay your subscriptions, your AI handles the rest</span><span><a href="https://riospay.xyz">riospay.xyz</a></span></footer>
<script>
document.addEventListener('click', e => { const b = e.target.closest('[data-copy]'); if (!b) return;
  navigator.clipboard?.writeText(b.dataset.copy).then(() => { const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => b.textContent = t, 1400); }); });
${script}
</script></body></html>`;
}

const field = (value, label = 'Copy') => `<div class="field"><span class="mono">${esc(value)}</span><button class="copy" data-copy="${esc(value)}">${label}</button></div>`;

// ---------- sign in ----------
export function homePage() {
  return shell('Sign in', `
<div class="eyebrow">riOs console</div>
<h1 class="title">Your subscriptions, <em class="s">covered.</em></h1>
<p class="lead">Sign in with your riOs key to see what's locked, what's covered and every renewal riOs has paid.</p>
<div class="card" style="margin-top:26px">
  <form id="f"><label for="k" style="margin-top:0">Your riOs key</label><input id="k" autocomplete="off" spellcheck="false" placeholder="rios_…" required>
  <button class="btn full" type="submit">Open console</button><p id="err" class="small" style="color:var(--bad);margin-top:10px"></p></form>
</div>
<p class="center muted" style="margin-top:22px">New here? <a href="/signup" style="color:var(--sky)">Get a key in 10 seconds</a></p>`,
  { script: `
try { if (localStorage.getItem('rios_key')) location.replace('/app'); } catch {}
document.getElementById('f').onsubmit = async e => { e.preventDefault();
  const k = document.getElementById('k').value.trim(); const err = document.getElementById('err'); err.textContent = '';
  const r = await fetch('/v1/me', { headers: { Authorization: 'Bearer ' + k } });
  if (!r.ok) { err.textContent = 'That key was not recognised.'; return; }
  try { localStorage.setItem('rios_key', k); } catch {} location.href = '/app'; };` });
}

// ---------- signup ----------
export function signupPage() {
  return shell('Get your key', `
<div class="eyebrow">Get started</div>
<h1 class="title">Let your AI pay your <em class="s">subscriptions.</em></h1>
<p class="lead">Create your riOs key, connect it to Claude, ChatGPT or Cursor, and cover the months you can afford.</p>
<div class="card" style="margin-top:26px">
  <form method="post"><label for="name" style="margin-top:0">What should we call you?</label><input id="name" name="name" maxlength="60" required placeholder="Favour">
  <button class="btn full" type="submit">Create my key</button></form>
  <p class="small muted" style="margin-top:14px">Runs on PayPal's sandbox during the hackathon. No real money moves.</p>
</div>`);
}

export function keyPage(publicUrl, user, key) {
  const link = `${publicUrl}/mcp/k/${key}`;
  return shell('Your key', `
<div class="eyebrow">You're in</div>
<h1 class="title">Welcome, <em class="s">${esc(user.name)}.</em></h1>
<p class="lead">This is your riOs key. Copy it now: riOs only keeps a fingerprint and can't show it again.</p>
<div class="card" style="margin-top:22px">
  <label style="margin-top:0">Your key</label>${field(key)}
  <label>Your connector link</label>${field(link)}
  <p class="note warn">Treat both like a password. Anyone with them can manage your riOs subscriptions, but nobody can send locked money anywhere else.</p>
  <button class="btn full" id="open">Open my console</button>
</div>
<h2 style="font-size:26px;margin:34px 0 4px">Connect your AI</h2>
<div class="tabs" id="tabs"><button data-t="claude" class="on">Claude</button><button data-t="chatgpt">ChatGPT</button><button data-t="cursor">Cursor</button><button data-t="code">Claude Code</button></div>
<div class="card" id="guide"></div>`,
  { script: `
const KEY = ${JSON.stringify(key)}, LINK = ${JSON.stringify(link)}, MCP = ${JSON.stringify(publicUrl + '/mcp')};
${guidesJs()}
document.getElementById('open').onclick = () => { try { localStorage.setItem('rios_key', KEY); } catch {} location.href = '/app'; };
const show = t => { document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); document.getElementById('guide').innerHTML = guide(t, LINK, KEY, MCP); };
document.getElementById('tabs').onclick = e => { const b = e.target.closest('button'); if (b) show(b.dataset.t); };
show('claude');` });
}

// shared connect guides (used on the key page and in the console)
function guidesJs() {
  return `
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fld = v => '<div class="field"><span class="mono">' + esc(v) + '</span><button class="copy" data-copy="' + esc(v) + '">Copy</button></div>';
function guide(t, link, key, mcp) {
  const G = {
    claude: ['In Claude, open <b>Settings → Customize → Connectors</b> and tap <b>Add custom connector</b>.',
      'Name it <b>riOs</b> and paste your connector link:' + fld(link),
      'Choose <b>No sign-in</b>. Your key is already inside the link. Tap <b>Add</b>.',
      'Start a chat, switch on riOs in the tools menu and say: <i>“cover my design tool for 3 months”</i>.'],
    chatgpt: ['On chatgpt.com, open <b>Settings → Apps &amp; Connectors → Advanced</b> and turn on <b>Developer mode</b>.',
      'Create a connector named <b>riOs</b> with this server URL:' + fld(link),
      'Set authentication to <b>None</b> and save.',
      'In a new chat, enable riOs and ask what you can cover.'],
    cursor: ['Open <b>Cursor Settings → MCP → Add new server</b>, or add this to <span class="mono">~/.cursor/mcp.json</span>:' + fld(JSON.stringify({ mcpServers: { rios: { url: mcp, headers: { Authorization: 'Bearer ' + key } } } })),
      'Ask the agent: <i>“list my riOs subscriptions”</i>.'],
    code: ['Run this in your terminal:' + fld('claude mcp add --transport http rios ' + mcp + ' --header "Authorization: Bearer ' + key + '"'),
      'Start Claude Code and ask: <i>“what does riOs cover for me?”</i>'],
  };
  return '<ol class="steps">' + G[t].map(s => '<li><div>' + s + '</div></li>').join('') + '</ol>';
}`;
}

// ---------- PayPal return pages ----------
export function coveredPage(d) {
  const months = `${d.months} month${d.months > 1 ? 's' : ''}`;
  return shell("You're covered", `<div class="center">
<div class="check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
<div class="eyebrow">Payment approved</div>
<h1 class="title">You're <em class="s">covered.</em></h1>
<p class="lead">${esc(d.subscription)} is funded for ${months}. riOs pays every renewal on its due date.</p></div>
<div class="card" style="margin-top:24px"><div class="rows" style="margin-top:0;border-top:0">
<div><span>Subscription</span><span>${esc(d.subscription)}</span></div>
<div><span>Locked</span><span>$${esc(d.covers)}</span></div>
<div><span>Months covered</span><span>${months}</span></div>
<div><span>Change your mind</span><span>until ${esc(String(d.cancel_until || '').slice(0, 10))}</span></div></div>
<a class="btn full" href="/app">Open my console</a></div>
<p class="center muted small" style="margin-top:18px">You can close this page and go back to your AI.</p>`);
}
export function messagePage(title, text, accent = '') {
  return shell(title, `<div class="eyebrow">${esc(accent || 'riOs')}</div><h1 class="title">${esc(title)}</h1><p class="lead">${text}</p>
<div style="margin-top:26px"><a class="btn" href="/app">Open my console</a></div>`);
}

// ---------- console ----------
export function consolePage(publicUrl) {
  return shell('Console', `<div class="wrap" style="max-width:720px">
<div id="hero" class="card" style="padding:26px;background:linear-gradient(160deg,rgba(47,123,255,.32),rgba(16,28,42,.7) 55%);border-color:rgba(152,213,253,.25)">
  <div class="muted small" id="hello">Loading…</div>
  <div style="display:flex;align-items:baseline;gap:10px;margin-top:8px"><h1 style="font-size:clamp(44px,10vw,64px);font-weight:700" id="total">$0.00</h1><span class="muted">locked</span></div>
  <div class="muted" id="nexttxt" style="margin-top:2px"></div>
  <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap"><button class="btn sm" data-tab="add">＋ Add subscription</button><button class="btn sm ghost" data-tab="connect">Connect your AI</button></div>
</div>
<div class="tabs" id="tabs"><button data-tab="subs" class="on">Subscriptions</button><button data-tab="activity">Activity</button><button data-tab="connect">Connect</button><button data-tab="settings">Settings</button></div>
<div id="view"></div>
</div>
<style>
.sub{margin-bottom:12px}.sub h3{font-size:22px}.row{display:flex;justify-content:space-between;align-items:center;gap:10px}
.pill{font:600 12px var(--body);padding:5px 10px;border-radius:999px;white-space:nowrap}
.pill.ok{background:rgba(123,224,176,.12);color:var(--ok)}.pill.warn{background:rgba(255,201,120,.12);color:var(--warn)}.pill.bad{background:rgba(255,138,138,.12);color:var(--bad)}
.bar{height:8px;border-radius:8px;background:rgba(255,255,255,.07);overflow:hidden;margin:16px 0 8px}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--cobalt),var(--sky));border-radius:8px}
.acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.ev{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}.ev:last-child{border:0}
.dot{flex:none;width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:rgba(152,213,253,.1);color:var(--sky);font-size:15px}
.empty{text-align:center;padding:36px 20px;color:var(--muted)}
</style>`, { script: `
const MCP = ${JSON.stringify(publicUrl + '/mcp')}, BASE = ${JSON.stringify(publicUrl)};
${guidesJs()}
let KEY = null; try { KEY = localStorage.getItem('rios_key'); } catch {}
if (!KEY) location.replace('/');
const api = async (path, opt = {}) => {
  const r = await fetch('/v1' + path, { ...opt, headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' } });
  if (r.status === 401) { try { localStorage.removeItem('rios_key'); } catch {} location.replace('/'); }
  const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j;
};
const $ = id => document.getElementById(id), view = $('view');
const fmtDate = d => d ? new Date(d + (d.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
let me = null, subs = [], tab = 'subs';

async function load() {
  [me, subs] = await Promise.all([api('/me'), api('/subscriptions')]);
  $('hello').textContent = 'Hi ' + me.name + ' · riOs balance';
  const total = subs.reduce((t, s) => t + parseFloat(s.locked_balance), 0);
  $('total').textContent = '$' + total.toFixed(2);
  const next = subs.filter(s => s.status === 'active').sort((a, b) => a.next_renewal.localeCompare(b.next_renewal))[0];
  $('nexttxt').textContent = next ? 'Next renewal: ' + next.name + ' · $' + next.monthly + ' · ' + fmtDate(next.next_renewal) : 'Add a subscription to get started.';
  render();
}
function statusPill(s) {
  if (s.status === 'paused') return '<span class="pill bad">Paused · ' + esc(s.attention || 'check') + '</span>';
  if (s.renewals_covered > 0) return '<span class="pill ok">Covered</span>';
  if (s.waiting_for_approval.length) return '<span class="pill warn">Waiting for approval</span>';
  return '<span class="pill warn">Needs funding</span>';
}
function subCard(s) {
  const total = Math.max(s.renewals_covered, 1), pct = s.renewals_covered ? 100 : 0;
  let acts = '';
  s.waiting_for_approval.forEach(w => { acts += '<a class="btn sm blue" href="' + esc(w.approve_url) + '">Approve $' + esc(w.total) + ' in PayPal</a><button class="btn sm ghost" data-cancel="' + w.deposit_id + '">Cancel checkout</button>'; });
  s.cancellable_deposits.forEach(c => { acts += '<button class="btn sm ghost" data-cancel="' + c.deposit_id + '" data-refund="' + c.refundable + '">Cancel &amp; refund $' + esc(c.refundable) + '</button>'; });
  acts += '<button class="btn sm ghost" data-fund="' + s.subscription_id + '">Cover more months</button>';
  if (parseFloat(s.locked_balance) === 0 && !s.waiting_for_approval.length) acts += '<button class="btn sm ghost" data-remove="' + s.subscription_id + '">Remove</button>';
  const paid = (s.recent_payments || []).map(p => '<div><span>' + fmtDate(p.period) + '</span><span>$' + esc(p.amount) + ' · ' + esc(p.status) + '</span></div>').join('');
  return '<div class="card sub fade"><div class="row"><h3>' + esc(s.name) + '</h3>' + statusPill(s) + '</div>'
    + '<div class="muted small" style="margin-top:4px">$' + esc(s.monthly) + ' a month · pays ' + esc(s.pays_to) + '</div>'
    + '<div class="bar"><i style="width:' + pct + '%"></i></div>'
    + '<div class="row small"><span>' + s.renewals_covered + ' renewal' + (s.renewals_covered === 1 ? '' : 's') + ' covered · $' + esc(s.locked_balance) + ' locked</span><span class="muted">' + (s.covered_through ? 'through ' + fmtDate(s.covered_through) : 'next ' + fmtDate(s.next_renewal)) + '</span></div>'
    + (paid ? '<div class="rows">' + paid + '</div>' : '')
    + '<div class="acts">' + acts + '</div></div>';
}
async function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'subs') view.innerHTML = subs.length ? subs.map(subCard).join('') : '<div class="card empty">No subscriptions yet.<br><button class="btn sm" style="margin-top:14px" data-tab="add">Add your first one</button></div>';
  if (tab === 'activity') {
    view.innerHTML = '<div class="card"><div class="muted">Loading…</div></div>';
    const ev = await api('/activity?limit=40');
    const L = { subscription_added: ['＋', 'Subscription added'], funding_started: ['⧗', 'Checkout created'], funding_locked: ['🔒', 'Funds locked'], renewal_paid: ['✓', 'Renewal paid'], renewal_failed: ['!', 'Renewal failed, money returned'], renewal_sent: ['→', 'Renewal sent'], renewal_unfunded: ['…', 'Renewal due, not funded'], account_created: ['★', 'Account created'], deposit_refunded: ['↺', 'Deposit refunded'], funding_cancelled_in_paypal: ['×', 'Checkout cancelled'], subscription_removed: ['−', 'Subscription removed'] };
    view.innerHTML = '<div class="card">' + (ev.length ? ev.map(e => { const [ic, lb] = L[e.type] || ['•', e.type.replace(/_/g, ' ')];
      const det = [e.name || e.subscription, e.amount ? '$' + e.amount : e.total ? '$' + e.total : e.monthly ? '$' + e.monthly + '/mo' : ''].filter(Boolean).join(' · ');
      return '<div class="ev"><div class="dot">' + ic + '</div><div style="flex:1"><div style="font-weight:600">' + lb + '</div><div class="muted small">' + esc(det) + '</div></div><div class="muted small">' + ago(e.at) + '</div></div>'; }).join('') : '<div class="empty">Nothing yet.</div>') + '</div>';
  }
  if (tab === 'connect') {
    const link = BASE + '/mcp/k/' + KEY;
    view.innerHTML = '<div class="card"><div class="eyebrow">Your connector link</div>' + fld(link) + '<div class="tabs" id="gt"><button data-g="claude" class="on">Claude</button><button data-g="chatgpt">ChatGPT</button><button data-g="cursor">Cursor</button><button data-g="code">Claude Code</button></div><div id="gd">' + guide('claude', link, KEY, MCP) + '</div></div>';
    $('gt').onclick = e => { const b = e.target.closest('button'); if (!b) return; $('gt').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('gd').innerHTML = guide(b.dataset.g, link, KEY, MCP); };
  }
  if (tab === 'settings') view.innerHTML = '<div class="card"><div class="rows" style="margin-top:0;border-top:0"><div><span>Name</span><span>' + esc(me.name) + '</span></div><div><span>Network</span><span>PayPal sandbox</span></div><div><span>Fee</span><span>0% during the hackathon</span></div></div><label>Your key</label>' + fld(KEY) + '<button class="btn full ghost" id="out">Sign out</button></div>';
  if (tab === 'add') view.innerHTML = '<div class="card fade"><h3 style="font-size:24px">Add a subscription</h3><p class="muted small" style="margin-top:4px">Who gets paid, how much, and when it renews.</p><form id="af">'
    + '<label>Name</label><input name="name" required placeholder="Design tool">'
    + '<label>Provider\\'s PayPal email</label><input name="payee_email" type="email" required placeholder="billing@provider.com">'
    + '<label>Monthly amount (USD)</label><input name="monthly_amount" inputmode="decimal" required placeholder="12.00">'
    + '<label>Next renewal</label><input name="next_billing_date" type="date" required value="' + new Date().toISOString().slice(0, 10) + '">'
    + '<button class="btn full" type="submit">Add subscription</button><p class="small" id="aerr" style="color:var(--bad);margin-top:10px"></p></form></div>';
  if (tab === 'fund') {
    const s = subs.find(x => x.subscription_id === fundId);
    view.innerHTML = '<div class="card fade"><h3 style="font-size:24px">Cover ' + esc(s.name) + '</h3><p class="muted small" style="margin-top:4px">$' + esc(s.monthly) + ' a month. You approve the total once in PayPal.</p>'
      + '<label>How many months?</label><select id="mo">' + Array.from({ length: 12 }, (_, i) => '<option value="' + (i + 1) + '"' + (i === 2 ? ' selected' : '') + '>' + (i + 1) + ' month' + (i ? 's' : '') + '</option>').join('') + '</select>'
      + '<div class="rows" id="q"></div><button class="btn full blue" id="go">Continue to PayPal</button><p class="small" id="ferr" style="color:var(--bad);margin-top:10px"></p></div>';
    const quote = async () => { const q = await api('/subscriptions/' + fundId + '/quote', { method: 'POST', body: JSON.stringify({ months: +$('mo').value }) });
      $('q').innerHTML = '<div><span>Covers</span><span>' + q.renewals_covered.map(fmtDate).join(', ') + '</span></div><div><span>Fee</span><span>$' + q.fee + '</span></div><div><span>Total</span><span><b>$' + q.total_to_pay + '</b></span></div>'; };
    $('mo').onchange = quote; quote();
    $('go').onclick = async () => { try { const f = await api('/subscriptions/' + fundId + '/fund', { method: 'POST', body: JSON.stringify({ months: +$('mo').value }) }); location.href = f.approve_url; } catch (e) { $('ferr').textContent = e.message; } };
  }
}
let fundId = null;
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; render(); return; }
  const f = e.target.closest('[data-fund]'); if (f) { fundId = f.dataset.fund; tab = 'fund'; render(); return; }
  const c = e.target.closest('[data-cancel]');
  if (c) { if (!confirm(c.dataset.refund ? 'Cancel this deposit and refund $' + c.dataset.refund + ' to your PayPal?' : 'Cancel this checkout?')) return;
    try { await api('/deposits/' + c.dataset.cancel + '/cancel', { method: 'POST' }); await load(); } catch (er) { alert(er.message); } return; }
  const r = e.target.closest('[data-remove]');
  if (r) { if (!confirm('Remove this subscription?')) return; try { await api('/subscriptions/' + r.dataset.remove, { method: 'DELETE' }); await load(); } catch (er) { alert(er.message); } return; }
  if (e.target.id === 'out') { try { localStorage.removeItem('rios_key'); } catch {} location.href = '/'; }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'af') return; e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try { await api('/subscriptions', { method: 'POST', body: JSON.stringify(body) }); tab = 'subs'; await load(); } catch (er) { $('aerr').textContent = er.message; }
});
load().catch(e => view.innerHTML = '<div class="card empty">' + esc(e.message) + '</div>');` });
}
