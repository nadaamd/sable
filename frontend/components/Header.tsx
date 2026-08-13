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
  "awaiting-clear": "window closed, clearing due",
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
      <span className="opacity-70">{label} </span>
      <a className="mono" href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">
        {address.slice(0, 8)}…
      </a>
    </span>
  )
}

/** A labelled value. Used for facts, not as a marketing metric tile. */
function Field({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-[var(--dim)]">{label}</span>
      <span className="mono text-[15px]" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
        {note ? <span className="sans ml-2 text-[13px] text-[var(--dim)]">{note}</span> : null}
      </span>
    </div>
  )
}

/**
 * Identity bar, the claim, and the batch readout.
 *
 * The clearing price and the matched volume are the only two values this market ever makes
 * public, so they belong at the top of the page rather than in a side panel.
 *
 * They are deliberately not presented as a row of four equal metric tiles with a caption on
 * each. Two figures are the result; batch state and order count are context, and sit at the
 * scale of context. The disclosure note is stated once for the whole readout instead of
 * repeating the word "public" under each number.
 *
 * Returns a fragment so the bar is a direct child of the page's flex column, which is what
 * lets it stick over the whole document rather than over its own parent.
 */
export function Header({
  batch,
  maxOrders,
  nowSec,
  blockNumber,
  staleFor,
}: {
  batch?: BatchView
  maxOrders?: number
  nowSec: number
  blockNumber?: number
  /** Seconds since the last successful read, or null before the first one lands. */
  staleFor?: number | null
}) {
  const cleared = batch?.cleared ?? false
  const remaining = batch ? batch.commitDeadline - nowSec : 0
  const priceText = !batch || !cleared ? "—" : batch.clearingPrice === 0 ? "no cross" : String(batch.clearingPrice)
  const volumeText = !batch || !cleared ? "—" : String(batch.matchedVolume)

  return (
    <>
      <div
        // Chrome, and solid: a blurred glass bar is decoration, and content sliding under a
        // half-transparent header is harder to read than content that is simply covered.
        className="panel-head sticky top-0 z-20 -mx-3 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-3 py-4 sm:-mx-4 sm:px-4"
        style={{ minHeight: "var(--header-h)" }}
      >
        <div className="flex items-center gap-3.5">
          <Mark />
          <h1 className="mono text-[34px] leading-none tracking-[0.3em] sm:text-[40px]">SABLE</h1>
          <span className="ml-1 hidden border-l border-[var(--accent-deep)] pl-4 text-[13px] text-[var(--accent)] md:inline">
            the confidential cross
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span className="hidden items-center gap-1.5 md:flex">
            <Contract label="cross" address={CROSS_ADDRESS} />
            <span className="opacity-70">·</span>
            <Contract label="rfq" address={MESSAGING_ADDRESS} />
          </span>

          <span className="flex items-center gap-1.5 whitespace-nowrap opacity-70">
            <span style={{ color: blockNumber ? "var(--accent)" : "var(--seal)" }} aria-hidden>
              ●
            </span>
            COTI testnet
            <span className="opacity-70">·</span>
            <span className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>{blockNumber ?? "…"}</span>
            {/* The page polls. Saying so beats a decorative pulse that implies a live stream. */}
            {typeof staleFor === "number" && (
              <span className="opacity-70">read {staleFor < 2 ? "just now" : `${staleFor}s ago`}</span>
            )}
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

      <p className="prose">
        A sealed-bid, uniform-price batch auction. Orders arrive as ciphertext and the matching
        engine computes a clearing price without decrypting any of them.
      </p>

      <div className="panel">
        <div className="flex flex-wrap items-end gap-x-12 gap-y-6 px-4 py-4">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
            <div className="flex flex-col gap-1.5">
              <span className="panel-label">Clearing price</span>
              <span
                className="mono text-[44px] leading-none sm:text-[52px]"
                style={{ color: cleared ? "var(--accent)" : "var(--seal)", fontVariantNumeric: "tabular-nums" }}
              >
                {priceText}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="panel-label">Matched volume</span>
              <span
                className="mono text-[44px] leading-none sm:text-[52px]"
                style={{ color: cleared ? "var(--ink)" : "var(--seal)", fontVariantNumeric: "tabular-nums" }}
              >
                {volumeText}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-10 gap-y-4 border-[var(--line)] sm:border-l sm:pl-10">
            <Field
              label="Batch"
              value={batch ? `#${batch.id}` : "—"}
              note={
                batch
                  ? batch.phase === "commit"
                    ? `${PHASE_LABEL[batch.phase]}, ${countdown(remaining)}`
                    : PHASE_LABEL[batch.phase]
                  : "reading chain"
              }
            />
            <Field
              label="Orders"
              value={batch && maxOrders ? `${batch.orderCount} of ${maxOrders}` : "—"}
            />
          </div>
        </div>

        <div className="border-t border-[var(--line)] px-4 py-2">
          <p className="prose">
            Those two figures are the only values this batch makes public. Side, limit, size and
            every individual fill stay encrypted on chain.
          </p>
        </div>
      </div>
    </>
  )
}
