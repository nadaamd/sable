"use client"

import type { BatchView, OrderRow } from "@/lib/chain"
import { EXPLORER } from "@/lib/deployment"

/** Short ciphertext fingerprint — proof there is real data there, and that it is opaque. */
function fingerprint(ct: bigint): string {
  const hex = ct.toString(16).padStart(64, "0")
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`
}

function Sealed({ ct, width = 6 }: { ct: bigint; width?: number }) {
  return (
    <span className="sealed" title={`ciphertext 0x${ct.toString(16)}`}>
      {"█".repeat(width)}
    </span>
  )
}

function Addr({ address }: { address: string }) {
  return (
    <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer" className="text-[var(--dim)]">
      {address.slice(0, 6)}…{address.slice(-4)}
    </a>
  )
}

function Row({ order, cleared }: { order: OrderRow; cleared: boolean }) {
  const p = order.plain
  const mine = Boolean(p)

  return (
    <tr className={mine ? "bg-[#12151a]" : undefined}>
      <td className="text-[var(--dim)]">#{order.index}</td>
      <td>
        <Addr address={order.trader} />
        {order.deskName && <span className="ml-2 text-[var(--accent)]">{order.deskName}</span>}
      </td>

      <td>
        {p ? (
          <span style={{ color: p.isBuy ? "var(--buy)" : "var(--sell)" }}>{p.isBuy ? "BUY" : "SELL"}</span>
        ) : (
          <Sealed ct={order.ct.isBuy} width={4} />
        )}
      </td>
      <td className="text-right">{p ? p.limit : <Sealed ct={order.ct.limit} width={5} />}</td>
      <td className="text-right">{p ? p.size : <Sealed ct={order.ct.size} width={5} />}</td>

      <td className="text-right">
        {!cleared ? (
          <span className="text-[var(--dim)]">—</span>
        ) : p ? (
          <span className={p.fill > 0 ? "text-[var(--ink)]" : "text-[var(--dim)]"}>{p.fill}</span>
        ) : (
          <Sealed ct={order.ct.fill} width={4} />
        )}
      </td>

      <td className="text-[var(--dim)] text-[11px]">{fingerprint(order.ct.limit)}</td>
      <td className="text-[var(--dim)]">{order.claimed ? "settled" : cleared ? "unsettled" : ""}</td>
    </tr>
  )
}

export function Blotter({ batch }: { batch: BatchView }) {
  const readable = batch.orders.filter((o) => o.plain).length

  return (
    <div className="panel">
      <div className="flex items-baseline justify-between border-b border-[var(--line)] px-3 py-2">
        <div>
          <span className="text-[var(--dim)] text-[10px] uppercase tracking-widest">Order book</span>
          <span className="ml-3">batch {batch.id}</span>
        </div>
        <div className="text-[var(--dim)] text-[11px]">
          {batch.orders.length} order{batch.orders.length === 1 ? "" : "s"} · {readable} readable by keys you hold
        </div>
      </div>

      {batch.orders.length === 0 ? (
        <div className="px-3 py-8 text-center text-[var(--dim)]">
          No orders in this batch yet. Run the desks and they appear here — sealed.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th />
              <th>Trader</th>
              <th>Side</th>
              <th className="text-right">Limit</th>
              <th className="text-right">Size</th>
              <th className="text-right">Fill</th>
              <th>Ciphertext</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {batch.orders.map((o) => (
              <Row key={o.index} order={o} cleared={batch.cleared} />
            ))}
          </tbody>
        </table>
      )}

      <div className="border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--dim)]">
        Every row is a public `view` call — anyone can read this table. Side, limit and size are
        ciphertexts under their own desk&apos;s key, so they stay █ unless you hold that key.
        Nothing here is hidden by this interface; it is unreadable on chain.
      </div>
    </div>
  )
}
