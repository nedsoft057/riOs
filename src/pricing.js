// riOs pricing, in one place. Served publicly at /pricing.json and used by the README.
//
// How riOs earns:
// 1. First-month fee: a percentage of ONE month's price, charged once when a subscription is first
//    funded. Every later month added to that subscription is free.
// 2. riOs Card (roadmap): a one-time card fee per user, and a share of card interchange on every
//    renewal the card pays. Cards use just-in-time funding: the card holds $0 and each charge is
//    approved by riOs only if that user has that month locked for that exact service.
export const LAUNCH_FIRST_MONTH_FEE_BPS = 300; // 3%
export const LAUNCH_CARD_FEE_CENTS = 150;      // $1.50, once

export function pricing(cfg) {
  const beta = !(cfg.firstMonthFeeBps > 0);
  return {
    model: 'first_month_fee',
    beta,
    first_month_fee_percent: (cfg.firstMonthFeeBps || 0) / 100,
    launch_first_month_fee_percent: LAUNCH_FIRST_MONTH_FEE_BPS / 100,
    later_months_fee_percent: 0,
    card: {
      status: 'roadmap',
      one_time_fee: (cfg.cardFeeCents / 100).toFixed(2),
      monthly_fee: '0.00',
      funding: 'just_in_time',
    },
    currency: cfg.currency,
    summary: beta
      ? `Free during the beta. At launch: ${LAUNCH_FIRST_MONTH_FEE_BPS / 100}% of the first month of each new subscription, every later month free.`
      : `${cfg.firstMonthFeeBps / 100}% of the first month of each new subscription. Every later month is free.`,
    example: example(cfg.firstMonthFeeBps > 0 ? cfg.firstMonthFeeBps : LAUNCH_FIRST_MONTH_FEE_BPS),
  };
}

// ChatGPT Plus at $20/month, covered for 3 months, then topped up with 3 more.
function example(bps) {
  const fee = Math.ceil(2000 * bps / 10000);
  return {
    subscription: 'ChatGPT Plus, $20.00/month',
    first_funding: { months: 3, covered: '60.00', fee: (fee / 100).toFixed(2), total: ((6000 + fee) / 100).toFixed(2) },
    next_funding: { months: 3, covered: '60.00', fee: '0.00', total: '60.00' },
  };
}
