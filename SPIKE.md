# Day-1 gas spike — results

Measured on COTI testnet (chainId 7082400), solc 0.8.20 / evmVersion paris / viaIR +
optimizer(200). Raw data in `spike-report.json`. Total cost of the entire spike (including a redeploy
after the mux fix): **0.013 COTI** out of a 10 COTI faucet grant.

## Verdict: single-transaction clearing is viable, with room to spare

The design question was whether a uniform-price batch auction over *encrypted* orders
fits in one transaction, or whether clearing has to be sharded across several.

**It fits, comfortably.** The n=20, K=12 target costs 29.1M gas — 24% of the block.
Sharding is not needed and has been dropped from the plan.

```
gas(n, K) = 118,374 + 163,760·n + 103,282·n·K + 77,108·K      max residual 0.5%
```

Max orders in one clearing tx, budgeting 80% of the 120M block limit:

| price ticks (K) | max orders (n) |
|---|---|
| 4 | 165 |
| 8 | 96 |
| **12** | **67** |
| 16 | 52 |

## Correctness is verified, not assumed

The spike seeds a book whose clearing is computable by hand, so it tests the algorithm
as well as its cost.

Book: buys 103×50, 101×30, 100×20, 98×10 / sells 97×40, 99×25, 100×35, 104×15 over a
12-tick grid [95..106]. Demand and supply cross at 100 with 100 units matched.

**Result: price 100, volume 100 — correct**, computed entirely on garbled values, with
no Solidity branch ever touching an encrypted quantity.

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
| `onBoard(ctUint64)` | 47,585 | **crosses the encryption boundary** |
| `offBoardToUser` | 47,962 | **crosses the encryption boundary** |
| `validateCiphertext` | 48,614 | **crosses the encryption boundary** |

Crossing in or out of the encrypted domain costs ~4x a garbled compute op. The design
rule that follows: **minimise boundary crossings, compute freely.**

That is why the kernel onboards each order *once* and amortises it across all K ticks.
Onboarding inside the tick loop would have added 3 × 47,585 gas per (order, tick) and
made the kernel ~2.4x more expensive.

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

## Design decision taken on the back of this

Order **side stays encrypted**. Making it public would let each order touch only one of
the two curves and drop the two `and` ops, cutting the per-(order, tick) cost roughly in
half. We can afford not to: knowing "there is a large seller" is itself tradeable
information, and hiding direction is a core part of what a dark pool sells. With 67
orders of headroom at K=12, the privacy is worth more than the gas.

## Reproduce

```bash
npm install
npx hardhat run scripts/new-wallet.ts --network coti-testnet   # then fund via faucet.coti.io
STAGE=probe  npm run spike    # deploy, mux/bool probes, seed the book
STAGE=kernel npm run spike    # gas curve + correctness assertion
STAGE=micro  npm run spike    # per-operation marginal costs
```
