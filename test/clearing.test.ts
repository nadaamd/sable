/**
 * Unit tests for the plaintext clearing reference.
 *
 * WHY THIS FILE AND NOT THE CONTRACT. SableCross calls MpcCore 67 times, so it needs COTI's
 * garbled-compute precompiles and cannot run on a local Hardhat network. There is no way to unit
 * test `clear()` offline today.
 *
 * `referenceClear` can be, and it matters more than it looks. It is the ORACLE: run-agents,
 * check-offline and stress-max-orders all decide whether the contract is correct by comparing it
 * against this function, precisely because encrypted computation gives no visibility when it goes
 * wrong — a mux with swapped arguments returns a plausible number and no error. If the oracle
 * drifts, every one of those verdicts is worthless and nothing would say so.
 *
 * So these lock down the behaviour the contract is checked against. Where a test asserts something
 * subtle, the assertion is grounded in SableCross itself, not in the reference — a test that only
 * restates its implementation proves nothing.
 *
 * Runs offline in milliseconds: `npm test`. Node's built-in runner, no dependencies.
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  referenceClear,
  referenceLegs,
  referenceRefundLegs,
} from "../scripts/agents/reference.ts"
import type { PlannedOrder } from "../scripts/agents/strategy.ts"

/** The production grid, from scripts/agents/desks.ts. */
const TICKS = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106]

const buy = (limit: number, size: number): PlannedOrder => ({ isBuy: true, limit, size })
const sell = (limit: number, size: number): PlannedOrder => ({ isBuy: false, limit, size })

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Demand and supply at a tick, computed independently of the function under test. */
function depth(orders: PlannedOrder[], tick: number) {
  return {
    demand: sum(orders.filter((o) => o.isBuy && o.limit >= tick).map((o) => o.size)),
    supply: sum(orders.filter((o) => !o.isBuy && o.limit <= tick).map((o) => o.size)),
  }
}

// ---------------------------------------------------------------- nothing crosses ----

test("empty book clears at nothing", () => {
  const r = referenceClear([], TICKS)
  assert.equal(r.price, 0)
  assert.equal(r.volume, 0)
  assert.deepEqual(r.fills, [])
})

test("empty tick grid clears at nothing", () => {
  const r = referenceClear([buy(101, 10), sell(99, 10)], [])
  assert.equal(r.volume, 0)
  assert.deepEqual(r.fills, [0, 0])
})

test("book that does not cross clears at nothing, and fills nobody", () => {
  // Every bid sits below every ask, so min(demand, supply) is 0 at every tick.
  const book = [buy(97, 10), buy(96, 5), sell(103, 10), sell(104, 5)]
  const r = referenceClear(book, TICKS)
  assert.equal(r.price, 0)
  assert.equal(r.volume, 0)
  assert.deepEqual(r.fills, [0, 0, 0, 0])
})

test("buy-side-only book does not cross", () => {
  const r = referenceClear([buy(101, 10), buy(102, 7)], TICKS)
  assert.equal(r.volume, 0)
  assert.deepEqual(r.fills, [0, 0])
})

test("sell-side-only book does not cross", () => {
  const r = referenceClear([sell(99, 10), sell(98, 7)], TICKS)
  assert.equal(r.volume, 0)
  assert.deepEqual(r.fills, [0, 0])
})

// ---------------------------------------------------------------- the tie-break ------

test("a tie resolves to the LOWEST tick", () => {
  /*
   * The one behaviour a reimplementation is most likely to get backwards, and the reason the
   * reference carries a strict `>` in its argmax.
   *
   * SableCross._argmax does:
   *     gtBool better = MpcCore.gt(crossed, bestVol)   // STRICT
   *     bestPrice     = MpcCore.mux(better, bestPrice, ticks[k])
   * so a later tick matching the incumbent volume does NOT displace it. Ties keep the first tick
   * reached, and the loop runs low to high.
   *
   * Here one lot is bid at 106 and one lot offered at 95, so every tick in the grid crosses
   * exactly 1: the maximum is achieved twelve times over and only the tie-break decides.
   */
  const r = referenceClear([buy(106, 1), sell(95, 1)], TICKS)
  assert.equal(r.volume, 1)
  assert.equal(r.price, TICKS[0], "a tie must settle on the lowest tick, not the highest")
})

test("a strictly better tick later in the grid does displace the incumbent", () => {
  // The mirror of the case above: without this, "lowest wins" could be hiding a broken argmax
  // that simply never updates.
  const book = [buy(106, 1), sell(95, 1), buy(103, 9), sell(103, 9)]
  const r = referenceClear(book, TICKS)
  assert.equal(r.price, 103)
  assert.equal(r.volume, 10)
})

// ---------------------------------------------------------------- allocation ---------

test("balanced book fills everyone completely", () => {
  const book = [buy(102, 10), sell(100, 10)]
  const r = referenceClear(book, TICKS)
  assert.equal(r.volume, 10)
  assert.deepEqual(r.fills, [10, 10])
})

test("the short side is rationed and the fills telescope to exactly the volume", () => {
  /*
   * Demand 30, supply 20 at the clearing price. The three buys share 20 by cumulative quotients
   * rather than by rounding each share independently — which is the point: independent rounding
   * loses or invents units, and the contract would go insolvent by the difference.
   */
  const book = [buy(105, 10), buy(105, 10), buy(105, 10), sell(95, 20)]
  const r = referenceClear(book, TICKS)
  assert.equal(r.volume, 20)
  const fills = r.fills
  assert.equal(sum([fills[0], fills[1], fills[2]]), 20, "buy fills must total the volume exactly")
  assert.equal(fills[3], 20, "the lone seller takes the whole volume")
  for (let i = 0; i < 3; i++) assert.ok(fills[i] <= 10, "no fill may exceed its order size")
})

test("rationing with a remainder still totals exactly, and loses no unit", () => {
  // 3 buyers of 10 against 10 of supply: 10/3 does not divide, so the quotients must absorb the
  // remainder between them rather than each rounding down and leaving a unit unallocated.
  const book = [buy(105, 10), buy(105, 10), buy(105, 10), sell(95, 10)]
  const r = referenceClear(book, TICKS)
  assert.equal(r.volume, 10)
  assert.equal(sum(r.fills.slice(0, 3)), 10, "the remainder must not be dropped")
})

test("an order that does not cross at the clearing price gets nothing", () => {
  const book = [buy(105, 10), buy(96, 10), sell(100, 10)]
  const r = referenceClear(book, TICKS)
  assert.ok(r.price >= 100, "the clearing price must be at or above the seller's limit")
  assert.equal(r.fills[1], 0, "a bid below the clearing price is not filled")
})

test("clearing can land on the first and on the last tick", () => {
  const low = referenceClear([buy(95, 5), sell(95, 5)], TICKS)
  assert.equal(low.price, 95)
  assert.equal(low.volume, 5)

  const high = referenceClear([buy(106, 5), sell(106, 5)], TICKS)
  assert.equal(high.price, 106)
  assert.equal(high.volume, 5)
})

test("a single-tick grid still clears", () => {
  const r = referenceClear([buy(101, 4), sell(101, 4)], [101])
  assert.deepEqual([r.price, r.volume], [101, 4])
})

// ---------------------------------------------------------------- the legs -----------

test("a buy filled at its own limit gets no quote back", () => {
  const book = [buy(100, 10), sell(100, 10)]
  const r = referenceClear(book, TICKS)
  const legs = referenceLegs(book, r.fills, r.price)
  assert.equal(legs[0].baseOut, 10)
  assert.equal(legs[0].quoteOut, 0, "escrow was size x limit and the fill cost exactly that")
})

test("a buy filled below its limit is refunded the difference", () => {
  const book = [buy(105, 10), sell(100, 10)]
  const r = referenceClear(book, TICKS)
  const legs = referenceLegs(book, r.fills, r.price)
  assert.equal(legs[0].quoteOut, 10 * 105 - 10 * r.price)
})

test("refund legs return every unit of both escrows", () => {
  const book = [buy(97, 10), sell(103, 4)]
  const legs = referenceRefundLegs(book)
  assert.equal(sum(legs.map((l) => l.quoteOut)), 10 * 97, "all quote back to the buyer")
  assert.equal(sum(legs.map((l) => l.baseOut)), 4, "all base back to the seller")
})

// ---------------------------------------------------------------- invariants ---------

/** Deterministic PRNG, so a failing sweep is reproducible from its seed alone. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test("invariants hold over 600 random books", () => {
  /*
   * The named cases above are the ones somebody thought of. This is the part that catches what
   * nobody did: the properties the contract's solvency actually rests on, over books drawn at
   * random. Solvency is not an assertion in the contract — it is a consequence of the fills
   * summing to the volume on BOTH sides with no rounding leak, which is exactly what is checked
   * here.
   */
  const rnd = mulberry32(20260829)
  const pick = (n: number) => Math.floor(rnd() * n)

  for (let iter = 0; iter < 600; iter++) {
    const n = 1 + pick(12)
    const book: PlannedOrder[] = Array.from({ length: n }, () => {
      const isBuy = rnd() < 0.5
      return { isBuy, limit: TICKS[pick(TICKS.length)], size: 1 + pick(40) }
    })

    const r = referenceClear(book, TICKS)
    const where = `seed 20260829, iteration ${iter}, book ${JSON.stringify(book)}`

    assert.equal(r.fills.length, book.length, `one fill per order — ${where}`)

    if (r.volume === 0) {
      assert.equal(r.price, 0, `no cross means no price — ${where}`)
      assert.ok(r.fills.every((f) => f === 0), `no cross means no fills — ${where}`)
      continue
    }

    // The price is a real tick, and the volume is the depth it actually crosses.
    assert.ok(TICKS.includes(r.price), `price must be on the grid — ${where}`)
    const d = depth(book, r.price)
    assert.equal(r.volume, Math.min(d.demand, d.supply), `volume must be the crossed depth — ${where}`)

    // No other tick crosses more: this is the maximisation, checked independently.
    for (const t of TICKS) {
      const o = depth(book, t)
      assert.ok(Math.min(o.demand, o.supply) <= r.volume, `tick ${t} beats the winner — ${where}`)
    }

    let buyFilled = 0
    let sellFilled = 0
    book.forEach((o, i) => {
      const f = r.fills[i]
      assert.ok(f >= 0, `fills cannot be negative — ${where}`)
      assert.ok(f <= o.size, `a fill cannot exceed its order — ${where}`)
      const crosses = o.isBuy ? o.limit >= r.price : o.limit <= r.price
      if (!crosses) assert.equal(f, 0, `an order off the cross must not fill — ${where}`)
      if (o.isBuy) buyFilled += f
      else sellFilled += f
    })

    // THE solvency property: both sides settle exactly the volume, no unit lost or invented.
    assert.equal(buyFilled, r.volume, `buy fills must total the volume — ${where}`)
    assert.equal(sellFilled, r.volume, `sell fills must total the volume — ${where}`)

    // And the payouts conserve both escrows to the unit.
    const legs = referenceLegs(book, r.fills, r.price)
    const baseIn = sum(book.filter((o) => !o.isBuy).map((o) => o.size))
    const quoteIn = sum(book.filter((o) => o.isBuy).map((o) => o.size * o.limit))
    assert.equal(sum(legs.map((l) => l.baseOut)), baseIn, `base must be conserved — ${where}`)
    assert.equal(sum(legs.map((l) => l.quoteOut)), quoteIn, `quote must be conserved — ${where}`)
  }
})
