// Stress test: real PayPal sandbox transactions through the real riOs code paths, run in steps
// so each call stays well inside a serverless time limit.
//   setup   one "riOs stress test" account + 10 subscriptions
//   fund    10 deposits (3 months each), paid with PayPal sandbox test cards and captured
//   refund  5 extra 1-month deposits, captured then cancelled inside the 3-day window (refunds)
//   renew   3 monthly renewal rounds on a simulated clock: 10 real payouts per round
//   sync    ask PayPal for each payout's final status
// Only the stress account is touched: renewals run with userId set, so nobody else's
// subscriptions are paid early by the simulated clock.
import { Vault } from './vault.js';
import { today, addMonths, addDays, money } from './util.js';

const SUBS = [
  ['Music stream', '9.99'], ['Cloud storage', '2.99'], ['Design suite', '12.00'], ['AI assistant', '20.00'], ['Video stream', '15.49'],
  ['Notes app', '4.00'], ['VPN', '6.50'], ['Domain + email', '7.00'], ['Fitness app', '11.00'], ['News pass', '5.00'],
];
const MONTHS = 3, ROUNDS = 3, REFUNDS = 5;
// PayPal sandbox test cards (they only work against api-m.sandbox.paypal.com).
const CARDS = [
  { name: 'riOs Stress', number: '4032039317984658', expiry: '2030-12', cvv: '123' },
  { name: 'riOs Stress', number: '4111111111111111', expiry: '2030-12', cvv: '123' },
];

export async function runStressStep({ vault, store, paypal, config }, { payee, budgetMs = 45000 } = {}) {
  if (config.paypal.env !== 'sandbox') throw new Error('The stress test only runs on the PayPal sandbox');
  const started = Date.now(); const out = [];
  const time = () => Date.now() - started < budgetMs;
  let st = await store.transact(db => (db.meta = db.meta || {}, db.meta.stress ||= { phase: 'setup', round: 0, card: 0, notes: [] }, { ...db.meta.stress }));
  const save = patch => store.transact(db => { Object.assign(db.meta.stress, patch); return { ...db.meta.stress }; });
  const user = st.userId ? { id: st.userId, name: 'riOs stress test' } : null;

  if (st.phase === 'setup') {
    if (!payee) throw new Error('payee is required for setup');
    const { user: u } = await vault.createUser('riOs stress test');
    const subs = [];
    for (const [name, amt] of SUBS) subs.push((await vault.addSubscription(u, { name, payee_email: payee, monthly_amount: amt, next_billing_date: today(vault.now()) })).subscription_id);
    st = await save({ phase: 'fund', userId: u.id, subs, payee, startedAt: new Date().toISOString(), day0: today(vault.now()) });
    out.push(`created ${subs.length} subscriptions`);
    return { ...view(st), did: out };
  }
  const u = user;

  const fundOne = async (subId, months) => {
    for (let tries = 0; tries < CARDS.length; tries++) {
      const card = CARDS[(st.card + tries) % CARDS.length];
      try {
        const f = await vault.startFunding(u, subId, months, { card });
        const c = await vault.confirmFunding(f.deposit_id, { userId: u.id });
        if (c.status !== 'locked') throw new Error(`deposit ${f.deposit_id} is ${c.status}${c.paypal_status ? ` (PayPal ${c.paypal_status})` : ''}`);
        if (tries) st = await save({ card: (st.card + tries) % CARDS.length });
        return c;
      } catch (e) { if (tries === CARDS.length - 1) throw e; }
    }
  };

  if (st.phase === 'fund') {
    const funded = new Set(await store.transact(db => db.deposits.filter(d => d.userId === u.id && d.status === 'locked' && d.months === MONTHS).map(d => d.subscriptionId)));
    for (const subId of st.subs) {
      if (funded.has(subId)) continue;
      if (!time()) break;
      const c = await fundOne(subId, MONTHS); funded.add(subId); out.push(`funded ${c.subscription}: ${c.total_paid}`);
    }
    if (st.subs.every(s => funded.has(s))) st = await save({ phase: 'refund' });
  }

  if (st.phase === 'refund' && time()) {
    const done = await store.transact(db => db.deposits.filter(d => d.userId === u.id && d.months === 1 && d.status === 'refunded').map(d => d.subscriptionId));
    for (const subId of st.subs.slice(0, REFUNDS)) {
      if (done.includes(subId)) continue;
      if (!time()) break;
      // An earlier step may have locked this deposit and then run out of time before the refund.
      let dep = await store.transact(db => db.deposits.find(d => d.subscriptionId === subId && d.months === 1 && d.status === 'locked'));
      if (!dep) { const c = await fundOne(subId, 1); dep = { id: c.deposit_id }; out.push(`funded extra month on ${c.subscription}`); }
      const r = await vault.cancelDeposit(u, dep.id); out.push(`refunded ${r.refunded} on ${r.subscription}`);
      done.push(subId);
    }
    if (st.subs.slice(0, REFUNDS).every(s => done.includes(s))) st = await save({ phase: 'renew' });
  }

  while (st.phase === 'renew' && time()) {
    const simDay = addMonths(st.day0, st.round);
    const sim = new Vault({ store, paypal, config, now: () => new Date(`${simDay}T12:00:00Z`) });
    const r = await sim.runRenewals({ userId: u.id });
    out.push(`round ${st.round + 1} (${simDay}): ${r.submitted} payouts sent${r.errors.length ? `, errors: ${r.errors.join('; ')}` : ''}`);
    // Only move on when nothing in this round is left unsent.
    const left = await store.transact(db => db.subscriptions.filter(s => s.userId === u.id && s.status === 'active' && s.nextRenewal <= simDay).length);
    if (left === 0) st = await save(st.round + 1 >= ROUNDS ? { phase: 'sync', round: st.round + 1 } : { round: st.round + 1 });
    else break;
  }

  if (st.phase === 'sync' || st.phase === 'done') {
    const r = await vault.syncPayouts({ userId: u.id });
    out.push(`synced ${r.synced} payouts: ${r.paid} paid, ${r.failed} failed`);
    const open = await store.transact(db => db.payments.filter(p => p.userId === u.id && ['pending', 'unclaimed', 'submitting'].includes(p.status)).length);
    st = await save({ phase: open ? 'sync' : 'done', finishedAt: open ? null : new Date().toISOString() });
  }
  return { ...view(st), did: out };
}

function view(st) { return { phase: st.phase, round: st.round, user: st.userId }; }

// Everything the public proof page shows, straight from the ledger.
function runTx(db, st, run) {
  const subs = db.subscriptions.filter(s => s.userId === st.userId);
  const name = id => subs.find(s => s.id === id)?.name || '';
  const tx = [];
  for (const d of db.deposits.filter(d => d.userId === st.userId && d.captureId)) {
    tx.push({ run, kind: 'funding', at: d.lockedAt, what: `${d.subscriptionName} · ${d.months} mo locked`, amount: d.grossCents, ref: d.captureId, status: 'COMPLETED' });
    if (d.refundId) tx.push({ run, kind: 'refund', at: d.lockedAt, what: `${d.subscriptionName} · cancelled in window`, amount: -(d.netCents), ref: d.refundId, status: 'COMPLETED' });
  }
  for (const p of db.payments.filter(p => p.userId === st.userId)) {
    tx.push({ run, kind: 'renewal', at: p.createdAt, period: p.period, what: `${name(p.subscriptionId)} · renewal ${p.period}`, amount: p.amountCents, ref: p.batchId, status: p.status.toUpperCase() });
  }
  tx.sort((a, b) => (a.at || '').localeCompare(b.at || '') || a.kind.localeCompare(b.kind));
  return { tx, subs };
}
function summarize(tx) {
  const sum = k => tx.filter(t => t.kind === k).reduce((s, t) => s + Math.abs(t.amount), 0);
  return {
    counts: { total: tx.length, funding: tx.filter(t => t.kind === 'funding').length, refund: tx.filter(t => t.kind === 'refund').length, renewal: tx.filter(t => t.kind === 'renewal').length,
      paid: tx.filter(t => t.kind === 'renewal' && t.status === 'PAID').length, failed: tx.filter(t => t.status === 'FAILED').length },
    volume: { funding: money(sum('funding')), refund: money(sum('refund')), renewal: money(sum('renewal')) },
  };
}
export async function stressReport(store) {
  return store.transact(db => {
    const runs = [];
    const s1 = db.meta?.stress; if (!s1?.userId) return null;
    const r1 = runTx(db, s1, 1);
    runs.push({ run: 1, title: 'Lock, cancel, renew', phase: s1.phase, startedAt: s1.startedAt, finishedAt: s1.finishedAt || null,
      subscriptions: r1.subs.map(s => ({ name: s.name, monthly: money(s.monthlyCents) })), ...summarize(r1.tx), tx: r1.tx });
    const s2 = db.meta?.stress2;
    if (s2?.userId) {
      const r2 = runTx(db, s2, 2);
      runs.push({ run: 2, title: 'Payday', phase: s2.phase, startedAt: s2.startedAt, finishedAt: s2.finishedAt || null,
        subscriptions: r2.subs.map(s => ({ name: s.name, monthly: money(s.monthlyCents), day: s.nextRenewal })),
        paydays: Object.entries(s2.plans || {}).map(([k, p]) => ({ payday: k, budget: p.budget, spend: p.spend, split: p.items.map(i => ({ name: i.name, months: i.months })) })),
        held: s2.held || [], ...summarize(r2.tx), tx: r2.tx });
    }
    const all = runs.flatMap(r => r.tx);
    const done = runs.every(r => r.phase === 'done');
    return {
      phase: done ? 'done' : runs.find(r => r.phase !== 'done').phase, startedAt: s1.startedAt, finishedAt: done ? runs[runs.length - 1].finishedAt : null, payee: s1.payee,
      ...summarize(all), held: runs.reduce((n, r) => n + (r.held?.length || 0), 0),
      runs: runs.map(r => ({ ...r, tx: undefined })),
      tx: all.map(t => ({ ...t, amount: money(Math.abs(t.amount)) })),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Run 2, "Payday": irregular income on a simulated clock. Five subscriptions renew on different
// days of the month. Money arrives on three paydays of different sizes; each time riOs's own budget
// planner (the same code behind rios_plan_budget) splits it across the subscriptions. Three deposits
// made by mistake are cancelled inside the window. Six monthly renewal runs follow, and once a
// subscription's money runs out riOs must hold the renewal back instead of paying it.
const PAYDAY_SUBS = [['Music stream', '10.99', 3], ['Design tool', '15.00', 8], ['AI assistant', '20.00', 13], ['Cloud backup', '2.99', 18], ['Notes app', '8.00', 23]];
const PAYDAYS = { pay1: '120.00', pay2: '60.00', pay3: '80.00' };
const PAYDAY_STEPS = ['setup', 'pay1', 'win0', 'win1', 'pay2', 'mistakes', 'win2', 'pay3', 'win3', 'win4', 'win5', 'sync', 'done'];

export async function runPaydayStep(ctx, opts = {}) {
  const { store, config } = ctx;
  if (config.paypal.env !== 'sandbox') throw new Error('The stress test only runs on the PayPal sandbox');
  if (opts.reset) {
    // Set an attempt aside (it stays in the ledger, but the proof page stops counting it) and start clean.
    return store.transact(db => {
      db.meta = db.meta || {};
      if (db.meta.stress2) { (db.meta.stress2Void ||= []).push({ ...db.meta.stress2, voidedAt: new Date().toISOString() }); parkSubs(db, db.meta.stress2.userId); }
      delete db.meta.stress2; delete db.meta.stress2Lock;
      return { phase: 'reset', did: ['run 2 cleared; load again without reset to start fresh'] };
    });
  }
  // One step at a time: a reload while a step is still running must not start a second one.
  const me = Math.random().toString(36).slice(2);
  const got = await store.transact(db => {
    db.meta = db.meta || {};
    const l = db.meta.stress2Lock;
    if (l && l.until > Date.now()) return false;
    db.meta.stress2Lock = { by: me, until: Date.now() + 70000 };
    return true;
  });
  if (!got) return { phase: 'busy', did: ['A step is still running. Wait about a minute, then reload.'] };
  try { return await paydayStep(ctx, opts); }
  finally { await store.transact(db => { if (db.meta.stress2Lock?.by === me) delete db.meta.stress2Lock; }); }
}

// Test accounts must never be picked up by the real daily renewal run afterwards.
function parkSubs(db, userId) { for (const s of db.subscriptions) if (userId && s.userId === userId && s.status === 'active') s.status = 'paused'; }

async function paydayStep({ vault, store, paypal, config }, { budgetMs = 45000 } = {}) {
  const started = Date.now(); const out = [];
  const time = () => Date.now() - started < budgetMs;
  let st = await store.transact(db => (db.meta = db.meta || {}, db.meta.stress2 ||= { phase: 'setup', card: 0, plans: {}, deps: {}, held: [] }, JSON.parse(JSON.stringify(db.meta.stress2))));
  const save = patch => store.transact(db => { Object.assign(db.meta.stress2, patch); return JSON.parse(JSON.stringify(db.meta.stress2)); });
  const next = () => save({ phase: PAYDAY_STEPS[PAYDAY_STEPS.indexOf(st.phase) + 1] });

  if (st.phase === 'setup') {
    const payee = await store.transact(db => db.meta.stress?.payee);
    if (!payee) throw new Error('Run 1 must have finished first (it sets the sandbox payee)');
    const { user } = await vault.createUser('riOs payday test');
    const day0 = today(vault.now()); const subs = [];
    for (const [name, amt, off] of PAYDAY_SUBS) subs.push((await vault.addSubscription(user, { name, payee_email: payee, monthly_amount: amt, next_billing_date: addDays(day0, off) })).subscription_id);
    st = await save({ phase: 'pay1', userId: user.id, subs, payee, day0, startedAt: new Date().toISOString() });
    return { ...st, did: [`created ${subs.length} subscriptions with staggered due dates`] };
  }
  const u = { id: st.userId, name: 'riOs payday test' };

  const fund = async (key, subId, months) => {
    if (st.deps[key]) return null;
    for (let tries = 0; tries < CARDS.length; tries++) {
      const card = CARDS[(st.card + tries) % CARDS.length];
      try {
        const f = await vault.startFunding(u, subId, months, { card });
        const c = await vault.confirmFunding(f.deposit_id, { userId: u.id });
        if (c.status !== 'locked') throw new Error(`deposit ${f.deposit_id} is ${c.status}`);
        st = await store.transact(db => { db.meta.stress2.deps[key] = f.deposit_id; db.meta.stress2.card = (st.card + tries) % CARDS.length; return JSON.parse(JSON.stringify(db.meta.stress2)); });
        return c;
      } catch (e) { if (tries === CARDS.length - 1) throw e; }
    }
  };

  while (time() && st.phase !== 'done') {
    const ph = st.phase;
    if (ph.startsWith('pay')) {
      if (!st.plans[ph]) {
        const plan = await vault.planBudget(u, PAYDAYS[ph], st.subs);
        st = await store.transact(db => { db.meta.stress2.plans[ph] = { budget: plan.budget, spend: plan.will_spend, items: plan.plan.map(p => ({ id: p.subscription_id, name: p.name, months: p.add_months })) }; return JSON.parse(JSON.stringify(db.meta.stress2)); });
        out.push(`${ph}: planner split $${plan.budget} into ${plan.plan.map(p => `${p.name} ${p.add_months}mo`).join(', ')}`);
      }
      for (const it of st.plans[ph].items) {
        if (!it.months || st.deps[`${ph}:${it.id}`]) continue;
        if (!time()) break;
        const c = await fund(`${ph}:${it.id}`, it.id, it.months); if (c) out.push(`${ph}: locked ${c.total_paid} for ${c.subscription}`);
      }
      if (st.plans[ph].items.every(it => !it.months || st.deps[`${ph}:${it.id}`])) st = await next(); else break;
    } else if (ph === 'mistakes') {
      for (const subId of st.subs.slice(0, 3)) {
        if (!time()) break;
        const key = `mistake:${subId}`;
        const already = await store.transact(db => db.deposits.find(d => d.id === st.deps[key])?.status);
        if (already === 'refunded') continue;
        if (!st.deps[key]) { const c = await fund(key, subId, 1); out.push(`mistake: locked ${c.total_paid} on ${c.subscription}`); }
        const r = await vault.cancelDeposit(u, st.deps[key]); out.push(`mistake: refunded ${r.refunded} on ${r.subscription}`);
      }
      const done = await store.transact(db => st.subs.slice(0, 3).every(s => db.deposits.find(d => d.id === st.deps[`mistake:${s}`])?.status === 'refunded'));
      if (done) st = await next(); else break;
    } else if (ph.startsWith('win')) {
      const k = Number(ph.slice(3)); const simDay = addDays(addMonths(st.day0, k), 26);
      const sim = new Vault({ store, paypal, config, now: () => new Date(`${simDay}T12:00:00Z`) });
      const r = await sim.runRenewals({ userId: u.id });
      const held = await store.transact(db => db.subscriptions.filter(s => s.userId === u.id && s.attention === 'unfunded').map(s => s.name));
      out.push(`month ${k + 1} (${simDay}): ${r.submitted} renewals paid${held.length ? `, held back (no money left): ${held.join(', ')}` : ''}${r.errors.length ? `, errors: ${r.errors.join('; ')}` : ''}`);
      if (r.errors.length) break;
      st = await store.transact(db => { db.meta.stress2.held.push(...held.map(n => ({ month: k + 1, name: n }))); return JSON.parse(JSON.stringify(db.meta.stress2)); });
      st = await next();
    } else if (ph === 'sync') {
      const r = await vault.syncPayouts({ userId: u.id });
      out.push(`synced ${r.synced} payouts: ${r.paid} paid, ${r.failed} failed`);
      const open = await store.transact(db => db.payments.filter(p => p.userId === u.id && ['pending', 'unclaimed', 'submitting'].includes(p.status)).length);
      if (open) break;
      await store.transact(db => parkSubs(db, u.id));
      st = await save({ phase: 'done', finishedAt: new Date().toISOString() });
    }
  }
  return { phase: st.phase, user: st.userId, did: out };
}
