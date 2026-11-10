// PayPal REST client: Orders v2 (funding), captures + refunds (cancel window),
// Payouts (paying providers each month). Every money-moving call carries a
// PayPal-Request-Id so retries can never charge or pay twice.
import { money } from './util.js';

export class PayPalError extends Error {
  constructor(message, status, details) { super(message); this.status = status; this.details = details; }
}

export class PayPal {
  constructor({ clientId, clientSecret, apiBase }) {
    this.clientId = clientId; this.clientSecret = clientSecret; this.base = apiBase;
    this.token = null; this.tokenExp = 0;
  }

  configured() { return Boolean(this.clientId && this.clientSecret); }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExp - 60000) return this.token;
    if (!this.configured()) throw new PayPalError('PayPal is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.', 500);
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalError(`PayPal login failed: ${body.error_description || res.status}`, res.status, body);
    this.token = body.access_token; this.tokenExp = Date.now() + (body.expires_in || 300) * 1000;
    return this.token;
  }

  async call(method, path, body, requestId) {
    const headers = { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' };
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    if (method === 'POST') headers.Prefer = 'return=representation';
    const res = await fetch(`${this.base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const detail = data.details?.[0]?.issue || data.name || '';
      throw new PayPalError(`PayPal ${method} ${path.split('?')[0]} failed (${res.status}${detail ? `: ${detail}` : ''})${data.debug_id ? ` debug_id=${data.debug_id}` : ''}`, res.status, data);
    }
    return data;
  }

  // Checkout for a deposit. The payer approves it in PayPal; we capture after.
  async createOrder({ amountCents, currency, description, customId, returnUrl, cancelUrl, requestId }) {
    const order = await this.call('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: customId, custom_id: customId, description: description.slice(0, 127),
        amount: { currency_code: currency, value: money(amountCents) },
      }],
      payment_source: { paypal: { experience_context: {
        brand_name: 'riOs', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
        landing_page: 'LOGIN', // open PayPal's login screen, not the guest card form
        return_url: returnUrl, cancel_url: cancelUrl,
      } } },
    }, requestId);
    const link = (order.links || []).find(l => l.rel === 'payer-action' || l.rel === 'approve');
    return { id: order.id, status: order.status, approveUrl: link?.href };
  }

  getOrder(orderId) { return this.call('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`); }

  async captureOrder(orderId, requestId) {
    const o = await this.call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, requestId);
    const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
    return { status: o.status, captureId: cap?.id, captureStatus: cap?.status, amount: cap?.amount, payerEmail: o.payer?.email_address };
  }

  async refundCapture(captureId, amountCents, currency, requestId) {
    const r = await this.call('POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      { amount: { value: money(amountCents), currency_code: currency } }, requestId);
    return { id: r.id, status: r.status };
  }

  async createPayout({ batchId, receiver, amountCents, currency, note, itemId }) {
    const r = await this.call('POST', '/v1/payments/payouts', {
      sender_batch_header: { sender_batch_id: batchId, email_subject: 'You have a payment from riOs', email_message: note },
      items: [{ recipient_type: 'EMAIL', receiver, note, sender_item_id: itemId, amount: { value: money(amountCents), currency } }],
    }, batchId);
    return { batchId: r.batch_header?.payout_batch_id, status: r.batch_header?.batch_status };
  }

  async getPayout(payoutBatchId) {
    const r = await this.call('GET', `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`);
    const item = r.items?.[0];
    return { batchStatus: r.batch_header?.batch_status, itemStatus: item?.transaction_status, itemId: item?.payout_item_id, error: item?.errors?.name };
  }
}
