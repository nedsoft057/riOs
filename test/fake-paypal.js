// A small stand-in for PayPal's REST API, used only by the tests.
import { createServer } from 'node:http';

export async function startFakePayPal() {
  const state = { orders: {}, captures: {}, refunds: [], payouts: {}, requestIds: {}, n: 0, payoutStatus: 'SUCCESS', calls: [] };
  const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const data = body ? (req.headers['content-type']?.includes('json') ? JSON.parse(body) : body) : {};
    const url = new URL(req.url, 'http://x'); const p = url.pathname;
    state.calls.push(`${req.method} ${p}`);
    const send = (s, d) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const rid = req.headers['paypal-request-id'];
    if (rid && state.requestIds[rid]) return send(200, state.requestIds[rid]);
    const remember = (d) => { if (rid) state.requestIds[rid] = d; return d; };

    if (p === '/v1/oauth2/token') return send(200, { access_token: 'tok', expires_in: 3600 });
    if (p === '/v2/checkout/orders' && req.method === 'POST') {
      const id = `ORDER${++state.n}`;
      const o = { id, status: data.payment_source?.card ? 'APPROVED' : 'PAYER_ACTION_REQUIRED', amount: data.purchase_units[0].amount, links: [{ rel: 'payer-action', href: `https://sandbox.paypal.test/checkout?token=${id}` }] };
      state.orders[id] = o; return send(201, remember({ id, status: o.status, links: o.links }));
    }
    let m;
    if ((m = p.match(/^\/v2\/checkout\/orders\/([^/]+)$/))) {
      const o = state.orders[m[1]]; if (!o) return send(404, { name: 'RESOURCE_NOT_FOUND' });
      return send(200, { id: o.id, status: o.status, purchase_units: [{ payee: { email_address: 'merchant@rios.test' }, payments: { captures: o.capture ? [o.capture] : [] } }] });
    }
    if ((m = p.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/))) {
      const o = state.orders[m[1]];
      if (!o || o.status !== 'APPROVED') return send(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] });
      o.status = 'COMPLETED'; o.capture = { id: `CAP${++state.n}`, status: 'COMPLETED', amount: o.amount };
      state.captures[o.capture.id] = o.capture;
      return send(201, remember({ id: o.id, status: 'COMPLETED', purchase_units: [{ payments: { captures: [o.capture] } }] }));
    }
    if ((m = p.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/))) {
      if (!state.captures[m[1]]) return send(404, { name: 'RESOURCE_NOT_FOUND' });
      const r = { id: `REF${++state.n}`, status: 'COMPLETED', amount: data.amount }; state.refunds.push(r);
      return send(201, remember(r));
    }
    if (p === '/v1/payments/payouts' && req.method === 'POST') {
      const id = `BATCH${++state.n}`;
      state.payouts[id] = { request: data, status: state.payoutStatus };
      return send(201, remember({ batch_header: { payout_batch_id: id, batch_status: 'PENDING' } }));
    }
    if ((m = p.match(/^\/v1\/payments\/payouts\/([^/]+)$/))) {
      const b = state.payouts[m[1]]; if (!b) return send(404, { name: 'RESOURCE_NOT_FOUND' });
      return send(200, { batch_header: { batch_status: 'SUCCESS' }, items: [{ payout_item_id: 'ITEM1', transaction_status: b.status }] });
    }
    send(404, { name: 'NOT_FOUND', path: p });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, state, approve: id => { state.orders[id].status = 'APPROVED'; }, close: () => server.close() };
}
