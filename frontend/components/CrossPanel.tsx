"use client"

import type { BatchView } from "@/lib/chain"

const PHASE_LABEL: Record<BatchView["phase"], string> = {
  idle: "AWAITING FIRST ORDER",
  commit: "COMMIT WINDOW OPEN",
  "awaiting-clear": "WINDOW CLOSED — CLEARING DUE",
  cleared: "CLEARED",
}

function countdown(seconds: number): string {
  if (seconds <= 0) return "00:00"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

/**
 * The public result of the batch. Only two numbers ever become public — the clearing price
 * and the total matched volume — and they are the whole point: the market produces price
 * discovery without any participant revealing their hand.
 */
export function CrossPanel({ batch, ticks, nowSec }: { batch: BatchView; ticks: number[]; nowSec: number }) {
  const remaining = batch.commitDeadline - nowSec

  return (
    <div className="panel">
      <div className="flex items-baseline justify-between border-b border-[var(--line)] px-3 py-2">
        <span className="text-[var(--dim)] text-[10px] uppercase tracking-widest">The cross</span>
        <span
          className="text-[11px]"
          style={{ color: batch.phase === "cleared" ? "var(--buy)" : "var(--accent)" }}
        >
          {PHASE_LABEL[batch.phase]}
          {batch.phase === "commit" && ` · ${countdown(remaining)}`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-px bg-[var(--line)]">
        <div className="bg-[var(--panel)] px-3 py-4">
          <div className="text-[10px] uppercase tracking-widest text-[var(--dim)]">Clearing price</div>
          <div className="mt-1 text-3xl" style={{ color: batch.cleared ? "var(--accent)" : "var(--seal)" }}>
            {batch.cleared ? (batch.clearingPrice === 0 ? "no cross" : batch.clearingPrice) : "—"}
          </div>
        </div>
        <div className="bg-[var(--panel)] px-3 py-4">
          <div className="text-[10px] uppercase tracking-widest text-[var(--dim)]">Matched volume</div>
          <div className="mt-1 text-3xl" style={{ color: batch.cleared ? "var(--ink)" : "var(--seal)" }}>
            {batch.cleared ? batch.matchedVolume : "—"}
          </div>
        </div>
      </div>

      {/* The public price grid, with the clearing tick marked. */}
      <div className="border-t border-[var(--line)] px-3 py-3">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--dim)]">Price grid</div>
        <div className="flex flex-wrap gap-1">
          {ticks.map((t) => {
            const isClearing = batch.cleared && t === batch.clearingPrice
            return (
              <span
                key={t}
                className="px-2 py-1 text-[11px]"
                style={{
                  border: `1px solid ${isClearing ? "var(--accent)" : "var(--line)"}`,
                  color: isClearing ? "var(--accent)" : "var(--dim)",
                }}
              >
                {t}
              </span>
            )
          })}
        </div>
      </div>

      <div className="border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--dim)]">
        Clearing is permissionless: once the window closes anyone may trigger it, so no operator
        can stall a batch — and none can see inside one either. The price maximises matched
        volume over the grid, computed entirely on encrypted orders.
      </div>
    </div>
  )
}
