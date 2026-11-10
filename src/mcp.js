// MCP (Model Context Protocol) server: JSON-RPC 2.0, no dependencies.
// Works over Streamable HTTP (stateless JSON responses) and stdio.
import { UserError } from './util.js';
import { PayPalError } from './paypal.js';

export const SERVER_INFO = { name: 'rios', title: 'riOs', version: '0.1.0' };
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `riOs lets people prepay their subscriptions for the months they can afford.
Funds for a subscription are locked and riOs pays each renewal on its due date via PayPal.
Typical flow: rios_add_subscription -> rios_quote -> rios_fund_subscription (give the user the approve_url; only they can approve payments in PayPal) -> rios_check_funding.
Use rios_list_subscriptions to answer "how long am I covered?" and rios_plan_budget to split an amount across subscriptions.
Amounts are in the account currency (USD). Never ask for card or PayPal passwords.
A deposit can be cancelled for a refund within 3 days of approval; after that it is locked by design.`;

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });

export const TOOLS = [
  {
    name: 'rios_add_subscription',
    title: 'Add a subscription',
    description: 'Add a subscription riOs should pay. payee_email is the PayPal account that receives each renewal payment. Once funded, the payee and amount can no longer change.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['name', 'payee_email', 'monthly_amount'], properties: {
      name: str('What it is, e.g. "Spotify" or "Design tool"'),
      payee_email: str('PayPal email address of whoever gets paid each month', { format: 'email' }),
      monthly_amount: str('Amount per month, e.g. "10.99"'),
      next_billing_date: str('Next renewal date, YYYY-MM-DD. Defaults to today.'),
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'rios_list_subscriptions',
    title: 'List subscriptions and runway',
    description: 'Show every subscription with its locked balance, how many renewals are covered, the date it is paid through, fundings waiting for approval and deposits that can still be cancelled.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'rios_quote',
    title: 'Quote a funding',
    description: 'Work out what it costs to cover a subscription for a number of months, and which renewal dates that covers. Does not charge anything.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['subscription_id', 'months'], properties: {
      subscription_id: str('From rios_list_subscriptions'), months: { type: 'integer', minimum: 1, maximum: 24 },
    } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'rios_fund_subscription',
    title: 'Fund a subscription',
    description: 'Create a PayPal checkout to cover a subscription for N months. Returns approve_url: give it to the user, who approves the payment in PayPal themselves. After approval the funds are locked for this subscription.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['subscription_id', 'months'], properties: {
      subscription_id: str('From rios_list_subscriptions'), months: { type: 'integer', minimum: 1, maximum: 24 },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'rios_check_funding',
    title: 'Check a funding',
    description: 'Check whether the user has approved a funding in PayPal. If approved, riOs captures the payment and locks the funds.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['deposit_id'], properties: { deposit_id: str('From rios_fund_subscription') } },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'rios_cancel_deposit',
    title: 'Cancel a deposit',
    description: 'Cancel a deposit within 3 days of approval and refund the part not yet paid out to the user\'s PayPal. After 3 days deposits are locked and this will refuse. Confirm with the user before calling.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['deposit_id'], properties: { deposit_id: str('From rios_list_subscriptions (cancellable_deposits)') } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'rios_plan_budget',
    title: 'Plan a budget',
    description: 'Given an amount of money, suggest how many months of each subscription it can cover, filling them one month at a time in priority order. Does not charge anything.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['budget'], properties: {
      budget: str('Amount available, e.g. "50"'),
      subscription_ids: { type: 'array', items: { type: 'string' }, description: 'Optional priority order. Defaults to all active subscriptions.' },
    } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'rios_activity',
    title: 'Recent activity',
    description: 'Recent events: subscriptions added, fundings locked, renewals paid or failed, refunds.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'rios_remove_subscription',
    title: 'Remove a subscription',
    description: 'Remove a subscription that has no locked funds left.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['subscription_id'], properties: { subscription_id: str('From rios_list_subscriptions') } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
];

async function callTool(vault, user, name, a = {}) {
  switch (name) {
    case 'rios_add_subscription': return vault.addSubscription(user, a);
    case 'rios_list_subscriptions': { const subs = await vault.listSubscriptions(user); return { count: subs.length, subscriptions: subs }; }
    case 'rios_quote': return vault.quoteFunding(user, a.subscription_id, a.months);
    case 'rios_fund_subscription': return vault.startFunding(user, a.subscription_id, a.months);
    case 'rios_check_funding': return vault.confirmFunding(a.deposit_id, { userId: user.id });
    case 'rios_cancel_deposit': return vault.cancelDeposit(user, a.deposit_id);
    case 'rios_plan_budget': return vault.planBudget(user, a.budget, a.subscription_ids);
    case 'rios_activity': return { events: await vault.activity(user, a.limit) };
    case 'rios_remove_subscription': return vault.removeSubscription(user, a.subscription_id);
    default: throw new RpcError(-32602, `Unknown tool: ${name}`);
  }
}

class RpcError extends Error { constructor(code, message) { super(message); this.code = code; } }

// Handle one JSON-RPC message. Returns a response object, or null for notifications.
export async function handleMessage(vault, user, msg) {
  const isRequest = msg && typeof msg === 'object' && 'id' in msg && msg.id !== null;
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return isRequest || msg?.id === undefined ? { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid request' } } : null;
  }
  if (!isRequest) return null; // notifications (initialized, cancelled...) need no reply
  const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  try {
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion;
        return reply({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'resources/list': return reply({ resources: [] });
      case 'prompts/list': return reply({ prompts: [] });
      case 'tools/call': {
        const { name, arguments: args } = msg.params || {};
        if (!TOOLS.some(t => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
        try {
          const out = await callTool(vault, user, name, args || {});
          return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: wrap(out), isError: false });
        } catch (e) {
          if (e instanceof RpcError) throw e;
          const message = e.user ? e.message : e instanceof PayPalError ? `PayPal problem: ${e.message}` : 'Something went wrong inside riOs. Please try again.';
          if (!e.user) console.error(`[rios] tool ${name} failed:`, e);
          return reply({ content: [{ type: 'text', text: message }], isError: true });
        }
      }
      default: return fail(-32601, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    return fail(e.code || -32603, e.message || 'Internal error');
  }
}

function wrap(out) { return out && typeof out === 'object' && !Array.isArray(out) ? out : { result: out }; }
