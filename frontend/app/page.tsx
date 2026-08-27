import Link from "next/link"
import { Mark } from "@/components/Mark"
import { Primer } from "@/components/Primer"
import { EXPLAINER_URL, REPO_URL } from "@/lib/deployment"

/**
 * The landing page.
 *
 * A Server Component with no state and no chain reads, so it ships no JavaScript and has no
 * loading frame. Live data belongs behind the button, which is the whole reason the button
 * exists.
 *
 * It carries one job: someone who has never heard of this understands it before scrolling. The
 * work is done by the primer, not by prose — the same legend the terminal uses, so the notation
 * a visitor learns here is the notation they meet there.
 */
export default function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-5 py-16">
      <header className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Mark size={40} />
          <h1 className="mono text-[38px] leading-none tracking-[0.3em] sm:text-[46px]">SABLE</h1>
        </div>
        <p className="text-[15px] leading-relaxed sm:text-[17px]">
          Orders sit encrypted on a public blockchain. The market finds a clearing price without
          decrypting any of them.
        </p>
      </header>

      <Primer label={null} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <Link
          href="/terminal"
          className="!text-[var(--chrome-ink)] hover:!no-underline"
          style={{
            background: "var(--chrome)",
            padding: "0.85rem 1.5rem",
            fontSize: "15px",
          }}
        >
          See it in action →
        </Link>
        <span className="text-[13px] text-[var(--dim)]">
          A live book on COTI testnet. Read-only, no wallet.
        </span>
      </div>

      <footer className="flex flex-col gap-3 border-t border-[var(--line)] pt-5">
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
