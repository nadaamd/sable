"use client"

import type { RfqMessage } from "@/lib/chain"

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
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
export function RfqFeed({ messages, deskName }: { messages: RfqMessage[]; deskName: (a: string) => string }) {
  return (
    <div className="panel">
      <div className="flex items-baseline justify-between border-b border-[var(--line)] px-3 py-2">
        <span className="panel-label">RFQ channel</span>
        <span className="text-[13px] text-[var(--dim)]">{messages.length} encrypted messages</span>
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
              <th>On chain</th>
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
                    <span>
                      <span className="text-[var(--buy)]">{m.text}</span>
                      <span className="ml-2 text-[12px] text-[var(--dim)]">read as {m.readAs}</span>
                    </span>
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
          Sender and recipient can each decrypt one of these; nobody else can decrypt either
          copy. An indication of interest carries a side and a size and deliberately no price,
          which is enough for a counterparty to size up without learning a valuation. COTI pays
          each desk for the encrypted cells it stores, so the protocol funds the private
          negotiation it depends on.
        </p>
      </div>
    </div>
  )
}
