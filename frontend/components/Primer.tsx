/*
 * No "use client": this renders no state and handles no events, so it stays a Server Component
 * and adds nothing to the landing's client bundle. The terminal imports it too, where it simply
 * becomes part of that route's bundle.
 */
/**
 * The page has to be legible in three seconds, before anyone reads a sentence.
 *
 * The concept is not explained by describing it. It is explained by showing one row in both of
 * its states side by side: what the chain stores, and what a single key turns that into. A
 * visitor who has never heard of a batch auction gets it from the picture.
 *
 * This is a LEGEND, not live data, and it says so. We cannot decrypt a desk's order without its
 * key, so showing a decrypted row as though it were live would be a claim we cannot back. The
 * example uses the notation the real book below uses, and nothing else.
 */

function SealedBlocks({ width }: { width: number }) {
  return <span className="sealed">{"█".repeat(width)}</span>
}

function Caption({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] text-[var(--dim)]">{children}</span>
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-16 flex-col gap-1">
      <Caption>{label}</Caption>
      <span className="mono text-[15px]">{children}</span>
    </div>
  )
}

/**
 * A decrypted value that arrives by decrypting.
 *
 * Two layers in one grid cell: the sealed glyphs on top, the value underneath. Scroll-driven CSS
 * fades the first out and the second in, out of blur, so the legend performs the thing it
 * describes. Without the animation both layers are simply present and the value wins, so nothing
 * is hidden if the effect never runs.
 */
function Reveal({
  width,
  animate,
  children,
}: {
  width: number
  animate?: boolean
  children: React.ReactNode
}) {
  if (!animate) return <>{children}</>
  return (
    <span className="decrypt">
      <span className="sealed" aria-hidden>
        {"█".repeat(width)}
      </span>
      <span className="plain">{children}</span>
    </span>
  )
}

export function Primer({
  label = "How to read this page",
  animate = false,
}: {
  label?: string | null
  /** Landing only: play the sealed-to-decrypted transition as the legend scrolls into view. */
  animate?: boolean
}) {
  return (
    <div className="panel">
      {label !== null && (
        <div className="panel-head px-3 py-2">
          <span className="panel-label">{label}</span>
        </div>
      )}

      <div className="grid gap-px bg-[var(--line)] md:grid-cols-[1fr_auto_1fr]">
        <div className="bg-[var(--panel)] px-4 py-4">
          <p className="text-[13px]">Stored on chain. Anyone can fetch it.</p>
          <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
            <Cell label="desk">Atlas</Cell>
            <Cell label="side">
              <SealedBlocks width={4} />
            </Cell>
            <Cell label="limit">
              <SealedBlocks width={5} />
            </Cell>
            <Cell label="size">
              <SealedBlocks width={6} />
            </Cell>
          </div>
        </div>

        <div className="flex items-center justify-center bg-[var(--panel)] px-4 py-2 md:px-3">
          <span className="text-[var(--accent-deep)]" aria-hidden>
            <span className="md:hidden">↓</span>
            <span className="hidden md:inline">→</span>
          </span>
          <span className="sr-only">becomes, with that desk&apos;s key</span>
        </div>

        <div className="bg-[var(--panel-hi)] px-4 py-4">
          <p className="text-[13px]">With that desk&apos;s own key, and no other.</p>
          <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
            <Cell label="desk">Atlas</Cell>
            <Cell label="side">
              <Reveal width={4} animate={animate}>
                <span style={{ color: "var(--buy)" }}>BUY</span>
              </Reveal>
            </Cell>
            <Cell label="limit">
              <Reveal width={5} animate={animate}>
                103
              </Reveal>
            </Cell>
            <Cell label="size">
              <Reveal width={6} animate={animate}>
                37
              </Reveal>
            </Cell>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--line)] px-3 py-2">
        <p className="prose">An example of the notation, not a live row.</p>
      </div>
    </div>
  )
}
