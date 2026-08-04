/**
 * Shared testnet wallet plumbing: create N wallets, keep them funded for gas, and onboard
 * an AES key for each. Keys persist in .env so every stage of a staged run sees the same
 * identities.
 */
import fs from "fs"
import path from "path"
import { CotiNetwork, getDefaultProvider, Wallet } from "@coti-io/coti-ethers"

const ENV = path.join(__dirname, "..", "..", ".env")

const MIN_GAS_BALANCE = 10n ** 17n // 0.1 COTI — plenty at ~0.005 gwei
const FUND_AMOUNT = 5n * 10n ** 17n // 0.5 COTI

/** Parse .env into a map; later assignments win, as dotenv does. */
export function readEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(ENV)) return out
  for (const line of fs.readFileSync(ENV, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

export function writeEnv(env: Record<string, string>) {
  fs.writeFileSync(
    ENV,
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    "utf8",
  )
}

/**
 * Wallet 0 is the funder — it must already hold testnet COTI from the free faucet. The
 * rest are created on demand and topped up from it.
 */
export async function setupWallets(count: number, labels?: string[]): Promise<Wallet[]> {
  const provider = getDefaultProvider(CotiNetwork.Testnet)
  const env = readEnv()

  const pks = (env.SIGNING_KEYS ?? "").split(",").filter(Boolean)
  const created = count - pks.length
  for (let i = 0; i < created; i++) pks.push(Wallet.createRandom().privateKey)
  if (created > 0) {
    env.SIGNING_KEYS = pks.join(",")
    env.PUBLIC_KEYS = pks.map((pk) => new Wallet(pk).address).join(",")
    writeEnv(env)
    console.log(`  created ${created} new wallet(s)`)
  }

  const wallets = pks.slice(0, count).map((pk) => new Wallet(pk, provider))
  const funder = wallets[0]

  const funderBal = await provider.getBalance(funder.address)
  console.log(`  funder ${funder.address}  ${Number(funderBal) / 1e18} COTI`)
  if (funderBal === 0n) throw new Error(`Fund ${funder.address} free at https://faucet.coti.io`)

  for (let i = 1; i < wallets.length; i++) {
    if ((await provider.getBalance(wallets[i].address)) < MIN_GAS_BALANCE) {
      console.log(`  topping up ${wallets[i].address}`)
      await (await funder.sendTransaction({ to: wallets[i].address, value: FUND_AMOUNT })).wait()
    }
  }

  // AES keys must exist before any encrypted input or decryption.
  const userKeys = (env.USER_KEYS ?? "").split(",").filter(Boolean)
  const resolved: string[] = []
  for (let i = 0; i < wallets.length; i++) {
    if (userKeys[i]) {
      wallets[i].setAesKey(userKeys[i])
      resolved.push(userKeys[i])
    } else {
      console.log(`  onboarding AES key for wallet ${i}...`)
      await wallets[i].generateOrRecoverAes()
      resolved.push(wallets[i].getUserOnboardInfo()!.aesKey!)
    }
  }
  const env2 = readEnv()
  env2.USER_KEYS = resolved.join(",")
  writeEnv(env2)

  wallets.forEach((w, i) => console.log(`  ${(labels?.[i] ?? `wallet ${i}`).padEnd(10)} ${w.address}`))
  return wallets
}
