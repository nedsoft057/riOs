import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startFakePayPal } from './fake-paypal.js';
import { loadConfig } from '../src/config.js';
import { MemoryStore } from '../src/store/index.js';
import { PayPal } from '../src/paypal.js';
import { Vault } from '../src/vault.js';
import { createHandler } from '../src/http.js';
import { addMonths } from '../src/util.js';

let pp; let clock;
before(async () => { pp = await startFakePayPal(); });
after(() => pp.close());

function setup(env = {}) {
  clock = new Date('2026-11-10T09:00:00Z');
  const config = loadConfig({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_API_BASE: pp.base, PUBLIC_URL: 'https://api.riospay.test', CRON_SECRET: 'cron', ...env });
  const vault = new Vault({ store: new MemoryStore(), paypal: new PayPal(config.paypal), config, now: () => clock });
  return { config, vault };
}
const orderIdFrom = url => new URL(url).searchParams.get('token');

async function fundedSub(vault, user, months = 3, monthly = '10.99') {
  const sub = await vault.addSubscription(user, { name: 'Spotify', payee_email: 'provider@example.com', monthly_amount: monthly, next_billing_date: '2026-11-15' });
  const f = await vault.startFunding(user, sub.subscription_id, months);
  pp.approve(orderIdFrom(f.approve_url));
  const dep = await vault.confirmFunding(f.deposit_id, { userId: user.id });
  return { sub, f, dep };
}

test('funding locks money and shows runway', async () => {
  const { vault } = setup();
  const { user } = await vault.createUser('Favour');
  const { f, dep } = await fundedSub(vault, user);
  assert.equal(f.total_to_pay, '32.97');
  assert.equal(f.fee, '0.00');
  assert.equal(dep.status, 'locked');
  const [s] = await vault.listSubscriptions(user);
  assert.equal(s.locked_balance, '32.97');
  assert.equal(s.renewals_covered, 3);
  assert.equal(s.covered_through, '2027-02-14');
  assert.equal(s.payee_locked, true);
});

test('confirming twice never captures twice', async () => {
  const { vault } = setup();
  const { user } = await vault.createUser('A');
  const { f } = await fundedSub(vault, user);
  const before = pp.state.calls.filter(c => c.endsWith('/capture')).length;
  const again = await vault.confirmFunding(f.deposit_id, { userId: user.id });
  assert.equal(again.status, 'locked');
  assert.equal(pp.state.calls.filter(c => c.endsWith('/capture')).length, before);
});

test('unapproved funding stays pending with its link', async () => {
  const { vault } = setup();
  const { user } = await vault.createUser('A');
  const sub = await vault.addSubscription(user, { name: 'Tool', payee_email: 'p@example.com', monthly_amount: '5' });
  const f = await vault.startFunding(user, sub.subscription_id, 2);
  const c = await vault.confirmFunding(f.deposit_id, { userId: user.id });
  assert.equal(c.status, 'pending');
  assert.ok(c.approve_url);
});

test('fee is taken on deposit and kept on refund', async () => {
  const { vault } = setup({ RIOS_FEE_BPS: '200' });
  const { user } = await vault.createUser('A');
  const { f, dep } = await fundedSub(vault, user, 2, '49');
  assert.equal(f.total_to_pay, '100.00'); // 98 covered + 2% of 100
  assert.equal(dep.fee, '2.00');
  const r = await vault.cancelDeposit(user, f.deposit_id);
  assert.equal(r.refunded, '98.00');
  assert.equal(r.fee_kept, '2.00');
});

test('cancel works inside 3 days and is refused after', async () => {
  const { vault } = setup();
  const { user } = await vault.createUser('A');
  const one = await fundedSub(vault, user);
  const r = await vault.cancelDeposit(user, one.f.deposit_id);
  assert.equal(r.status, 'refunded');
  assert.equal(r.refunded, '32.97');

  const two = await fundedSub(vault, user);
  clock = new Date(clock.getTime() + 73 * 3600e3);
  await assert.rejects(vault.cancelDeposit(user, two.f.deposit_id), /cancel window ended/);
});

test('renewal pays exactly one month on the due date, once', async () => {
  const { vault } = setup();
  const { user } = await vault.createUser('A');
  await fundedSub(vault, user);
  assert.equal((await vault.runRenewals()).submitted, 0); // not due yet (due 15 Nov)
  clock = new Date('2026-11-15T08:00:00Z');
  const r1 = await vault.runRenewals();
  assert.equal(r1.submitted, 1);
  const batch = Object.values(pp.state.payouts).at(-1).request;
  assert.equal(batch.items[0].amount.value, '10.99');
  assert.equal(batch.items[0].receiver, 'provider@example.com');
  const r2 = await vault.runRenewals();
  assert.equal(r2.submitted, 0);
  assert.equal(r2.paid, 1);
  const [s] = await vault.listSubscriptions(user);
  assert.equal(s.next_renewal, '2026-12-15');
  assert.equal(s.locked_balance, '21.98');
  assert.equal(s.renewals_covered, 2);
});

test('no money left: renewal is flagged, not paid', async () => {
  const { vault } = setup();
  const { user } = await vault.createUser('A');
  await vault.addSubscription(user, { name: 'Tool', payee_email: 'p@example.com', monthly_amount: '5' });
  const r = await vault.runRenewals();
  assert.equal(r.unfunded, 1);
  const [s] = await vault.listSubscriptions(user);
  assert.equal(s.attention, 'unfunded');
});

test('failed payout returns the money and pauses the subscription', async () => {
  const { vault } = setup();
  const { user } = await vault.createUser('A');
  await fundedSub(vault, user);
  pp.state.payoutStatus = 'RETURNED';
  clock = new Date('2026-11-15T08:00:00Z');
  await vault.runRenewals();
  const r = await vault.runRenewals();
  pp.state.payoutStatus = 'SUCCESS';
  assert.equal(r.failed, 1);
  const [s] = await vault.listSubscriptions(user);
  assert.equal(s.locked_balance, '32.97');
  assert.equal(s.status, 'paused');
  assert.equal(s.next_renewal, '2026-11-15');
});

test('refund after one renewal returns only what is left', async () => {
  const { vault } = setup();
  const { user } = await vault.createUser('A');
  const sub = await vault.addSubscription(user, { name: 'Tool', payee_email: 'p@example.com', monthly_amount: '10', next_billing_date: '2026-11-10' });
  const f = await vault.startFunding(user, sub.subscription_id, 3);
  pp.approve(orderIdFrom(f.approve_url));
  await vault.confirmFunding(f.deposit_id, { userId: user.id });
  await vault.runRenewals();
  const r = await vault.cancelDeposit(user, f.deposit_id);
  assert.equal(r.refunded, '20.00');
});

test('users cannot see or touch each other\'s data', async () => {
  const { vault } = setup();
  const a = (await vault.createUser('A')).user;
  const b = (await vault.createUser('B')).user;
  const { sub, f } = await fundedSub(vault, a);
  assert.equal((await vault.listSubscriptions(b)).length, 0);
  await assert.rejects(vault.startFunding(b, sub.subscription_id, 1), /not found/);
  await assert.rejects(vault.cancelDeposit(b, f.deposit_id), /not found/);
  await assert.rejects(vault.confirmFunding(f.deposit_id, { userId: b.id }), /not found/);
});

test('budget planner fills months in priority order', async () => {
  const { vault } = setup();
  const { user } = await vault.createUser('A');
  const s1 = await vault.addSubscription(user, { name: 'Music', payee_email: 'a@example.com', monthly_amount: '10' });
  const s2 = await vault.addSubscription(user, { name: 'Cloud', payee_email: 'b@example.com', monthly_amount: '3' });
  const plan = await vault.planBudget(user, '35', [s1.subscription_id, s2.subscription_id]);
  // One month each per round, first in the list gets first pick: 10+3, 20+6, then only Cloud fits.
  assert.deepEqual(plan.plan.map(p => p.add_months), [2, 5]);
  assert.equal(plan.will_spend, '35.00');
  assert.equal(plan.left_over, '0.00');
});

test('input validation', async () => {
  const { vault } = setup();
  const { user } = await vault.createUser('A');
  await assert.rejects(vault.addSubscription(user, { name: 'X', payee_email: 'nope', monthly_amount: '5' }), /payee_email/);
  await assert.rejects(vault.addSubscription(user, { name: 'X', payee_email: 'a@b.co', monthly_amount: '5.555' }), /monthly_amount/);
  await assert.rejects(vault.addSubscription(user, { name: 'X', payee_email: 'a@b.co', monthly_amount: '5', next_billing_date: '2020-01-01' }), /past/);
  const s = await vault.addSubscription(user, { name: 'X', payee_email: 'a@b.co', monthly_amount: '5' });
  await assert.rejects(vault.startFunding(user, s.subscription_id, 0), /months/);
  await assert.rejects(vault.startFunding(user, s.subscription_id, 25), /months/);
});

test('month maths handles short months', () => {
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
});

test('live PayPal is blocked unless explicitly allowed', () => {
  assert.throws(() => loadConfig({ PAYPAL_ENV: 'live' }), /blocked/);
});

// ---------- MCP over HTTP ----------
async function startHttp() {
  const { config, vault } = setup();
  const server = createServer(createHandler({ vault, config }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, vault, close: () => server.close() };
}
async function rpc(base, key, method, params, id = 1) {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
}

test('MCP: handshake, tools and a full funding flow', async () => {
  const h = await startHttp();
  try {
    const { apiKey } = await h.vault.createUser('Favour');
    const unauth = await rpc(h.base, 'wrong', 'initialize', {});
    assert.equal(unauth.status, 401);

    const init = await rpc(h.base, apiKey, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.body.result.protocolVersion, '2025-06-18');
    assert.equal(init.body.result.serverInfo.name, 'rios');

    const note = await fetch(`${h.base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    assert.equal(note.status, 202);

    const list = await rpc(h.base, apiKey, 'tools/list', {});
    assert.equal(list.body.result.tools.length, 9);

    const call = (name, args) => rpc(h.base, apiKey, 'tools/call', { name, arguments: args });
    const added = (await call('rios_add_subscription', { name: 'Spotify', payee_email: 'provider@example.com', monthly_amount: '10.99', next_billing_date: '2026-12-01' })).body.result;
    assert.equal(added.isError, false);
    const subId = added.structuredContent.subscription_id;

    const fund = (await call('rios_fund_subscription', { subscription_id: subId, months: 2 })).body.result.structuredContent;
    assert.equal(fund.total_to_pay, '21.98');
    pp.approve(orderIdFrom(fund.approve_url));

    // The PayPal return page locks the funds.
    const ret = await fetch(`${h.base}/paypal/return?deposit=${fund.deposit_id}&token=${orderIdFrom(fund.approve_url)}`);
    assert.equal(ret.status, 200);
    assert.match(await ret.text(), /funded for 2 months/);

    const subs = (await call('rios_list_subscriptions', {})).body.result.structuredContent;
    assert.equal(subs.subscriptions[0].renewals_covered, 2);

    const bad = (await call('rios_quote', { subscription_id: 'sub_nope', months: 1 })).body.result;
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /not found/i);

    const unknown = await rpc(h.base, apiKey, 'nope/method', {});
    assert.equal(unknown.body.error.code, -32601);

    // Key in the URL path also works.
    const viaPath = await fetch(`${h.base}/mcp/k/${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }) });
    assert.equal(viaPath.status, 200);

    // Cron needs its secret.
    assert.equal((await fetch(`${h.base}/cron/renew`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${h.base}/cron/renew`, { method: 'POST', headers: { Authorization: 'Bearer cron' } })).status, 200);

    // Vercel-style rewritten path.
    const vr = await fetch(`${h.base}/api/index?__path=/health`);
    assert.equal(vr.status, 200);
  } finally { h.close(); }
});

test('signup page creates a working key', async () => {
  const h = await startHttp();
  try {
    const res = await fetch(`${h.base}/signup`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Tester' });
    const page = await res.text();
    const key = page.match(/rios_[A-Za-z0-9_-]{20,}/)[0];
    const ping = await rpc(h.base, key, 'ping', {});
    assert.equal(ping.status, 200);
  } finally { h.close(); }
});

test('riOs refuses to pay its own PayPal account', async () => {
  const { vault } = setup();
  const { user } = await vault.createUser('A');
  await fundedSub(vault, user);   // first order teaches riOs its merchant email
  await assert.rejects(vault.addSubscription(user, { name: 'Self', payee_email: 'Merchant@rios.test', monthly_amount: '5' }), /riOs PayPal account itself/);
  const { vault: v2 } = setup({ RIOS_MERCHANT_EMAIL: 'me@rios.test' });
  const { user: u2 } = await v2.createUser('B');
  await assert.rejects(v2.addSubscription(u2, { name: 'Self', payee_email: 'me@rios.test', monthly_amount: '5' }), /riOs PayPal account itself/);
});

test('an abandoned checkout can be cancelled, then the subscription removed', async () => {
  const { vault } = setup();
  const { user } = await vault.createUser('A');
  const sub = await vault.addSubscription(user, { name: 'Tool', payee_email: 'p@example.com', monthly_amount: '5' });
  const f = await vault.startFunding(user, sub.subscription_id, 2);
  await assert.rejects(vault.removeSubscription(user, sub.subscription_id), /rios_cancel_deposit/);
  const c = await vault.cancelDeposit(user, f.deposit_id);
  assert.equal(c.status, 'cancelled');
  const r = await vault.removeSubscription(user, sub.subscription_id);
  assert.equal(r.removed, true);
});

test('stress test: 50 transactions, only the stress account is touched', async () => {
  const { config, vault } = setup({ PAYPAL_ENV: 'sandbox' });
  const store = vault.store;
  const { user: favour } = await vault.createUser('Favour');
  const { sub: real } = await fundedSub(vault, favour, 3); // due 2026-11-15, must not be paid by the simulated clock
  const { runStressStep, stressReport } = await import('../src/stress.js');
  const deps = { vault, store, paypal: vault.paypal, config };
  let r = await runStressStep(deps, { payee: 'provider@example.com' });
  assert.equal(r.phase, 'fund');
  for (let i = 0; i < 20 && r.phase !== 'done'; i++) r = await runStressStep(deps, {});
  assert.equal(r.phase, 'done');
  const rep = await stressReport(store);
  assert.deepEqual([rep.counts.funding, rep.counts.refund, rep.counts.renewal, rep.counts.paid, rep.counts.total], [15, 5, 30, 30, 50]);
  const [s] = await vault.listSubscriptions(favour);
  assert.equal(s.subscription_id, real.subscription_id);
  assert.equal(s.locked_balance, '32.97');
  assert.equal(s.recent_payments.length, 0);
});
