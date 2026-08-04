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

The long side is then rationed pro-rata to order size, still encrypted:

```
fill = participates ? size * matched / sideTotal : 0
```

This needs no branch on which side is long — which is essential, because that fact is
itself encrypted. The short side satisfies `sideTotal == matched`, so its ratio is exactly
1 and it fills completely. Each fill is offboarded to its own trader's key: only they can
read it.

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

Day-1 de-risking spike is complete and the architecture is validated on testnet — see
**[SPIKE.md](SPIKE.md)** for measured gas, the cost model, and the correctness proof.

Headline: clearing 20 orders over 12 price ticks, *including* encrypted pro-rata
allocation of every fill, costs 33.7M gas — 28% of a block. Single-transaction clearing is
viable; no sharding required. Both the clearing price and every individual fill have been
verified against hand-computed books.

## Repo

```
contracts/GasSpike.sol     the clearing kernel, instrumented for measurement
scripts/spike-gas.ts       gas curve + correctness harness
scripts/new-wallet.ts      testnet wallet bootstrap
SPIKE.md                   measured results and design decisions
```

## Getting started

```bash
npm install
npx hardhat compile
npx hardhat run scripts/new-wallet.ts --network coti-testnet   # then fund at faucet.coti.io
STAGE=probe  npm run spike
STAGE=kernel npm run spike
```

Testnet only. The generated key lives in `.env`, which is gitignored — never reuse it on
mainnet.

## License

MIT
