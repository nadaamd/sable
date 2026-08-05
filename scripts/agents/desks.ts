/**
 * The three desks and the market they trade on.
 *
 * Each mandate is private: it lives here, on the desk's own machine, and nothing in it is
 * ever published. Only an encrypted IOI and a sealed order reach the chain.
 *
 * The mandates are deliberately asymmetric — Atlas wants more than the market can supply —
 * so the RFQ round has something real to tell them.
 */
import type { Mandate } from "./strategy"

/** The market's public price grid: 12 ticks, one quote unit apart. */
export const TICKS = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106]

export const MANDATES: Mandate[] = [
  {
    // A large buyer that will pay up to 103 and ladders down from there. Its target exceeds
    // the visible supply, so the RFQ will hold it back from over-escrowing.
    name: "Atlas",
    side: "buy",
    targetSize: 70,
    reservation: 103,
    ladder: [
      { offset: 0, weight: 4 },
      { offset: -2, weight: 3 },
    ],
  },
  {
    // A small, price-sensitive buyer. Its reservation sits below where this batch will
    // clear, so it should end up unfilled and fully refunded — the case that proves
    // unmatched orders leak nothing and cost nothing.
    name: "Borealis",
    side: "buy",
    targetSize: 20,
    reservation: 99,
    ladder: [{ offset: 0, weight: 1 }],
  },
  {
    // The supply side, laddering up from a reservation of 98 across three rungs.
    name: "Cygnus",
    side: "sell",
    targetSize: 65,
    reservation: 98,
    ladder: [
      { offset: 0, weight: 4 },
      { offset: 2, weight: 7 },
      { offset: 3, weight: 2 },
    ],
  },
]

/** How long a batch accepts orders once the first one lands. */
export const COMMIT_WINDOW = 150

/**
 * How long after the window closes before a stuck batch can be abandoned and refunded.
 * Must be at least one commit window — a premature rescue cancels a batch that could still
 * have cleared, so on a real market this should be far more generous than a test needs.
 */
export const RESCUE_DELAY = 300

/**
 * Largest order this market accepts, in base units.
 *
 * The ceiling is arithmetic, not policy: MAX_ORDERS * maxOrderSize must stay inside 32 bits
 * so the allocation's `cum * matched` stays inside 64. With MAX_ORDERS = 32 that caps it at
 * 134,217,728; 1e8 leaves room and is orders of magnitude above anything the desks trade.
 */
export const MAX_ORDER_SIZE = 100_000_000

/**
 * Reward epoch length for the RFQ messaging channel. Kept short so a demo run actually
 * reaches a claimable epoch: COTI's PrivateMessaging only pays out an epoch once it has
 * ended, and it pays in proportion to the encrypted cells a desk stored. The protocol
 * literally pays the desks for talking to each other privately.
 */
export const MESSAGING_EPOCH = 120
