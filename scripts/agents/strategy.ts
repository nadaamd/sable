/**
 * Desk strategy — deterministic, no model calls.
 *
 * A desk's mandate is private and never leaves the machine. What goes on chain is an
 * encrypted indication of interest (IOI), and later a sealed order. This module is the
 * decision layer between the two, and it is pure so it can be reasoned about and tested
 * without touching the network.
 *
 * ## Why the RFQ changes size, not price
 *
 * Sable is a sealed-bid UNIFORM-price auction: everyone who crosses trades at the same
 * clearing price, so shading your limit mostly just risks missing the fill without
 * improving your execution. The rational move is to bid close to your true reservation
 * value. That is a property of the mechanism, not a heuristic.
 *
 * So what the RFQ actually buys you is not a better price — it is knowing whether to commit
 * capital at all, and how much. Submitting an order escrows funds; escrowing against
 * counterparty interest that is not there locks capital for nothing. Hence:
 *
 *     committed = clamp(visible opposing interest, probe floor, own target)
 *
 * Never commit more than the counterparty interest you can actually see. All integer
 * arithmetic — a float `floor` drifting by one unit would silently change the book.
 *
 * And the IOI must be encrypted, or announcing "I need to buy 70" to the market is simply
 * telling everyone to raise their price.
 */

export type Side = "buy" | "sell"

/** One rung of a desk's order ladder, relative to its reservation price. */
export type Rung = {
  /** Price offset from the reservation. 0 is the most aggressive rung. */
  offset: number
  /** Relative size weight; weights are normalised against their sum. */
  weight: number
}

export type Mandate = {
  name: string
  side: Side
  /** Total quantity the desk wants to move, in base units. */
  targetSize: number
  /**
   * The desk's true reservation price: the most a buyer will pay, the least a seller will
   * accept. Bid it honestly — see the note above on uniform-price auctions.
   */
  reservation: number
  ladder: Rung[]
}

export type PlannedOrder = {
  isBuy: boolean
  limit: number
  size: number
}

/** Fraction of target a desk still commits when it sees no counterparty, to probe. */
export const PROBE_FLOOR = 0.25

export type Decision = {
  committed: number
  orders: PlannedOrder[]
  /** Why this size — carried through to the run log so the demo can explain itself. */
  rationale: string
}

/**
 * Snap a price onto the public grid, conservatively: a buyer rounds DOWN and a seller
 * rounds UP, so snapping can never push a desk past its own reservation.
 */
export function snapToGrid(price: number, side: Side, ticks: number[]): number {
  const sorted = [...ticks].sort((a, b) => a - b)
  if (side === "buy") {
    const ok = sorted.filter((t) => t <= price)
    return ok.length ? ok[ok.length - 1] : sorted[0]
  }
  const ok = sorted.filter((t) => t >= price)
  return ok.length ? ok[0] : sorted[sorted.length - 1]
}

/** Split `total` across weights, giving any rounding remainder to the last rung. */
export function splitByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  const parts = weights.map((w) => Math.floor((total * w) / sum))
  parts[parts.length - 1] += total - parts.reduce((a, b) => a + b, 0)
  return parts
}

/**
 * Decide what to commit, given the total opposing interest learned from encrypted IOIs.
 */
export function decide(mandate: Mandate, observedOpposing: number, ticks: number[]): Decision {
  const probe = Math.floor(mandate.targetSize * PROBE_FLOOR)
  const committed = Math.max(Math.min(mandate.targetSize, observedOpposing), probe)

  const rationale =
    observedOpposing === 0
      ? `saw no opposing interest, probing with ${committed}/${mandate.targetSize}`
      : observedOpposing >= mandate.targetSize
        ? `saw ${observedOpposing} opposing vs target ${mandate.targetSize}, committing in full`
        : `saw only ${observedOpposing} opposing vs target ${mandate.targetSize}, ` +
          `committing ${committed} and keeping ${mandate.targetSize - committed} back`

  const sizes = splitByWeight(committed, mandate.ladder.map((r) => r.weight))
  const orders: PlannedOrder[] = mandate.ladder
    .map((rung, i) => ({
      isBuy: mandate.side === "buy",
      limit: snapToGrid(mandate.reservation + rung.offset, mandate.side, ticks),
      size: sizes[i],
    }))
    .filter((o) => o.size > 0)

  return { committed, orders, rationale }
}

/** What a desk escrows for a given set of orders: quote for buyers, base for sellers. */
export function escrowFor(orders: PlannedOrder[]): { base: number; quote: number } {
  let base = 0
  let quote = 0
  for (const o of orders) {
    if (o.isBuy) quote += o.size * o.limit
    else base += o.size
  }
  return { base, quote }
}

/**
 * What the desk WOULD have escrowed had it ignored the RFQ and committed its full target.
 * The difference is capital the encrypted RFQ freed up — the concrete payoff of the
 * pre-trade layer, and the number worth putting on screen.
 */
export function counterfactualEscrow(mandate: Mandate, ticks: number[]): { base: number; quote: number } {
  const sizes = splitByWeight(mandate.targetSize, mandate.ladder.map((r) => r.weight))
  const orders = mandate.ladder
    .map((rung, i) => ({
      isBuy: mandate.side === "buy",
      limit: snapToGrid(mandate.reservation + rung.offset, mandate.side, ticks),
      size: sizes[i],
    }))
    .filter((o) => o.size > 0)
  return escrowFor(orders)
}

// ------------------------------------------------------------------ IOI wire format

/**
 * IOIs must fit one message chunk. COTI's PrivateMessaging caps a chunk at
 * MAX_CHUNK_CELLS = 3 cells of 8 bytes, so 24 bytes total. `IOI:B:70` is 8.
 *
 * Note what an IOI deliberately omits: any price. It says "there is interest this size on
 * this side", which is what a counterparty needs to size up, and nothing about valuation.
 */
export function encodeIoi(side: Side, size: number): string {
  const msg = `IOI:${side === "buy" ? "B" : "S"}:${size}`
  if (Buffer.byteLength(msg, "utf8") > 24) throw new Error(`IOI too long for one chunk: ${msg}`)
  return msg
}

export function decodeIoi(msg: string): { side: Side; size: number } | null {
  const m = msg.trim().match(/^IOI:([BS]):(\d+)$/)
  if (!m) return null
  return { side: m[1] === "B" ? "buy" : "sell", size: Number(m[2]) }
}
