"use client"

import type { BatchView } from "@/lib/chain"
import {
  CROSS_ADDRESS,
  EXPLAINER_URL,
  EXPLORER,
  MESSAGING_ADDRESS,
  REPO_URL,
} from "@/lib/deployment"

const PHASE_LABEL: Record<BatchView["phase"], string> = {
  idle: "awaiting first order",
  commit: "commit window open",
  "awaiting-clear": "window closed",
  cleared: "cleared",
}

function countdown(seconds: number): string {
  if (seconds <= 0) return "00:00"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

/**
 * The mark: three sealed fields and one cleared. Same glyph as the favicon, so a tab and the
 * page identify each other.
 */
function Mark() {
  return (
    <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect x="4" y="5" width="15" height="4.5" rx="1" fill="var(--seal)" />
      <rect x="4" y="13.75" width="21" height="4.5" rx="1" fill="var(--seal)" />
      <rect x="4" y="22.5" width="10" height="4.5" rx="1" fill="var(--seal)" />
      <rect x="16" y="22.5" width="8" height="4.5" rx="1" fill="var(--accent)" />
    </svg>
  )
}

function Contract({ label, address }: { label: string; address: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-[var(--dim)]">{label} </span>
      <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">
        {address.slice(0, 8)}…
      </a>
    </span>
  )
}

/**
 * A headline number.
 *
 * `note` says whether the value is public or sealed, on every tile. The page's entire claim is
 * about which is which, so stating it beside each number costs one line and removes the need
 * to infer it.
 */
function Stat({
  label,
  value,
  note,
  color = "var(--ink)",
  small,
}: {
  label: string
  value: string
  note: string
  color?: string
  small?: boolean
}) {
  return (
    <div className="bg-[var(--panel)] px-4 py-4">
      <div className="panel-label">{label}</div>
      <div
        // 1.6x apart, not 2.2x: the headline pair must dominate without the row looking broken.
        className={small ? "mt-1.5 text-[28px] sm:text-[32px]" : "mt-1.5 text-[44px] sm:text-[52px]"}
        style={{ color, fontVariantNumeric: "tabular-nums", lineHeight: 1.05 }}
      >
        {value}
      </div>
      <div className="mt-2 text-[11px] text-[var(--dim)]">{note}</div>
    </div>
  )
}

/**
 * Identity bar, the claim, and the headline numbers.
 *
 * The clearing price and the matched volume are the only two values this market ever makes
 * public — which is the whole point — and they used to sit in a side panel below the fold.
 * They are the page's headline, so they are in its header.
 *
 * Returns a fragment so the bar is a direct child of the page's flex column, which is what
 * lets it stick over the whole document rather than its own parent.
 */
export function Header({
  batch,
  maxOrders,
  nowSec,
  blockNumber,
}: {
  batch?: BatchView
  maxOrders?: number
  nowSec: number
  blockNumber?: number
}) {
  const cleared = batch?.cleared ?? false
  const remaining = batch ? batch.commitDeadline - nowSec : 0

  return (
    <>
      <div
        className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-[var(--line)] py-4"
        style={{
          background: "color-mix(in srgb, var(--bg) 90%, transparent)",
          backdropFilter: "blur(8px)",
          minHeight: "var(--header-h)",
        }}
      >
        <div className="flex items-center gap-3.5">
          <Mark />
          <h1 className="text-[34px] leading-none tracking-[0.3em] sm:text-[40px]">SABLE</h1>
          <span className="ml-1 hidden border-l border-[var(--line)] pl-4 text-[13px] text-[var(--dim)] md:inline">
            the confidential cross
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          <span className="hidden items-center gap-1.5 md:flex">
            <Contract label="cross" address={CROSS_ADDRESS} />
            <span className="text-[var(--line-hi)]">·</span>
            <Contract label="rfq" address={MESSAGING_ADDRESS} />
          </span>

          <span className="flex items-center gap-1.5 whitespace-nowrap text-[var(--dim)]">
            <span
              className={blockNumber ? "live-dot" : undefined}
              style={{ color: blockNumber ? "var(--buy)" : "var(--seal)" }}
              aria-hidden
            >
              ●
            </span>
            COTI testnet
            <span className="text-[var(--line-hi)]">·</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{blockNumber ?? "…"}</span>
          </span>

          <span className="flex items-center gap-3 whitespace-nowrap">
            <a href={EXPLAINER_URL} target="_blank" rel="noreferrer">
              how it works ↗
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              code ↗
            </a>
          </span>
        </div>
      </div>

      <p className="max-w-3xl text-[15px] leading-relaxed">
        A sealed-bid, uniform-price batch auction whose matching engine runs on encrypted orders.{" "}
        <span className="text-[var(--dim)]">
          The market publishes a price. No participant reveals their hand.
        </span>
      </p>

      <div className="panel grid grid-cols-2 gap-px bg-[var(--line)] md:grid-cols-4">
        <Stat
          label="Clearing price"
          value={!batch ? "—" : cleared ? (batch.clearingPrice === 0 ? "no cross" : String(batch.clearingPrice)) : "—"}
          note="public"
          color={cleared ? "var(--accent)" : "var(--seal)"}
        />
        <Stat
          label="Matched volume"
          value={!batch ? "—" : cleared ? String(batch.matchedVolume) : "—"}
          note="public"
          color={cleared ? "var(--ink)" : "var(--seal)"}
        />
        <Stat
          label="Batch"
          value={batch ? `#${batch.id}` : "—"}
          note={
            batch
              ? batch.phase === "commit"
                ? `${PHASE_LABEL[batch.phase]} · ${countdown(remaining)}`
                : PHASE_LABEL[batch.phase]
              : "reading chain…"
          }
          color={cleared ? "var(--buy)" : "var(--accent)"}
          small
        />
        <Stat
          label="Orders"
          value={batch && maxOrders ? `${batch.orderCount} / ${maxOrders}` : "—"}
          note="side, limit, size — all sealed"
          small
        />
      </div>
    </>
  )
}
