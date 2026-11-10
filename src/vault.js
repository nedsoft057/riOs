// riOs core: subscriptions, locked deposits, renewals.
//
// Money rules:
// - A deposit funds one subscription for N months. The user approves it once in PayPal.
// - The fee (feeBps, 0 during the hackathon) is taken from every deposit and never refunded.
// - For cancelWindowHours after a deposit is captured, the user can cancel it and get back
//   whatever of it hasn't been paid out yet. After that it is locked.
// - On each renewal date, exactly one month's amount is paid to the subscription's payee via
//   PayPal Payouts, drawn from the oldest deposits first.
// - Once a subscription has been funded, its payee and monthly amount cannot change, so an AI
//   (or anyone holding the API key) can never redirect locked money.
import { UserError, id, sha256, toCents, money, today, parseDate, addMonths, addDays, isEmail } from './util.js';
import { randomBytes } from 'node:crypto';

const FINAL_FAIL = new Set(['FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED', 'DENIED']);

export class Vault {
  constructor({ store, paypal, config, now = () => new Date() }) {
    this.store = store; this.paypal = paypal; this.cfg = config; this.now = now;
  }

  // ---------- users ----------
  async createUser(name) {
    name = String(name || '').trim().slice(0, 60) || 'riOs user';
    const key = `rios_${randomBytes(24).toString('base64url')}`;
    const user = { id: id('usr'), name, keyHash: sha256(key), createdAt: this.now().toISOString() };
    await this.store.transact(db => { db.users.push(user); log(db, user.id, 'account_created', {}, this.now()); });
    return { user: { id: user.id, name }, apiKey: key };
  }

  async authenticate(key) {
    if (!key || typeof key !== 'string') return null;
    const h = sha256(key);
    return this.store.transact(db => {
      const u = db.users.find(x => x.keyHash === h);
      return u ? { id: u.id, name: u.name } : null;
    });
  }

  // ---------- subscriptions ----------
  async addSubscription(user, { name, payee_email, monthly_amount, next_billing_date }) {
    name = String(name || '').trim();
    if (!name || name.length > 60) throw new UserError('name is required (up to 60 characters), e.g. "Spotify"');
    if (!isEmail(payee_email)) throw new UserError('payee_email must be the PayPal email address that receives the payments');
    const monthlyCents = toCents(monthly_amount, 'monthly_amount');
    if (monthlyCents < 100 || monthlyCents > this.cfg.maxMonthlyCents) throw new UserError(`monthly_amount must be between 1.00 and ${money(this.cfg.maxMonthlyCents)}`);
    const t = today(this.now());
    const next = next_billing_date ? parseDate(next_billing_date, 'next_billing_date') : t;
    if (next < t) throw new UserError('next_billing_date cannot be in the past');
    if (next > addMonths(t, 12)) throw new UserError('next_billing_date must be within the next 12 months');
    const sub = {
      id: id('sub'), userId: user.id, name, payeeEmail: payee_email.trim().toLowerCase(), monthlyCents,
      currency: this.cfg.currency, nextRenewal: next, status: 'active', attention: null, createdAt: this.now().toISOString(),
    };
    await this.store.transact(db => {
      if (db.subscriptions.filter(s => s.userId === user.id && s.status !== 'removed').length >= 25) throw new UserError('You can have up to 25 subscriptions');
      db.subscriptions.push(sub);
      log(db, user.id, 'subscription_added', { subscriptionId: sub.id, name, monthly: money(monthlyCents) }, this.now());
    });
    return this.describeSub(sub, []);
  }

  async listSubscriptions(user) {
    return this.store.transact(db => {
      const subs = db.subscriptions.filter(s => s.userId === user.id && s.status !== 'removed');
      return subs.map(s => this.describeSub(s, db.deposits.filter(d => d.subscriptionId === s.id), db.payments.filter(p => p.subscriptionId === s.id)));
    });
  }

  async removeSubscription(user, subscriptionId) {
    return this.store.transact(db => {
      const sub = ownSub(db, user, subscriptionId);
      const deps = db.deposits.filter(d => d.subscriptionId === sub.id);
      if (balanceOf(deps) > 0) throw new UserError('This subscription still has locked funds. It keeps paying until they run out, then you can remove it.');
      if (deps.some(d => d.status === 'pending')) throw new UserError('There is a funding waiting for approval. Approve or cancel it in PayPal first.');
      sub.status = 'removed';
      log(db, user.id, 'subscription_removed', { subscriptionId: sub.id }, this.now());
      return { removed: true, subscription_id: sub.id, name: sub.name };
    });
  }

  // ---------- funding ----------
  quote(monthlyCents, months) {
    const net = monthlyCents * months;
    const bps = this.cfg.feeBps;
    const fee = bps > 0 ? Math.ceil(net * bps / (10000 - bps)) : 0; // fee is bps of the total deposit
    return { net, fee, gross: net + fee };
  }

  async quoteFunding(user, subscriptionId, months) {
    months = this.checkMonths(months);
    return this.store.transact(db => {
      const sub = ownSub(db, user, subscriptionId);
      const q = this.quote(sub.monthlyCents, months);
      return {
        subscription: sub.name, months, monthly: money(sub.monthlyCents), currency: sub.currency,
        covered_amount: money(q.net), fee: money(q.fee), fee_percent: this.cfg.feeBps / 100, total_to_pay: money(q.gross),
        renewals_covered: renewalDates(sub.nextRenewal, months),
      };
    });
  }

  async startFunding(user, subscriptionId, months) {
    months = this.checkMonths(months);
    const dep = await this.store.transact(db => {
      const sub = ownSub(db, user, subscriptionId);
      if (sub.status !== 'active') throw new UserError('This subscription is paused. Check its status first.');
      const open = db.deposits.filter(d => d.subscriptionId === sub.id && d.status === 'pending');
      if (open.length >= 3) throw new UserError('There are already 3 fundings waiting for approval for this subscription. Approve or cancel those first.');
      const q = this.quote(sub.monthlyCents, months);
      const d = {
        id: id('dep'), userId: user.id, subscriptionId: sub.id, subscriptionName: sub.name, months,
        netCents: q.net, feeCents: q.fee, grossCents: q.gross, remainingCents: 0, currency: sub.currency,
        status: 'pending', orderId: null, approveUrl: null, captureId: null,
        createdAt: this.now().toISOString(), lockedAt: null, cancelUntil: null, refundId: null,
      };
      db.deposits.push(d);
      return d;
    });
    let order;
    try {
      order = await this.paypal.createOrder({
        amountCents: dep.grossCents, currency: dep.currency,
        description: `riOs: ${dep.subscriptionName}, ${dep.months} month${dep.months > 1 ? 's' : ''}`,
        customId: dep.id, requestId: `order-${dep.id}`,
        returnUrl: `${this.cfg.publicUrl}/paypal/return?deposit=${dep.id}`,
        cancelUrl: `${this.cfg.publicUrl}/paypal/cancel?deposit=${dep.id}`,
      });
    } catch (e) {
      await this.store.transact(db => { const d = db.deposits.find(x => x.id === dep.id); if (d) d.status = 'failed'; });
      throw e;
    }
    await this.store.transact(db => {
      const d = db.deposits.find(x => x.id === dep.id);
      d.orderId = order.id; d.approveUrl = order.approveUrl;
      log(db, user.id, 'funding_started', { depositId: d.id, subscription: d.subscriptionName, months: d.months, total: money(d.grossCents) }, this.now());
    });
    return {
      deposit_id: dep.id, status: 'waiting_for_approval', subscription: dep.subscriptionName, months: dep.months,
      total_to_pay: money(dep.grossCents), currency: dep.currency, fee: money(dep.feeCents),
      approve_url: order.approveUrl,
      next_step: 'Open approve_url and approve the payment in PayPal. riOs locks the funds as soon as you approve.',
    };
  }

  // Capture an approved order and lock the funds. Safe to call many times.
  // userId is null when called from the PayPal return page (the order id must then match).
  async confirmFunding(depositId, { userId = null, orderId = null } = {}) {
    const dep = await this.store.transact(db => {
      const d = db.deposits.find(x => x.id === depositId);
      if (!d || (userId && d.userId !== userId)) throw new UserError('Funding not found', 'not_found');
      if (orderId && d.orderId !== orderId) throw new UserError('This PayPal order does not match the funding', 'not_found');
      return { ...d };
    });
    if (dep.status !== 'pending') return this.describeDeposit(dep);
    if (!dep.orderId) throw new UserError('This funding has no PayPal order yet. Start a new funding.');

    const order = await this.paypal.getOrder(dep.orderId);
    let cap = null;
    if (order.status === 'APPROVED') cap = await this.paypal.captureOrder(dep.orderId, `capture-${dep.id}`);
    else if (order.status === 'COMPLETED') {
      const c = order.purchase_units?.[0]?.payments?.captures?.[0];
      cap = { status: 'COMPLETED', captureId: c?.id, captureStatus: c?.status, amount: c?.amount };
    } else {
      return { ...this.describeDeposit(dep), paypal_status: order.status,
        next_step: order.status === 'VOIDED' ? 'This PayPal order was cancelled. Start a new funding.' : 'Not approved yet. Open approve_url and approve the payment in PayPal.' };
    }

    if (cap.captureStatus !== 'COMPLETED') {
      return { ...this.describeDeposit(dep), paypal_status: cap.captureStatus || cap.status,
        next_step: 'PayPal has not completed this payment yet (it may be under review). Check again later.' };
    }
    const paid = toCents(cap.amount?.value || '0');
    if (paid !== dep.grossCents || (cap.amount?.currency_code && cap.amount.currency_code !== dep.currency)) {
      throw new Error(`Captured amount ${cap.amount?.value} ${cap.amount?.currency_code} does not match the expected ${money(dep.grossCents)} ${dep.currency}`);
    }
    return this.store.transact(db => {
      const d = db.deposits.find(x => x.id === dep.id);
      if (d.status === 'pending') {
        const now = this.now();
        d.status = 'locked'; d.captureId = cap.captureId; d.remainingCents = d.netCents;
        d.lockedAt = now.toISOString();
        d.cancelUntil = new Date(now.getTime() + this.cfg.cancelWindowHours * 3600e3).toISOString();
        const sub = db.subscriptions.find(s => s.id === d.subscriptionId);
        if (sub && sub.attention === 'unfunded') sub.attention = null;
        log(db, d.userId, 'funding_locked', { depositId: d.id, subscription: d.subscriptionName, months: d.months, amount: money(d.netCents) }, now);
      }
      return this.describeDeposit(d);
    });
  }

  async markFundingCancelled(depositId) {
    return this.store.transact(db => {
      const d = db.deposits.find(x => x.id === depositId);
      if (d && d.status === 'pending') { d.status = 'cancelled'; log(db, d.userId, 'funding_cancelled_in_paypal', { depositId: d.id }, this.now()); }
      return d ? this.describeDeposit(d) : null;
    });
  }

  async cancelDeposit(user, depositId) {
    const dep = await this.store.transact(db => {
      const d = db.deposits.find(x => x.id === depositId && x.userId === user.id);
      if (!d) throw new UserError('Deposit not found', 'not_found');
      if (d.status === 'pending') { d.status = 'cancelled'; return { done: this.describeDeposit(d) }; }
      if (d.status !== 'locked') throw new UserError(`This deposit is ${d.status} and can't be cancelled.`);
      if (this.now().toISOString() >= d.cancelUntil) throw new UserError(`The ${this.cfg.cancelWindowHours / 24}-day cancel window ended on ${d.cancelUntil.slice(0, 10)}. These funds are locked and will keep paying the subscription. For a serious problem, contact the riOs team.`);
      if (d.remainingCents <= 0) throw new UserError('Nothing left to refund on this deposit: it has already been paid out.');
      d.status = 'refunding';
      return { d: { ...d } };
    });
    if (dep.done) return { ...dep.done, refunded: '0.00', note: 'Funding was never paid, so it is simply cancelled.' };
    const d = dep.d;
    try {
      const r = await this.paypal.refundCapture(d.captureId, d.remainingCents, d.currency, `refund-${d.id}`);
      return this.store.transact(db => {
        const x = db.deposits.find(y => y.id === d.id);
        x.status = 'refunded'; x.refundId = r.id; const amt = x.remainingCents; x.remainingCents = 0;
        log(db, x.userId, 'deposit_refunded', { depositId: x.id, amount: money(amt), feeKept: money(x.feeCents) }, this.now());
        return { ...this.describeDeposit(x), refunded: money(amt), fee_kept: money(x.feeCents), paypal_refund_status: r.status };
      });
    } catch (e) {
      await this.store.transact(db => { const x = db.deposits.find(y => y.id === d.id); if (x.status === 'refunding') x.status = 'locked'; });
      throw e;
    }
  }

  // Split a budget across subscriptions, one month at a time in priority order.
  async planBudget(user, budget, subscriptionIds) {
    const budgetCents = toCents(budget, 'budget');
    return this.store.transact(db => {
      let subs = db.subscriptions.filter(s => s.userId === user.id && s.status === 'active');
      if (Array.isArray(subscriptionIds) && subscriptionIds.length) {
        subs = subscriptionIds.map(i => subs.find(s => s.id === i)).filter(Boolean);
      }
      if (!subs.length) throw new UserError('No active subscriptions to plan for. Add one first.');
      const months = Object.fromEntries(subs.map(s => [s.id, 0]));
      const total = () => subs.reduce((t, s) => t + (months[s.id] ? this.quote(s.monthlyCents, months[s.id]).gross : 0), 0);
      let progress = true;
      while (progress) {
        progress = false;
        for (const s of subs) {
          if (months[s.id] >= this.cfg.maxMonths) continue;
          months[s.id]++;
          if (total() <= budgetCents) progress = true; else months[s.id]--;
        }
      }
      const used = total();
      const plan = subs.map(s => {
        const deps = db.deposits.filter(d => d.subscriptionId === s.id);
        const covered = Math.floor(balanceOf(deps) / s.monthlyCents);
        const startFrom = addMonths(s.nextRenewal, covered);
        return { subscription_id: s.id, name: s.name, monthly: money(s.monthlyCents), add_months: months[s.id],
          cost: months[s.id] ? money(this.quote(s.monthlyCents, months[s.id]).gross) : '0.00',
          covered_through_after: months[s.id] || covered ? addDays(addMonths(startFrom, months[s.id]), -1) : null };
      });
      return { budget: money(budgetCents), will_spend: money(used), left_over: money(budgetCents - used), plan,
        how_to_apply: 'Call rios_fund_subscription for each subscription with its add_months.' };
    });
  }

  async activity(user, limit = 20) {
    limit = Math.max(1, Math.min(100, Number(limit) || 20));
    return this.store.transact(db => db.events.filter(e => e.userId === user.id).slice(-limit).reverse());
  }

  // ---------- renewals (run by the daily cron) ----------
  async runRenewals() {
    const report = { synced: 0, paid: 0, failed: 0, unfunded: 0, submitted: 0, errors: [] };
    // 1. Check payouts still in flight.
    const inflight = await this.store.transact(db => db.payments.filter(p => ['pending', 'unclaimed'].includes(p.status) && p.batchId).map(p => ({ ...p })));
    for (const p of inflight) {
      try {
        const st = await this.paypal.getPayout(p.batchId);
        await this.store.transact(db => this.applyPayoutStatus(db, p.id, st, report));
        report.synced++;
      } catch (e) { report.errors.push(`sync ${p.id}: ${e.message}`); }
    }
    // 2. Pay everything that's due.
    const t = today(this.now());
    const due = await this.store.transact(db => {
      const out = [];
      for (const sub of db.subscriptions) {
        if (sub.status !== 'active' || sub.nextRenewal > t) continue;
        const period = sub.nextRenewal;
        if (db.payments.some(p => p.subscriptionId === sub.id && p.period === period && p.status !== 'failed')) continue;
        const deps = db.deposits.filter(d => d.subscriptionId === sub.id && d.status === 'locked' && d.remainingCents > 0)
          .sort((a, b) => a.lockedAt.localeCompare(b.lockedAt));
        if (deps.reduce((s, d) => s + d.remainingCents, 0) < sub.monthlyCents) {
          if (sub.attention !== 'unfunded') { sub.attention = 'unfunded'; log(db, sub.userId, 'renewal_unfunded', { subscription: sub.name, due: period }, this.now()); }
          report.unfunded++;
          continue;
        }
        let need = sub.monthlyCents; const allocations = [];
        for (const d of deps) { if (!need) break; const take = Math.min(need, d.remainingCents); d.remainingCents -= take; need -= take; allocations.push({ depositId: d.id, cents: take }); }
        const pay = { id: id('pay'), userId: sub.userId, subscriptionId: sub.id, subscriptionName: sub.name, period,
          amountCents: sub.monthlyCents, currency: sub.currency, payeeEmail: sub.payeeEmail, allocations,
          status: 'submitting', batchId: null, createdAt: this.now().toISOString(), updatedAt: this.now().toISOString(), failureReason: null };
        db.payments.push(pay);
        sub.nextRenewal = addMonths(period, 1); sub.attention = null;
        out.push({ ...pay });
      }
      return out;
    });
    for (const p of due) {
      try {
        const r = await this.paypal.createPayout({ batchId: p.id, itemId: p.id, receiver: p.payeeEmail, amountCents: p.amountCents, currency: p.currency,
          note: `riOs renewal for ${p.subscriptionName} (${p.period})` });
        await this.store.transact(db => {
          const x = db.payments.find(y => y.id === p.id);
          x.batchId = r.batchId; x.status = 'pending'; x.updatedAt = this.now().toISOString();
          log(db, x.userId, 'renewal_sent', { subscription: x.subscriptionName, amount: money(x.amountCents), period: x.period, to: x.payeeEmail }, this.now());
        });
        report.submitted++;
      } catch (e) {
        await this.store.transact(db => this.failPayment(db, p.id, e.message, report));
        report.errors.push(`payout ${p.id}: ${e.message}`);
      }
    }
    return report;
  }

  applyPayoutStatus(db, paymentId, st, report) {
    const p = db.payments.find(x => x.id === paymentId);
    if (!p || !['pending', 'unclaimed'].includes(p.status)) return;
    const s = st.itemStatus || st.batchStatus;
    p.updatedAt = this.now().toISOString();
    if (s === 'SUCCESS') { p.status = 'paid'; report.paid++; log(db, p.userId, 'renewal_paid', { subscription: p.subscriptionName, amount: money(p.amountCents), period: p.period }, this.now()); }
    else if (s === 'UNCLAIMED') p.status = 'unclaimed';
    else if (FINAL_FAIL.has(s)) this.failPayment(db, p.id, `PayPal payout ${s}${st.error ? ` (${st.error})` : ''}`, report);
  }

  // Put the money back on the deposits and pause the subscription for a human to look at.
  failPayment(db, paymentId, reason, report) {
    const p = db.payments.find(x => x.id === paymentId);
    if (!p || p.status === 'failed') return;
    for (const a of p.allocations) { const d = db.deposits.find(x => x.id === a.depositId); if (d) d.remainingCents += a.cents; }
    p.status = 'failed'; p.failureReason = reason; p.updatedAt = this.now().toISOString();
    const sub = db.subscriptions.find(s => s.id === p.subscriptionId);
    if (sub) { sub.nextRenewal = p.period; sub.status = 'paused'; sub.attention = 'payout_failed'; }
    report.failed++;
    log(db, p.userId, 'renewal_failed', { subscription: p.subscriptionName, period: p.period, reason, fundsReturnedToBalance: money(p.amountCents) }, this.now());
  }

  // ---------- views ----------
  checkMonths(m) {
    m = Number(m);
    if (!Number.isInteger(m) || m < 1 || m > this.cfg.maxMonths) throw new UserError(`months must be a whole number from 1 to ${this.cfg.maxMonths}`);
    return m;
  }

  describeSub(s, deps = [], pays = []) {
    const bal = balanceOf(deps);
    const covered = Math.floor(bal / s.monthlyCents);
    const pending = deps.filter(d => d.status === 'pending').map(d => ({ deposit_id: d.id, months: d.months, total: money(d.grossCents), approve_url: d.approveUrl }));
    return {
      subscription_id: s.id, name: s.name, monthly: money(s.monthlyCents), currency: s.currency, pays_to: s.payeeEmail,
      status: s.status, attention: s.attention, next_renewal: s.nextRenewal,
      locked_balance: money(bal), renewals_covered: covered,
      covered_through: covered ? addDays(addMonths(s.nextRenewal, covered), -1) : null,
      payee_locked: deps.some(d => d.status !== 'pending' && d.status !== 'cancelled' && d.status !== 'failed'),
      waiting_for_approval: pending,
      cancellable_deposits: deps.filter(d => d.status === 'locked' && d.remainingCents > 0 && this.now().toISOString() < d.cancelUntil)
        .map(d => ({ deposit_id: d.id, refundable: money(d.remainingCents), cancel_until: d.cancelUntil })),
      recent_payments: pays.slice(-3).reverse().map(p => ({ period: p.period, amount: money(p.amountCents), status: p.status })),
    };
  }

  describeDeposit(d) {
    return {
      deposit_id: d.id, subscription: d.subscriptionName, months: d.months, status: d.status,
      total_paid: money(d.grossCents), covers: money(d.netCents), fee: money(d.feeCents), remaining: money(d.remainingCents),
      cancel_until: d.cancelUntil, approve_url: d.status === 'pending' ? d.approveUrl : undefined,
    };
  }
}

function ownSub(db, user, subscriptionId) {
  const s = db.subscriptions.find(x => x.id === subscriptionId && x.userId === user.id && x.status !== 'removed');
  if (!s) throw new UserError('Subscription not found. Use rios_list_subscriptions to see your subscription ids.', 'not_found');
  return s;
}
function balanceOf(deps) { return deps.filter(d => d.status === 'locked' || d.status === 'refunding').reduce((t, d) => t + d.remainingCents, 0); }
function renewalDates(start, n) { return Array.from({ length: n }, (_, i) => addMonths(start, i)); }
function log(db, userId, type, data, now) {
  db.events.push({ at: now.toISOString(), userId, type, ...data });
  if (db.events.length > 5000) db.events.splice(0, db.events.length - 5000);
}
