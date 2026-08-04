/**
 * A desk: an autonomous trading agent with a private mandate.
 *
 * The mandate never leaves this object. What the desk puts on chain is an end-to-end
 * encrypted indication of interest, then a sealed order, then a claim. Nothing it publishes
 * reveals its side, its price, or its size.
 */
import type { Wallet } from "@coti-io/coti-ethers"
import type { itUint } from "@coti-io/coti-ethers"
import { decide, decodeIoi, encodeIoi, escrowFor, type Mandate, type PlannedOrder, type Side } from "./strategy"

export type ReceivedIoi = { from: string; side: Side; size: number }

export class Desk {
  constructor(
    readonly mandate: Mandate,
    readonly wallet: Wallet,
    private readonly messaging: any,
    private readonly cross: any,
  ) {}

  get name(): string {
    return this.mandate.name
  }

  get address(): string {
    return this.wallet.address
  }

  // --------------------------------------------------------------- RFQ round

  /**
   * Tell each peer, in an encrypted message only that peer can read, how much interest this
   * desk has and on which side. Deliberately carries no price.
   */
  async broadcastIoi(peers: Desk[]): Promise<bigint> {
    const msg = encodeIoi(this.mandate.side, this.mandate.targetSize)
    const to = await this.messaging.getAddress()
    const selector = this.messaging.sendMessage.fragment.selector
    let gas = 0n

    for (const peer of peers) {
      if (peer.address === this.address) continue
      const encrypted = await this.wallet.encryptValue(msg, to, selector)
      const rcpt = await (
        await this.messaging.connect(this.wallet).sendMessage(peer.address, encrypted, { gasLimit: 12_000_000 })
      ).wait()
      gas += rcpt.gasUsed
    }
    return gas
  }

  /** Read and decrypt the inbox. Only this desk holds the key to these messages. */
  async readIois(): Promise<ReceivedIoi[]> {
    const count = Number(await this.messaging.inboxCount(this.address))
    if (count === 0) return []
    const ids: bigint[] = await this.messaging.getInboxPage(this.address, 0, count)

    const out: ReceivedIoi[] = []
    for (const id of ids) {
      // ctString decodes as a struct whose single member is an array of chunks. Access it
      // positionally and rebuild the shape the SDK expects.
      const raw = await this.messaging.getRecipientCiphertext(id)
      const ct = { value: Array.from(raw[0] as ArrayLike<unknown>, (x) => BigInt(x as bigint)) }
      const meta = await this.messaging.getMessageMetadata(id)

      let text: string
      try {
        text = String(await this.wallet.decryptValue(ct as any))
      } catch {
        continue // not addressed to us, or not a string we can read
      }
      const parsed = decodeIoi(text)
      if (parsed) out.push({ from: meta.from ?? meta[1], ...parsed })
    }
    return out
  }

  /** Total interest on the opposite side of this desk's own, learned from the RFQ. */
  opposingInterest(iois: ReceivedIoi[]): number {
    return iois.filter((i) => i.side !== this.mandate.side).reduce((s, i) => s + i.size, 0)
  }

  // ---------------------------------------------------------------- decisions

  plan(iois: ReceivedIoi[], ticks: number[]) {
    return decide(this.mandate, this.opposingInterest(iois), ticks)
  }

  // ------------------------------------------------------------- order submission

  /** Seal and submit one order. Escrow is pulled inside submitOrder. */
  async submitOrder(order: PlannedOrder): Promise<bigint> {
    const to = await this.cross.getAddress()
    const selector = this.cross.submitOrder.fragment.selector

    const isBuy = (await this.wallet.encryptValue(order.isBuy ? 1n : 0n, to, selector)) as itUint
    const limit = (await this.wallet.encryptValue(BigInt(order.limit), to, selector)) as itUint
    const size = (await this.wallet.encryptValue(BigInt(order.size), to, selector)) as itUint

    const rcpt = await (
      await this.cross.connect(this.wallet).submitOrder(isBuy, limit, size, { gasLimit: 12_000_000 })
    ).wait()
    return rcpt.gasUsed
  }

  async approveEscrow(base: any, quote: any, allowance: number): Promise<void> {
    const spender = await this.cross.getAddress()
    for (const token of [base, quote]) {
      await (
        await token.connect(this.wallet)["approve(address,uint256)"](spender, allowance, { gasLimit: 6_000_000 })
      ).wait()
    }
  }

  // -------------------------------------------------------------- post-clearing

  async orderIndices(batchId: number): Promise<number[]> {
    const idx: bigint[] = await this.cross.ordersOfTrader(batchId, this.address)
    return idx.map(Number)
  }

  /**
   * Decrypt this desk's own fill. Index 1, not `.fill`: ethers returns a Result that is
   * also an Array, so Array.prototype.fill shadows the named output.
   */
  async readFill(batchId: number, orderIndex: number): Promise<number> {
    const row = await this.cross.orderOf(batchId, orderIndex)
    return Number(await this.wallet.decryptValue(row[1]))
  }

  async claim(batchId: number): Promise<bigint> {
    const rcpt = await (await this.cross.connect(this.wallet).claim(batchId, { gasLimit: 30_000_000 })).wait()
    return rcpt.gasUsed
  }

  async balances(base: any, quote: any): Promise<{ base: bigint; quote: bigint }> {
    return {
      base: await this.readBalance(base),
      quote: await this.readBalance(quote),
    }
  }

  private async readBalance(token: any): Promise<bigint> {
    const ct = await token.connect(this.wallet)["balanceOf(address)"](this.address)
    return BigInt(await this.wallet.decryptValue256(ct))
  }

  /** Messaging rewards accrued for storing encrypted cells in a finished epoch. */
  async pendingRewards(epoch: number): Promise<bigint> {
    return await this.messaging.pendingRewards(epoch, this.address)
  }

  async claimRewards(epoch: number): Promise<bigint> {
    const rcpt = await (
      await this.messaging.connect(this.wallet).claimRewards(epoch, { gasLimit: 6_000_000 })
    ).wait()
    return rcpt.gasUsed
  }

  /** What this desk locks up for a given plan — used to show what the RFQ saved. */
  escrowFor(orders: PlannedOrder[]) {
    return escrowFor(orders)
  }
}
