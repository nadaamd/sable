"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Blotter } from "@/components/Blotter"
import { CrossPanel } from "@/components/CrossPanel"
import { DeskKeys } from "@/components/DeskKeys"
import { RfqFeed } from "@/components/RfqFeed"
import { loadMarket, loadRewards, loadRfq, type MarketView, type RewardsView, type RfqMessage } from "@/lib/chain"
import { CROSS_ADDRESS, EXPLORER, MESSAGING_ADDRESS, envDesks, type DeskKey } from "@/lib/deployment"

const STORAGE = "sable.deskKeys"
const POLL_MS = 8000

export default function Page() {
  /** Desk identities we know about. */
  const [keys, setKeys] = useState<DeskKey[]>([])
  /** Which of them are unlocked. Empty by default — the terminal opens fully sealed. */
  const [active, setActive] = useState<string[]>([])
  const [market, setMarket] = useState<MarketView | null>(null)
  const [rfq, setRfq] = useState<RfqMessage[]>([])
  const [rewards, setRewards] = useState<RewardsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  const [viewBatch, setViewBatch] = useState<number | undefined>(undefined)

  // Demo desks come from .env.local; anything pasted in the UI is layered on top.
  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE) : null
    const saved: DeskKey[] = stored ? JSON.parse(stored) : []
    const merged = [...envDesks(), ...saved].filter(
      (k, i, all) => all.findIndex((o) => o.address.toLowerCase() === k.address.toLowerCase()) === i,
    )
    setKeys(merged)
  }, [])

  /** Only unlocked desks are used for decryption; the rest of the book stays sealed. */
  const unlocked = useMemo(
    () => keys.filter((k) => active.some((a) => a.toLowerCase() === k.address.toLowerCase())),
    [keys, active],
  )

  const refresh = useCallback(async () => {
    try {
      // The RFQ feed is enumerated from every known desk, so the message list is complete
      // regardless of what is unlocked — only the decryption depends on held keys.
      const [m, f] = await Promise.all([loadMarket(keys, unlocked, viewBatch), loadRfq(keys, unlocked)])
      setMarket(m)
      setRfq(f)
      setRewards(await loadRewards(f))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [keys, unlocked, viewBatch])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  // Local ticker so the commit countdown moves between polls.
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  const addKey = (k: DeskKey) => {
    setKeys((prev) => {
      const next = [...prev.filter((p) => p.address.toLowerCase() !== k.address.toLowerCase()), k]
      // Only pasted keys are persisted; env-provided demo desks come back on their own.
      const fromEnv = new Set(envDesks().map((d) => d.address.toLowerCase()))
      window.localStorage.setItem(
        STORAGE,
        JSON.stringify(next.filter((n) => !fromEnv.has(n.address.toLowerCase()))),
      )
      return next
    })
    setActive((prev) => [...prev, k.address])
  }

  const forgetPasted = () => {
    window.localStorage.removeItem(STORAGE)
    const env = envDesks()
    setKeys(env)
    setActive((prev) => prev.filter((a) => env.some((e) => e.address.toLowerCase() === a.toLowerCase())))
  }

  const toggle = (address: string) =>
    setActive((prev) =>
      prev.some((a) => a.toLowerCase() === address.toLowerCase())
        ? prev.filter((a) => a.toLowerCase() !== address.toLowerCase())
        : [...prev, address],
    )

  const deskName = useMemo(
    () => (addr: string) => keys.find((k) => k.address.toLowerCase() === addr.toLowerCase())?.name ?? "",
    [keys],
  )

  const batches = market ? Array.from({ length: market.currentBatch + 1 }, (_, i) => i) : []

  return (
    <main className="mx-auto max-w-[1400px] p-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl tracking-wide">
            SABLE <span className="text-[var(--dim)]">/ the confidential cross</span>
          </h1>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[var(--dim)]">
            A sealed-bid, uniform-price batch auction whose matching engine runs on encrypted
            orders. The market publishes a price. No participant reveals their hand.
          </p>
        </div>
        <div className="text-right text-[11px] text-[var(--dim)]">
          <div>
            cross{" "}
            <a href={`${EXPLORER}/address/${CROSS_ADDRESS}`} target="_blank" rel="noreferrer">
              {CROSS_ADDRESS.slice(0, 10)}…
            </a>
          </div>
          <div>
            rfq{" "}
            <a href={`${EXPLORER}/address/${MESSAGING_ADDRESS}`} target="_blank" rel="noreferrer">
              {MESSAGING_ADDRESS.slice(0, 10)}…
            </a>
          </div>
          <div>COTI testnet · block {market?.blockNumber ?? "…"}</div>
        </div>
      </header>

      {error && (
        <div className="panel mb-4 px-3 py-2 text-[11px]" style={{ borderColor: "var(--sell)" }}>
          <span style={{ color: "var(--sell)" }}>chain read failed:</span> {error}
        </div>
      )}

      {market && batches.length > 1 && (
        <div className="mb-4 flex items-center gap-2 text-[11px]">
          <span className="text-[var(--dim)]">batch</span>
          {batches.map((b) => (
            <button
              key={b}
              onClick={() => setViewBatch(b === market.currentBatch ? undefined : b)}
              style={{
                borderColor: b === market.batch.id ? "var(--accent)" : "var(--line)",
                color: b === market.batch.id ? "var(--accent)" : "var(--dim)",
              }}
            >
              {b}
              {b === market.currentBatch ? " (live)" : ""}
            </button>
          ))}
        </div>
      )}

      {!market ? (
        <div className="panel px-3 py-10 text-center text-[var(--dim)]">reading chain…</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="flex flex-col gap-4">
            <Blotter batch={market.batch} />
            <RfqFeed messages={rfq} deskName={deskName} />
          </div>

          <div className="flex flex-col gap-4">
            <CrossPanel batch={market.batch} ticks={market.ticks} nowSec={nowSec} />
            <DeskKeys keys={keys} active={active} onToggle={toggle} onAdd={addKey} onForget={forgetPasted} />

            <div className="panel">
              <div className="border-b border-[var(--line)] px-3 py-2 text-[10px] uppercase tracking-widest text-[var(--dim)]">
                Market
              </div>
              <div className="px-3 py-2 text-[11px]">
                <Line
                  k="ticks"
                  v={`${market.ticks.length} (${market.ticks[0]}–${market.ticks[market.ticks.length - 1]})`}
                />
                <Line k="commit window" v={`${market.commitWindow}s`} />
                <Line k="max orders / batch" v={String(market.maxOrders)} />
                <Line k="orders in batch" v={`${market.batch.orderCount} / ${market.maxOrders}`} />
                {rewards && (
                  <>
                    <Line k="rfq epoch settled" v={String(rewards.epoch)} />
                    <Line
                      k="reward pool"
                      v={`${(Number(rewards.pool) / 1e18).toFixed(4)} COTI · ${rewards.usageUnits} cells`}
                    />
                  </>
                )}
              </div>
              <div className="border-t border-[var(--line)] px-3 py-2 text-[11px] leading-relaxed text-[var(--dim)]">
                What is public: that an address submitted an order and when, the clearing price,
                and the matched volume. What is never public: side, limit, size, each desk&apos;s
                fill, and everything about orders that did not cross.
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-[3px]">
      <span className="text-[var(--dim)]">{k}</span>
      <span>{v}</span>
    </div>
  )
}
