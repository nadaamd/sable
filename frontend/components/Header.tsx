"use client"

import {
  CROSS_ADDRESS,
  EXPLAINER_URL,
  EXPLORER,
  MESSAGING_ADDRESS,
  REPO_URL,
} from "@/lib/deployment"

/**
 * The mark: three sealed fields and one cleared. Same glyph as the favicon, so a tab and the
 * page identify each other.
 */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect x="4" y="6" width="15" height="4" rx="1" fill="var(--seal)" />
      <rect x="4" y="14" width="21" height="4" rx="1" fill="var(--seal)" />
      <rect x="4" y="22" width="10" height="4" rx="1" fill="var(--seal)" />
      <rect x="17" y="22" width="7" height="4" rx="1" fill="var(--accent)" />
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
 * Sticky identity bar plus the one-sentence claim.
 *
 * Sticky because the two facts a reader needs while scrolling a book are which chain they are
 * looking at and how fresh it is — and because the page previously offered no route to the
 * source at all. Returns a fragment so both rows are direct children of the page's flex
 * column, which is what lets the bar stick over the whole document rather than its own parent.
 */
export function Header({ blockNumber }: { blockNumber?: number }) {
  return (
    <>
      <div
        className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-[var(--line)] py-2.5"
        style={{
          background: "color-mix(in srgb, var(--bg) 90%, transparent)",
          backdropFilter: "blur(8px)",
          // Kept in sync with --header-h so the sticky cross panel clears this bar.
          minHeight: "var(--header-h)",
        }}
      >
        <div className="flex items-baseline gap-2.5">
          <span className="self-center">
            <Mark />
          </span>
          <h1 className="text-lg leading-none tracking-[0.22em]">SABLE</h1>
          <span className="hidden text-[12px] text-[var(--dim)] sm:inline">the confidential cross</span>
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

      <p className="max-w-3xl text-[12px] leading-relaxed text-[var(--dim)]">
        A sealed-bid, uniform-price batch auction whose matching engine runs on encrypted orders.
        The market publishes a price. No participant reveals their hand.
      </p>
    </>
  )
}
