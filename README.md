# riOs

**Prepay your subscriptions for the months you can afford, and let your AI manage them.**

Most subscriptions make you choose between paying every month or paying for a whole year. People with irregular income (freelancers, creators, students, anyone paid in seasons rather than salaries) often can't commit to either, but they *can* say: "I just got paid, cover me for three months."

riOs is an [MCP](https://modelcontextprotocol.io) server. Connect it to Claude, ChatGPT or any MCP client, and your AI can:

- add the subscriptions you pay for
- tell you exactly how much it costs to cover any number of months
- create a **PayPal** checkout that you approve once
- lock that money for the subscription, and pay **every renewal on its due date** through PayPal Payouts
- answer "how long am I covered?" and "I've got $50, what can I cover?"

Website: [riospay.xyz](https://riospay.xyz) · Console: [api.riospay.xyz/app](https://api.riospay.xyz/app) · Docs: [api.riospay.xyz/docs](https://api.riospay.xyz/docs)

## How riOs uses PayPal and AI

**PayPal (Developer platform, sandbox)**

| PayPal API | What riOs does with it |
|---|---|
| Orders v2 | Funding a subscription creates an order for monthly price × months. The user approves it in PayPal checkout; riOs captures it and locks the money for that one subscription and payee. |
| Payouts v1 | A daily job (08:00 UTC cron) pays each due renewal: exactly one month's amount, to that subscription's payee. A failed payout returns the money to the locked balance and pauses the subscription. |
| Payments v2 (refunds) | Within 3 days of approval, a deposit can be cancelled and everything not yet paid out is refunded. |

Every money-moving call sends a `PayPal-Request-Id`, so a retry can never charge or pay twice.

**AI**

- **Model Context Protocol (MCP):** riOs is an MCP server (JSON-RPC 2.0 over Streamable HTTP) exposing nine tools. Each tool carries read-only or destructive hints, so assistants ask the user before calling anything that moves money.
- **Claude (Anthropic) and ChatGPT (OpenAI):** users add riOs as a custom connector and manage everything in plain language: add subscriptions, check coverage, split new income, and prepare payments. The AI can prepare a payment but never approve it; only the user can, inside PayPal.

**Other tools:** Node.js (no framework), Vercel (hosting + cron), Upstash Redis (storage).

## Stress tested: 50 real PayPal sandbox transactions

We ran riOs end to end against the PayPal sandbox through the same code paths real users hit: **15 deposits locked** (Orders v2 capture), **5 refunds** inside the 3-day window (Payments v2 refund) and **30 of 30 renewals paid** (Payouts v1) across three months on a simulated clock. 0 failed, 0 lost. Every PayPal transaction ID is public at **[api.riospay.xyz/proof](https://api.riospay.xyz/proof)** ([JSON](https://api.riospay.xyz/proof.json)). The run lives in [`src/stress.js`](src/stress.js) and only ever touches its own test account.

## How the money moves

```
 You ──"cover Spotify for 3 months"──▶ your AI ──MCP──▶ riOs
                                                       │ creates a PayPal order
 You ◀──────────── approve link ───────────────────────┘
 You ──approve in PayPal──▶ PayPal ──capture──▶ riOs locks $32.97 for Spotify
                                                       │
 every renewal date (daily cron) ──▶ riOs ──PayPal Payout $10.99──▶ provider
```

| Step | PayPal API |
|---|---|
| Fund a subscription | Orders v2: create, then capture after approval |
| Cancel within 3 days | Payments v2: refund the capture (unspent part only) |
| Pay each renewal | Payouts v1, one payout per renewal |

Every money-moving call sends a `PayPal-Request-Id`, so a retry can never charge or pay twice.

## The rules

- **Lock by default.** Money funded for a subscription can only go to that subscription's payee, one month at a time.
- **3-day cancel window.** Within 72 hours of approval, a deposit can be cancelled and the unspent part refunded. After that it's locked.
- **Your AI can't redirect money.** Once a subscription is funded, its payee and monthly amount can't change. Even a tricked AI can't send locked funds anywhere else.
- **Your AI can't approve payments.** Only you can, in PayPal.
- **Fee:** 0% for now (configurable with `RIOS_FEE_BPS`; the fee is taken from each deposit and is not refunded).
- **Failed payout?** The money goes back to the subscription's balance and the subscription pauses for review.

## MCP tools

| Tool | What it does |
|---|---|
| `rios_add_subscription` | Add a subscription: name, payee PayPal email, monthly amount, next renewal date |
| `rios_list_subscriptions` | Balances, renewals covered, "covered through" date, pending approvals, cancellable deposits |
| `rios_quote` | Cost of covering N months, and which renewal dates that covers |
| `rios_fund_subscription` | Create the PayPal checkout; returns the approve link |
| `rios_check_funding` | Capture an approved payment and lock the funds |
| `rios_cancel_deposit` | Refund a deposit inside the 3-day window |
| `rios_plan_budget` | Split a budget across subscriptions, month by month in priority order |
| `rios_activity` | Recent events |
| `rios_remove_subscription` | Remove a subscription with no locked funds |

## Try it

1. Get a key at **`https://<your-deployment>/signup`** (sandbox only: no real money moves).
2. Connect your AI:
   - **Claude Code:** `claude mcp add --transport http rios https://<your-deployment>/mcp --header "Authorization: Bearer <key>"`
   - **Claude custom connector / URL-only clients:** `https://<your-deployment>/mcp/k/<key>`
   - **Local (stdio):** `RIOS_API_KEY=<key> node stdio.js`
3. Say: *"Add my design tool, $12 a month to provider@example.com, renewing on the 1st. Cover it for 3 months."*

## Run it yourself

No dependencies: just Node 20+.

```bash
cp .env.example .env        # add your PayPal sandbox app's client id and secret
npm test                    # 16 tests against a fake PayPal
npm run create-user -- "Your name"
npm start                   # http://localhost:8787/mcp, renewals every hour
```

### Deploy on Vercel (free)

1. Import this repo into Vercel.
2. Add **Upstash Redis** from Vercel's Storage marketplace (free tier). It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
3. Set the environment variables from `.env.example`: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PUBLIC_URL`, `CRON_SECRET`.
4. Deploy. Vercel calls `/cron/renew` daily (see `vercel.json`).

## What riOs can't do yet

- **Big brands.** Netflix, Spotify and similar don't accept PayPal Payouts. riOs pays any provider with a PayPal account today; big brands come next through virtual card partners.
- **Live money.** riOs runs on PayPal's sandbox. Live mode is blocked in code until riOs is registered, audited and partnered (`RIOS_ALLOW_LIVE`).

## Project layout

```
src/vault.js     money rules: subscriptions, deposits, renewals
src/paypal.js    PayPal REST client (orders, captures, refunds, payouts)
src/mcp.js       MCP protocol + tool definitions
src/http.js      HTTP routes: /mcp, PayPal return pages, signup, cron
src/store/       file (local) or Upstash Redis (Vercel) storage
api/index.js     Vercel function
server.js        Node server
stdio.js         local MCP over stdio
test/            tests with a fake PayPal
```

Built for the PayPal AI Hackathon by Favour ([@Favour_D_Crier](https://x.com/Favour_D_Crier)).
