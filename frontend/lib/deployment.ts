/**
 * Which deployment the terminal reads.
 *
 * Addresses are public testnet information and are committed so the page works read-only
 * with no setup. Desk AES keys are NOT committed — run `npm run frontend:config` from the
 * repo root to generate `frontend/.env.local` from your own agent run.
 */

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://testnet.coti.io/rpc"
export const EXPLORER = "https://testnet.cotiscan.io"
export const CHAIN_ID = 7082400

export const CROSS_ADDRESS = process.env.NEXT_PUBLIC_CROSS ?? "0x99e48161B780b869884Ab5845b0eC41ca54eb28a"
export const MESSAGING_ADDRESS = process.env.NEXT_PUBLIC_MESSAGING ?? "0xbc0828b30BAA9a086fD64773CFa8cc63996ffE37"

export type DeskKey = { name: string; address: string; aesKey: string }

/**
 * Optional demo desks, injected at build time from .env.local. Without them the terminal
 * still renders the whole book — just entirely sealed, which is the honest default view.
 */
export function envDesks(): DeskKey[] {
  const raw = process.env.NEXT_PUBLIC_DEMO_DESKS
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((d) => d?.address && d?.aesKey) : []
  } catch {
    return []
  }
}
