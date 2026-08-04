"use client"

import { useState } from "react"
import type { DeskKey } from "@/lib/deployment"

/**
 * Holding a desk's AES key is what turns █ into numbers.
 *
 * Keys are listed but INACTIVE by default, so the terminal opens on the honest view: a
 * complete, public, unreadable order book. Unlocking one desk shows that desk's rows and
 * leaves every other row sealed — which is the whole claim, in one click.
 *
 * Keys stay in the browser, are never transmitted, and are used only for local decryption.
 * Testnet only.
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
    <div className="panel">
      <div className="flex items-baseline justify-between border-b border-[var(--line)] px-3 py-2">
        <span className="text-[10px] uppercase tracking-widest text-[var(--dim)]">View as desk</span>
        <span className="text-[11px] text-[var(--dim)]">
          {active.length}/{keys.length} unlocked
        </span>
      </div>

      {keys.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-[var(--dim)]">
          No desk keys available. Run <span className="text-[var(--ink)]">npm run frontend:config</span> from
          the repo root after an agent run, or paste one below.
        </div>
      ) : (
        <div className="flex flex-col gap-1 px-3 py-2">
          {keys.map((k) => {
            const on = isActive(k.address)
            return (
              <button
                key={k.address}
                onClick={() => onToggle(k.address)}
                className="flex items-center justify-between"
                style={{
                  borderColor: on ? "var(--accent)" : "var(--line)",
                  color: on ? "var(--accent)" : "var(--dim)",
                }}
              >
                <span>
                  {on ? "◉" : "○"} {k.name}
                </span>
                <span className="text-[10px]">
                  {k.address.slice(0, 8)}… {on ? "unlocked" : "sealed"}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-2 text-[11px]">
        <button onClick={() => setOpen(!open)} className="!border-0 !p-0 underline">
          {open ? "cancel" : "add a key"}
        </button>
        {keys.length > 0 && (
          <button onClick={onForget} className="!border-0 !p-0 underline">
            forget pasted keys
          </button>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-2 border-t border-[var(--line)] px-3 py-2">
          <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="0x desk address" value={address} onChange={(e) => setAddress(e.target.value)} />
          <input placeholder="AES key (32 hex)" value={aesKey} onChange={(e) => setAesKey(e.target.value)} />
          <button onClick={submit}>load</button>
          {error && <span className="text-[11px] text-[var(--sell)]">{error}</span>}
        </div>
      )}

      <div className="border-t border-[var(--line)] px-3 py-2 text-[11px] leading-relaxed text-[var(--dim)]">
        Decryption happens locally with COTI&apos;s SDK — no key leaves this browser. A wrong key
        does not error, it returns noise, so a value is only shown when the result is
        structurally possible.
      </div>
    </div>
  )
}
