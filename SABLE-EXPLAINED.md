# Sable, explained

**A stock market where nobody — not even the people running it — can see what anyone is
buying or selling. And yet it still works out the right price.**

That sentence sounds impossible. This document explains why it isn't, how we built it, and
what it proves.

---

### How to read this

- **Two minutes?** Read *The problem* and *The idea*. That's the whole story.
- **Curious how it's possible?** Add *The trick* and *A batch, start to finish*.
- **Technical?** Jump to *The hard parts* — that's where the real engineering is.
- **Thinking about markets and money?** *Why this couldn't exist before* and *What it
  unlocks*.

No blockchain or AI knowledge is assumed anywhere. Where a technical word is unavoidable, it
gets explained on the spot.

---

## The problem

Imagine you manage a pension fund and you need to sell a very large block of shares.

The moment anyone finds out, you're in trouble. Traders who learn you're a big seller will
sell first, pushing the price down before your order goes through, then buy back cheaply
from you. You end up with a worse price, and the difference goes into their pocket. This
isn't a hypothetical or a loophole — it is one of the best-documented phenomena in finance.
Simply *being seen* costs you money.

So for decades, big institutions have used **dark pools**: private venues where you can place
a large order without broadcasting it. A large share of US stock trading — routinely more than
a third — now happens away from the public exchanges.

Dark pools have one structural flaw. Someone has to run them — and that someone *can* see
everything. You're not avoiding exposure; you're concentrating it into a single party and
hoping they behave. They haven't always. In 2016, both Barclays and Credit Suisse settled
with US regulators over misrepresenting how their dark pools actually worked and who was
allowed to see the flow inside them.

That's the bind. **A market that hides your order needs an operator you can see. An operator
who can see is an operator who can cheat.**

## The idea

Sable is a market where the operator *cannot* cheat, because the operator cannot see.

Not "promises not to look." Not "logs every access." Cannot. The orders arrive encrypted, the
price is computed while they stay encrypted, and the only things that ever become readable
are the final price, the total amount traded, and — privately, to each participant alone —
how much of their own order was filled.

There is no administrator with a master key. There is no "break glass in case of emergency."
The code that runs the market is public and anyone can read it. What it operates on is
mathematically opaque to everyone, including us, the people who wrote it.

## The trick

Here's the part that sounds like science fiction and isn't.

There is a branch of cryptography that lets several parties who don't trust each other
compute a shared result from their private inputs — without any of them revealing those
inputs, and without a trusted middleman. It's decades old in theory. Until recently it was
far too slow to be useful.

A useful mental image: everyone writes their order on a slip of paper and seals it in an
envelope. Instead of a person opening the envelopes, imagine a machine that is *physically
incapable* of showing anyone what's inside, yet can still add up the slips and print out the
resulting price. The machine's design is published, so you can check it does exactly what it
claims — you just can't see the paper. Not you, not the machine's builder, not anyone.

The specific technique is called **garbled circuits**. The network Sable runs on —
[COTI](https://coti.io) — makes them fast enough to actually use, which is the development
that makes this project possible at all rather than merely describable.

Two consequences worth holding onto, because everything else follows from them:

1. **The computer never learns the values it is working with.** It manipulates them the way
   you'd rearrange sealed envelopes: correctly, and blindly.
2. **Therefore it cannot make decisions the normal way.** More on this in *The hard parts* —
   it's the single most interesting engineering constraint in the project.

## A batch, start to finish

Rather than describe Sable abstractly, here is a run that actually happened on COTI's test
network. Every number below was produced by the live system, and every one of them was
checked against an independently written model of what *should* happen.

Three automated trading desks take part. Each has its own private instructions — how much to
trade, the worst price it will accept — which never leave its own machine.

### Step 1 — They feel each other out, privately

Before committing anything, the desks send each other encrypted messages: *"I have interest
this large, on this side."* Deliberately no price. Only the intended recipient can read each
message; to everyone else it is noise.

Six messages went out. Then each desk sized up what it had learned:

```
Atlas     saw 20 of buying and 65 of selling interest
          → wanted 70, could only see 65 of supply, so committed 65 and held 5 back
Borealis  saw 70 and 20 of buying, 65 of selling
          → committed its full 20
Cygnus    saw 70 and 20 of buying interest
          → committed its full 65
```

That middle line is worth pausing on. **Atlas voluntarily shrank its own order** because the
encrypted conversation told it the other side of the market wasn't big enough to absorb the
full amount. Committing to a trade means locking up collateral, so Atlas locked 6,639 units
instead of 7,150 — about 7% less capital tied up — and it lost nothing by doing so, because
that extra amount was never going to trade anyway.

This is the private negotiation earning its keep in a way you can measure. And it only works
*because* the messages are encrypted: announcing "I need to buy 70" in the open is simply
telling the market to raise its price against you.

### Step 2 — Sealed orders go in

Each desk submits its real orders, encrypted: which direction, at what price, how much.
Six orders in total. Anyone in the world can look at them. Nobody can read them.

At this point the desks also lock up collateral, so that a trade, once matched, is guaranteed
to settle. The amount locked is encrypted too — and both types of token are always moved,
one of them by an encrypted zero, so that even *which token moved* gives nothing away about
whether an order was a buy or a sell.

### Step 3 — The market finds the price, blind

At a fixed moment the window closes and anyone can trigger the settlement. Not a privileged
operator — anyone. There is no one to bribe, delay, or beg.

The market then works out the single price at which the largest possible amount can trade.
It does this over the whole set of sealed orders, without ever opening one.

Result: **price 101, and 65 units changed hands.**

Those two numbers become public. That is the point — a price is a public good, useful to
everyone. Everything that produced it stays sealed forever.

### Step 4 — Each desk learns its own fill, and only its own

Every participant can now decrypt one number: how much of their own order went through.

```
Atlas     order 1 → 37 filled     Cygnus  order 1 → 20 filled
Atlas     order 2 → 28 filled     Cygnus  order 2 → 35 filled
Borealis  order   →  0 filled     Cygnus  order 3 → 10 filled
```

Borealis's price was too low to trade at 101, so it didn't trade — and got every unit of its
collateral back. Its order remains sealed permanently. **An order that doesn't trade reveals
nothing at all, forever.** In a conventional market, unfilled orders are exactly what leaks
your intentions.

We tested the confidentiality directly rather than asserting it. Cygnus attempted to decrypt
Atlas's fill of 37. It got `3.3383808768725014e+38` — meaningless noise. Here is the full
picture, measured:

```
holding no keys        can read 0 of 6 orders
holding Atlas's key    can read 2 of 6   (exactly Atlas's own two)
holding Borealis's     can read 1 of 6   (exactly its own)
holding Cygnus's       can read 3 of 6   (exactly its own three)
```

Each participant sees precisely their own rows. Not one more.

### Step 5 — Money moves, still privately

Each desk collects what it's owed. The amounts are encrypted, so balances don't leak
positions. The books balanced exactly:

```
Atlas    received 65 units, paid 6,565
Cygnus   delivered 65 units, received 6,565
Borealis unchanged — fully refunded
```

And a final touch: the messaging layer that carried the private negotiation **pays the desks
for using it.** Each collected a small reward for the encrypted data it stored. The
infrastructure funds the confidentiality it depends on.

## What is public, and what never is

| Anyone can see | Nobody can ever see |
|---|---|
| That an address placed an order, and when | Whether it was a buy or a sell |
| The final price of each batch | The price they were willing to accept |
| The total amount traded | The size of their order |
| That settlement occurred | How much of it was filled |
| The full source code of the market | **Anything at all about orders that didn't trade** |

## Why an auction, and not a normal exchange

A normal exchange matches orders continuously — the instant two of them line up, they trade.
That design rewards being fast, which is why so much money goes into shaving milliseconds,
and it's the root of a whole category of value extraction where someone who sees your order
first profits from it.

Sable instead collects orders over a window and settles them all together at **one shared
price**. Everyone who trades in a batch gets the same price. Nobody wins by being a
microsecond earlier.

This isn't a novel invention, and that's a feature — it's the design behind the closing
auction that sets official prices on major stock exchanges every day, and it has a
well-developed academic literature behind it. Sable's contribution is that the mechanism has
never before been run on orders nobody can read.

A pleasant side effect: because everyone settles at the same price, there's little to gain
from lying about what you'd pay. Bidding your honest limit is the sensible strategy. The
mechanism does the work that would otherwise require game-playing.

## The hard parts

*This section is for readers who want the engineering. Skip freely.*

### You cannot ask a question about encrypted data

Normal code branches: *if the price is above 100, do this.* Sable cannot. The computer
genuinely does not know whether the price is above 100 — that's the whole point.

So every decision has to be restructured into arithmetic that produces the right answer
without anyone knowing which way it went. Instead of choosing between two paths, you compute
*both* and blend them using a selector that is itself encrypted. Every condition in the
market — is this a buy, is this price high enough, did this order participate — works this
way.

An early consequence: the one operation everything depends on, the encrypted "pick A or B",
turned out to behave **backwards** from every convention. `pick(condition, A, B)` returns
*B* when the condition is true. This is not documented anywhere and is invisible from the
source code, because the operation is performed by the network rather than by the program.

Get it backwards and the market silently selects exactly the orders that should *not*
participate, produces a plausible-looking wrong price, and raises no error — because every
value involved is encrypted, so there is nothing to inspect. Our first version had this bug.

What caught it was a decision made before any code was measured: we built a small market by
hand, worked out on paper what the correct answer had to be, and refused to trust the system
until it reproduced that answer exactly. **On encrypted computation, a test whose answer you
know in advance is worth more than any amount of code review.** You cannot debug what you
cannot see.

### A rounding error that would have drained the market

Sometimes more people want to buy than sell. The extra demand has to be rationed, so each
buyer gets a share proportional to their order.

The obvious way to do this is subtly, dangerously wrong. Give each buyer
`their size × amount traded ÷ total demand`, rounded down, and the two sides of the market
stop matching: buyers collectively receive slightly more than sellers collectively delivered.
The market would be paying out more than it took in — on every batch where rationing
happened, forever.

Concretely: 7 units of demand meeting 10 of supply, with sellers at 5 and 5, gives buyers 7
units while taking only 6 from sellers. One unit short. Every time.

The fix rounds the *running total* rather than each share:

```
share for order i = round(total up to and including i) − round(total up to i−1)
```

Written this way the roundings cancel out along the chain, and the shares add up to exactly
the right amount on both sides — always, with no reconciliation step and no leftovers. The
books balance because of the formula, not because something checks them afterwards.

Verified on a deliberately lopsided market: 85 units traded, buyers rationed to 85% of what
they asked for, and both sides summing to exactly 85. Collateral in equalled payout out, to
the unit, in both currencies.

### Encrypted maths is cheap. Encrypted doors are expensive.

Blockchains charge for computation, so we measured the cost of every individual operation
before designing anything. The result inverted our assumptions:

| Operation | Cost |
|---|---|
| Compare two encrypted numbers | 9,917 |
| Add, blend, or take the minimum | ~13,000 |
| Multiply, divide | ~34,000 |
| **Move a value into or out of the encrypted domain** | **~48,000** |

Doing arithmetic on secrets is nearly free. *Handling* them — bringing a stored secret in to
work on it, or sealing a result back up — costs four times as much as computing with it.

That single table drove the design. Restructuring the market so each order is unsealed once
and reused throughout, rather than unsealed each time it's needed, made it roughly 2.4× less
expensive. A later pass found the same saving again in the settlement stage, cutting its cost
by 37%. Both improvements were *predicted from the table and then confirmed by measurement* —
the numbers matched to within 0.2%.

The resulting cost model:

```
cost(orders, price levels) = 132,064 + 164,081·orders + 103,275·orders·levels + 52,278·levels
```

It predicts real measurements to within 0.6%, which is what lets us size the market from
arithmetic instead of guesswork. A settled batch of six orders across twelve price levels
measured 13,130,009 — about 11% of what a single block can hold. The model puts the ceiling
near 48 orders at that number of price levels.

### An escape hatch, because holding other people's money demands one

Settlement is the most expensive operation in the system. If it ever became impossible to
perform, the collateral inside that batch would be trapped — and, because of how the market
advances from one batch to the next, no future batch could ever open either. One stuck batch
would end the market permanently.

So there is a way out: after a generous delay, **anyone** can abandon an unsettled batch and
return every participant's collateral untouched. It works in pieces, so no batch can ever be
too large to unwind — an escape hatch that could fail the same way as the thing it rescues
would not be an escape hatch.

Tested end to end: refused while the market was still open, refused again before the delay
had passed, then unwound in two chunks called by two different people, with all three
participants refunded to a difference of exactly zero, and the market accepting new orders
immediately afterwards.

## Why this couldn't exist before

You may have heard of zero-knowledge proofs, the cryptography behind most privacy work in
this space. They're remarkable, and they solve a different problem: proving something about
*your own* data without revealing it.

An auction needs something strictly harder. The clearing price is a function of *everyone's*
private orders at once. No single participant can compute it — they'd need everyone else's
secrets. The very party you'd normally trust to compute it is the party who must not see it.

That requires computing over data belonging to several mutually distrustful parties. It's a
different branch of cryptography, and until it became fast enough to run inside a
blockchain, a market like this was a thought experiment.

That's the sense in which Sable isn't "a private version of an existing product." It's a
mechanism that had no implementation, because the mathematics to run it honestly didn't
exist in usable form.

## What it unlocks

The immediate use is the one we built: institutions and automated traders moving size without
paying the cost of being seen.

The interesting part is what stops being a compromise once confidential computation is
available to a market:

**Sealed-bid auctions of every kind.** Procurement, spectrum, art, carbon credits — anywhere
bidders currently shade their offers because they fear revealing their true valuation.

**Markets between AI agents.** Software agents are starting to hold budgets and transact
autonomously. An agent's strategy *is* its value, and on a transparent ledger every action it
takes publishes that strategy. Confidentiality isn't a feature for agent-to-agent commerce;
it's a precondition. Sable's three desks are a working instance of it: they negotiate,
decide, trade and settle with no human in the loop and no strategy disclosed.

**Price discovery without disclosure.** Sable produces a public, usable price out of inputs
that stay private. That combination — a public good built from protected data — generalises
well beyond trading.

## Proof, not promises

Everything described here runs on COTI's test network today, and every claim above is checked
by an automated test rather than asserted.

The tests are unusual in one way worth mentioning. Because encrypted computation cannot be
inspected while it runs, we wrote an **independent second implementation** of the market's
logic in plain, readable code — one that operates on ordinary visible numbers. The real
encrypted market is checked against that reference on every run. When they disagree,
something is wrong; and unlike reading the code, this catches errors that produce believable
but incorrect answers.

Two complete scenarios are verified end to end on every test run:

| | Balanced market | Lopsided market |
|---|---|---|
| Price found | 101 | 101 |
| Amount traded | 65 | 85 |
| Individual fills | all six exact | all six exact, rationing applied |
| Books balanced | both sides exactly | both currencies exactly |
| Money movements | exact for all three | exact for all three |
| Confidentiality | each sees only their own | each sees only their own |

Measured costs, for the technically inclined:

| Action | Cost | As a share of one block |
|---|---|---|
| Place a sealed order | ~2.8M | 2% |
| Six encrypted negotiation messages | 3.1M | 3% |
| Settle a batch of six orders | 13.1M | 11% |
| Collect what you're owed | 1.4M – 4.0M | 1–3% |
| Unwind an abandoned batch | ~0.5M per order | under 1% |

## Try it yourself

Everything is open source and runs against a public test network. No real money is involved
at any point.

```bash
npm install
npm run check          # the market's logic, checked offline — no network, no cost

npm run wallet         # creates a test account, then fund it free at faucet.coti.io

STAGE=setup   npm run agents   # deploy a market and three desks
STAGE=rfq     npm run agents   # the desks negotiate, encrypted
STAGE=submit  npm run agents   # they decide and place sealed orders
STAGE=clear   npm run agents   # the market finds the price, blind
STAGE=claim   npm run agents   # money moves, confidentiality verified
STAGE=rewards npm run agents   # the desks collect their messaging rewards
```

And a terminal you can watch it through:

```bash
cd frontend && npm install && npm run dev
```

It opens showing the complete order book — and every value in it as a solid block, because
that is genuinely what's stored. Unlock one desk's key and that desk's rows resolve into
numbers while all the others stay unreadable. That's not the interface being coy. It's the
market.

## What's in the repository

```
contracts/SableCross.sol      the market itself: orders, collateral, pricing, settlement
contracts/GasSpike.sol        the measurement rig behind every number in this document

scripts/agents/               the three desks: private instructions, decisions, behaviour
scripts/agents/reference.ts   the independent second implementation used to check the first
scripts/run-agents.ts         a complete run, end to end
scripts/test-rescue.ts        the escape hatch, exercised
scripts/stress-max-orders.ts  the market at its own capacity limit

frontend/                     the terminal — a public window onto a sealed book

SPIKE.md                      how every cost in this document was measured
README.md                     the technical entry point
```

---

*Sable was built for the [COTI Vibe Code Challenge — Web 4 Agent Edition](https://stay.coti.io/vibe-coding/).
It runs on COTI's public test network. MIT licensed.*
