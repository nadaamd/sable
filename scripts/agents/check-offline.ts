/**
 * Offline check of the desk strategy and the reference clearing engine.
 *
 * Runs with no network and no gas: `npx ts-node scripts/agents/check-offline.ts`.
 * Everything here must pass before a single testnet transaction is sent.
 */
import { decide, counterfactualEscrow, escrowFor, encodeIoi, decodeIoi, splitByWeight, snapToGrid } from "./strategy"
import { referenceClear, referenceLegs } from "./reference"
import { MANDATES, TICKS } from "./desks"

let failures = 0

function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  const ok = g === w
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(46)} ${ok ? g : `got ${g}  want ${w}`}`)
}

console.log(`Offline strategy + reference checks\n`)

// ------------------------------------------------------------------- primitives

console.log(`[primitives]`)
eq("splitByWeight(65, [4,3])", splitByWeight(65, [4, 3]), [37, 28])
eq("splitByWeight(65, [4,7,2])", splitByWeight(65, [4, 7, 2]), [20, 35, 10])
eq("splitByWeight remainder lands on last", splitByWeight(10, [1, 1, 1]), [3, 3, 4])
eq("buyer snaps down", snapToGrid(99.6, "buy", TICKS), 99)
eq("seller snaps up", snapToGrid(99.4, "sell", TICKS), 100)
eq("IOI round-trip", decodeIoi(encodeIoi("buy", 70)), { side: "buy", size: 70 })
eq("IOI rejects junk", decodeIoi("hello"), null)

// ------------------------------------------------------------------- decisions

console.log(`\n[decisions] each desk sees the others' encrypted IOIs`)

// Total opposing interest each desk learns from the RFQ round.
const opposing: Record<string, number> = {}
for (const m of MANDATES) {
  opposing[m.name] = MANDATES.filter((o) => o.side !== m.side).reduce((s, o) => s + o.targetSize, 0)
}

const decisions = MANDATES.map((m) => ({ mandate: m, ...decide(m, opposing[m.name], TICKS) }))

for (const d of decisions) {
  console.log(`  ${d.mandate.name.padEnd(9)} ${d.rationale}`)
  console.log(
    `            orders: ${d.orders.map((o) => `${o.isBuy ? "BUY " : "SELL"} ${o.limit}x${o.size}`).join("  ")}`,
  )
}

eq("Atlas commits", decisions[0].committed, 65)
eq("Atlas orders", decisions[0].orders.map((o) => [o.limit, o.size]), [[103, 37], [101, 28]])
eq("Borealis commits", decisions[1].committed, 20)
eq("Borealis orders", decisions[1].orders.map((o) => [o.limit, o.size]), [[99, 20]])
eq("Cygnus commits", decisions[2].committed, 65)
eq("Cygnus orders", decisions[2].orders.map((o) => [o.limit, o.size]), [[98, 20], [100, 35], [101, 10]])

// ------------------------------------------------------------------- clearing

const book = decisions.flatMap((d) => d.orders)
const cleared = referenceClear(book, TICKS)
const legs = referenceLegs(book, cleared.fills, cleared.price)

console.log(`\n[clearing] reference engine on the resulting book`)
console.log(`  price ${cleared.price}  volume ${cleared.volume}  demand ${cleared.demandAtClearing}  supply ${cleared.supplyAtClearing}`)
book.forEach((o, i) =>
  console.log(
    `  ${o.isBuy ? "BUY " : "SELL"} ${String(o.limit).padStart(3)}x${String(o.size).padStart(3)}` +
      `  fill ${String(cleared.fills[i]).padStart(3)}  baseOut ${String(legs[i].baseOut).padStart(3)}` +
      `  quoteOut ${String(legs[i].quoteOut).padStart(5)}`,
  ),
)

eq("clearing price", cleared.price, 101)
eq("matched volume", cleared.volume, 65)
eq("fills", cleared.fills, [37, 28, 0, 20, 35, 10])

// ------------------------------------------------------------------- invariants

console.log(`\n[invariants] the properties the contract must also satisfy`)
const buyFills = book.reduce((s, o, i) => s + (o.isBuy ? cleared.fills[i] : 0), 0)
const sellFills = book.reduce((s, o, i) => s + (!o.isBuy ? cleared.fills[i] : 0), 0)
eq("buy fills == volume", buyFills, cleared.volume)
eq("sell fills == volume", sellFills, cleared.volume)

const escrow = escrowFor(book)
const paidBase = legs.reduce((s, l) => s + l.baseOut, 0)
const paidQuote = legs.reduce((s, l) => s + l.quoteOut, 0)
eq("base escrowed == base paid out", escrow.base, paidBase)
eq("quote escrowed == quote paid out", escrow.quote, paidQuote)
book.forEach((o, i) => {
  if (cleared.fills[i] > o.size) {
    failures++
    console.log(`  FAIL order ${i} overfilled`)
  }
})
eq("no order overfilled", true, true)

// --------------------------------------------------------- what the RFQ bought

console.log(`\n[capital] what the encrypted RFQ saved`)
for (const d of decisions) {
  const actual = escrowFor(d.orders)
  const blind = counterfactualEscrow(d.mandate, TICKS)
  const savedQuote = blind.quote - actual.quote
  const savedBase = blind.base - actual.base
  if (savedQuote || savedBase) {
    console.log(
      `  ${d.mandate.name.padEnd(9)} escrowed ${actual.quote || actual.base} vs ${blind.quote || blind.base} blind` +
        `  ->  ${savedQuote || savedBase} units of capital not locked`,
    )
  } else {
    console.log(`  ${d.mandate.name.padEnd(9)} full commitment either way, nothing to save`)
  }
}

console.log(`\n${"=".repeat(72)}`)
console.log(failures === 0 ? `ALL OFFLINE CHECKS PASSED` : `${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
