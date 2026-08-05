/**
 * Read-only chain access for the terminal.
 *
 * Everything here is a public `view` call: the terminal needs no wallet, no signature and
 * no permission to render the entire order book. It renders it sealed, because that is what
 * the chain actually stores.
 */
import { Contract, FetchRequest, JsonRpcProvider } from "ethers"
import { decryptString, decryptUint } from "@coti-io/coti-sdk-typescript"
import { CROSS_ABI, MESSAGING_ABI } from "./abi"
import { CHAIN_ID, CROSS_ADDRESS, MESSAGING_ADDRESS, RPC_URL, type DeskKey } from "./deployment"

export type Phase = "idle" | "commit" | "awaiting-clear" | "cleared"

export type Plain = { isBuy: boolean; limit: number; size: number; fill: number }

export type OrderRow = {
  index: number
  trader: string
  claimed: boolean
  ct: { isBuy: bigint; limit: bigint; size: bigint; fill: bigint }
  /** Present only when we hold the owning desk's AES key and the result looks sane. */
  plain?: Plain
  deskName?: string
}

export type BatchView = {
  id: number
  commitDeadline: number
  cleared: boolean
  clearingPrice: number
  matchedVolume: number
  orderCount: number
  orders: OrderRow[]
  phase: Phase
}

export type MarketView = {
  ticks: number[]
  commitWindow: number
  maxOrders: number
  currentBatch: number
  batch: BatchView
  blockNumber: number
}

export type RfqMessage = {
  id: number
  from: string
  to: string
  timestamp: number
  epoch: number
  chunks: bigint[]
  /** Decrypted when we hold either the sender's or the recipient's key. */
  text?: string
  readAs?: string
}

export type RewardsView = {
  epoch: number
  epochDuration: number
  pool: bigint
  usageUnits: bigint
}

/**
 * Retry every call, because the testnet RPC is not reliable.
 *
 * Measured at 4/10 availability during one outage, which is fatal here for a reason specific
 * to this page: a single 502 on any of the ~40 view calls behind one poll turns the whole
 * book into an error state. The page reads as "the market is broken" when the market is fine.
 *
 * Retry belongs per-call, not per-render: at 40% availability, four attempts take the odds of
 * losing a call from 60% to 13%, and a poll needs every call to land.
 */
function resilient(url: string): JsonRpcProvider {
  const req = new FetchRequest(url)
  req.timeout = 20_000
  req.retryFunc = async (_req, resp, attempt) => {
    // 0 is a transport failure (DNS, reset, CORS-level); 429/5xx are the RPC shedding load.
    const transient = resp.statusCode === 0 || resp.statusCode === 429 || resp.statusCode >= 500
    if (!transient || attempt >= 4) return false
    await new Promise((r) => setTimeout(r, 200 * 2 ** attempt))
    return true
  }
  // staticNetwork: skip the eth_chainId probe on every call — one fewer thing to lose.
  return new JsonRpcProvider(req, CHAIN_ID, { staticNetwork: true })
}

let _provider: JsonRpcProvider | null = null
export function provider(): JsonRpcProvider {
  if (!_provider) _provider = resilient(RPC_URL)
  return _provider
}

export const cross = () => new Contract(CROSS_ADDRESS, CROSS_ABI, provider())
export const messaging = () => new Contract(MESSAGING_ADDRESS, MESSAGING_ABI, provider())

function keyFor(trader: string, keys: DeskKey[]): DeskKey | undefined {
  return keys.find((k) => k.address.toLowerCase() === trader.toLowerCase())
}

/**
 * A wrong key does not throw — it returns garbage. So a decryption is only trusted when the
 * result is structurally possible: a boolean that is 0 or 1, a limit on the public grid, and
 * a size that is not absurd. This is what stops the terminal from confidently showing noise.
 */
function plausible(p: Plain, ticks: number[]): boolean {
  const lo = Math.min(...ticks)
  const hi = Math.max(...ticks)
  return p.limit >= lo && p.limit <= hi && p.size >= 0 && p.size < 1e12 && p.fill <= p.size
}

/**
 * `all` supplies the address -> desk name mapping (addresses are public, so a row can be
 * labelled even while sealed). `unlocked` is the subset whose keys we may actually use.
 */
function tryDecrypt(row: OrderRow, ticks: number[], all: DeskKey[], unlocked: DeskKey[]): OrderRow {
  const named = keyFor(row.trader, all)
  if (named) row = { ...row, deskName: named.name }

  const desk = keyFor(row.trader, unlocked)
  if (!desk) return row
  try {
    const isBuyRaw = decryptUint(row.ct.isBuy, desk.aesKey)
    const p: Plain = {
      isBuy: isBuyRaw === 1n,
      limit: Number(decryptUint(row.ct.limit, desk.aesKey)),
      size: Number(decryptUint(row.ct.size, desk.aesKey)),
      fill: row.ct.fill === 0n ? 0 : Number(decryptUint(row.ct.fill, desk.aesKey)),
    }
    if (isBuyRaw > 1n || !plausible(p, ticks)) return row
    return { ...row, plain: p }
  } catch {
    return row
  }
}

function phaseOf(commitDeadline: number, cleared: boolean, nowSec: number): Phase {
  if (cleared) return "cleared"
  if (commitDeadline === 0) return "idle"
  return nowSec < commitDeadline ? "commit" : "awaiting-clear"
}

/**
 * Loads a batch.
 *
 * Pass `batchId` to inspect a specific one. Omitted, it shows the most recent batch that
 * actually has orders: clearing rolls the counter forward, so the live batch is empty right
 * after a cross and the interesting one is the batch just settled.
 */
export async function loadMarket(all: DeskKey[], unlocked: DeskKey[], batchId?: number): Promise<MarketView> {
  const c = cross()
  const [ticksRaw, commitWindow, maxOrders, currentBatchRaw, blockNumber] = await Promise.all([
    c.allTicks(),
    c.commitWindow(),
    c.MAX_ORDERS(),
    c.currentBatch(),
    provider().getBlockNumber(),
  ])

  const ticks = (ticksRaw as bigint[]).map(Number)
  const current = Number(currentBatchRaw)

  let id = batchId ?? current
  let meta = await c.batches(id)
  if (batchId === undefined && Number(meta[4]) === 0 && current > 0) {
    id = current - 1
    meta = await c.batches(id)
  }

  const commitDeadline = Number(meta[0])
  const cleared = Boolean(meta[1])
  const orderCount = Number(meta[4])

  // One round trip per order, in parallel. Sequentially this was the dominant cost of a load:
  // the first paint waited on ~8 serial round trips and showed a dead frame for seconds.
  const rows: OrderRow[] = await Promise.all(
    Array.from({ length: orderCount }, async (_, i) => {
      const r = await c.sealedOrder(id, i)
      return tryDecrypt(
        {
          index: i,
          trader: r[0] as string,
          claimed: Boolean(r[5]),
          ct: { isBuy: r[1] as bigint, limit: r[2] as bigint, size: r[3] as bigint, fill: r[4] as bigint },
        },
        ticks,
        all,
        unlocked,
      )
    }),
  )

  return {
    ticks,
    commitWindow: Number(commitWindow),
    maxOrders: Number(maxOrders),
    currentBatch: current,
    blockNumber,
    batch: {
      id,
      commitDeadline,
      cleared,
      clearingPrice: Number(meta[2]),
      matchedVolume: Number(meta[3]),
      orderCount,
      orders: rows,
      phase: phaseOf(commitDeadline, cleared, Math.floor(Date.now() / 1000)),
    },
  }
}

/**
 * The RFQ feed. Messages are gathered from the desks we know about; each one is decrypted
 * with whichever side's key we hold, which is exactly the point — sender and recipient can
 * both read it, and no one else can.
 */
export async function loadRfq(all: DeskKey[], unlocked: DeskKey[]): Promise<RfqMessage[]> {
  const m = messaging()

  // Enumerate from every desk we know of — the traffic is public. Only decryption depends on
  // which keys are unlocked. Desks are independent, so they fan out.
  const perDesk = await Promise.all(
    all.map(async (desk) => {
      const [inbox, sent] = await Promise.all([m.inboxCount(desk.address), m.sentCount(desk.address)])
      const [inIds, outIds] = await Promise.all([
        Number(inbox) > 0 ? m.getInboxPage(desk.address, 0, inbox) : Promise.resolve([]),
        Number(sent) > 0 ? m.getSentPage(desk.address, 0, sent) : Promise.resolve([]),
      ])
      return [...(inIds as bigint[]), ...(outIds as bigint[])].map(Number)
    }),
  )
  const ids = [...new Set(perDesk.flat())].sort((a, b) => a - b)

  const out = await Promise.all(
    ids.map(async (id): Promise<RfqMessage> => {
      const meta = await m.getMessageMetadata(id)
      const from = meta[0] as string
      const to = meta[1] as string

      const recipientKey = keyFor(to, unlocked)
      const senderKey = keyFor(from, unlocked)

      // Prefer the recipient's copy; fall back to the sender's. Whichever we can read.
      let chunks: bigint[] = []
      let text: string | undefined
      let readAs: string | undefined
      try {
        const which = recipientKey ?? senderKey
        const res = recipientKey ? await m.getRecipientCiphertext(id) : await m.getSenderCiphertext(id)
        chunks = Array.from(res[0] as ArrayLike<unknown>, (x) => BigInt(x as bigint))
        if (which) {
          text = decryptString({ value: chunks }, which.aesKey)
          readAs = which.name
        }
      } catch {
        text = undefined
      }

      return { id, from, to, timestamp: Number(meta[2]), epoch: Number(meta[3]), chunks, text, readAs }
    }),
  )
  return out
}

/**
 * Reward state for the epoch the RFQ traffic actually landed in.
 *
 * Derived from the messages rather than from `currentEpoch - 1`: epochs are short and a demo
 * run drifts several of them past the RFQ round, so the naive "previous epoch" is empty and
 * misleading.
 */
export async function loadRewards(messages: RfqMessage[]): Promise<RewardsView> {
  const m = messaging()
  const [epochRaw, durRaw] = await Promise.all([m.currentEpoch(), m.epochDuration()])
  const live = Number(epochRaw)

  const epoch = messages.length > 0 ? Math.max(...messages.map((x) => x.epoch)) : Math.max(0, live - 1)
  const [pool, units] = await Promise.all([m.epochRewardPool(epoch), m.epochTotalUsageUnits(epoch)])
  return { epoch, epochDuration: Number(durRaw), pool: pool as bigint, usageUnits: units as bigint }
}
