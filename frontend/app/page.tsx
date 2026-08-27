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
  children,
}: {
  tone?: "chrome" | "peach"
  eyebrow?: string
  children: React.ReactNode
}) {
  const cls = tone === "chrome" ? "band-chrome" : tone === "peach" ? "band-peach" : ""
  return (
    <section className={`band ${cls}`}>
      <div className="band-inner rise flex flex-col gap-8">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        {children}
      </div>
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
      <span className="mono text-[40px] leading-none sm:text-[48px]">{value}</span>
      <span className="text-[16px]">{label}</span>
      <span className="note">{note}</span>
    </div>
  )
}

const BUTTON_LIGHT: React.CSSProperties = {
  background: "var(--accent)",
  color: "var(--chrome)",
  padding: "0.9rem 1.6rem",
  fontSize: "16px",
}

export default function Landing() {
  return (
    <main className={`${displaySerif.variable} ${bodySans.variable} editorial`}>
      {/* ------------------------------------------------- hero, on plum ------ */}
      <section className="band band-chrome" style={{ paddingBlock: "4.5rem" }}>
        <div className="band-inner flex flex-col gap-10">
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
            decrypting a single one of them, by a contract nobody can see inside, us included.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <Link href="/terminal" className="hover:!no-underline" style={BUTTON_LIGHT}>
              See it in action →
            </Link>
            <a
              href={EXPLAINER_URL}
              target="_blank"
              rel="noreferrer"
              className="band-border hover:!no-underline"
              style={{
                border: "1px solid",
                padding: "0.9rem 1.6rem",
                fontSize: "16px",
                color: "var(--chrome-ink)",
              }}
            >
              How it works ↗
            </a>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- problem ------------ */}
      <Band eyebrow="The problem">
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
            and Credit Suisse both settled with the SEC over how theirs ranked and exposed order
            flow.
          </p>
        </div>
      </Band>

      {/* ------------------------------------------------- how ---------------- */}
      <Band eyebrow="How it works">
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
      </Band>

      {/* ------------------------------------------------- legend ------------- */}
      <Band eyebrow="What a row looks like">
        <Primer label="Stored, then decrypted" />
      </Band>

      {/* ------------------------------------------------- proof, on peach ---- */}
      <Band tone="peach" eyebrow="Measured, not claimed">
        <h2 className="display display-m max-w-[24ch]">Every number here came off the chain.</h2>
        <div className="grid gap-10 sm:grid-cols-3">
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
      <Band eyebrow="Disclosure surface">
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
      </Band>

      {/* ------------------------------------------------- close, on plum ----- */}
      <section className="band band-chrome">
        <div className="band-inner rise flex flex-col gap-8">
          <h2 className="display display-l max-w-[20ch]">
            The book is public. It is also unreadable.
          </h2>
          <p className="max-w-[50ch] text-[18px] leading-relaxed opacity-80">
            Fetching the whole thing needs no wallet, no signature and no permission. That is what
            makes its confidentiality a property of the chain rather than of this page.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/terminal" className="hover:!no-underline" style={BUTTON_LIGHT}>
              Open the terminal →
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
      </section>
    </main>
  )
}
