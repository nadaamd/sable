/**
 * Plaintext reference implementation of SableCross's clearing and allocation.
 *
 * This exists to be an independent oracle. Encrypted computation gives you no visibility
 * when it goes wrong — a mux with swapped arguments produces a plausible number and no
 * error — so the contract is checked against this rather than against hardcoded values.
 * It mirrors the Solidity step for step, including the strict `>` in the argmax (so ties
 * resolve to the lowest tick, exactly as the mux chain does) and the cumulative-quotient
 * allocation.
 */
import type { PlannedOrder } from "./strategy"

export type ClearResult = {
  price: number
  volume: number
  fills: number[]
  demandAtClearing: number
  supplyAtClearing: number
}

export function referenceClear(orders: PlannedOrder[], ticks: number[]): ClearResult {
  const demand: number[] = []
  const supply: number[] = []
  let bestPrice = 0
  let bestVolume = 0

  for (const tick of ticks) {
    let d = 0
    let s = 0
    for (const o of orders) {
      if (o.isBuy && o.limit >= tick) d += o.size
      if (!o.isBuy && o.limit <= tick) s += o.size
    }
    demand.push(d)
    supply.push(s)
    const crossed = Math.min(d, s)
    // Strict >: the first tick achieving the maximum wins, matching the contract's mux chain.
    if (crossed > bestVolume) {
      bestVolume = crossed
      bestPrice = tick
    }
  }

  if (bestVolume === 0) {
    return { price: 0, volume: 0, fills: orders.map(() => 0), demandAtClearing: 0, supplyAtClearing: 0 }
  }

  const k = ticks.indexOf(bestPrice)
  const dTot = demand[k]
  const sTot = supply[k]
  const V = bestVolume

  // Cumulative quotients: the fills telescope to exactly V on each side, which is what
  // keeps the contract solvent. See SableCross._allocate.
  let cumBuy = 0
  let cumSell = 0
  let qBuyPrev = 0
  let qSellPrev = 0
  const fills: number[] = []

  for (const o of orders) {
    if (o.isBuy && o.limit >= bestPrice) cumBuy += o.size
    if (!o.isBuy && o.limit <= bestPrice) cumSell += o.size

    const qBuy = Math.floor((cumBuy * V) / dTot)
    const qSell = Math.floor((cumSell * V) / sTot)
    fills.push(o.isBuy ? qBuy - qBuyPrev : qSell - qSellPrev)
    qBuyPrev = qBuy
    qSellPrev = qSell
  }

  return { price: bestPrice, volume: V, fills, demandAtClearing: dTot, supplyAtClearing: sTot }
}

export type Legs = { baseOut: number; quoteOut: number }

/** What each order is owed once the batch clears. Mirrors SableCross._allocate. */
export function referenceLegs(orders: PlannedOrder[], fills: number[], price: number): Legs[] {
  return orders.map((o, i) => {
    const fill = fills[i]
    const notional = fill * price
    return o.isBuy
      ? { baseOut: fill, quoteOut: o.size * o.limit - notional }
      : { baseOut: o.size - fill, quoteOut: notional }
  })
}

/** Refund-everything case, for a batch where nothing crossed. */
export function referenceRefundLegs(orders: PlannedOrder[]): Legs[] {
  return orders.map((o) => (o.isBuy ? { baseOut: 0, quoteOut: o.size * o.limit } : { baseOut: o.size, quoteOut: 0 }))
}
