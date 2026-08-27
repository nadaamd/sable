"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Blotter } from "@/components/Blotter"
import { Header } from "@/components/Header"
import { PriceGrid } from "@/components/PriceGrid"
import { Section } from "@/components/Section"
import { DeskKeys } from "@/components/DeskKeys"
import { RfqFeed } from "@/components/RfqFeed"
import { loadMarket, loadRewards, loadRfq, type MarketView, type RewardsView, type RfqMessage } from "@/lib/chain"
import { EXPLAINER_URL, envDesks, type DeskKey } from "@/lib/deployment"

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
  /** When the last successful read landed, so the header can say how fresh the page is. */
  const [readAt, setReadAt] = useState<number | null>(null)

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
      setReadAt(Math.floor(Date.now() / 1000))
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

  const batchPicker =
    market && batches.length > 1 ? (
      <div className="scroll-x flex items-center gap-1.5 text-[13px]">
        {batches.map((b) => (
          <button
            key={b}
            onClick={() => setViewBatch(b === market.currentBatch ? undefined : b)}
            className="mono shrink-0 !px-2 !py-1"
            style={{
              borderColor: b === market.batch.id ? "var(--accent)" : "var(--line)",
              color: b === market.batch.id ? "var(--accent)" : "var(--dim)",
            }}
          >
            {b}
            {b === market.currentBatch ? " live" : ""}
          </button>
        ))}
      </div>
    ) : null

  // gap-4 here, and Sections add their own top margin. `Header` must stay a DIRECT child of
  // <main>: its sticky bar is only sticky across its parent's box, so wrapping it in a div
  // would pin it to that div and let it scroll away with the hero.
  return (
    <main className="mx-auto flex max-w-[1400px] flex-col gap-4 p-3 pb-10 sm:p-4">
      <Header
        batch={market?.batch}
        maxOrders={market?.maxOrders}
        nowSec={nowSec}
        blockNumber={market?.blockNumber}
        staleFor={readAt === null ? null : nowSec - readAt}
      />

      {error && (
        <div className="panel px-3 py-2 text-[13px]" style={{ borderColor: "var(--sell)" }}>
          <span style={{ color: "var(--sell)" }}>chain read failed:</span> {error}
        </div>
      )}


      {/*
        Sections follow the market's own order: what stayed sealed, how the desks negotiated
        before committing, and the rules they all played under. The control that acts on the
        book sits inside the book's own band, not in a distant column.
      */}
      <Section label="The sealed book" aside={batchPicker}>
        <DeskKeys keys={keys} active={active} onToggle={toggle} onAdd={addKey} onForget={forgetPasted} />
        {market ? <Blotter batch={market.batch} /> : <BookSkeleton />}
      </Section>

      <Section label="Pre-trade negotiation">
        <RfqFeed messages={rfq} deskName={deskName} />
      </Section>

      {market && (
        <Section label="Market rules">
          <div className="grid gap-4 lg:grid-cols-2">
            <PriceGrid batch={market.batch} ticks={market.ticks} />

            <div className="panel flex flex-col">
              <div className="panel-head px-3 py-2">
                <span className="panel-label">Parameters &amp; disclosure</span>
              </div>
              <div className="px-3 py-2 text-[13px]">
                <Line k="commit window" v={`${market.commitWindow}s`} />
                <Line k="max orders / batch" v={String(market.maxOrders)} />
                <Line k="orders in this batch" v={`${market.batch.orderCount} / ${market.maxOrders}`} />
                {rewards && (
                  <>
                    <Line k="rfq epoch settled" v={String(rewards.epoch)} />
                    <Line
                      k="messaging rewards"
                      v={`${(Number(rewards.pool) / 1e18).toFixed(4)} COTI · ${rewards.usageUnits} cells`}
                    />
                  </>
                )}
              </div>

            </div>
          </div>
        </Section>
      )}

      <footer className="border-t border-[var(--line)] pt-3">
        <p className="prose">
          Read-only. No wallet needed. Testnet only.{" "}
          <a href={EXPLAINER_URL} target="_blank" rel="noreferrer">
            How it works
          </a>
        </p>
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
function BookSkeleton() {
  return (
    <div className="panel">
      <div className="panel-head flex items-baseline justify-between px-3 py-2">
        <span className="panel-label">Order book</span>
        <span className="text-[13px] opacity-80">reading chain…</span>
      </div>
      <div className="flex flex-col">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-6 border-b border-[var(--line)] px-3 py-2 last:border-0"
          >
            <span className="text-[var(--dim)]">#{i}</span>
            <span className="sealed">{"█".repeat(11)}</span>
            <span className="sealed">{"█".repeat(4)}</span>
            <span className="sealed ml-auto">{"█".repeat(5 + (i % 3))}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 py-[3px]">
      <span className="text-[var(--dim)]">{k}</span>
      <span className="mono text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
        {v}
      </span>
    </div>
  )
}
