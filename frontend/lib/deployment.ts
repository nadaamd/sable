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

export const CROSS_ADDRESS = process.env.NEXT_PUBLIC_CROSS ?? "0x0B80999a68F3Eee6735C36F949f952b36AB244ee"
export const MESSAGING_ADDRESS = process.env.NEXT_PUBLIC_MESSAGING ?? "0x962C3D5Cfec9eBFA878ca9890FB48118338fCa7E"

/**
 * Where someone goes after the page convinces them.
 *
 * The terminal had no route to the source or to the write-up, which is a dead end for the
 * one visitor who matters most — the one who wants to check the claim rather than take it.
 * NOTE: these 404 until the repository is made public.
 */
export const REPO_URL = "https://github.com/nadaamd/sable"
export const EXPLAINER_URL = `${REPO_URL}/blob/main/SABLE-EXPLAINED.md`

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
