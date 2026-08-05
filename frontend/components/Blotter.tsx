"use client"

import { useEffect, useRef, useState } from "react"
import type { BatchView, OrderRow } from "@/lib/chain"
import { EXPLORER } from "@/lib/deployment"

/** Short ciphertext fingerprint — proof there is real data there, and that it is opaque. */
function fingerprint(ct: bigint): string {
  const hex = ct.toString(16).padStart(64, "0")
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`
}

/**
 * A sealed field, drawn as blocks whose count varies with the ciphertext.
 *
 * Fixed-width blocks made the book a perfect grid, which read as a loading placeholder rather
 * than as data. The width is derived from the CIPHERTEXT, which is public — it reveals nothing
 * about the plaintext, and it makes the wall look like what it is.
 */
function Sealed({ ct, base = 5 }: { ct: bigint; base?: number }) {
  const width = base + Number(ct % 3n)
  return (
    <span className="sealed" title={`ciphertext 0x${ct.toString(16)}`}>
      {"█".repeat(width)}
    </span>
  )
}

function Addr({ address }: { address: string }) {
  return (
    <a
      href={`${EXPLORER}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--dim)]"
    >
      {address.slice(0, 6)}…{address.slice(-4)}
    </a>
  )
}

function Row({ order, cleared, flash }: { order: OrderRow; cleared: boolean; flash: boolean }) {
  const p = order.plain

  return (
    <tr className={`${p ? "bg-[var(--panel-hi)]" : ""} ${flash ? "revealed" : ""}`}>
      <td className="text-[var(--dim)]">#{order.index}</td>
      <td>
        <Addr address={order.trader} />
        {order.deskName && <span className="ml-2 text-[var(--accent)]">{order.deskName}</span>}
      </td>

      <td>
        {p ? (
          <span style={{ color: p.isBuy ? "var(--buy)" : "var(--sell)" }}>{p.isBuy ? "BUY" : "SELL"}</span>
        ) : (
          <Sealed ct={order.ct.isBuy} base={4} />
        )}
      </td>
      <td className="text-right">{p ? p.limit : <Sealed ct={order.ct.limit} />}</td>
      <td className="text-right">{p ? p.size : <Sealed ct={order.ct.size} />}</td>

      <td className="text-right">
        {!cleared ? (
          <span className="text-[var(--dim)]">—</span>
        ) : p ? (
          <span className={p.fill > 0 ? "text-[var(--ink)]" : "text-[var(--dim)]"}>{p.fill}</span>
        ) : (
          <Sealed ct={order.ct.fill} base={4} />
        )}
      </td>

      {/* First to go on a narrow screen: it is corroboration, not information. */}
      <td className="hidden text-[13px] text-[var(--dim)] md:table-cell">{fingerprint(order.ct.limit)}</td>
      <td className="text-[var(--dim)]">{order.claimed ? "settled" : cleared ? "unsettled" : ""}</td>
    </tr>
  )
}

/**
 * Marks rows that just became readable.
 *
 * Unlocking a desk swapped ciphertext for numbers between two frames, so the single most
 * important event in the product — a field going from unreadable to readable — was invisible
 * unless you already knew which row to watch. This flashes exactly the rows that changed.
 */
function useJustRevealed(orders: OrderRow[]): Set<number> {
  const seen = useRef<Set<number>>(new Set())
  const [flashing, setFlashing] = useState<Set<number>>(new Set())

  useEffect(() => {
    const readable = new Set(orders.filter((o) => o.plain).map((o) => o.index))
    const fresh = [...readable].filter((i) => !seen.current.has(i))
    seen.current = readable
    if (fresh.length === 0) return

    setFlashing(new Set(fresh))
    const id = setTimeout(() => setFlashing(new Set()), 900)
    return () => clearTimeout(id)
  }, [orders])

  return flashing
}

export function Blotter({ batch }: { batch: BatchView }) {
  const flashing = useJustRevealed(batch.orders)
  const readable = batch.orders.filter((o) => o.plain).length
  const total = batch.orders.length

  return (
    <div className="panel">
      <div className="panel-head flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
        <div>
          <span className="panel-label">Order book</span>
          <span className="ml-3">batch {batch.id}</span>
        </div>
        {total > 0 && (
          <div className="text-[13px] opacity-80">
            <span className={readable > 0 ? "text-[var(--accent)] opacity-100" : undefined}>
              {readable} of {total}
            </span>{" "}
            readable with the keys you hold
          </div>
        )}
      </div>

      {total === 0 ? (
        <div className="px-3 py-8 text-center text-[var(--dim)]">
          No orders in this batch yet. Run the desks and they appear here, sealed.
        </div>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th />
                <th>Trader</th>
                <th>Side</th>
                <th className="text-right">Limit</th>
                <th className="text-right">Size</th>
                <th className="text-right">Fill</th>
                <th className="hidden md:table-cell">Ciphertext</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {batch.orders.map((o) => (
                <Row key={o.index} order={o} cleared={batch.cleared} flash={flashing.has(o.index)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-[var(--line)] px-3 py-2">
        <p className="prose">
          Every row here comes from a public <code>view</code> call, so anyone can fetch this
          table. Side, limit and size are ciphertexts encrypted under each desk&apos;s own key, so
          they render as █ unless you hold that key. The interface is not withholding them; they
          are unreadable on chain.
        </p>
      </div>
    </div>
  )
}
