import type { Metadata } from "next"

/**
 * The terminal's own metadata.
 *
 * `page.tsx` here is a client component, and a `metadata` export is only honoured in a Server
 * Component, so the route carries a thin server layout to hold it.
 */
export const metadata: Metadata = {
  title: "Sable terminal — the sealed book, live",
  description:
    "A live order book on COTI testnet, rendered sealed because that is what the chain stores. Unlock one desk's key and only that desk's rows resolve.",
}

export default function TerminalLayout({ children }: LayoutProps<"/terminal">) {
  return children
}
