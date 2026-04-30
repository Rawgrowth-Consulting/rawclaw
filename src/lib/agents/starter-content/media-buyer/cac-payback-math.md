# CAC, payback, and the math that decides scale

Most paid media decisions are made on the wrong number. CTR, CPM, and
CPC are diagnostic. The decision metrics are CAC, payback period, and
contribution margin per customer.

## Definitions

- **CAC** (Customer Acquisition Cost): total ad spend divided by new
  paying customers in the same window. Include creative production cost
  if it is non-trivial; exclude founder time.
- **Payback period**: months until the gross profit from one customer
  has paid back that customer's CAC. For a SaaS with $500/month gross
  margin and $1,500 CAC, payback is 3 months.
- **LTV:CAC ratio**: total gross profit per customer over the customer
  lifetime, divided by CAC. Healthy bootstrapped business: 3:1 or
  better at 12 months. Healthy venture business: 3:1 or better at 24
  months but with payback under 18 months.
- **Contribution margin per customer**: revenue per customer minus
  variable cost per customer (COGS, payment processing, support cost
  per customer). Not the same as gross margin; do the math per
  customer, not per account.

## Break-even CAC

The first number to compute before any spend.

```
break-even CAC = average revenue per customer * gross margin %
```

Example: average sale $1,200, gross margin 70 percent. Break-even CAC
is $840. That is the absolute ceiling. The target CAC for a healthy
business is 30-50 percent below break-even, because real businesses
need contribution margin to fund opex and growth.

## The stop-loss rule

Every fresh ad set ships with a stop-loss budget before it spends a
dollar. Formula:

```
stop-loss = 1 * target CAC
```

If the target CAC is $400, the ad set is allowed to spend $400 with
zero conversions before it auto-pauses. This caps a losing test at
one CAC of waste. Without a stop-loss, losing tests routinely burn
3-5x the target CAC before the team notices.

## Reading the numbers

The order of operations on a fresh ad set:

1. Wait for statistical significance (50+ conversions per cell, or
   the stop-loss whichever lands first).
2. Compute CAC and compare to break-even and target.
3. If CAC is at or below target, scale by 20-30 percent and re-read
   in 7 days.
4. If CAC is between target and break-even, do not scale; iterate the
   creative or the offer.
5. If CAC is above break-even, kill. Do not iterate; start fresh.

Common mistake: looking at CTR or CPM before CAC. A cell can have
great CTR and broken CAC; the algorithm rewards engagement, the
business rewards conversion. Always read CAC first.

## The payback ceiling

Bootstrapped businesses cannot run negative cash on acquisition.
Payback ceiling for cash-funded growth is 6 months. Beyond that the
business is taking a loan from future cash; that is a venture-funded
play, not a bootstrap one.

For SaaS: monthly contribution margin times 6 is the maximum CAC the
business can absorb without external funding.

## What this file is for

Every campaign brief lands on the founder's desk with these numbers
filled in:

- Target CAC: $X
- Break-even CAC: $Y
- Stop-loss per ad set: $Z
- Expected payback at scale: N months
- Kill criterion: CAC above $Y for 5 consecutive days

If any line is missing, the brief is not ready for spend. Ad accounts
do not recover from blind tests; they bleed audience trust and the
algorithm punishes the next campaign.
