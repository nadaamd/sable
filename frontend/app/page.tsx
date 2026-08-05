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

  /**
   * Demo desks come from .env.local; anything pasted in the UI is layered on top.
   *
   * This reads localStorage, which does not exist during SSR, so it cannot move into a
   * `useState` initialiser without either crashing on the server or rendering a different
   * desk list there than on the client — a hydration mismatch. Reading an external store on
   * mount is what the effect is for; `set-state-in-effect` flags the shape, not a defect.
   */
  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE) : null
    const saved: DeskKey[] = stored ? JSON.parse(stored) : []
    const merged = [...envDesks(), ...saved].filter(
      (k, i, all) => all.findIndex((o) => o.address.toLowerCase() === k.address.toLowerCase()) === i,
    )
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is unavailable during SSR
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

  /**
   * Subscribe to the chain: one read immediately, then every POLL_MS.
   *
   * `refresh` is async and every setState in it happens after an await, so no state is set
   * synchronously in this effect body — the rule matches on the call, not the timing.
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh() only sets state after awaiting
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
    <main className="mx-auto flex max-w-[1400px] flex-col gap-4 p-3 sm:p-4">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-xl tracking-wide">
            SABLE <span className="text-[var(--dim)]">/ the confidential cross</span>
          </h1>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[var(--dim)]">
            A sealed-bid, uniform-price batch auction whose matching engine runs on encrypted
            orders. The market publishes a price. No participant reveals their hand.
          </p>
        </div>
        <div className="text-[12px] text-[var(--dim)] sm:text-right">
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
          <div className="flex items-center gap-1.5 sm:justify-end">
            <span
              className={market ? "live-dot" : undefined}
              style={{ color: market ? "var(--buy)" : "var(--seal)" }}
              aria-hidden
            >
              ●
            </span>
            COTI testnet · block {market?.blockNumber ?? "…"}
          </div>
        </div>
      </header>

      {error && (
        <div className="panel px-3 py-2 text-[12px]" style={{ borderColor: "var(--sell)" }}>
          <span style={{ color: "var(--sell)" }}>chain read failed:</span> {error}
        </div>
      )}

      {/*
        The primary control, above the book it acts on. It also carries the "this is sealed, not
        broken" line, so there is one explanation in one place rather than two boxes competing.
      */}
      <DeskKeys keys={keys} active={active} onToggle={toggle} onAdd={addKey} onForget={forgetPasted} />

      {market && batches.length > 1 && (
        <div className="scroll-x flex items-center gap-2 text-[12px]">
          <span className="shrink-0 text-[var(--dim)]">batch</span>
          {batches.map((b) => (
            <button
              key={b}
              onClick={() => setViewBatch(b === market.currentBatch ? undefined : b)}
              className="shrink-0"
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
        <Skeleton />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          {/*
            The cross leads on mobile — two public numbers beat a table you have to scroll — and
            stays in view on desktop, where the book can run to 32 rows.
          */}
          <div className="lg:order-2 lg:sticky lg:top-4 lg:self-start">
            <CrossPanel batch={market.batch} ticks={market.ticks} nowSec={nowSec} />
          </div>

          <div className="flex flex-col gap-4 lg:order-1">
            <Blotter batch={market.batch} />
            <RfqFeed messages={rfq} deskName={deskName} />

            <div className="panel">
              <div className="border-b border-[var(--line)] px-3 py-2">
                <span className="panel-label">Market</span>
              </div>
              <div className="px-3 py-2 text-[12px]">
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
              <div className="border-t border-[var(--line)] px-3 py-2 text-[12px] leading-relaxed text-[var(--dim)]">
                What is public: that an address submitted an order and when, the clearing price,
                and the matched volume. What is never public: side, limit, size, each desk&apos;s
                fill, and everything about orders that did not cross.
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="pb-2 text-[12px] leading-relaxed text-[var(--dim)]">
        Read-only. No wallet, no signature, no permission needed to fetch this entire book — that
        is the point. Testnet only.
      </footer>
    </main>
  )
}

/**
 * First paint, before the chain answers.
 *
 * A centred "reading chain…" left a dead frame on the most important impression the page makes,
 * and on camera. The skeleton is sealed rows — the shape the real book will take — so the first
 * thing a visitor sees is already the point being made.
 */
function Skeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="panel lg:order-1">
        <div className="flex items-baseline justify-between border-b border-[var(--line)] px-3 py-2">
          <span className="panel-label">Order book</span>
          <span className="text-[12px] text-[var(--dim)]">reading chain…</span>
        </div>
        <div className="flex flex-col">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-6 border-b border-[var(--line)] px-3 py-2 last:border-0">
              <span className="text-[var(--dim)]">#{i}</span>
              <span className="sealed">{"█".repeat(11)}</span>
              <span className="sealed">{"█".repeat(4)}</span>
              <span className="sealed ml-auto">{"█".repeat(5 + (i % 3))}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel px-3 py-6 lg:order-2">
        <span className="panel-label">The cross</span>
        <div className="mt-3 text-4xl text-[var(--seal)]">██ · ██</div>
      </div>
    </div>
  )
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 py-[3px]">
      <span className="text-[var(--dim)]">{k}</span>
      <span className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
        {v}
      </span>
    </div>
  )
}
