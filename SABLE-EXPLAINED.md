# Sable

**A sealed-bid, uniform-price call auction whose matching engine executes on encrypted
orders, on-chain, with no operator able to read the book.**

Orders are submitted as ciphertext — side, limit price and size. The clearing price and the
pro-rata allocation are computed under garbled circuits on COTI's gcEVM, without any order
ever being decrypted. Two values become public per batch: the uniform clearing price and the
total matched volume. Each participant can decrypt exactly one additional value: their own
fill. Nothing else is recoverable by anyone, including the authors of the contract.

The full loop — encrypted bilateral negotiation between autonomous agents, sealed order
submission, blind clearing, confidential settlement in PrivateERC20 — runs on COTI testnet
and is verified against an independent plaintext implementation of the same mechanism.

---

### Scope of this document

This is the complete design and verification record: the market microstructure, the
confidential execution model, the specific engineering constraints imposed by computing on
garbled data, the measured cost model, and the failure containment. It assumes familiarity
with blockchain execution and with autonomous agents; it does not assume prior exposure to
secure multi-party computation, which is introduced where it matters.

Every figure quoted is measured on testnet unless explicitly attributed to the cost model.

- **Microstructure and mechanism:** §1–§4
- **The agent layer:** §5
- **A verified run, with the confidentiality measurement:** §6–§7
- **Engineering findings — the substantive part:** §8–§10
- **Positioning and applications:** §11–§12
- **Verification methodology and reproduction:** §13–§15

---

## 1. The problem

Execution on a transparent venue leaks the order before it settles. On a public DEX the
sequence is mechanical: the transaction enters the mempool, its size and direction are
readable, and the price moves against it before inclusion. This is not an implementation
defect to be patched at the application layer — it is a property of executing intent on a
ledger where intent is visible. Every mitigation deployed so far (private relays, commit
schemes, batch inclusion) narrows the window without removing the underlying asymmetry: the
order is eventually visible to whoever settles it.

Traditional finance addressed the same asymmetry with dark pools, and inherited a different
problem. A dark pool conceals the order from the market but not from its operator. The
counterparty risk is replaced by operator risk, concentrated in a single party whose
incentive to observe the flow is exactly proportional to the flow's value. The historical
record is unambiguous: in 2016 both Barclays and Credit Suisse settled with the SEC and the
NYAG over misrepresenting how their dark pools ranked and exposed order flow.

The constraint is structural. **A venue that conceals your order requires an operator; an
operator that can read the book can trade against it.** Confidentiality enforced by policy
is confidentiality contingent on the operator's incentives.

Sable removes the operator from the trust boundary. Not by auditing access, not by
attesting to a policy — by making the book unreadable to the process that matches it.

## 2. Design

Sable is a periodic call auction. Orders accumulate over a commit window; at the close, any
address may trigger clearing. The contract computes a single uniform price at which the
maximum volume crosses, allocates the long side pro-rata, and settles both legs in
confidential tokens. Every intermediate value in that computation is a garbled handle. No
branch in the Solidity source ever reads an encrypted value.

The trust model that results:

- **No privileged role.** Clearing is permissionless. There is no operator to bribe, delay,
  or subpoena, and no admin key, master key, or recovery key. The escape hatch in §10 is
  callable by anyone and can only return escrow to its depositor.
- **No trusted hardware.** Confidentiality rests on multi-party computation, not on an
  enclave whose vendor is a single point of compromise.
- **Public mechanism, private inputs.** The contract is readable and the mechanism is
  auditable in full. Its inputs are cryptographically opaque, symmetrically, to everyone
  including us.

## 3. The confidential execution model

COTI's gcEVM extends the EVM with a garbled-circuit MPC layer. The relevant properties for
a market designer:

**Two value domains.** Encrypted values exist either as *ciphertext* in storage (`ctUint64`,
`ctBool`) or as *garbled handles* valid for the duration of a transaction (`gtUint64`,
`gtBool`). Arithmetic and comparison operate on garbled handles. Moving between the domains
— `onBoard` to lift storage into computation, `offBoard` to seal a result back — is an
explicit operation with its own cost, and that cost dominates. §9 quantifies it.

**Encrypted inputs are bound to a call.** A transaction input (`itUint64`) is encrypted
under a key derived from the sender, the target contract and the function selector, so a
ciphertext cannot be replayed against a different entry point.

**Two offboarding targets, and they are not interchangeable.** `offBoard` seals under the
network key, producing a ciphertext the contract can later lift back into computation.
`offBoardToUser` seals under a specific user's AES key, producing a ciphertext only that
user can decrypt and which the contract can never re-onboard. Choosing wrongly is a
runtime failure, not a compile-time one; §8 covers where this cost us.

**There is no branching.** The execution layer does not learn the values it manipulates, so
control flow cannot depend on them. Every conditional in the market must be expressed as an
oblivious select — compute both arms, blend under an encrypted selector. This is the single
constraint that shapes the entire implementation, and §8 is largely about its consequences.

## 4. Mechanism

### Clearing

Over a public, strictly ascending price grid `P = [p₁ … p_K]`, with every order field
encrypted:

```
for each tick k:
  demand(k) = Σᵢ mux( isBuyᵢ ∧ limitᵢ ≥ p_k , sizeᵢ , 0 )
  supply(k) = Σᵢ mux( ¬isBuyᵢ ∧ limitᵢ ≤ p_k , sizeᵢ , 0 )
  crossed(k) = min( demand(k), supply(k) )

k* = argmax_k crossed(k)
```

`demand` is non-increasing in `k` and `supply` is non-decreasing, so the curves cross
exactly once. `k*` is therefore the volume-maximising price by construction rather than by
search heuristic, and the argmax is realised as a `mux` chain with strict `>`, which resolves
ties to the lowest tick deterministically.

The grid is public. This is a deliberate disclosure: it bounds the clearing cost to
`O(orders × levels)` and it reveals nothing about the book, since a tick's presence in the
grid says nothing about whether any order sits at it.

### Allocation, and the invariant that keeps the contract solvent

The long side is rationed pro-rata to order size, still encrypted. The direct formula is
subtly and dangerously wrong.

The short side satisfies `sideTotal == matched`, so its ratio is exactly 1 and it never
truncates. The long side, computed as `⌊sizeᵢ · matched / sideTotal⌋`, does truncate — but
per-order, so the truncations do not sum to the aggregate truncation. The two sides then
move different quantities of base while the contract holds exactly what was escrowed. The
contract pays out more than it took in, on every batch where rationing occurs.

A one-unit counterexample: 7 of demand against 10 of supply, sellers at 5 and 5. Buyers
receive 7; sellers deliver 3 + 3 = 6. One unit short, permanently, and undetectable from
inside an encrypted computation.

The fix rounds the *cumulative* share and takes differences:

```
cum_i  = Σ sizes of same-side participants up to and including i
q_i    = ⌊ cum_i · V / T ⌋
fill_i = q_i − q_{i−1}
```

The quotients telescope: the fills sum to `⌊T·V/T⌋ = V` exactly on both sides, while each
fill stays within one unit of its ideal share. Conservation of value is a property of the
formula, not the result of a reconciliation pass — which matters, because a reconciliation
pass would have to branch on encrypted quantities.

Neither clearing nor allocation branches on which side is long. That fact is itself
encrypted.

### Escrow and settlement

`submitOrder` escrows under a mux, so the collateral leg is chosen obliviously:

```
escrowQuote = mux( isBuy, 0, size × limit )   // buy → size × limit
escrowBase  = mux( isBuy, size, 0 )           // buy → 0
```

Both token legs are always transferred, one of them an encrypted zero. A pattern of
transfers that varied with the side would leak the side, so it does not vary.

`PrivateERC20._update` terminates in a `require` over a decrypted success bit, so an
underfunded escrow reverts. The escrow is binding, not advisory.

Settlement is pull-based. Clearing writes three ciphertexts per order — `fill` under the
trader's key, `baseOut` and `quoteOut` under the network key — and each trader calls
`claim()` themselves. This keeps clearing at fixed cost regardless of participant count and
places the (dominant) encrypted-transfer cost with the party that benefits from it. §9 shows
why that allocation of cost is not incidental.

Admissibility is enforced at submission with exactly one deliberate decryption — a single
bit:

```solidity
gtBool admissible = and( le(size, maxOrderSize),
                         and( ge(limit, ticks[0]), le(limit, ticks[K-1]) ) );
if (!MpcCore.decrypt(admissible)) revert OrderOutsideBounds();
```

One bit leaks: whether a rejected order was out of bounds. In exchange, the constructor's
overflow bounds become enforceable rather than assumed — `MAX_ORDERS × maxOrderSize ≤ 2³²−1`
and `maxOrderSize × topTick ≤ 2⁶⁴−1`, checked at deployment, keep every product in the
kernel inside `uint64` without a single encrypted overflow check in the hot path.

### Why a call auction rather than a continuous book

Continuous matching restores latency as an edge and re-imports the ordering games that
motivated the design. A periodic uniform-price auction removes the speed race by
construction: within a batch, arrival order does not affect the price received.

This is not a novel mechanism, which is the point. It is the design behind the closing cross
that sets official reference prices on major exchanges, behind CoW Protocol's batches, and
behind the Budish–Cramton–Shim frequent-batch-auction literature. It is also materially
cheaper on gcEVM, since clearing amortises over the batch instead of running per order.

The mechanism carries an incentive property worth stating explicitly: under a uniform price,
shading a limit mostly risks the fill without improving the execution price. Truthful
bidding is approximately optimal. That property comes from the auction format, not from a
heuristic in the agent code — which is what makes the agent layer in §5 legible rather than
adversarial.

## 5. The agent layer

Three desks operate as autonomous agents. Each carries a **private mandate** — target size,
reservation price, laddering preference — that never leaves its own process. Strategy is
deterministic with no model calls: a run is reproducible and every number in it is
independently checkable, which is a requirement for verification, not an aesthetic choice.

Before committing, desks exchange encrypted indications of interest over COTI's
`PrivateMessaging`: side and size, deliberately no price, readable only by the recipient.
Payloads are capped at 24 bytes per chunk by the messaging layer, which the IOI encoding
respects (`IOI:B:70`).

Because the auction already makes truthful bidding near-optimal, the RFQ is not a price
negotiation. What it determines is **whether to commit capital at all**:

```
committed = clamp( visible opposing interest, probe floor, own target )
```

Escrowing against counterparty interest that is not there is pure capital cost. In the
verified run below, Atlas targets 70, observes 65 of opposing supply, commits 65, and locks
6,639 quote units instead of 7,150 — 511 units freed, with no reduction in fill, since the
unmatched 5 was never going to trade. A probe floor prevents the rule from collapsing to
zero when the inbox is empty.

The IOI must be encrypted for the rule to be safe. Broadcasting "I need to buy 70" in clear
is an instruction to the market to reprice against you.

`PrivateMessaging` pays each desk in proportion to the encrypted cells it stored, so the
protocol funds the confidential negotiation the mechanism depends on.

## 6. A verified run

The following is a single `npm run agents` execution on COTI testnet. Every value was
produced by the live system and checked against `scripts/agents/reference.ts`, an
independent plaintext implementation of the same mechanism.

**Negotiation.** Six encrypted IOIs, 3.12M gas. Each desk then sizes:

```
Atlas     inbox: BUY 20, SELL 65   → target 70, sees 65 of supply, commits 65
Borealis  inbox: BUY 70, SELL 65   → commits 20 in full
Cygnus    inbox: BUY 70, BUY 20    → commits 65 in full
```

**Submission.** Six sealed orders, ~2.8M gas each. Publicly enumerable, individually
unreadable. Escrow locked under mux; both legs moved.

**Clearing.** The commit window closes; clearing is triggered permissionlessly.

```
price 101, matched volume 65, 13,130,009 gas
```

Those two values become public. Everything that produced them stays sealed.

**Allocation.** Each trader decrypts exactly one value — their own fill:

```
Atlas    order 1 → 37      Cygnus  order 1 → 20
Atlas    order 2 → 28      Cygnus  order 2 → 35
Borealis order   →  0      Cygnus  order 3 → 10
```

All six match the reference engine. Borealis's limit was below 101, so it did not trade and
was refunded in full; its order stays sealed permanently. **An unmatched order discloses
nothing, ever** — which inverts the usual leakage profile, since on a transparent venue
resting unfilled orders are precisely what reveals intent.

Confidentiality was measured rather than asserted. Cygnus attempted to decrypt Atlas's fill
of 37 and obtained `3.3383808768725014e+38`. The full visibility matrix:

```
no keys held           reads 0 of 6 orders
Atlas's key            reads 2 of 6   (exactly its own two)
Borealis's key         reads 1 of 6   (exactly its own)
Cygnus's key           reads 3 of 6   (exactly its own three)
```

Each key reads precisely its own rows.

**Settlement.** Pull-based, in PrivateERC20, amounts encrypted so balances do not disclose
positions:

```
Atlas    +65 base / −6,565 quote
Cygnus   −65 base / +6,565 quote
Borealis  0 / 0   (unfilled, fully refunded)
```

Escrow in equals payout out, in both tokens, exactly. Each desk then claimed 0.0167 COTI in
messaging rewards for the encrypted cells it stored.

## 7. Disclosure surface

| Public | Encrypted permanently |
|---|---|
| That an address submitted an order, and when | Side (buy/sell) |
| The batch clearing price | Limit price |
| Total matched volume | Order size |
| That settlement occurred | Individual fill |
| The price grid and the full contract source | **Everything about unmatched orders** |

One additional bit leaks by construction: a rejected submission reveals that it was out of
bounds (§4). Nothing else crosses the boundary.

Price discovery is a public good; the inputs that produce it are not. Sable separates the
two.

## 8. Engineering constraints

### Obliviousness, and an inverted primitive

Every conditional becomes `mux`. The consequence is that the correctness of the entire
kernel rests on one primitive — and that primitive behaves contrary to convention:

```
MpcCore.mux(bit, a, b) == bit ? b : a
```

The arguments are effectively transposed relative to every ternary in general use. This is
undocumented, and it is invisible from the Solidity source because the operation delegates
to a precompile.

The failure mode is the dangerous kind. Inverted, the kernel accumulates exactly the orders
that should not participate, produces a well-formed and plausible clearing price, and raises
no error — because every value involved is encrypted, so there is nothing to inspect, log,
or assert on. Our first kernel had this bug.

What caught it was a methodological decision made before any code was measured: construct a
small book by hand, derive the correct clearing price and allocation on paper, and withhold
trust from the implementation until it reproduces that answer exactly. **On encrypted
computation, a test whose answer you know in advance dominates any amount of code review.**
The finding generalised into `reference.ts` (§13) and is recorded as a hazard note in the
contract header, since it will silently break anyone else building on the same primitive.

### Cost is concentrated at the domain boundary, not in the arithmetic

Every operation was measured differentially before the design was fixed. The result inverted
our priors:

| Operation | Gas |
|---|---|
| Compare two encrypted values | 9,917 |
| Add / mux / min | ~13,000 |
| Multiply / divide | ~34,000 |
| **`onBoard` / `offBoard` / `validateCiphertext`** | **~48,000** |

Garbled arithmetic is close to free. Crossing the boundary between storage and computation
costs roughly 4× a compute op. The design rule follows directly: **minimise boundary
crossings, compute freely.** Garbled handles remain valid for the whole transaction, so an
order onboarded once can be reused across every phase of clearing.

Restructuring the kernel to onboard each order once rather than per use made it ~2.4×
cheaper. A later pass found the same saving in settlement, cutting it 37%. Both were
*predicted from the table and then confirmed by measurement*, agreeing to within 0.2% —
which is the useful result: the cost surface of this platform is predictable enough to design
against analytically.

The second-order consequence shapes the settlement architecture. A 256-bit PrivateERC20
transfer costs ~1.2M gas against ~13k for a 64-bit garbled compute op. **The encrypted token
transfers dominate the system, not the confidential matching engine.** Pull-based settlement
is a direct response: clearing stays fixed-cost, and each desk pays for its own transfer.

## 9. Cost model and capacity

Least-squares fit over the measured clearing curve:

```
gas(orders, levels) = 132,064 + 164,081·orders + 103,275·orders·levels + 52,278·levels
```

Residual against real measurements: 0.6%. The bilinear term is the kernel proper — one pass
over each order at each price level — and its coefficient is the boundary-crossing rule of §8
made visible in a regression.

Measured, on testnet:

| Action | Gas | Share of one 120M block |
|---|---|---|
| `submitOrder` | ~2.8M | 2% |
| Six encrypted IOIs | 3.1M | 3% |
| `clear`, 6 orders × 12 levels | 13.13M | 11% |
| `claim` | 1.4M – 4.0M | 1–3% |
| `rescue` | ~0.5M per order | <1% |

Against the 120M block gas limit, **the model** places the ceiling near 48 orders at 12
price levels. The model, not a measurement: the largest configuration we have cleared and
measured on chain is the 6×12 batch above. Capacity beyond that is an extrapolation from a
fit with a 0.6% residual, and is labelled as such wherever it appears.

Both terms of the model are actionable in the same direction. Fewer price levels is the
cheaper axis — the grid is public and can be tightened around a reference price without
disclosing anything — and the linear order term is what makes batching, rather than
continuous matching, the right structure for this platform.

## 10. Failure containment

Clearing is the most expensive operation in the system, and `currentBatch` only advances
inside it. A batch that could not be cleared would trap every escrow it holds *and* prevent
any future batch from opening. One stuck batch would terminate the market permanently.

`rescue(count)` is the containment. After a delay bounded below by the commit window, **any**
address may abandon an unsettled batch and release every escrow untouched. It is chunked, so
no batch can be too large to unwind — an escape hatch that could fail in the same way as the
operation it rescues is not an escape hatch. On completion it marks the batch settled with
price and volume zero and advances `currentBatch`, lifting the freeze.

Exercised end to end in `scripts/test-rescue.ts`, against a book that would have crossed:

- rejected while the commit window was open;
- rejected again after the window but before the rescue delay;
- unwound in two chunks called by two different addresses, demonstrating permissionlessness;
- all three participants refunded to a delta of exactly zero in both tokens;
- a settled batch cannot be rescued twice;
- a new order accepted immediately afterwards, proving the freeze is lifted.

The delay is generous by design. A premature rescue cancels a batch that could have cleared,
which makes the parameter a griefing surface rather than a theft one — the trade-off is
stated in the test's header so it is not silently re-tuned.

## 11. Why this requires MPC and not zero-knowledge proofs

Most confidentiality work in this space uses zero-knowledge proofs, which solve an adjacent
but strictly easier problem: proving a statement about *your own* private data.

A clearing price is a function of *everyone's* private orders jointly. No participant can
compute it — doing so requires every other participant's secrets. The party you would
normally delegate the computation to is precisely the party that must not learn the inputs.
A ZK proof can attest that a correct clearing was performed; it cannot produce one without
someone first holding the whole book in clear.

That requires computation over data held by mutually distrusting parties, which is secure
multi-party computation, a different primitive with a different cost profile. Until MPC
became fast enough to run inside EVM execution, this mechanism had no implementation path.

This is the sense in which Sable is not a private version of an existing product. It is a
mechanism whose implementation was blocked on the underlying cryptography rather than on
engineering effort.

## 12. Applications

The immediate use is the one built here: institutions and autonomous agents executing size
without paying the cost of being observed.

What generalises is the primitive underneath — a mechanism whose inputs are private to their
owners and whose output is a public good.

**Sealed-bid auctions.** Procurement, spectrum, carbon credits, art. Anywhere bidders
currently shade because revealing a true valuation is costly, and where the auctioneer is
today a trusted party by necessity rather than by design.

**Agent-to-agent markets.** An autonomous agent's strategy is its economic value, and on a
transparent ledger every action it takes publishes that strategy incrementally.
Confidentiality is not a feature of agent commerce, it is a precondition for it. Sable's
three desks are a working instance: they negotiate, size, commit, clear and settle with no
human in the loop and no mandate disclosed.

**Price discovery without disclosure.** A public, usable reference price computed from
inputs that remain private generalises well past trading — to any setting where an aggregate
is valuable and the constituents are sensitive.

## 13. Verification

Encrypted computation cannot be inspected while it runs. Assertions on intermediate values
are unavailable, tracing reveals nothing, and the failure mode of interest is a plausible
wrong answer rather than a revert. The methodology follows from that.

**An independent second implementation.** `scripts/agents/reference.ts` implements the same
mechanism in plaintext TypeScript, including the strict `>` in the argmax so tie-breaking
matches exactly. The encrypted market is checked against it on every run. Expected values
are *derived* rather than hardcoded, so the oracle stays correct when parameters change —
which is what allowed the pro-rata fix to be validated on a lopsided book rather than only
on the balanced one it was designed against.

**Invariants asserted on chain, every run.** Fills sum to the matched volume on both sides;
escrow equals payout in both tokens; no order is overfilled; a desk attempting to decrypt
another's fill receives noise.

Two complete scenarios, end to end:

| | Balanced book | Lopsided book |
|---|---|---|
| Clearing price | 101 | 101 |
| Matched volume | 65 | 85 |
| Individual fills | all six exact | all six exact, rationing applied |
| Conservation | both sides exact | both tokens exact |
| Settlement deltas | exact for all three desks | exact for all three desks |
| Confidentiality | each key reads only its own rows | each key reads only its own rows |

One methodological note worth recording, since it recurred. Two frontend defects — reading
the empty post-cross batch, and deriving the reward epoch as `currentEpoch − 1` — were found
by running the system, not by reading it. Both were in code that reviewed as obviously
correct. On this platform, execution is the only reliable oracle.

## 14. Running it

Testnet only, no real value at risk at any point.

```bash
npm install
npm run check                  # mechanism + reference engine, offline, no gas
npx hardhat compile
npm run wallet                 # fund the printed address free at faucet.coti.io
```

The agent run is staged because the commit window and the reward epoch are wall-clock
deadlines, so each stage is separately resumable:

```bash
STAGE=setup   npm run agents   # tokens, mint, RFQ channel, the cross, approvals
STAGE=rfq     npm run agents   # encrypted indications of interest
STAGE=submit  npm run agents   # desks read inboxes, size, seal orders
STAGE=clear   npm run agents   # waits out the window, clears, verifies vs reference
STAGE=claim   npm run agents   # settles, checks conservation, privacy, capital saved
STAGE=rewards npm run agents   # claims messaging rewards for the finished epoch
```

`npm run e2e` exercises the contract directly without the agent layer.

The read-only terminal:

```bash
npm run frontend:config        # writes frontend/.env.local (addresses + desk keys)
cd frontend && npm install && npm run dev
```

It opens on the complete order book with every field rendered as a solid block, because that
is what is actually stored. Unlocking one desk's key resolves that desk's rows into numbers
while every other row stays opaque. The interface is not withholding anything — it is
displaying the state faithfully.

Keys live in `.env` and `frontend/.env.local`, both gitignored. Testnet keys only.

## 15. Repository

```
contracts/SableCross.sol         the market: batches, escrow, clearing, allocation, claim
contracts/GasSpike.sol           the kernel instrumented for measurement
contracts/test/TestToken.sol     PrivateERC20 with an open mint, for testnet runs
contracts/test/DeskMessaging.sol deployable PrivateMessaging — the RFQ channel

scripts/agents/desks.ts          the three private mandates and the market grid
scripts/agents/strategy.ts       deterministic decision layer, pure and testable
scripts/agents/reference.ts      plaintext clearing engine — the oracle for the contract
scripts/agents/desk.ts           a desk's on-chain behaviour: RFQ, submit, claim
scripts/run-agents.ts            the full agent run
scripts/cross-e2e.ts             three-trader contract test with assertions
scripts/test-rescue.ts           the escape hatch, exercised end to end
scripts/stress-max-orders.ts     the market at its configured capacity
scripts/spike-gas.ts             gas curve + correctness harness

frontend/                        read-only terminal — the sealed book, live

SPIKE.md                         how every gas figure here was measured
README.md                        technical entry point
```

---

*Built for the [COTI Vibe Code Challenge — Web 4 Agent Edition](https://stay.coti.io/vibe-coding/).
Runs on COTI's public testnet (chain 7082400). MIT licensed.*
