/**
 * SableCross end-to-end on COTI testnet, with three independent traders.
 *
 * This is the test that matters: the spike proved the clearing kernel, but everything that
 * makes SableCross a market rather than a calculator is only exercised here — escrow,
 * multi-trader sealed orders, per-trader fill offboarding, conservation of value, and the
 * property that one trader cannot read another's fill.
 *
 * The book is distributed across traders and its outcome is computed by hand:
 *
 *   idx trader side  limit size | fill baseOut quoteOut
 *    0    A     BUY   102    60 |  51     51       969
 *    1    B     BUY   101    40 |  34     34       606
 *    2    C     BUY   100    20 |   0      0      2000   (out of the money at 101)
 *    3    C     SELL   99    30 |  30      0      3030
 *    4    B     SELL  100    30 |  30      0      3030
 *    5    A     SELL  101    25 |  25      0      2525
 *
 *   clearing price 101, matched volume 85
 *   base:  85 in / 85 out      quote: 12,160 in / 12,160 out      exact both sides
 *
 * Staged and resumable, because the commit window is a wall-clock deadline:
 *   STAGE=setup   wallets, tokens, mint, approve, deploy
 *   STAGE=submit  the six sealed orders
 *   STAGE=clear   wait out the window, clear, assert price/volume/fills/legs
 *   STAGE=claim   settle, assert net token balances, assert cross-trader privacy
 */
import hre from "hardhat"
import fs from "fs"
import path from "path"
import { CotiNetwork, getDefaultProvider, Wallet } from "@coti-io/coti-ethers"
import type { itUint } from "@coti-io/coti-ethers"

const STAGE = (process.env.STAGE ?? "all").toLowerCase()
const ENV = path.join(__dirname, "..", ".env")
const STATE = path.join(__dirname, "..", "cross-e2e-state.json")

const TICKS = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106]
const COMMIT_WINDOW = 150 // seconds
const RESCUE_DELAY = 300 // must be >= COMMIT_WINDOW; see SableCross.rescueDelay
const MAX_ORDER_SIZE = 100_000_000 // MAX_ORDERS * this must stay inside 32 bits
const TRADERS = 3
const MIN_GAS_BALANCE = 10n ** 17n // 0.1 COTI is plenty at ~0.005 gwei
const FUND_AMOUNT = 5n * 10n ** 17n // 0.5 COTI
const MINT = 1_000_000
const ALLOWANCE = 500_000

const EXPECTED_PRICE = 101n
const EXPECTED_VOLUME = 85n

type Leg = { trader: number; isBuy: boolean; limit: number; size: number; fill: bigint; baseOut: bigint; quoteOut: bigint }

const BOOK: Leg[] = [
  { trader: 0, isBuy: true, limit: 102, size: 60, fill: 51n, baseOut: 51n, quoteOut: 969n },
  { trader: 1, isBuy: true, limit: 101, size: 40, fill: 34n, baseOut: 34n, quoteOut: 606n },
  { trader: 2, isBuy: true, limit: 100, size: 20, fill: 0n, baseOut: 0n, quoteOut: 2000n },
  { trader: 2, isBuy: false, limit: 99, size: 30, fill: 30n, baseOut: 0n, quoteOut: 3030n },
  { trader: 1, isBuy: false, limit: 100, size: 30, fill: 30n, baseOut: 0n, quoteOut: 3030n },
  { trader: 0, isBuy: false, limit: 101, size: 25, fill: 25n, baseOut: 0n, quoteOut: 2525n },
]

/** Net token movement per trader once everything settles. */
const NET: Array<{ base: bigint; quote: bigint }> = [
  { base: 26n, quote: -2626n }, // A: bought 51 @101, sold 25 @101
  { base: 4n, quote: -404n }, // B: bought 34, sold 30
  { base: -30n, quote: 3030n }, // C: buy unfilled and refunded, sold 30
]

type State = {
  base?: string
  quote?: string
  cross?: string
  submitted?: number
  balancesBefore?: Array<{ base: string; quote: string }>
}

let failures = 0

// ------------------------------------------------------------------- utilities

const readState = (): State => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {})
const writeState = (s: State) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2))
const fmt = (n: bigint | number) => Number(n).toLocaleString("en-US")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Parse .env into a map (later assignments win, as dotenv does) and rewrite it whole. */
function readEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(ENV)) return out
  for (const line of fs.readFileSync(ENV, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

function writeEnv(env: Record<string, string>) {
  const body = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
  fs.writeFileSync(ENV, body + "\n", "utf8")
}

function check(label: string, got: bigint, want: bigint) {
  const ok = got === want
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(44)} got ${String(got).padStart(8)}  want ${String(want).padStart(8)}`)
}

/**
 * Loads (creating as needed) TRADERS wallets, tops them up for gas from wallet 0, and
 * onboards an AES key for each. Keys are persisted so every stage sees the same traders.
 */
async function setupTraders(): Promise<Wallet[]> {
  const provider = getDefaultProvider(CotiNetwork.Testnet)
  const env = readEnv()

  let pks = (env.SIGNING_KEYS ?? "").split(",").filter(Boolean)
  const created = TRADERS - pks.length
  for (let i = 0; i < created; i++) pks.push(Wallet.createRandom().privateKey)
  if (created > 0) {
    env.SIGNING_KEYS = pks.join(",")
    env.PUBLIC_KEYS = pks.map((pk) => new Wallet(pk).address).join(",")
    writeEnv(env)
    console.log(`  created ${created} new trader wallet(s)`)
  }

  const wallets = pks.slice(0, TRADERS).map((pk) => new Wallet(pk, provider))
  const funder = wallets[0]

  const funderBal = await provider.getBalance(funder.address)
  console.log(`  funder ${funder.address}  ${Number(funderBal) / 1e18} COTI`)
  if (funderBal === 0n) throw new Error(`Fund ${funder.address} free at https://faucet.coti.io`)

  // Top up the other traders for gas.
  for (let i = 1; i < wallets.length; i++) {
    const bal = await provider.getBalance(wallets[i].address)
    if (bal < MIN_GAS_BALANCE) {
      console.log(`  funding trader ${i} ${wallets[i].address} with ${Number(FUND_AMOUNT) / 1e18} COTI`)
      await (await funder.sendTransaction({ to: wallets[i].address, value: FUND_AMOUNT })).wait()
    }
  }

  // AES keys: needed before any encrypted input or decryption.
  const userKeys = (env.USER_KEYS ?? "").split(",").filter(Boolean)
  const resolved: string[] = []
  for (let i = 0; i < wallets.length; i++) {
    if (userKeys[i]) {
      wallets[i].setAesKey(userKeys[i])
      resolved.push(userKeys[i])
    } else {
      console.log(`  onboarding AES key for trader ${i}...`)
      await wallets[i].generateOrRecoverAes()
      resolved.push(wallets[i].getUserOnboardInfo()!.aesKey!)
    }
  }
  const env2 = readEnv()
  env2.USER_KEYS = resolved.join(",")
  writeEnv(env2)

  wallets.forEach((w, i) => console.log(`  trader ${"ABC"[i]} ${w.address}`))
  return wallets
}

// ---------------------------------------------------------------------- stages

async function stageSetup(traders: Wallet[], state: State) {
  console.log(`\n[setup] deploy tokens`)
  const Token = await hre.ethers.getContractFactory("TestToken")

  const base = await Token.connect(traders[0]).deploy("Sable Base", "sBASE", { gasLimit: 6_000_000 })
  await base.waitForDeployment()
  state.base = await base.getAddress()

  const quote = await Token.connect(traders[0]).deploy("Sable Quote", "sQUOTE", { gasLimit: 6_000_000 })
  await quote.waitForDeployment()
  state.quote = await quote.getAddress()
  writeState(state)
  console.log(`  base  ${state.base}`)
  console.log(`  quote ${state.quote}`)

  console.log(`\n[setup] mint ${fmt(MINT)} of each token to each trader`)
  for (const t of traders) {
    for (const tok of [base, quote]) {
      await (await (tok as any).connect(traders[0])["mint(address,uint256)"](t.address, MINT, { gasLimit: 6_000_000 })).wait()
    }
  }

  console.log(`\n[setup] deploy SableCross (K=${TICKS.length} ticks, ${COMMIT_WINDOW}s window)`)
  const Cross = await hre.ethers.getContractFactory("SableCross")
  const cross = await Cross.connect(traders[0]).deploy(state.base!, state.quote!, TICKS, COMMIT_WINDOW, RESCUE_DELAY, MAX_ORDER_SIZE, {
    gasLimit: 12_000_000,
  })
  await cross.waitForDeployment()
  state.cross = await cross.getAddress()
  writeState(state)
  console.log(`  cross ${state.cross}`)

  console.log(`\n[setup] approve the cross to pull escrow`)
  for (let i = 0; i < traders.length; i++) {
    for (const tok of [base, quote]) {
      await (await (tok as any).connect(traders[i])["approve(address,uint256)"](state.cross!, ALLOWANCE, { gasLimit: 6_000_000 })).wait()
    }
    console.log(`  trader ${"ABC"[i]} approved both tokens`)
  }

  // Record starting balances so the claim stage can assert net movement.
  state.balancesBefore = []
  for (let i = 0; i < traders.length; i++) {
    state.balancesBefore.push({
      base: (await readBalance(base, traders[i])).toString(),
      quote: (await readBalance(quote, traders[i])).toString(),
    })
  }
  writeState(state)
  console.log(`  recorded opening balances`)
}

async function readBalance(token: any, trader: Wallet): Promise<bigint> {
  const ct = await token.connect(trader)["balanceOf(address)"](trader.address)
  return BigInt(await trader.decryptValue256(ct))
}

async function stageSubmit(traders: Wallet[], state: State) {
  const cross = await attachCross(state, traders[0])
  const selector = cross.submitOrder.fragment.selector
  const from = state.submitted ?? 0

  console.log(`\n[submit] ${BOOK.length - from} sealed order(s)`)
  for (let i = from; i < BOOK.length; i++) {
    const o = BOOK[i]
    const t = traders[o.trader]
    const c = cross.connect(t) as any

    const isBuy = (await t.encryptValue(o.isBuy ? 1n : 0n, state.cross!, selector)) as itUint
    const limit = (await t.encryptValue(BigInt(o.limit), state.cross!, selector)) as itUint
    const size = (await t.encryptValue(BigInt(o.size), state.cross!, selector)) as itUint

    const rcpt = await (await c.submitOrder(isBuy, limit, size, { gasLimit: 12_000_000 })).wait()
    console.log(
      `  #${i} ${"ABC"[o.trader]} ${o.isBuy ? "BUY " : "SELL"} ${String(o.limit).padStart(3)}x${String(o.size).padStart(3)}` +
        `   ${fmt(rcpt.gasUsed).padStart(10)} gas`,
    )
    state.submitted = i + 1
    writeState(state)
  }

  const meta = await cross.batches(0)
  console.log(`  commit deadline ${new Date(Number(meta.commitDeadline) * 1000).toISOString()}`)
}

async function stageClear(traders: Wallet[], state: State) {
  const cross = await attachCross(state, traders[0])
  const meta = await cross.batches(0)
  const deadline = Number(meta.commitDeadline) * 1000

  if (meta.cleared) {
    console.log(`\n[clear] batch already cleared — re-running assertions only`)
  } else {
    const waitMs = deadline - Date.now() + 3000
    if (waitMs > 0) {
      console.log(`\n[clear] commit window open, waiting ${Math.ceil(waitMs / 1000)}s`)
      await sleep(waitMs)
    }

    console.log(`[clear] clearing the batch`)
    const rcpt = await (await (cross.connect(traders[0]) as any).clear({ gasLimit: 120_000_000 })).wait()
    console.log(`  ${fmt(rcpt.gasUsed)} gas for ${BOOK.length} orders over ${TICKS.length} ticks`)
  }

  const m = await cross.batches(0)
  console.log(`\n[clear] cross`)
  check("clearing price", m.clearingPrice, EXPECTED_PRICE)
  check("matched volume", m.matchedVolume, EXPECTED_VOLUME)

  console.log(`\n[clear] per-order fill, decrypted by its owner`)
  let fillBuy = 0n
  let fillSell = 0n

  for (let i = 0; i < BOOK.length; i++) {
    const o = BOOK[i]
    const t = traders[o.trader]
    // Positional access, NOT row.fill: ethers returns a Result that is also an Array, so
    // Array.prototype.fill shadows the named output. Index 1 is the fill.
    const row = await cross.orderOf(0, i)
    const fill = BigInt(await t.decryptValue(row[1]))

    const tag = `#${i} ${"ABC"[o.trader]} ${o.isBuy ? "BUY " : "SELL"} ${o.limit}x${o.size}`
    check(`${tag} fill`, fill, o.fill)

    if (o.isBuy) fillBuy += fill
    else fillSell += fill
  }

  // The invariant the whole allocation formula exists to protect. Read from the chain, not
  // from the table: naive pro-rata would fail exactly here.
  console.log(`\n[clear] conservation of value (from decrypted fills)`)
  check("buy-side fills == matched volume", fillBuy, EXPECTED_VOLUME)
  check("sell-side fills == matched volume", fillSell, EXPECTED_VOLUME)

  // The settlement legs are network-key ciphertexts, so they cannot be read here. The
  // hand-computed table below is validated for internal consistency now, and validated
  // against the contract by the net balance assertions in the claim stage.
  console.log(`\n[clear] expected settlement table is self-consistent`)
  const baseIn = BOOK.filter((o) => !o.isBuy).reduce((s, o) => s + BigInt(o.size), 0n)
  const quoteIn = BOOK.filter((o) => o.isBuy).reduce((s, o) => s + BigInt(o.size) * BigInt(o.limit), 0n)
  const baseOutSum = BOOK.reduce((s, o) => s + o.baseOut, 0n)
  const quoteOutSum = BOOK.reduce((s, o) => s + o.quoteOut, 0n)
  check("base escrowed == base paid out", baseIn, baseOutSum)
  check("quote escrowed == quote paid out", quoteIn, quoteOutSum)
}

async function stageClaim(traders: Wallet[], state: State) {
  const cross = await attachCross(state, traders[0])
  const Token = await hre.ethers.getContractFactory("TestToken")
  const base = Token.attach(state.base!) as any
  const quote = Token.attach(state.quote!) as any

  console.log(`\n[claim] each trader settles their own orders`)
  for (let i = 0; i < traders.length; i++) {
    const rcpt = await (await (cross.connect(traders[i]) as any).claim(0, { gasLimit: 30_000_000 })).wait()
    console.log(`  trader ${"ABC"[i]} claimed  ${fmt(rcpt.gasUsed).padStart(10)} gas`)
  }

  console.log(`\n[claim] net token movement per trader`)
  for (let i = 0; i < traders.length; i++) {
    const before = state.balancesBefore![i]
    const nowBase = await readBalance(base.connect(traders[i]), traders[i])
    const nowQuote = await readBalance(quote.connect(traders[i]), traders[i])
    check(`trader ${"ABC"[i]} base delta`, nowBase - BigInt(before.base), NET[i].base)
    check(`trader ${"ABC"[i]} quote delta`, nowQuote - BigInt(before.quote), NET[i].quote)
  }

  // The privacy claim, tested rather than asserted: B must not be able to read A's fill.
  console.log(`\n[claim] cross-trader privacy`)
  const aFill = (await cross.orderOf(0, 0))[1]
  let leaked: bigint | null = null
  try {
    leaked = BigInt(await traders[1].decryptValue(aFill))
  } catch {
    leaked = null
  }
  if (leaked === BOOK[0].fill) {
    failures++
    console.log(`  FAIL trader B decrypted A's fill (${leaked}) — offboarding is not isolating`)
  } else {
    console.log(`  ok   trader B cannot recover A's fill of ${BOOK[0].fill} (got ${leaked === null ? "decrypt error" : leaked})`)
  }
}

async function attachCross(state: State, signer: Wallet) {
  if (!state.cross) throw new Error(`No SableCross deployed — run STAGE=setup first.`)
  const Cross = await hre.ethers.getContractFactory("SableCross")
  return Cross.attach(state.cross).connect(signer) as any
}

// ------------------------------------------------------------------------ main

async function main() {
  console.log(`SableCross end-to-end — COTI testnet   (stage: ${STAGE})`)
  const traders = await setupTraders()
  const state = readState()

  if (STAGE === "setup" || STAGE === "all") await stageSetup(traders, state)
  if (STAGE === "submit" || STAGE === "all") await stageSubmit(traders, state)
  if (STAGE === "clear" || STAGE === "all") await stageClear(traders, state)
  if (STAGE === "claim" || STAGE === "all") await stageClaim(traders, state)

  console.log(`\n${"=".repeat(72)}`)
  console.log(failures === 0 ? `ALL CHECKS PASSED` : `${failures} CHECK(S) FAILED`)
  if (failures > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
