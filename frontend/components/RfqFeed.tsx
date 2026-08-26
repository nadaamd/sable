"use client"

import type { RfqMessage } from "@/lib/chain"

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/**
 * `IOI:B:70` is a wire format, not a sentence.
 *
 * The messaging layer caps a chunk at 24 bytes, so the payload is terse by necessity. That is a
 * reason to decode it for the reader, not a reason to make them decode it: a visitor should see
 * what the desk actually said, with the raw bytes beside it as corroboration.
 */
function decodeIoi(text: string): { side: "buy" | "sell"; size: number } | null {
  const m = /^IOI:([BS]):(\d+)$/.exec(text.trim())
  if (!m) return null
  return { side: m[1] === "B" ? "buy" : "sell", size: Number(m[2]) }
}

function ctPreview(chunks: bigint[]): string {
  if (chunks.length === 0) return "—"
  return chunks
    .map((c) => c.toString(16).padStart(64, "0").slice(0, 8))
    .join(" ")
}

/**
 * The pre-trade layer: desks telling each other how much interest they have, on chain and
 * end-to-end encrypted. Note what an IOI never contains — a price.
 */
function Decoded({ text }: { text: string }) {
  const ioi = decodeIoi(text)
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      {ioi ? (
        <span style={{ color: ioi.side === "buy" ? "var(--buy)" : "var(--sell)" }}>
          wants to {ioi.side} {ioi.size}
        </span>
      ) : (
        <span className="text-[var(--ink)]">{text}</span>
      )}
      {ioi && <span className="text-[12px] text-[var(--dim)]">{text}</span>}
    </span>
  )
}

export function RfqFeed({ messages, deskName }: { messages: RfqMessage[]; deskName: (a: string) => string }) {
  return (
    <div className="panel">
      <div className="panel-head flex items-baseline justify-between px-3 py-2">
        <span className="panel-label">RFQ channel</span>
        <span className="text-[13px] opacity-80">{messages.length} encrypted messages</span>
      </div>

      {messages.length === 0 ? (
        <div className="px-3 py-8 text-center text-[var(--dim)]">
          No messages. Load a desk key, or run the RFQ round.
        </div>
      ) : (
        <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th />
              <th>From</th>
              <th>To</th>
              <th title="First bytes of each stored ciphertext chunk">On chain</th>
              <th>Decrypted</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id}>
                <td className="text-[var(--dim)]">#{m.id}</td>
                <td>{deskName(m.from) || shortAddr(m.from)}</td>
                <td>{deskName(m.to) || shortAddr(m.to)}</td>
                <td className="text-[12px] sealed">{ctPreview(m.chunks)}</td>
                <td>
                  {m.text ? (
                    <Decoded text={m.text} />
                  ) : (
                    <span className="text-[var(--dim)]">no key held</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <div className="border-t border-[var(--line)] px-3 py-2">
        <p className="prose">
          Sender and recipient can each decrypt. An IOI carries a side and a size, never a price.
        </p>
      </div>
    </div>
  )
}
