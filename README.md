# Sable

**The confidential cross for autonomous agents.**

A sealed-bid, uniform-price batch auction where the matching engine runs on encrypted
orders — built on [COTI](https://coti.io)'s garbled-circuit EVM.

Built for the [COTI Vibe Code Challenge — Web 4 Agent Edition](https://stay.coti.io/vibe-coding/).

**Live terminal: <https://sable-cross.vercel.app>** — read-only, no wallet, opens on a sealed book.

> **Full design and verification record: [SABLE-EXPLAINED.md](SABLE-EXPLAINED.md)** — mechanism,
> confidential execution model, measured cost model, failure containment, verification
> methodology. *En français : **[SABLE-EXPLAINED.fr.md](SABLE-EXPLAINED.fr.md)**.*

---

## The problem

An agent that wants to execute size on a transparent DEX is dead on arrival: its order is
visible before it settles, so it gets front-run. Traditional finance solved this with dark
pools — but a dark pool needs a trusted operator, and the record shows they cheat.
Barclays LX and Credit Suisse both paid SEC penalties for misrepresenting who could see
the flow.

Sable is a crossing network where the operator *cannot* cheat, because it cannot see.

## How it works

Autonomous agents negotiate over end-to-end encrypted on-chain messages, then commit
sealed orders — side, limit price and size, all encrypted. At the close of each batch a
contract computes the uniform clearing price using garbled circuits, without ever
decrypting a single order.

The market publishes a price. No participant reveals their hand.

### The desks

Each desk is an autonomous agent carrying a **private mandate** — target size, reservation
price, how it wants to ladder — that never leaves its own machine. Strategy is
deterministic, with no model calls, so a run is reproducible and every number in it is
checkable.

Before committing, desks exchange encrypted indications of interest over COTI's
`PrivateMessaging`: *"there is interest this size on this side"*, and deliberately no price.
Only the recipient can decrypt one.

What the RFQ changes is **size, not price**. Sable is a uniform-price auction, so shading a
limit mostly risks the fill without improving execution — bidding your true reservation
value is the rational move, a property of the mechanism rather than a heuristic. What the
RFQ actually buys is knowing whether to commit capital at all:

```
committed = clamp(visible opposing interest, probe floor, own target)
```

Never escrow against counterparty interest that isn't there. In the verified run, Atlas
wants 70 but can only see 65 of supply, so it commits 65 and locks 6,639 quote units
instead of 7,150 — **511 units of capital freed, with no loss of fill.** And the IOI has to
be encrypted, or announcing "I need to buy 70" is just telling the market to raise its
price.

The messaging layer pays for itself: `PrivateMessaging` rewards each desk in proportion to
the encrypted cells it stored, so the protocol funds the private negotiation it depends on.

### Why a batch auction, not an order book

Continuous matching makes latency an edge again and re-imports MEV. A periodic call
auction at a uniform price removes the speed race by construction — the design behind
Nasdaq's closing cross, CoW Protocol, and the Budish–Cramton–Shim frequent-batch-auction
literature. It is also dramatically cheaper on gcEVM: clearing happens once per batch
rather than on every order.

### The clearing kernel

Over a public price grid `P = [p₁ … p_K]`, with every order encrypted:

```
for each tick k:
  demand(k) = Σᵢ mux( isBuyᵢ ∧ limitᵢ ≥ p_k , sizeᵢ , 0 )
  supply(k) = Σᵢ mux( ¬isBuyᵢ ∧ limitᵢ ≤ p_k , sizeᵢ , 0 )
  crossed(k) = min( demand(k), supply(k) )

k* = argmax_k crossed(k)
```

Demand is non-increasing in `k` and supply is non-decreasing, so the curves cross exactly
once — `k*` is the volume-maximising price, not a heuristic. No Solidity branch ever
touches an encrypted value: every conditional is a `mux`.

### Allocation, and the invariant that keeps it solvent

The long side is then rationed pro-rata to order size, still encrypted. The obvious formula
— `size * matched / sideTotal` — is subtly wrong, and wrong in a way that would drain the
contract. The short side satisfies `sideTotal == matched`, so its ratio is exactly 1 and it
never truncates; the long side rounds down. The two sides then move different quantities of
base, while the contract holds exactly what was escrowed.

So Sable rounds the *cumulative* share and takes differences:

```
cum_i  = Σ sizes of same-side participants up to and including i
q_i    = ⌊ cum_i · V / T ⌋
fill_i = q_i − q_{i−1}
```

The quotients telescope, so the fills sum to `⌊T·V/T⌋ = V` **exactly on both sides**, while
each fill stays within one unit of its ideal share. Conservation of value is enforced by
the formula, not by a reconciliation pass.

Neither the allocation nor the clearing ever branches on which side is long — essential,
since that fact is itself encrypted. Each fill is offboarded to its own trader's key: only
they can read it.

### What leaks, and what never does

| Public | Encrypted forever |
|---|---|
| That an address submitted an order, and when | Side (buy/sell) |
| The batch clearing price | Limit price |
| Total matched volume | Size |
| — | Each participant's individual fill |
| — | **Everything** about unmatched orders |

Price discovery is a public good. Sable produces it without anyone showing their hand.

## Status

**The full loop runs on COTI testnet, verified end to end.** Three autonomous desks
negotiate privately, commit sealed orders, clear, and settle in real PrivateERC20 — with
every result checked against an independent plaintext implementation of the same mechanism
(`scripts/agents/reference.ts`) rather than against hardcoded values.

One `npm run agents` run, verified:

```
[rfq]     6 encrypted IOIs exchanged, 3.12M gas
[submit]  Atlas    inbox: BUY 20, SELL 65  -> saw only 65 vs target 70, commits 65
          Borealis inbox: BUY 70, SELL 65  -> commits 20 in full
          Cygnus   inbox: BUY 70, BUY 20   -> commits 65 in full
[clear]   price 101, volume 65, 13.13M gas
          fills 37 / 28 / 0 / 20 / 35 / 10   all matching the reference engine
[claim]   Atlas  +65 base / −6,565 quote
          Borealis  0 / 0        (unfilled, fully refunded)
          Cygnus −65 base / +6,565 quote
[capital] Atlas locked 6,639 instead of 7,150 — 511 units freed by the RFQ
[privacy] Cygnus cannot recover Atlas's fill of 37
[rewards] each desk claimed 0.0167 COTI for the encrypted cells it stored
```

The invariants that matter all hold on chain: fills sum to the matched volume on **both**
sides, escrow equals payout in both tokens, no order is overfilled, and a desk attempting
to decrypt another's fill gets noise.

Gas, measured: `submitOrder` 2.53M, `clear` 13.1M for 6 orders over 12 ticks, `claim`
1.4–4.0M depending on order count. Notably the encrypted **token transfers dominate**, not
the clearing kernel — a 256-bit PrivateERC20 transfer costs roughly 1.2M against ~13k for a
64-bit garbled compute op. Settlement is pull-based precisely so that cost sits with each
desk rather than in the clearing transaction.

Gas does not leak the book either, and this is now measured rather than argued. Two books of
six orders over the same twelve ticks, sharing no order — one clearing at 101 on a volume of
65, the other not crossing at all — both cost **9,193,052 gas, identical to the unit**
(`scripts/gas-uniformity.ts`). The kernel cannot branch on an encrypted value, so it runs the
same circuit whatever the values are.

That measurement needs its own care: run each book once and they differ by 17,100 gas, which
is not a leak but 22,100 minus 5,000 — the EVM's gap between initialising a zero storage slot
and overwriting a non-zero one. Whichever book runs first pays it. The same 17,100 separates
the first and second order a trader submits, for the same reason and with nothing to do with
buy versus sell. The script therefore runs each book twice and compares the repeats.

Clearing has also been measured **at the contract's own bound**, since that is the case whose
failure is unrecoverable: 32 orders over 12 ticks costs **66,651,243 gas — 55.5% of the block
limit**, with price, volume and both-sided conservation all matching the reference engine.
`MAX_ORDERS = 32` ships with 1.8× headroom; ~46 orders fit an 80% budget. That measurement
came in 24.6% above the kernel model, for a reason traced in
[SABLE-EXPLAINED.md §9](SABLE-EXPLAINED.md#9-cost-model-and-capacity).

The day-1 de-risking spike that sized all of this is in **[SPIKE.md](SPIKE.md)**: the cost
model, per-operation gas, and the traps that would otherwise have shipped silently.

## Repo

```
contracts/SableCross.sol         the market: batches, escrow, clearing, allocation, claim
contracts/test/TestToken.sol     PrivateERC20 with an open mint, for testnet runs
contracts/test/DeskMessaging.sol deployable PrivateMessaging — the desks' RFQ channel
contracts/GasSpike.sol           the clearing kernel, instrumented for measurement

scripts/agents/desks.ts          the three private mandates and the market grid
scripts/agents/strategy.ts       deterministic decision layer, pure and testable
scripts/agents/reference.ts      plaintext clearing engine — the oracle for the contract
scripts/agents/desk.ts           a desk's on-chain behaviour: RFQ, submit, claim
scripts/agents/check-offline.ts  strategy + reference checks, no network, no gas
scripts/run-agents.ts            the full agent run
scripts/cross-e2e.ts             three-trader contract test with assertions
scripts/spike-gas.ts             gas curve + correctness harness
SPIKE.md                         measured results and design decisions

frontend/                        read-only terminal — the sealed book, live
```

## Getting started

```bash
npm install
npm run check                  # strategy + reference engine, offline, no gas
npx hardhat compile
npm run wallet                 # then fund the printed address free at faucet.coti.io
```

The full agent run (it funds the other two desks from the first wallet):

```bash
STAGE=setup   npm run agents   # tokens, mint, RFQ channel, the cross, approvals
STAGE=rfq     npm run agents   # encrypted indications of interest
STAGE=submit  npm run agents   # desks read their inboxes, decide, seal orders
STAGE=clear   npm run agents   # waits out the commit window, clears, verifies
STAGE=claim   npm run agents   # settles, checks balances, privacy and capital saved
STAGE=rewards npm run agents   # claims messaging rewards for the finished epoch
```

`npm run e2e` runs the same staged flow against the contract directly, without the agent
layer. Both are staged and resumable because the commit window and the reward epoch are
wall-clock deadlines.

Then the terminal:

```bash
npm run frontend:config        # writes frontend/.env.local with addresses + desk keys
cd frontend && npm install && npm run dev
```

See **[frontend/README.md](frontend/README.md)**. It is read-only, needs no wallet, and opens
on a fully sealed book — unlocking a desk key is what turns █ into numbers.

Before demoing or recording it:

```bash
npm run preflight              # read-only, zero gas — GO / NO-GO in ~10s
```

It samples RPC availability rather than assuming it, confirms the terminal will open on a
populated batch, and checks that the desk keys on disk unlock rows in *that* batch — keys from
a previous market fail silently, and you find out when a click reveals nothing. Shot list and
narration for the demo video: **[VIDEO.md](VIDEO.md)**.

Testnet only. Keys live in `.env`, which is gitignored — never reuse them on mainnet.

## License

MIT
