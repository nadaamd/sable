import { Instrument_Serif, Red_Hat_Display } from "next/font/google"
import Link from "next/link"
import { SceneCanvas } from "@/components/SceneCanvas"
import { Mark } from "@/components/Mark"
import { Primer } from "@/components/Primer"
import { EXPLAINER_URL, REPO_URL } from "@/lib/deployment"

/**
 * The landing page.
 *
 * A Server Component: no state and no chain reads, so it has no loading frame and its sections
 * are prerendered. Live data sits behind the button, which is the reason the button exists.
 *
 * It is NOT JavaScript-free, and earlier comments here claimed it was. `next/link` is a client
 * component and the App Router ships its runtime regardless, so the route always carried client
 * JS; the dust adds a canvas on top. Measured in production: 563 KB across 8 chunks for the
 * landing against 1,632 KB for the terminal.
 *
 * Typography and section rhythm follow the reference design nada chose (ricardochance.com):
 * Instrument Serif display over Red Hat Display body, its 11/16/20/24/32/48/80/140 scale,
 * generous vertical air, numbered steps, scroll-driven reveals. The information architecture does
 * NOT follow it — that site sells a freelance service, so its Services/Process/Budget sections
 * have no counterpart here. These sections are Sable's own substance at the reference's rhythm.
 *
 * The palette carries the page in BANDS, not trim. A first pass used it as accents and the
 * result showed --accent zero times: neutral page, two plum buttons, identity gone. Mauve Shadow
 * opens and closes the page as a full surface, Soft Peach carries the proof section, and Cream
 * and Light Bronze do the text on top of them.
 *
 * Display sizes are fluid rather than the reference's fixed pixels: a literal 140px hero
 * overflows a phone, which is the one detail worth not copying.
 */
const displaySerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  // The reference sets its hero in the italic. Loading the real italic face matters: without it
  // the browser synthesises an oblique by shearing the roman, which in a serif looks wrong.
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-display-src",
})

const bodySans = Red_Hat_Display({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--font-body-src",
})

function Band({
  tone,
  eyebrow,
  geometry,
  children,
}: {
  tone?: "chrome" | "peach"
  eyebrow?: string
  /** Which wireframe form the scene canvas shows while this band owns the viewport. */
  geometry?: string
  children: React.ReactNode
}) {
  const cls = tone === "chrome" ? "band-chrome" : tone === "peach" ? "band-peach" : ""
  return (
    <section className={`band ${cls}`} data-geometry={geometry} data-geometry-tone={tone === "chrome" ? "chrome" : "light"}>
      <div className="band-inner scrim">
        {eyebrow && <p className="eyebrow band-rail">{eyebrow}</p>}
        <div className="band-body rise">{children}</div>
      </div>
    </section>
  )
}

/*
 * The band's label is a RAIL, not a stacked line.
 *
 * The reference offsets its content off a 7-column grid and pins the section label with sticky,
 * so the label is still on screen at the bottom of the section it names. Here the label had been
 * stacked above the heading, where it scrolled away in the first 200px and stopped naming
 * anything. Layout lives in .band-inner / .band-rail / .band-body in globals.css.
 */

/**
 * One step of the market, as the reference stacks its process: number, then a display-serif
 * title, then the body. Its own scrim, not the section's — the section is several viewports
 * tall and a single radial gradient over it would be opaque in the middle and absent at both
 * ends. Its opacity is driven by how close it is to the focal line; see .pstep in globals.css.
 */
function ProcessStep({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <article className="pstep scrim">
      <span className="pstep-n mono">{n}</span>
      <h3 className="display pstep-title">{title}</h3>
      <p className="pstep-body">{body}</p>
    </article>
  )
}

/** The focal marker that rides the rule, pinned to the line the steps light up on. */
function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <path
        d="M12 0c.6 6.6 4.8 10.8 12 12-7.2 1.2-11.4 5.4-12 12-.6-6.6-4.8-10.8-12-12C7.2 10.8 11.4 6.6 12 0Z"
        fill="var(--accent-deep)"
      />
    </svg>
  )
}

function Figure({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="mono text-[40px] leading-none sm:text-[48px]">{value}</span>
      <span className="text-[16px]">{label}</span>
      <span className="note">{note}</span>
    </div>
  )
}

/** Fill only: .pill owns height, padding and radius so both buttons match the reference. */
const BUTTON_LIGHT: React.CSSProperties = {
  background: "var(--accent)",
  color: "var(--chrome)",
}

export default function Landing() {
  return (
    <main className={`${displaySerif.variable} ${bodySans.variable} editorial`}>
      {/* ------------------------------------------------- hero, on plum ------ */}
      {/*
        Geometry copied from the reference: full-viewport section, label and title at the top,
        actions and description pushed to the bottom and spread apart. See .hero in globals.css
        for the measured paddings and sizes.
      */}
      {/*
        One fixed canvas for the whole page: a wireframe form that morphs between the shapes the
        sections declare, over dust that fades out with the hero. See components/SceneCanvas.tsx.
      */}
      <SceneCanvas />

      <section className="band-chrome hero" data-geometry="star" data-geometry-tone="chrome" data-geometry-hero>
        {/*
          Each scrim hugs its own text. It used to sit on hero-top and hero-bottom, which are
          both full-width while their text lives at the ends — so the gradient's opaque centre
          landed on empty space and erased the star's tips, while the text sat out at the faded
          edge. See .hero-top / .hero-eyebrow in globals.css.
        */}
        <div className="hero-top enter" style={{ position: "relative", zIndex: 3 }}>
          <div className="hero-eyebrow scrim flex items-center gap-4">
            <Mark size={26} />
            <span className="eyebrow">The confidential cross</span>
          </div>

          <h1 className="display hero-title scrim">
            A market that cannot read its own{" "}
            <span style={{ opacity: 0.6 }}>book</span>.
          </h1>
        </div>

        <div className="hero-bottom" style={{ position: "relative", zIndex: 3 }}>
          <div className="hero-actions scrim">
            <Link href="/terminal" className="pill hover:!no-underline" style={BUTTON_LIGHT}>
              See it in action
            </Link>
            <a
              href={EXPLAINER_URL}
              target="_blank"
              rel="noreferrer"
              className="pill band-border hover:!no-underline"
              style={{ border: "1px solid", color: "var(--chrome-ink)" }}
            >
              How it works ↗
            </a>
          </div>

          <div className="hero-desc scrim">
            <p className="text-[15px] leading-relaxed opacity-80">
              Orders arrive encrypted and stay that way. The clearing price is computed without
              decrypting a single one of them, by a contract nobody can see inside, us included.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- problem ------------ */}
      <Band geometry="bloom" eyebrow="The problem">
        <h2 className="display display-m max-w-[24ch]">Being seen is what costs you.</h2>
        <div className="stagger grid gap-8 sm:grid-cols-2">
          <p className="text-[16px] leading-relaxed text-[var(--dim)]">
            On a transparent venue your order is readable before it settles, so the price moves
            against you first. Private relays and commit schemes narrow the window; they do not
            close it, because the order is eventually visible to whoever settles it.
          </p>
          <p className="text-[16px] leading-relaxed text-[var(--dim)]">
            Traditional finance answered with dark pools, and traded one problem for another. A
            dark pool hides the order from the market but not from its operator. In 2016 Barclays
            and Credit Suisse both settled with the SEC over how theirs ranked and exposed order
            flow.
          </p>
        </div>
      </Band>

      {/* ------------------------------------------------- how ---------------- */}
      {/*
        The one section that changes gear, laid out the way the reference lays out its process.

        The lede pins for the length of the section while the steps scroll past it, and each step
        is lit by how close it is to the focal line — full at the centre of the viewport, down to
        a trace at either edge. A rule marks the split and a sparkle rides it at the focal height,
        so the line the steps light up on is visible rather than merely felt.

        It does NOT take the band rail: this section states its own label inside the pinned panel,
        which is where the reference puts it and the only place it can go once the left column is
        the panel.
      */}
      <section className="band process" data-geometry="diamond" data-geometry-tone="light">
        <div className="band-inner">
          <div className="process-lede">
            <div className="process-lede-in scrim">
              <p className="eyebrow">How it works</p>
              <h2 className="display display-m">Four steps, none of them readable.</h2>
              <p className="process-lede-body">
                The whole sequence runs on chain, in public. The contract never reads an order.
              </p>
            </div>
          </div>

          <div className="process-rule" aria-hidden>
            <span className="process-mark">
              <Sparkle />
            </span>
          </div>

          <div className="process-steps">
            <ProcessStep
              n="01"
              title="Desks negotiate, encrypted"
              body="Autonomous agents exchange indications of interest on chain: a side and a size, deliberately no price. Only the recipient can decrypt one."
            />
            <ProcessStep
              n="02"
              title="Orders are committed sealed"
              body="Side, limit and size all arrive as ciphertext, with collateral locked under an oblivious select so even which token moved gives nothing away."
            />
            <ProcessStep
              n="03"
              title="The market clears blind"
              body="At the close, any address may trigger clearing. The contract finds the price that maximises matched volume over a public grid, computing entirely on garbled values."
            />
            <ProcessStep
              n="04"
              title="Settlement stays private"
              body="Each desk decrypts exactly one number: its own fill. Balances move in confidential tokens, so a payout does not disclose a position."
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- legend ------------- */}
      <Band geometry="bloom" eyebrow="What a row looks like">
        <Primer label="Stored, then decrypted" animate />
      </Band>

      {/* ------------------------------------------------- proof, on peach ---- */}
      <Band tone="peach" geometry="ring" eyebrow="Measured, not claimed">
        <h2 className="display display-m max-w-[24ch]">Every number here came off the chain.</h2>
        <div className="stagger grid gap-10 sm:grid-cols-3">
          <Figure
            value="101"
            label="Clearing price"
            note="Found on six encrypted orders, checked against an independent plaintext engine."
          />
          <Figure
            value="0 of 6"
            label="Readable without a key"
            note="With one desk's key, exactly that desk's rows. Measured, not asserted."
          />
          <Figure
            value="55.5%"
            label="Of a block, at capacity"
            note="32 orders over 12 levels: 66,651,243 gas. Measured at the bound, not extrapolated."
          />
        </div>
        <p className="max-w-[60ch] text-[16px] leading-relaxed">
          Clearing cost the same gas, to the unit, on two books sharing no order. The kernel cannot
          branch on an encrypted value, so it runs the same circuit whatever the values are: a
          receipt discloses nothing the batch does not already publish.
        </p>
      </Band>

      {/* ------------------------------------------------- disclosure --------- */}
      <Band geometry="diamond" eyebrow="Disclosure surface">
        <div className="stagger grid gap-10 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h3 className="text-[20px]">Public</h3>
            <ul className="flex flex-col gap-2 text-[16px] text-[var(--dim)]">
              <li>That an address submitted an order, and when</li>
              <li>The batch clearing price</li>
              <li>Total matched volume</li>
              <li>The full contract source</li>
            </ul>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-[20px]">Encrypted permanently</h3>
            <ul className="flex flex-col gap-2 text-[16px] text-[var(--dim)]">
              <li>Side, buy or sell</li>
              <li>Limit price</li>
              <li>Order size</li>
              <li>Each participant&apos;s individual fill</li>
              <li>Everything about orders that did not cross</li>
            </ul>
          </div>
        </div>
      </Band>

      {/* ------------------------------------------------- close, on plum ----- */}
      <section className="band band-chrome" data-geometry="star" data-geometry-tone="chrome">
        <div className="band-inner scrim">
          <p className="eyebrow band-rail">Open it</p>
          <div className="band-body rise">
            <h2 className="display display-l max-w-[20ch]">
              The book is public. It is also unreadable.
            </h2>
            <p className="max-w-[50ch] text-[18px] leading-relaxed opacity-80">
              Fetching the whole thing needs no wallet, no signature and no permission. That is
              what makes its confidentiality a property of the chain rather than of this page.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/terminal" className="pill hover:!no-underline" style={BUTTON_LIGHT}>
                Open the terminal
              </Link>
              <span className="text-[14px] opacity-70">Read-only. COTI testnet.</span>
            </div>

            <div className="band-border mt-6 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-4 border-t pt-8">
              <p className="text-[13px] opacity-70">
                A sealed-bid, uniform-price batch auction, matched under garbled circuits on COTI.
              </p>
              <p className="flex flex-wrap gap-x-5 text-[13px]">
                <a href={EXPLAINER_URL} target="_blank" rel="noreferrer">
                  How it works ↗
                </a>
                <a href={REPO_URL} target="_blank" rel="noreferrer">
                  Code ↗
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/*
        Film grain, above everything and untouchable. Landing only: mix-blend-mode on a fixed
        full-screen layer forces what is beneath it into a blending context, and the terminal
        repaints on a poll.
      */}
      <div className="grain" aria-hidden />
    </main>
  )
}
