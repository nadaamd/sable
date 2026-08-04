# Sable

**The confidential cross for autonomous agents.**

A sealed-bid, uniform-price batch auction where the matching engine runs on encrypted
orders — built on [COTI](https://coti.io)'s garbled-circuit EVM.

Built for the [COTI Vibe Code Challenge — Web 4 Agent Edition](https://stay.coti.io/vibe-coding/).

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

**`SableCross.sol` is live on COTI testnet and passes an end-to-end test with three
independent traders.** Sealed orders, escrow, encrypted clearing, pro-rata allocation, real
PrivateERC20 settlement, and cross-trader privacy are all verified against a hand-computed
book — see `scripts/cross-e2e.ts`.

What the test proves, on chain:

- clearing price 101 and matched volume 85 on a book no one could read
- all six fills exact (51 / 34 / 0 / 30 / 30 / 25), each decrypted only by its own trader
- fills sum to the matched volume on **both** sides — the invariant that keeps the contract
  solvent
- net token movement exact for every trader (A +26 base / −2,626 quote, B +4 / −404,
  C −30 / +3,030)
- trader B attempting to decrypt trader A's fill of 51 recovers garbage, not the value

Gas, measured: `submitOrder` 2.53M, `clear` 13.1M for 6 orders over 12 ticks, `claim` 2.73M
per trader. Notably the encrypted **token transfers dominate**, not the clearing kernel —
a 256-bit PrivateERC20 transfer costs roughly 1.2M against ~13k for a 64-bit garbled
compute op. Settlement is pull-based precisely so that cost sits with each trader rather
than in the clearing transaction.

The day-1 de-risking spike that sized all of this is in **[SPIKE.md](SPIKE.md)**: the cost
model, per-operation gas, and the two traps that would otherwise have shipped silently.

## Repo

```
contracts/SableCross.sol      the market: batches, escrow, clearing, allocation, claim
contracts/test/TestToken.sol   PrivateERC20 with an open mint, for testnet runs
contracts/GasSpike.sol         the clearing kernel, instrumented for measurement
scripts/cross-e2e.ts           three-trader end-to-end test with assertions
scripts/spike-gas.ts           gas curve + correctness harness
scripts/new-wallet.ts          testnet wallet bootstrap
SPIKE.md                       measured results and design decisions
```

## Getting started

```bash
npm install
npx hardhat compile
npm run wallet                 # then fund the printed address free at faucet.coti.io

# three-trader end-to-end run (funds two more wallets from the first)
STAGE=setup  npm run e2e       # tokens, mint, approvals, deploy the cross
STAGE=submit npm run e2e       # six sealed orders
STAGE=clear  npm run e2e       # waits out the commit window, clears, asserts fills
STAGE=claim  npm run e2e       # settles, asserts balances and cross-trader privacy
```

Staged because the commit window is a wall-clock deadline; each stage is resumable.

Testnet only. Keys live in `.env`, which is gitignored — never reuse them on mainnet.

## License

MIT
