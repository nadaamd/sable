/**
 * Generates a fresh testnet wallet and writes it to .env.
 *
 * Deliberately does NOT onboard the AES key: onboarding is an on-chain transaction,
 * so it needs gas. Order of operations is generate -> fund from the free faucet ->
 * run the spike (which onboards on first use).
 */
import fs from "fs"
import path from "path"
import { CotiNetwork, getDefaultProvider, Wallet } from "@coti-io/coti-ethers"

const ENV = path.join(__dirname, "..", ".env")

async function main() {
  if (fs.existsSync(ENV) && /^SIGNING_KEYS=.+/m.test(fs.readFileSync(ENV, "utf8"))) {
    const provider = getDefaultProvider(CotiNetwork.Testnet)
    const pk = fs.readFileSync(ENV, "utf8").match(/^SIGNING_KEYS=(.+)$/m)![1].split(",")[0]
    const w = new Wallet(pk, provider)
    const bal = await provider.getBalance(w.address)
    console.log(`Wallet already in .env: ${w.address}`)
    console.log(`Balance: ${Number(bal) / 1e18} COTI`)
    if (bal === 0n) printFaucet(w.address)
    return
  }

  const provider = getDefaultProvider(CotiNetwork.Testnet)
  const w = Wallet.createRandom(provider)

  fs.appendFileSync(ENV, `PUBLIC_KEYS=${w.address}\nSIGNING_KEYS=${w.privateKey}\nUSER_KEYS=\n`, "utf8")

  console.log(`Created testnet wallet: ${w.address}`)
  console.log(`Private key written to .env (gitignored — testnet only, never reuse on mainnet).`)
  printFaucet(w.address)
}

function printFaucet(address: string) {
  console.log(`\n--- FUND IT (free) ---`)
  console.log(`  Web faucet:  https://faucet.coti.io`)
  console.log(`  Discord bot: https://discord.coti.io  ->  send "testnet ${address}"`)
  console.log(`  Address:     ${address}`)
  console.log(`\nThen: npm run spike`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
