import { Instrument_Serif, Red_Hat_Display } from "next/font/google"
import Link from "next/link"
import { Mark } from "@/components/Mark"
import { Primer } from "@/components/Primer"
import { EXPLAINER_URL, REPO_URL } from "@/lib/deployment"

/**
 * The landing page.
 *
 * A Server Component: no state, no chain reads, so it ships no JavaScript and has no loading
 * frame. Live data sits behind the button, which is the reason the button exists.
 *
 * Typography and section rhythm follow the reference design nada chose
 * (ricardochance.com): Instrument Serif display over Red Hat Display body, the same
 * 11/16/20/24/32/48/80/140 scale, generous vertical air, and scroll-driven reveals. The
 * information architecture does NOT follow it — that site sells a freelance service, so its
 * Services/Process/Budget sections have no counterpart here. These sections are Sable's own
 * substance at the reference's rhythm.
 *
 * Display sizes are fluid rather than fixed: a literal 140px hero overflows a phone, which is
 * the one detail of the reference worth not copying.
 */

/*
 * Declared here, not in the root layout, and the variables are applied to <main> below.
 *
 * Declaring them in the layout put all five font files on every route, so the terminal was
 * fetching a display serif it never renders. Scoping the CSS with a class was not enough: the
 * declaration is what decides what ships.
 *
 * Instrument Serif is named in the slop catalogue as an overused face. Using it is a knowing
 * trade for the reference design, and it stays off the terminal, which is an instrument.
 */
const displaySerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-display-src",
})

const bodySans = Red_Hat_Display({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--font-body-src",
})

function Section({
  eyebrow,
  children,
}: {
  eyebrow?: string
  children: React.ReactNode
}) {
  return (
    <section className="rise flex flex-col gap-8 border-t border-[var(--line)] pt-12 sm:pt-16">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      {children}
    </section>
  )
}

/** One step of the market, numbered. The reference numbers its process; Sable has a real one. */
function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="flex gap-5">
      <span className="mono shrink-0 pt-1 text-[13px] text-[var(--accent-deep)]">{n}</span>
      <div className="flex flex-col gap-2">
        <h3 className="text-[20px] leading-snug">{title}</h3>
        <p className="max-w-[46ch] text-[16px] leading-relaxed text-[var(--dim)]">{body}</p>
      </div>
    </div>
  )
}

function Figure({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="mono text-[40px] leading-none text-[var(--ink)] sm:text-[48px]">{value}</span>
      <span className="text-[16px]">{label}</span>
      <span className="text-[13px] text-[var(--dim)]">{note}</span>
    </div>
  )
}

export default function Landing() {
  return (
    <main className={`${displaySerif.variable} ${bodySans.variable} editorial mx-auto flex max-w-[1024px] flex-col gap-16 px-5 py-14 sm:gap-24 sm:px-8 sm:py-20`}>
      {/* ---------------------------------------------------------------- hero */}
      <header className="flex flex-col gap-10">
        <div className="flex items-center gap-4">
          <Mark size={30} />
          <span className="eyebrow">The confidential cross</span>
        </div>

        <h1 className="display display-xl">
          A market that
          <br />
          cannot read
          <br />
          its own book.
        </h1>

        <p className="max-w-[52ch] text-[18px] leading-relaxed sm:text-[20px]">
          Orders arrive encrypted and stay that way. The clearing price is computed without
          decrypting a single one of them, by a contract nobody can see inside — including us.
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/terminal"
            className="!text-[var(--chrome-ink)] hover:!no-underline"
            style={{ background: "var(--chrome)", padding: "0.9rem 1.6rem", fontSize: "16px" }}
          >
            See it in action →
          </Link>
          <a
            href={EXPLAINER_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              border: "1px solid var(--line-hi)",
              padding: "0.9rem 1.6rem",
              fontSize: "16px",
              color: "var(--ink)",
            }}
            className="hover:!no-underline"
          >
            How it works ↗
          </a>
        </div>
      </header>

      {/* ------------------------------------------------------------- problem */}
      <Section eyebrow="The problem">
        <h2 className="display display-m max-w-[24ch]">Being seen is what costs you.</h2>
        <div className="grid gap-8 sm:grid-cols-2">
          <p className="text-[16px] leading-relaxed text-[var(--dim)]">
            On a transparent venue your order is readable before it settles, so the price moves
            against you first. Private relays and commit schemes narrow the window; they do not
            close it, because the order is eventually visible to whoever settles it.
          </p>
          <p className="text-[16px] leading-relaxed text-[var(--dim)]">
            Traditional finance answered with dark pools, and traded one problem for another. A
            dark pool hides the order from the market but not from its operator. In 2016 Barclays
            and Credit Suisse both settled with the SEC over how theirs actually ranked and exposed
            order flow.
          </p>
        </div>
      </Section>

      {/* ------------------------------------------------------------- how */}
      <Section eyebrow="How it works">
        <h2 className="display display-m max-w-[26ch]">Four steps, none of them readable.</h2>
        <div className="flex flex-col gap-9">
          <Step
            n="01"
            title="Desks negotiate, encrypted"
            body="Autonomous agents exchange indications of interest on chain: a side and a size, deliberately no price. Only the recipient can decrypt one."
          />
          <Step
            n="02"
            title="Orders are committed sealed"
            body="Side, limit and size all arrive as ciphertext, with collateral locked under an oblivious select so even which token moved gives nothing away."
          />
          <Step
            n="03"
            title="The market clears blind"
            body="At the close, any address may trigger clearing. The contract finds the price that maximises matched volume over a public grid, computing entirely on garbled values."
          />
          <Step
            n="04"
            title="Settlement stays private"
            body="Each desk decrypts exactly one number: its own fill. Balances move in confidential tokens, so a payout does not disclose a position."
          />
        </div>
      </Section>

      {/* ------------------------------------------------------------- legend */}
      <Section eyebrow="What a row looks like">
        <Primer label={null} />
      </Section>

      {/* ------------------------------------------------------------- proof */}
      <Section eyebrow="Measured, not claimed">
        <h2 className="display display-m max-w-[24ch]">Every number here came off the chain.</h2>
        <div className="grid gap-10 sm:grid-cols-3">
          <Figure value="101" label="Clearing price" note="Found on six encrypted orders, verified against an independent plaintext engine." />
          <Figure value="0 of 6" label="Readable without a key" note="With one desk's key, exactly that desk's rows. Measured, not asserted." />
          <Figure value="55.5%" label="Of a block, at capacity" note="32 orders over 12 levels: 66,651,243 gas. Measured at the bound, not extrapolated." />
        </div>
        <p className="max-w-[60ch] text-[16px] leading-relaxed text-[var(--dim)]">
          Clearing cost the same gas, to the unit, on two books sharing no order. The kernel cannot
          branch on an encrypted value, so it runs the same circuit whatever the values are: a
          receipt discloses nothing the batch does not already publish.
        </p>
      </Section>

      {/* ------------------------------------------------------------- leaks */}
      <Section eyebrow="Disclosure surface">
        <div className="grid gap-10 sm:grid-cols-2">
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
      </Section>

      {/* ------------------------------------------------------------- close */}
      <Section>
        <h2 className="display display-l max-w-[20ch]">The book is public. It is also unreadable.</h2>
        <p className="max-w-[50ch] text-[18px] leading-relaxed text-[var(--dim)]">
          Fetching the whole thing needs no wallet, no signature and no permission. That is what
          makes its confidentiality a property of the chain rather than of this page.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/terminal"
            className="!text-[var(--chrome-ink)] hover:!no-underline"
            style={{ background: "var(--chrome)", padding: "0.9rem 1.6rem", fontSize: "16px" }}
          >
            Open the terminal →
          </Link>
          <span className="text-[13px] text-[var(--dim)]">Read-only. COTI testnet.</span>
        </div>
      </Section>

      <footer className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-4 border-t border-[var(--line)] pt-8">
        <p className="text-[13px] text-[var(--dim)]">
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
      </footer>
    </main>
  )
}
