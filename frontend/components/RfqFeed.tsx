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
        <span className="text-[var(--dim)] text-[10px] uppercase tracking-widest">RFQ channel</span>
        <span className="text-[11px] text-[var(--dim)]">{messages.length} encrypted message(s)</span>
      </div>

      {messages.length === 0 ? (
        <div className="px-3 py-8 text-center text-[var(--dim)]">
          No messages. Load a desk key, or run the RFQ round.
        </div>
      ) : (
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
                <td className="text-[11px] sealed">{ctPreview(m.chunks)}</td>
                <td>
                  {m.text ? (
                    <span>
                      <span className="text-[var(--buy)]">{m.text}</span>
                      <span className="ml-2 text-[10px] text-[var(--dim)]">read as {m.readAs}</span>
                    </span>
                  ) : (
                    <span className="text-[var(--dim)]">no key held</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--dim)]">
        Sender and recipient can each decrypt; nobody else can. An IOI carries a side and a
        size and deliberately no price — enough for a counterparty to size up, nothing about
        valuation. COTI pays each desk for the encrypted cells it stores, so the protocol funds
        the private negotiation it depends on.
      </div>
    </div>
  )
}
