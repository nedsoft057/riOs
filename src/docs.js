// riOs docs page (api.riospay.xyz/docs). The tool reference is generated from the live TOOLS list,
// so the docs always match what the MCP server actually offers.
import { TOOLS, SERVER_INFO } from './mcp.js';
import { CSS, MARK, esc } from './web.js';

const REPO = 'https://github.com/nedsoft057/riOs';

// Example arguments and (shortened) results for each tool.
const EX = {
  rios_add_subscription: [{ name: 'Design tool', payee_email: 'billing@designtool.com', monthly_amount: '25.00', next_billing_date: '2026-11-10' },
    { subscription_id: 'sub_H-aB5pBwB15y', name: 'Design tool', monthly: '25.00', next_renewal: '2026-11-10', locked_balance: '0.00', renewals_covered: 0 }],
  rios_list_subscriptions: [{}, { count: 1, subscriptions: [{ name: 'Design tool', monthly: '25.00', locked_balance: '75.00', renewals_covered: 3, covered_through: '2027-02-09', payee_locked: true }] }],
  rios_quote: [{ subscription_id: 'sub_H-aB5pBwB15y', months: 3 }, { months: 3, covered_amount: '75.00', fee: '0.00', total_to_pay: '75.00', renewals_covered: ['2026-11-10', '2026-12-10', '2027-01-10'] }],
  rios_fund_subscription: [{ subscription_id: 'sub_H-aB5pBwB15y', months: 3 }, { deposit_id: 'dep_At0cWK29L3WF', status: 'waiting_for_approval', total_to_pay: '75.00', approve_url: 'https://www.sandbox.paypal.com/checkoutnow?token=…' }],
  rios_check_funding: [{ deposit_id: 'dep_At0cWK29L3WF' }, { status: 'locked', covers: '75.00', cancel_until: '2026-11-13T14:10:10Z' }],
  rios_cancel_deposit: [{ deposit_id: 'dep_At0cWK29L3WF' }, { status: 'refunded', refunded: '75.00', fee_kept: '0.00' }],
  rios_plan_budget: [{ budget: '50' }, { budget: '50.00', plan: [{ name: 'Design tool', months: 1, cost: '25.00' }, { name: 'Music', months: 2, cost: '21.98' }], left_over: '3.02' }],
  rios_activity: [{ limit: 3 }, [{ type: 'renewal_paid', subscription: 'Design tool', amount: '25.00', period: '2026-11-10' }]],
  rios_remove_subscription: [{ subscription_id: 'sub_H-aB5pBwB15y' }, { removed: true }],
};

// tiny highlighter: json and shell
function hl(code, lang) {
  if (lang === 'json') {   // tokenize raw text so numbers inside strings stay strings
    let out = '', last = 0;
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;
    for (let m; (m = re.exec(code));) {
      out += esc(code.slice(last, m.index));
      if (m[1]) out += m[2] ? `<i class="k">${esc(m[1])}</i>${m[2]}` : `<i class="s">${esc(m[1])}</i>`;
      else if (m[3]) out += `<i class="b">${m[3]}</i>`;
      else out += `<i class="n">${m[4]}</i>`;
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }
  let s = esc(code);
  if (lang === 'sh') {
    s = s.replace(/^(\$ )?(\w[\w-]*)/gm, (m, p, cmd) => `${p ? '<i class="c">$ </i>' : ''}<i class="f">${cmd}</i>`)
      .replace(/(&quot;[^\n]*?&quot;|&#39;[^\n]*?&#39;)/g, '<i class="s">$1</i>').replace(/( --?[\w-]+)/g, '<i class="b">$1</i>');
  }
  return s;
}
const code = (c, lang = 'json', label = '') => `<div class="code">${label ? `<div class="ch"><span>${esc(label)}</span><button class="copy" data-copy="${esc(c)}">Copy</button></div>` : `<button class="copy fl" data-copy="${esc(c)}">Copy</button>`}<pre><code>${hl(c, lang)}</code></pre></div>`;
const J = v => JSON.stringify(v, null, 2);

function toolDoc(t) {
  const props = Object.entries(t.inputSchema.properties || {}), req = new Set(t.inputSchema.required || []);
  const ex = EX[t.name] || [{}, {}];
  const rows = props.length ? `<table><thead><tr><th>Input</th><th>Type</th><th>About</th></tr></thead><tbody>${props.map(([k, v]) =>
    `<tr><td><code>${esc(k)}</code>${req.has(k) ? '<span class="req">required</span>' : ''}</td><td class="muted">${esc(v.type)}${v.minimum != null ? ` ${v.minimum}–${v.maximum}` : ''}</td><td>${esc(v.description || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No inputs.</p>';
  return `<article class="tool" id="${t.name}"><div class="th"><h3><code>${t.name}</code></h3><span class="tt">${esc(t.title || '')}</span></div>
<p>${esc(t.description)}</p>${rows}
<div class="pair">${code(J(ex[0]), 'json', 'Arguments')}${code(J(ex[1]), 'json', 'Result (shortened)')}</div></article>`;
}

export function docsPage(publicUrl) {
  const mcp = `${publicUrl}/mcp`;
  const nav = [['overview', 'Overview'], ['quickstart', 'Quickstart'], ['connect', 'Connect your AI'], ['money', 'How the money moves'], ['rules', 'Rules'], ['tools', 'MCP tools'], ['protocol', 'Raw MCP'], ['api', 'Console API'], ['limits', 'Limits & roadmap'], ['source', 'Source code']];
  const body = `
<aside class="side"><nav>${nav.map(([id, l]) => `<a href="#${id}" data-s="${id}">${l}</a>`).join('')}
<div class="sub">${TOOLS.map(t => `<a href="#${t.name}" class="tl">${t.name.replace('rios_', '')}</a>`).join('')}</div></nav></aside>
<div class="doc">
<section id="overview" class="hero">
  <div class="eyebrow">Docs · ${esc(SERVER_INFO.title)} ${esc(SERVER_INFO.version)}</div>
  <h1>Prepay what you can. <em class="s">Your AI handles the rest.</em></h1>
  <p class="lead">riOs is an MCP server. Connect it to Claude, ChatGPT, Cursor or any MCP client and your AI can cover your subscriptions for the months you can afford. You approve once in PayPal, riOs locks the money for that subscription and pays every renewal on its due date.</p>
  <div class="cta"><a class="btn" href="/signup">Get your key</a><a class="btn ghost" href="/app">Open console</a><a class="btn ghost" href="${REPO}">GitHub</a></div>
  <div class="facts"><div><b>9</b><span>MCP tools</span></div><div><b>3</b><span>PayPal APIs</span></div><div><b>0%</b><span>fee during the hackathon</span></div><div><b>3 days</b><span>to cancel for a full refund</span></div></div>
</section>

<section id="quickstart"><h2>Quickstart</h2>
<ol class="qs">
  <li><b>Get a key.</b> <a href="/signup">api.riospay.xyz/signup</a> gives you a riOs key and a connector link.</li>
  <li><b>Connect your AI.</b> Paste the connector link into your AI's connector settings (guides below).</li>
  <li><b>Ask.</b> <i>“Pay for my design tool, $25 a month to billing@designtool.com, renewing today. Cover it for 3 months.”</i></li>
  <li><b>Approve in PayPal.</b> Your AI gives you a PayPal link. You approve. riOs locks the money and you're covered.</li>
</ol>
<p class="note">riOs runs on PayPal's <b>sandbox</b> during the hackathon. No real money moves. Use a PayPal sandbox personal account to approve.</p></section>

<section id="connect"><h2>Connect your AI</h2>
<p>Every client talks to the same endpoint, <code>${esc(mcp)}</code>, using MCP's Streamable HTTP transport. Your key goes in an <code>Authorization: Bearer</code> header, or inside the URL for clients that only accept a link.</p>
<div class="tabs" id="ct"><button data-c="claude" class="on">Claude</button><button data-c="chatgpt">ChatGPT</button><button data-c="cursor">Cursor</button><button data-c="code">Claude Code</button><button data-c="any">Any client</button></div>
<div class="cpane" data-c="claude"><ol class="steps"><li>In Claude, open <b>Settings → Customize → Connectors → Add custom connector</b>.</li><li>Name it <b>riOs</b> and paste your connector link. Choose <b>No sign-in</b>.</li><li>Turn on riOs in a chat's tools menu.</li></ol>${code(`${publicUrl}/mcp/k/<your-key>`, 'sh', 'Connector link')}</div>
<div class="cpane" data-c="chatgpt" hidden><ol class="steps"><li>On chatgpt.com, open <b>Settings → Apps &amp; Connectors → Advanced</b> and turn on <b>Developer mode</b>.</li><li>Create a connector named <b>riOs</b>, paste the connector link as the server URL, authentication <b>None</b>.</li></ol>${code(`${publicUrl}/mcp/k/<your-key>`, 'sh', 'Server URL')}</div>
<div class="cpane" data-c="cursor" hidden>${code(J({ mcpServers: { rios: { url: mcp, headers: { Authorization: 'Bearer <your-key>' } } } }), 'json', '~/.cursor/mcp.json')}</div>
<div class="cpane" data-c="code" hidden>${code(`claude mcp add --transport http rios ${mcp} --header "Authorization: Bearer <your-key>"`, 'sh', 'Terminal')}</div>
<div class="cpane" data-c="any" hidden>${code(J({ url: mcp, transport: 'streamable-http', headers: { Authorization: 'Bearer <your-key>' } }), 'json', 'Remote MCP server')}${code(`RIOS_API_KEY=<your-key> node stdio.js`, 'sh', 'Local (stdio), from a clone of the repo')}</div>
</section>

<section id="money"><h2>How the money moves</h2>
<div class="flow">
  <div class="fs"><span class="fn">1</span><div><b>You ask your AI</b><p>“Cover my design tool for 3 months.” Your AI calls <code>rios_quote</code>: $25 × 3 = $75, no fee.</p></div></div>
  <div class="fs"><span class="fn">2</span><div><b>riOs creates a PayPal order</b><p><code>rios_fund_subscription</code> creates the checkout and returns the approve link.</p><span class="api">Orders v2 · create</span></div></div>
  <div class="fs"><span class="fn">3</span><div><b>You approve in PayPal</b><p>Only you can. Your AI never sees your login or card.</p></div></div>
  <div class="fs"><span class="fn">4</span><div><b>riOs captures and locks</b><p>The money is locked for that one subscription and payee. The PayPal return page and <code>rios_check_funding</code> both capture, safely, at most once.</p><span class="api">Orders v2 · capture</span></div></div>
  <div class="fs"><span class="fn">5</span><div><b>Every renewal date, riOs pays</b><p>A daily job pays exactly one month to the provider and moves the date forward.</p><span class="api">Payouts v1</span></div></div>
  <div class="fs"><span class="fn">↺</span><div><b>Changed your mind?</b><p>Within 3 days, <code>rios_cancel_deposit</code> refunds whatever hasn't been paid out yet.</p><span class="api">Payments v2 · refund</span></div></div>
</div>
<table><thead><tr><th>Step</th><th>PayPal API</th><th>Safety</th></tr></thead><tbody>
<tr><td>Fund</td><td><code>POST /v2/checkout/orders</code></td><td>Amount checked against the quote on capture</td></tr>
<tr><td>Lock</td><td><code>POST /v2/checkout/orders/{id}/capture</code></td><td>Idempotent: confirming twice never captures twice</td></tr>
<tr><td>Pay renewal</td><td><code>POST /v1/payments/payouts</code></td><td>One payout per renewal; failures return the money to the balance</td></tr>
<tr><td>Refund</td><td><code>POST /v2/payments/captures/{id}/refund</code></td><td>Only the unspent part, only inside the window</td></tr>
</tbody></table>
<p class="muted small">Every money-moving call sends a <code>PayPal-Request-Id</code>, so a retry can never charge or pay twice.</p></section>

<section id="rules"><h2>The rules</h2>
<div class="rgrid">
  <div><h4>Locked to one payee</h4><p>Once funded, a subscription's payee and amount can't change. Even a tricked AI can't send locked money anywhere else.</p></div>
  <div><h4>Only you approve</h4><p>Every payment is approved by you inside PayPal. The AI can prepare it, never press pay.</p></div>
  <div><h4>3-day cancel window</h4><p>Cancel within 72 hours for a refund of everything not yet paid out. After that it stays locked for the provider.</p></div>
  <div><h4>Failed payout? Nothing lost</h4><p>If PayPal rejects a payout, the money goes back to the balance and the subscription pauses for review.</p></div>
  <div><h4>Never pays itself</h4><p>riOs refuses any payee that is riOs's own PayPal account.</p></div>
  <div><h4>Your key, your scope</h4><p>A key only sees its own subscriptions. riOs stores a fingerprint of it, never the key itself.</p></div>
</div></section>

<section id="tools"><h2>MCP tools</h2><p>Generated from the running server. Typical flow: <code>rios_add_subscription</code> → <code>rios_quote</code> → <code>rios_fund_subscription</code> → user approves → <code>rios_check_funding</code>.</p>
${TOOLS.map(toolDoc).join('')}</section>

<section id="protocol"><h2>Raw MCP</h2><p>riOs speaks JSON-RPC 2.0 over Streamable HTTP (stateless JSON responses). Protocol versions 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05.</p>
${code(`curl -s ${mcp} \\
  -H "Authorization: Bearer <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"rios_list_subscriptions","arguments":{}}}'`, 'sh', 'Call a tool')}
${code(J({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"count":1,"subscriptions":[…]}' }], structuredContent: { count: 1, subscriptions: ['…'] } } }), 'json', 'Response')}</section>

<section id="api"><h2>Console API</h2><p>The <a href="/app">console</a> uses a small JSON API with the same key. Send <code>Authorization: Bearer &lt;your-key&gt;</code>.</p>
<table><thead><tr><th>Method</th><th>Path</th><th>Does</th></tr></thead><tbody>
<tr><td>GET</td><td><code>/v1/me</code></td><td>Your account name</td></tr>
<tr><td>GET</td><td><code>/v1/subscriptions</code></td><td>Subscriptions, balances, runway</td></tr>
<tr><td>POST</td><td><code>/v1/subscriptions</code></td><td>Add a subscription</td></tr>
<tr><td>POST</td><td><code>/v1/subscriptions/{id}/quote</code></td><td>Quote N months</td></tr>
<tr><td>POST</td><td><code>/v1/subscriptions/{id}/fund</code></td><td>Create the PayPal checkout</td></tr>
<tr><td>DELETE</td><td><code>/v1/subscriptions/{id}</code></td><td>Remove (no locked funds)</td></tr>
<tr><td>POST</td><td><code>/v1/deposits/{id}/check</code></td><td>Capture and lock an approved funding</td></tr>
<tr><td>POST</td><td><code>/v1/deposits/{id}/cancel</code></td><td>Cancel a checkout, or refund inside the window</td></tr>
<tr><td>GET</td><td><code>/v1/activity</code></td><td>Recent events</td></tr>
</tbody></table>
${code(`curl -s ${publicUrl}/v1/subscriptions -H "Authorization: Bearer <your-key>"`, 'sh', 'Example')}</section>

<section id="limits"><h2>Limits &amp; roadmap</h2>
<ul class="lim"><li><b>Sandbox only.</b> Live mode is blocked in code until riOs is registered and approved for live Payouts.</li>
<li><b>Providers need PayPal.</b> Payouts only reach PayPal accounts. Netflix, Spotify and other big brands come next through virtual cards: one card per subscription, topped up from the locked balance on renewal day.</li>
<li><b>Limits.</b> Up to 24 months per funding, $1–$1,000 a month, 25 subscriptions per account.</li>
<li><b>Coming:</b> renewal notifications, more ways to fund (cards, bank, local rails), and gifting a subscription to someone else.</li></ul></section>

<section id="source"><h2>Source code</h2><p>riOs is open source (MIT) with zero dependencies: Node 20+, PayPal REST, MCP.</p>
${code(`git clone ${REPO}.git
cd riOs && cp .env.example .env   # add your PayPal sandbox app keys
npm test                           # runs against a fake PayPal
npm start                          # http://localhost:8787/mcp`, 'sh', 'Run it yourself')}
<div class="files">${[['src/vault.js', 'money rules: subscriptions, deposits, renewals'], ['src/paypal.js', 'PayPal REST client'], ['src/mcp.js', 'MCP protocol and tool definitions'], ['src/http.js', 'routes: MCP, PayPal return, console API, cron'], ['src/web.js', 'console and pages'], ['src/docs.js', 'this page']].map(([f, d]) => `<a href="${REPO}/blob/main/${f}"><code>${f}</code><span>${d}</span></a>`).join('')}</div></section>
</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Docs · riOs</title><meta name="description" content="riOs docs: connect your AI, how the money moves through PayPal, and every MCP tool."><meta name="theme-color" content="#070D14">
<link rel="icon" href="/favicon.png"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@600;700;800&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap">
<style>${CSS}
html{scroll-behavior:smooth;scroll-padding-top:90px}
.top{position:sticky;top:0;z-index:20;max-width:none;background:rgba(7,13,20,.72);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--line)}
.top .r{display:flex;gap:10px;align-items:center}.top .r a{font-size:14px;color:var(--muted);text-decoration:none}.top .r a.btn{color:#0B121A}
body{overflow-x:hidden}.doc *{overflow-wrap:anywhere}.code pre,.doc table,.doc table *{overflow-wrap:normal;word-break:normal}
.layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:48px;max-width:1180px;margin:0 auto;padding:0 24px}
.side nav{position:sticky;top:84px;display:flex;flex-direction:column;gap:2px;padding:24px 0;max-height:calc(100svh - 90px);overflow:auto}
.side a{padding:7px 12px;border-radius:10px;color:var(--muted);text-decoration:none;font-size:14px;font-weight:500}
.side a.on{background:rgba(152,213,253,.1);color:#fff}
.side .sub{margin:4px 0 0 12px;border-left:1px solid var(--line);display:flex;flex-direction:column}
.side .tl{font:500 12.5px "JetBrains Mono",monospace;padding:5px 12px}
.doc{min-width:0;padding:30px 0 80px}
section{padding:44px 0;border-bottom:1px solid var(--line)}section:last-child{border:0}
.hero h1{font-size:clamp(38px,6vw,64px);font-weight:700;margin:14px 0 16px;max-width:15ch}
.hero .lead{max-width:640px;font-size:18px}
.cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}
.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:34px}
.facts div{padding:18px;border-radius:18px;background:var(--card);border:1px solid var(--line)}
.facts b{display:block;font:700 28px var(--display);letter-spacing:-.02em}.facts span{color:var(--muted);font-size:13px}
h2{font-size:clamp(28px,4vw,38px);font-weight:700;margin-bottom:14px}
h3{font-size:19px}h4{font-size:17px;margin-bottom:6px;font-family:var(--display)}
p{color:#C9D8E5;margin:10px 0;max-width:720px}p.muted{color:var(--muted)}
code{font:500 .88em "JetBrains Mono",ui-monospace,monospace;background:rgba(152,213,253,.08);border:1px solid rgba(152,213,253,.12);padding:1px 6px;border-radius:6px;color:#D8EAF8}
a code{color:var(--sky)}
.code{position:relative;margin:14px 0;border-radius:16px;background:#050A10;border:1px solid var(--line);overflow:hidden}
.code .ch{display:flex;justify-content:space-between;align-items:center;padding:9px 12px 9px 16px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.04em}
.code .fl{position:absolute;top:10px;right:10px}
.code pre{padding:16px;overflow:auto;font:400 13px/1.65 "JetBrains Mono",ui-monospace,monospace;color:#CFE0EE}
.code pre code{background:none;border:0;padding:0;font:inherit;color:inherit}
i.k{color:#98D5FD;font-style:normal}i.s{color:#B8E7A9;font-style:normal}i.n{color:#FFC978;font-style:normal}i.b{color:#C9A7FF;font-style:normal}i.f{color:#7FB8FF;font-style:normal}i.c{color:#5E7385;font-style:normal}
table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;display:block;overflow-x:auto}
th,td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.doc th,.doc td:not(:last-child){white-space:nowrap}.doc td:last-child{min-width:200px}
.req{margin-left:8px;font:600 10px var(--body);letter-spacing:.06em;text-transform:uppercase;color:var(--warn)}
ol.qs{counter-reset:q;list-style:none;display:grid;gap:12px;margin-top:10px}
ol.qs li{counter-increment:q;position:relative;padding:16px 18px 16px 56px;border-radius:16px;background:var(--card);border:1px solid var(--line);color:#C9D8E5}
ol.qs li::before{content:counter(q);position:absolute;left:16px;top:15px;width:26px;height:26px;border-radius:50%;background:var(--cobalt);color:#fff;display:grid;place-items:center;font:700 13px var(--body)}
ol.qs a{color:var(--sky)}
.cpane{margin-top:6px}
#ct{overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}#ct::-webkit-scrollbar{display:none}#ct button{flex:none;white-space:nowrap;padding:9px 14px}
.flow{display:grid;gap:0;margin:20px 0 8px;position:relative}
.fs{display:grid;grid-template-columns:44px 1fr;gap:14px;padding:0 0 22px;position:relative}
.fs::before{content:"";position:absolute;left:21px;top:40px;bottom:0;width:2px;background:linear-gradient(var(--cobalt),rgba(47,123,255,.1))}.fs:last-child::before{display:none}
.fn{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:rgba(47,123,255,.18);border:1px solid rgba(152,213,253,.3);font:700 16px var(--display);color:var(--sky)}
.fs b{font-family:var(--display);font-size:18px}.fs p{margin:4px 0 8px}
.api{display:inline-block;font:600 11px "JetBrains Mono",monospace;padding:4px 9px;border-radius:999px;background:rgba(152,213,253,.1);color:var(--sky);border:1px solid rgba(152,213,253,.2)}
.rgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:10px}
.rgrid div{padding:20px;border-radius:18px;background:var(--card);border:1px solid var(--line)}.rgrid p{margin:0;font-size:15px}
.tool{margin:22px 0;padding:22px;border-radius:20px;background:rgba(11,20,31,.6);border:1px solid var(--line)}
.th{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.th code{font-size:15px}.tt{color:var(--muted);font-size:13px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pair .code{margin:10px 0 0}
ul.lim{list-style:none;display:grid;gap:10px;margin-top:10px}ul.lim li{padding:14px 16px;border-radius:14px;background:var(--card);border:1px solid var(--line);color:#C9D8E5;font-size:15px}
.files{display:grid;gap:8px;margin-top:14px}.files a{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:12px;background:var(--card);border:1px solid var(--line);text-decoration:none;font-size:14px}.files span{color:var(--muted)}
@media (max-width:900px){.layout{grid-template-columns:minmax(0,1fr);gap:0;padding:0 18px}.doc{padding-top:10px}.side{position:sticky;top:62px;z-index:10;background:rgba(7,13,20,.85);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);margin:0 -18px;border-bottom:1px solid var(--line)}
  .side nav{position:static;flex-direction:row;overflow-x:auto;padding:10px 16px;max-height:none;scrollbar-width:none}.side nav::-webkit-scrollbar{display:none}.side a{white-space:nowrap}.side .sub{display:none}
  .facts{grid-template-columns:1fr 1fr}.rgrid,.pair{grid-template-columns:1fr}html{scroll-padding-top:130px}}
</style></head><body>
<header class="top"><a class="brand" href="/">${MARK}riOs <span style="font:500 15px var(--body);color:var(--muted);margin-left:4px">docs</span></a><div class="r"><a href="/app">Console</a><a class="btn sm" href="/signup">Get your key</a></div></header>
<div class="layout">${body}</div>
<footer class="foot"><span>riOs · built for the PayPal AI Hackathon</span><span><a href="https://riospay.xyz">riospay.xyz</a> · <a href="${REPO}">GitHub</a></span></footer>
<script>
document.addEventListener('click', e => { const b = e.target.closest('[data-copy]'); if (!b) return;
  navigator.clipboard?.writeText(b.dataset.copy).then(() => { const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => b.textContent = t, 1400); }); });
document.getElementById('ct').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#ct button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.cpane').forEach(p => p.hidden = p.dataset.c !== b.dataset.c); };
const links = [...document.querySelectorAll('.side a[data-s]')];
const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) links.forEach(a => { const on = a.dataset.s === en.target.id; a.classList.toggle('on', on); if (on && innerWidth < 900) a.scrollIntoView({ inline: 'center', block: 'nearest' }); }); }), { rootMargin: '-40% 0px -55% 0px' });
document.querySelectorAll('.doc > section').forEach(s => io.observe(s));
</script></body></html>`;
}
