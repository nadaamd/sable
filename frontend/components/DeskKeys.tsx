"use client"

import { useState } from "react"
import type { DeskKey } from "@/lib/deployment"

/**
 * Holding a desk's AES key is what turns █ into numbers — so this is the page's primary
 * control, and it sits at the top, full width, above the book it acts on.
 *
 * It used to be the second panel of the right-hand column, below the fold on a laptop. A
 * first-time visitor read the sealed book as a broken page and left without ever discovering
 * that one click was the entire demonstration.
 *
 * Keys are listed but INACTIVE by default, so the terminal opens on the honest view: a
 * complete, public, unreadable order book. Keys stay in this browser, are never transmitted,
 * and are used only for local decryption. Testnet only.
 */
export function DeskKeys({
  keys,
  active,
  onToggle,
  onAdd,
  onForget,
}: {
  keys: DeskKey[]
  active: string[]
  onToggle: (address: string) => void
  onAdd: (k: DeskKey) => void
  onForget: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [aesKey, setAesKey] = useState("")
  const [error, setError] = useState<string | null>(null)

  const isActive = (a: string) => active.some((x) => x.toLowerCase() === a.toLowerCase())
  const none = active.length === 0

  function submit() {
    const addr = address.trim()
    const key = aesKey.trim().replace(/^0x/, "")
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return setError("address must be 0x + 40 hex chars")
    if (!/^[0-9a-fA-F]{32}$/.test(key)) return setError("AES key must be 32 hex chars")
    setError(null)
    onAdd({ name: name.trim() || `${addr.slice(0, 6)}…`, address: addr, aesKey: key })
    setName("")
    setAddress("")
    setAesKey("")
    setOpen(false)
  }

  return (
    <div className="panel" style={{ borderColor: none ? "var(--accent)" : "var(--line)" }}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {/*
            An instruction while nothing is unlocked, a label once something is.
            "View as desk" names a panel; it does not tell a first-time visitor that this one
            click IS the demonstration. Until they make it, the control asks for it directly.
          */}
          {none ? (
            <span className="mr-1 text-[14px] text-[var(--accent-deep)]">
              Click a desk to decrypt its orders
            </span>
          ) : (
            <span className="panel-label mr-1">Viewing as</span>
          )}

          {keys.length === 0 ? (
            <span className="text-[13px] text-[var(--dim)]">
              No desk keys loaded. Run <span className="text-[var(--ink)]">npm run frontend:config</span>{" "}
              after an agent run, or add one manually.
            </span>
          ) : (
            keys.map((k) => {
              const on = isActive(k.address)
              return (
                <button
                  key={k.address}
                  onClick={() => onToggle(k.address)}
                  aria-pressed={on}
                  className="flex items-center gap-2"
                  style={{
                    borderColor: on ? "var(--accent)" : "var(--line-hi)",
                    color: on ? "var(--accent)" : "var(--ink)",
                    background: on ? "color-mix(in srgb, var(--accent) 55%, transparent)" : "transparent",
                  }}
                >
                  <span aria-hidden>{on ? "◉" : "○"}</span>
                  <span>{k.name}</span>
                  <span className="mono text-[12px] text-[var(--dim)]">{k.address.slice(0, 8)}…</span>
                </button>
              )
            })
          )}
        </div>

        <div className="flex items-center gap-3 text-[13px]">
          <span className="text-[var(--dim)]">
            <span className="mono">
              {active.length}/{keys.length}
            </span>{" "}
            unlocked
          </span>
          <button onClick={() => setOpen(!open)} className="!border-0 !p-0 underline">
            {open ? "cancel" : "add a key"}
          </button>
          {keys.length > 0 && (
            <button onClick={onForget} className="!border-0 !p-0 underline">
              forget pasted
            </button>
          )}
        </div>
      </div>

      {/* The one line that stops a wall of █ from reading as a broken page. */}
      <div className="border-t border-[var(--line)] px-3 py-2">
        <p className="prose" style={{ color: none ? "var(--ink)" : "var(--dim)" }}>
          {none ? (
            <>
              <span style={{ color: "var(--accent)" }}>The book below is sealed on chain.</span> It
              is the complete book, fetched with public calls, and side, limit, size and fill are all
              ciphertexts. Unlocking one desk above decrypts that desk&apos;s own rows. Every other
              row stays █, including for us.
            </>
          ) : (
            <>
              Decryption happens locally with COTI&apos;s SDK and no key leaves this browser. A wrong
              key does not raise an error, it returns noise, so a value is shown only when the result
              is structurally possible. Rows belonging to locked desks remain unreadable.
            </>
          )}
        </p>
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] px-3 py-2">
          <input
            placeholder="name"
            className="w-28"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            placeholder="0x desk address"
            className="w-[26rem] max-w-full"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <input
            placeholder="AES key (32 hex)"
            className="w-64 max-w-full"
            value={aesKey}
            onChange={(e) => setAesKey(e.target.value)}
          />
          <button onClick={submit}>load</button>
          {error && <span className="text-[13px] text-[var(--sell)]">{error}</span>}
        </div>
      )}
    </div>
  )
}
