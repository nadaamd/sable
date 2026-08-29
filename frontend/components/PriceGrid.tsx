"use client"

import type { BatchView } from "@/lib/chain"

/**
 * The public price grid, with the clearing tick marked.
 *
 * The grid being public is a deliberate disclosure, not a leak: it bounds clearing cost to
 * O(orders x levels), and a tick's presence says nothing about whether any order sits at it.
 *
 * This panel used to also carry the clearing price and matched volume as large figures. Those
 * are the page's headline and now live in the header — leaving this to do one job.
 */
export function PriceGrid({ batch, ticks }: { batch: BatchView; ticks: number[] }) {
  return (
    <div className="panel">
      <div className="panel-head flex items-baseline justify-between px-3 py-2">
        <span className="panel-label">Price grid</span>
        <span className="text-[13px] opacity-80">
          {ticks.length} ticks, <span className="mono">{ticks[0]}</span> to{" "}
          <span className="mono">{ticks[ticks.length - 1]}</span>
        </span>
      </div>

      <div className="flex flex-wrap gap-1 px-3 py-3">
        {ticks.map((t) => {
          const isClearing = batch.cleared && t === batch.clearingPrice
          return (
            <span
              key={t}
              className="mono px-2 py-1 text-[12px]"
              style={{
                border: `1px solid ${isClearing ? "var(--accent)" : "var(--line)"}`,
                color: isClearing ? "var(--accent)" : "var(--dim)",
                background: isClearing ? "color-mix(in srgb, var(--accent) 60%, transparent)" : "transparent",
                fontVariantNumeric: "tabular-nums",
              }}
              title={isClearing ? "the clearing tick" : undefined}
            >
              {t}
            </span>
          )
        })}
      </div>

      <div className="border-t border-[var(--line)] px-3 py-2">
        <p className="prose">
          Clearing is permissionless: once the window closes, any address may trigger it.
        </p>
      </div>
    </div>
  )
}
