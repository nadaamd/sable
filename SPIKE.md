# Day-1 gas spike — results

Measured on COTI testnet (chainId 7082400), solc 0.8.20 / evmVersion paris / viaIR +
optimizer(200). Raw data in `spike-report.json`. Total cost of the entire spike (including a redeploy
after the mux fix): **0.013 COTI** out of a 10 COTI faucet grant.

## Verdict: single-transaction clearing is viable, with room to spare

The design question was whether a uniform-price batch auction over *encrypted* orders
fits in one transaction, or whether clearing has to be sharded across several.

**It fits, comfortably** — and so does encrypted pro-rata allocation on top. The n=20,
K=12 target costs 28.8M gas to clear, 33.7M with per-order pro-rata fills: 28% of the
block. Sharding is not needed and has been dropped from the plan.

```
clearing only:      gas(n, K) = 132,064 + 164,081·n + 103,275·n·K + 52,278·K
                                                              max residual 0.6%

with pro-rata:      gas(n, K) = 132,064 + 408,359·n + 103,275·n·K + 52,278·K
                    (allocation adds a measured 244,278 gas/order)
```

The combined model predicts 10,645,354 gas for the directly-measured
`clearAndAllocate(n=6, K=12)` run, which came in at 10,675,821 — 0.3% off. The two parts
compose.

Max orders in one transaction, budgeting 80% of the 120M block limit:

| price ticks (K) | clearing only | clearing + pro-rata |
|---|---|---|
| 4 | 165 | 116 |
| 8 | 96 | 77 |
| **12** | **67** | **57** |
| 16 | 52 | 46 |

### Postscript: what the model missed, measured at the bound

These are `GasSpike` numbers, and `SableCross` is not `GasSpike`. Clearing was later measured
on the deployed contract at `MAX_ORDERS = 32`, K=12 — the configuration whose failure is
unrecoverable, since an uncleanable batch traps its escrow and freezes the market:

```
measured   66,651,243 gas   (55.5% of the 120M block limit)
model      53,484,488 gas   → measured is 24.6% higher
```

The gap is the per-order work `SableCross` does and `GasSpike` does not: three ciphertext
writes per order (`fill` under the trader's key, `baseOut`/`quoteOut` under the network key)
plus their storage. Backed out of both contract measurements it is a constant — 414,109
gas/order at n=6, 411,461 at n=32, agreeing to 0.6% — so the model's *shape* survived a 5×
extrapolation in `n`, and only its per-order coefficient was wrong for the shipping contract.

For the deployed contract at K=12: `clear(n) = 778,955 + 2,058,509·n`, giving **~46 orders at
80% of a block** rather than the 57 above. `MAX_ORDERS = 32` therefore holds, with 1.8×
headroom — but the row that mattered was verified by measurement, not by this table.

**Extrapolation validates a shape, not a number.**

## Correctness is verified, not assumed

The spike seeds a book whose clearing is computable by hand, so it tests the algorithm
as well as its cost.

Book: buys 103×50, 101×30, 100×20, 98×10 / sells 97×40, 99×25, 100×35, 104×15 over a
12-tick grid [95..106]. Demand and supply cross at 100 with 100 units matched.

**Result: price 100, volume 100 — correct**, computed entirely on garbled values, with
no Solidity branch ever touching an encrypted quantity.

## Encrypted pro-rata allocation works, and is cheap

Rationing the long side pro-rata to order size — rather than by arrival-time priority —
turned out to be affordable, so it is the rule we ship. Fairer, and it does not depend on
a public ordering.

The rule, applied to every order with no branch anywhere:

```
fill = participates ? size * matched / sideTotal : 0
```

`sideTotal` is the order's own side aggregate at the clearing price. This needs **no
branch on which side is long**, which matters because that fact is itself encrypted: the
short side satisfies `sideTotal == matched`, so its ratio is exactly 1 and it fills
completely, for free. Being able to sidestep that branch is what makes encrypted pro-rata
tractable at all.

Verified on a deliberately unbalanced book (a balanced one never exercises rationing).
At clearing tick 101, demand is 100 against supply of 85, so buyers are rationed to 85%:

| order | expected fill | got |
|---|---|---|
| BUY 102 × 60 | 60·85/100 = 51 | **51** |
| BUY 101 × 40 | 40·85/100 = 34 | **34** |
| BUY 100 × 20 | 0 (out of the money at 101) | **0** |
| SELL 99 × 30 | 30 (short side, full) | **30** |
| SELL 100 × 30 | 30 | **30** |
| SELL 101 × 25 | 25 | **25** |

Clearing price 101, matched volume 85, buy-side fills summing to exactly 85 with no dust.
Each fill was decrypted with its own trader's AES key via `offBoardToUser`.

Division was the risk here and it evaporated: `div` on garbled values costs **35,291 gas**,
only 2.7x an `add`. `mul` against a public multiplier is 33,498. Pro-rata arithmetic is
~69k gas per order — the cheap part of allocation.

Two caveats, both accepted and documented in the contract:

- **Rounding.** Integer division truncates, so fills can sum to slightly under the matched
  volume. The dust stays unmatched, which is the convention in real call auctions and never
  over-allocates.
- **Bound.** `size * matched` must fit in 64 bits. COTI's 6-decimal cap on private tokens
  leaves room for sizes and volumes up to ~4.2e9 base units.

## MpcCore.mux is inverted, and nothing tells you

`mux(bit, a, b)` evaluates to **`bit ? b : a`** — the selected value is the *last*
argument. Measured via `probeMux`: `mux(true, 111, 222)` returns 222.

This is invisible from Solidity (mux delegates straight to the precompile) and is not in
the docs. Getting it backwards inverts every conditional in the clearing — it would
select exactly the orders that must *not* participate, on encrypted data, and raise no
error. The first version of the kernel had this bug; only the hand-computed book caught
it.

## Per-operation cost: the boundary is what costs, not the compute

| op | gas | |
|---|---|---|
| `ge(gtUint64, public)` | 9,917 | compute |
| `and(gtBool, gtBool)` | 12,575 | compute |
| `setPublic64` | 12,580 | compute |
| `mux` | 12,893 | compute |
| `add` | 12,932 | compute |
| `min` | 13,612 | compute |
| `mul(gtUint64, public)` | 33,498 | compute |
| `div(gtUint64, gtUint64)` | 35,291 | compute |
| `onBoard(ctUint64)` | 47,585 | **crosses the encryption boundary** |
| `offBoardToUser` | 47,962 | **crosses the encryption boundary** |
| `validateCiphertext` | 48,614 | **crosses the encryption boundary** |

Crossing in or out of the encrypted domain costs ~4x a garbled compute op. The design
rule that follows: **minimise boundary crossings, compute freely.**

That is why the kernel onboards each order *once* and amortises it across all K ticks.
Onboarding inside the tick loop would have added 3 × 47,585 gas per (order, tick) and
made the kernel ~2.4x more expensive.

The same rule paid off twice more, and both wins were predicted from the per-op table
before being measured:

- **Reuse garbled handles across phases.** The allocation pass originally re-onboarded
  every order, even though clearing had already onboarded it *in the same transaction*.
  Garbled handles stay valid for the whole transaction, so `_curves` now hands them back.
  Allocation overhead: **387,380 → 244,278 gas/order, −37%**. Predicted saving 142,755
  (3 × `onBoard`), measured 143,102 — 0.2% off.
- **Share one encrypted zero.** The curve accumulators were each initialised with their
  own `setPublic64(0)`. Garbled values are immutable — every operation returns a fresh
  handle — so one zero handle can seed all 2K accumulators. The per-tick coefficient fell
  from 77,108 to 52,278, a drop of 24,830 ≈ 2 × 12,580.

The model cross-validates against these micro-costs, which is why it can be trusted to
extrapolate:

- per (order, tick): measured 103,282 vs 96,634 predicted from micro-ops (2×`ge` +
  2×`and` + 2×`mux` + 2×`add`) — 7% loop/memory overhead
- per order: measured 163,760 vs 161,555 predicted (3×`onBoard` + `not` + 3 cold SLOAD)
  — 1.4%

A linearity check (gas vs iteration count on `mux`) confirms `viaIR` + optimizer elide
nothing, so the measurements are honest.

## Other findings

- **Block gas limit is 120,000,000**, not the 12M the official Hardhat template's
  example implies. This is the single number that made the design viable.
- **Encrypted booleans work from a plain 0/1 inputtext.** The `SBOOL_T` type tag is
  chosen contract-side by `validateCiphertext(itBool)`, so the client SDK needs no
  dedicated bool encryption. The `ctUint64` + `ne(x,0)` fallback is not needed.
- **`MpcCore.transfer(a, b, amount)`** exists — a native private-transfer primitive,
  which is what settlement should use rather than a hand-rolled debit/credit.
- Mixed public/secret overloads exist and are cheaper: `ge(gtUint64, uint64)` compares
  against a public tick, and `mux(gtBool, gtUint64, uint64)` muxes against a public
  value. The kernel uses both, which also spares a `setPublic64` per tick in the argmax.

## Toolchain traps (each one an evening saved)

- `typescript@7` gets installed by default and breaks `ts-node` → pin `typescript@^5`.
- The official template pins solc 0.8.19 but `@coti-io/coti-contracts@1.0.9` requires
  `^0.8.20`.
- solc ≥ 0.8.20 defaults to the shanghai target and emits `PUSH0`, which gcEVM rejects →
  keep `evmVersion: "paris"`.
- `setPublic64` is overloaded on `uint64`/`int64`, so bare integer literals are
  ambiguous → cast explicitly.
- The clearing kernel holds too many live locals for legacy codegen ("stack too deep") →
  `viaIR: true`.

## Design decisions taken on the back of this

**Order side stays encrypted.** Making it public would let each order touch only one of
the two curves and drop the two `and` ops, cutting the per-(order, tick) cost roughly in
half. We can afford not to: knowing "there is a large seller" is itself tradeable
information, and hiding direction is a core part of what a dark pool sells. With 57 orders
of headroom at K=12 including allocation, the privacy is worth more than the gas.

**Allocation is pro-rata, not time-priority.** Arrival-time priority was the conservative
plan, on the assumption that encrypted division would be too expensive. At 35,291 gas it
is not, so we take the fairer rule that does not leak through a public ordering.

**The demand/supply imbalance at the clearing price stays encrypted.** Only the clearing
price and total matched volume are revealed. Publishing `demand(k*)` and `supply(k*)`
separately — as Nasdaq does with its imbalance indicators — would tell everyone how
one-sided the book was. The `div` denominator therefore stays a secret/secret division
rather than the cheaper divide-by-public variant.

## Reproduce

```bash
npm install
npx hardhat run scripts/new-wallet.ts --network coti-testnet   # then fund via faucet.coti.io
STAGE=probe   npm run spike   # deploy, mux/bool probes, seed the balanced book
STAGE=kernel  npm run spike   # gas curve + clearing correctness assertion
STAGE=micro   npm run spike   # per-operation marginal costs
STAGE=prorata npm run spike   # unbalanced book, allocation + per-fill assertions
```

`STAGE=prorata` replaces the book with the unbalanced scenario, so run it last (or re-run
`STAGE=probe` afterwards to restore the balanced one).
