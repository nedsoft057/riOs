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
import { today, addMonths, money } from './util.js';

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
export async function stressReport(store) {
  return store.transact(db => {
    const st = db.meta?.stress; if (!st?.userId) return null;
    const subs = db.subscriptions.filter(s => s.userId === st.userId);
    const name = id => subs.find(s => s.id === id)?.name || '';
    const tx = [];
    for (const d of db.deposits.filter(d => d.userId === st.userId && d.captureId)) {
      tx.push({ kind: 'funding', at: d.lockedAt, what: `${d.subscriptionName} · ${d.months} mo locked`, amount: d.grossCents, ref: d.captureId, status: 'COMPLETED' });
      if (d.refundId) tx.push({ kind: 'refund', at: d.lockedAt, what: `${d.subscriptionName} · cancelled in window`, amount: -(d.netCents), ref: d.refundId, status: 'COMPLETED' });
    }
    for (const p of db.payments.filter(p => p.userId === st.userId)) {
      tx.push({ kind: 'renewal', at: p.createdAt, period: p.period, what: `${name(p.subscriptionId)} · renewal ${p.period}`, amount: p.amountCents, ref: p.batchId, status: p.status.toUpperCase() });
    }
    tx.sort((a, b) => (a.at || '').localeCompare(b.at || '') || a.kind.localeCompare(b.kind));
    const sum = k => tx.filter(t => t.kind === k).reduce((s, t) => s + Math.abs(t.amount), 0);
    return {
      phase: st.phase, startedAt: st.startedAt, finishedAt: st.finishedAt || null, payee: st.payee,
      counts: { total: tx.length, funding: tx.filter(t => t.kind === 'funding').length, refund: tx.filter(t => t.kind === 'refund').length, renewal: tx.filter(t => t.kind === 'renewal').length,
        paid: tx.filter(t => t.kind === 'renewal' && t.status === 'PAID').length, failed: tx.filter(t => t.status === 'FAILED').length },
      volume: { funding: money(sum('funding')), refund: money(sum('refund')), renewal: money(sum('renewal')) },
      subscriptions: subs.map(s => ({ name: s.name, monthly: money(s.monthlyCents) })),
      tx: tx.map(t => ({ ...t, amount: money(Math.abs(t.amount)) })),
    };
  });
}
