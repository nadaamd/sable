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
      <div className="flex items-baseline justify-between border-b border-[var(--line)] px-3 py-2">
        <span className="panel-label">Price grid</span>
        <span className="text-[12px] text-[var(--dim)]">
          {ticks.length} ticks · {ticks[0]}–{ticks[ticks.length - 1]}
        </span>
      </div>

      <div className="flex flex-wrap gap-1 px-3 py-3">
        {ticks.map((t) => {
          const isClearing = batch.cleared && t === batch.clearingPrice
          return (
            <span
              key={t}
              className="px-2 py-1 text-[12px]"
              style={{
                border: `1px solid ${isClearing ? "var(--accent)" : "var(--line)"}`,
                color: isClearing ? "var(--accent)" : "var(--dim)",
                background: isClearing ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                fontVariantNumeric: "tabular-nums",
              }}
              title={isClearing ? "the clearing tick" : undefined}
            >
              {t}
            </span>
          )
        })}
      </div>

      <div className="border-t border-[var(--line)] px-3 py-2 text-[12px] leading-relaxed text-[var(--dim)]">
        Clearing is permissionless: once the window closes anyone may trigger it, so no operator
        can stall a batch — and none can see inside one either. The price maximises matched volume
        over this grid, computed entirely on encrypted orders.
      </div>
    </div>
  )
}
