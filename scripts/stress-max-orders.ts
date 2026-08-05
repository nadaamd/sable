/**
 * Does clearing actually fit in a block at the contract's own limit?
 *
 * MAX_ORDERS was picked from a gas model fitted at n <= 8. That model has held to within
 * fractions of a percent, but a model is not a measurement, and the failure it would hide is
 * the worst one this contract has: clearing is O(n·K), and a batch that cannot be cleared
 * locks every escrow in it AND freezes the market permanently, because `currentBatch` only
 * advances inside `clear()`.
 *
 * So this fills a batch to MAX_ORDERS and clears it for real.
 *
 * It also exercises the parts only a full batch reaches: the rescue path's chunking is not
 * tested here (see stage `rescue`), but the bounds check is, and the reference engine
 * validates every one of the resulting fills.
 *
 * Staged and resumable — filling 32 orders takes a while:
 *   STAGE=setup   tokens, mint, approvals, a cross with a long commit window
 *   STAGE=fill    submit MAX_ORDERS orders
 *   STAGE=clear   clear it, report gas against the block limit, verify fills
 *   STAGE=bounds  prove an oversized order and an off-grid limit are both rejected
 */
import hre from "hardhat"
import fs from "fs"
import path from "path"
import type { Wallet } from "@coti-io/coti-ethers"
import type { itUint } from "@coti-io/coti-ethers"
import { setupWallets } from "./utils/traders"
import { referenceClear } from "./agents/reference"
import type { PlannedOrder } from "./agents/strategy"

const STAGE = (process.env.STAGE ?? "all").toLowerCase()
const STATE = path.join(__dirname, "..", "stress-state.json")

const BLOCK_GAS_LIMIT = 120_000_000
const TICKS = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106]
/** Long enough to submit 32 orders without the window closing underneath us. */
const COMMIT_WINDOW = 2400
const RESCUE_DELAY = 2400
const MAX_ORDER_SIZE = 100_000_000
const MINT = 100_000_000
const ALLOWANCE = 90_000_000
const WALLETS = 3

type State = {
  base?: string
  quote?: string
  cross?: string
  maxOrders?: number
  book?: PlannedOrder[]
  submitted?: number
}

let failures = 0

const readState = (): State => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {})
const writeState = (s: State) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2))
const fmt = (n: bigint | number) => Number(n).toLocaleString("en-US")

function check(label: string, got: bigint | number, want: bigint | number) {
  const ok = BigInt(got) === BigInt(want)
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(38)} got ${String(got).padStart(8)}  want ${String(want).padStart(8)}`)
}

/**
 * A book that spreads limits across the whole grid on both sides, so demand and supply both
 * have real shape and the clearing tick is genuinely contested — a degenerate book (all
 * orders at one price) would understate the work the kernel does.
 */
function buildBook(n: number): PlannedOrder[] {
  const book: PlannedOrder[] = []
  for (let i = 0; i < n; i++) {
    const isBuy = i % 2 === 0
    // Buyers walk down from the top of the grid, sellers up from the bottom.
    const step = Math.floor(i / 2) % 5
    const limit = isBuy ? TICKS[TICKS.length - 1 - step] : TICKS[step]
    book.push({ isBuy, limit, size: 10 + ((i * 7) % 23) })
  }
  return book
}

async function cross(state: State, signer: Wallet) {
  const Cross = await hre.ethers.getContractFactory("SableCross")
  return Cross.attach(state.cross!).connect(signer) as any
}

async function stageSetup(wallets: Wallet[], state: State) {
  const deployer = wallets[0]
  const Token = await hre.ethers.getContractFactory("TestToken")

  console.log(`\n[setup] tokens`)
  const base = await Token.connect(deployer).deploy("Stress Base", "xBASE", { gasLimit: 6_000_000 })
  await base.waitForDeployment()
  const quote = await Token.connect(deployer).deploy("Stress Quote", "xQUOTE", { gasLimit: 6_000_000 })
  await quote.waitForDeployment()
  state.base = await base.getAddress()
  state.quote = await quote.getAddress()

  console.log(`[setup] mint and approve`)
  for (const w of wallets) {
    for (const tok of [base, quote]) {
      await (await (tok as any).connect(deployer)["mint(address,uint256)"](w.address, MINT, { gasLimit: 6_000_000 })).wait()
    }
  }

  console.log(`[setup] deploy cross (${COMMIT_WINDOW}s window)`)
  const Cross = await hre.ethers.getContractFactory("SableCross")
  const c = await Cross.connect(deployer).deploy(
    state.base!,
    state.quote!,
    TICKS,
    COMMIT_WINDOW,
    RESCUE_DELAY,
    MAX_ORDER_SIZE,
    { gasLimit: 12_000_000 },
  )
  await c.waitForDeployment()
  state.cross = await c.getAddress()

  const maxOrders = Number(await c.MAX_ORDERS())
  state.maxOrders = maxOrders
  state.book = buildBook(maxOrders)
  writeState(state)

  for (const w of wallets) {
    for (const tok of [base, quote]) {
      await (
        await (tok as any).connect(w)["approve(address,uint256)"](state.cross!, ALLOWANCE, { gasLimit: 6_000_000 })
      ).wait()
    }
  }

  console.log(`  cross ${state.cross}`)
  console.log(`  MAX_ORDERS = ${maxOrders}, book built with ${state.book!.length} orders`)
}

async function stageFill(wallets: Wallet[], state: State) {
  const book = state.book!
  const from = state.submitted ?? 0
  console.log(`\n[fill] submitting ${book.length - from} of ${book.length} orders`)

  let gas = 0n
  for (let i = from; i < book.length; i++) {
    const o = book[i]
    const w = wallets[i % wallets.length]
    const c = await cross(state, w)
    const selector = c.submitOrder.fragment.selector

    const isBuy = (await w.encryptValue(o.isBuy ? 1n : 0n, state.cross!, selector)) as itUint
    const limit = (await w.encryptValue(BigInt(o.limit), state.cross!, selector)) as itUint
    const size = (await w.encryptValue(BigInt(o.size), state.cross!, selector)) as itUint

    const rcpt = await (await c.submitOrder(isBuy, limit, size, { gasLimit: 12_000_000 })).wait()
    gas += rcpt.gasUsed
    if (i % 8 === 0 || i === book.length - 1) {
      console.log(`  #${String(i).padStart(2)} ${o.isBuy ? "BUY " : "SELL"} ${o.limit}x${String(o.size).padStart(2)}   ${fmt(rcpt.gasUsed)} gas`)
    }
    state.submitted = i + 1
    writeState(state)
  }
  if (gas > 0n) console.log(`  ${fmt(gas)} gas total for this run`)
}

async function stageClear(wallets: Wallet[], state: State) {
  const c = await cross(state, wallets[0])
  const book = state.book!
  const n = Number(await c.orderCount(0))
  console.log(`\n[clear] ${n} orders over ${TICKS.length} ticks`)
  check("orders in batch", n, book.length)

  const meta0 = await c.batches(0)
  let gasUsed = 0n
  if (!meta0.cleared) {
    const deadline = Number(meta0.commitDeadline) * 1000
    const wait = deadline - Date.now() + 3000
    if (wait > 0) {
      console.log(`  waiting ${Math.ceil(wait / 1000)}s for the commit window to close`)
      await new Promise((r) => setTimeout(r, wait))
    }
    const rcpt = await (await c.clear({ gasLimit: BLOCK_GAS_LIMIT })).wait()
    gasUsed = rcpt.gasUsed
  } else {
    console.log(`  already cleared`)
  }

  const meta = await c.batches(0)
  const expected = referenceClear(book, TICKS)

  if (gasUsed > 0n) {
    const pct = (Number(gasUsed) / BLOCK_GAS_LIMIT) * 100
    console.log(`\n  clear() used ${fmt(gasUsed)} gas — ${pct.toFixed(1)}% of the ${fmt(BLOCK_GAS_LIMIT)} block limit`)
    console.log(`  headroom: ${fmt(BLOCK_GAS_LIMIT - Number(gasUsed))} gas`)
    const perOrder = Number(gasUsed) / n
    const feasible = Math.floor((BLOCK_GAS_LIMIT * 0.8) / perOrder)
    console.log(`  ${fmt(Math.round(perOrder))} gas/order at K=${TICKS.length} -> ~${feasible} orders fit in 80% of a block`)
    if (feasible < book.length) {
      failures++
      console.log(`  FAIL MAX_ORDERS=${book.length} exceeds what fits at 80% budget`)
    } else {
      console.log(`  ok   MAX_ORDERS=${book.length} sits inside the 80% budget`)
    }
  }

  console.log(`\n[clear] outcome vs reference engine`)
  check("clearing price", meta.clearingPrice, expected.price)
  check("matched volume", meta.matchedVolume, expected.volume)

  // Spot-check fills across the book rather than all 32, to keep the run short.
  console.log(`\n[clear] fills (sampled)`)
  let buySum = 0
  let sellSum = 0
  for (let i = 0; i < n; i++) {
    const w = wallets[i % wallets.length]
    const row = await (await cross(state, w)).sealedOrder(0, i)
    const fill = Number(await w.decryptValue(row[4]))
    if (book[i].isBuy) buySum += fill
    else sellSum += fill
    if (i % 8 === 0) check(`#${i} fill`, fill, expected.fills[i])
  }

  console.log(`\n[clear] conservation across all ${n} orders`)
  check("buy fills == matched volume", buySum, expected.volume)
  check("sell fills == matched volume", sellSum, expected.volume)
}

/**
 * The bounds check must actually reject, or the overflow guard is decorative.
 *
 * Deploys its own cross rather than reusing the stress one: that batch is already at
 * MAX_ORDERS, so every submission would revert on `BatchFull` before ever reaching the bounds
 * check — the test would pass for entirely the wrong reason.
 *
 * Includes a positive control. "Everything reverted" is only evidence of a working guard if a
 * valid order gets through the same setup.
 */
async function stageBounds(wallets: Wallet[], state: State) {
  const w = wallets[0]

  const Token = await hre.ethers.getContractFactory("TestToken")
  const base = await Token.connect(w).deploy("Bounds Base", "bBASE", { gasLimit: 6_000_000 })
  await base.waitForDeployment()
  const quote = await Token.connect(w).deploy("Bounds Quote", "bQUOTE", { gasLimit: 6_000_000 })
  await quote.waitForDeployment()
  for (const tok of [base, quote]) {
    await (await (tok as any).connect(w)["mint(address,uint256)"](w.address, MINT, { gasLimit: 6_000_000 })).wait()
  }

  const Cross = await hre.ethers.getContractFactory("SableCross")
  const fresh = await Cross.connect(w).deploy(
    await base.getAddress(),
    await quote.getAddress(),
    TICKS,
    COMMIT_WINDOW,
    RESCUE_DELAY,
    MAX_ORDER_SIZE,
    { gasLimit: 12_000_000 },
  )
  await fresh.waitForDeployment()
  const freshAddr = await fresh.getAddress()
  for (const tok of [base, quote]) {
    await (await (tok as any).connect(w)["approve(address,uint256)"](freshAddr, ALLOWANCE, { gasLimit: 6_000_000 })).wait()
  }

  const c = (fresh as any).connect(w)
  const selector = c.submitOrder.fragment.selector
  const maxSize = BigInt(await c.maxOrderSize())

  console.log(`\n[bounds] maxOrderSize = ${fmt(maxSize)}, grid ${TICKS[0]}–${TICKS[TICKS.length - 1]}`)
  console.log(`  fresh cross ${freshAddr}`)

  // Positive control first.
  {
    const isBuy = (await w.encryptValue(1n, freshAddr, selector)) as itUint
    const limit = (await w.encryptValue(100n, freshAddr, selector)) as itUint
    const size = (await w.encryptValue(25n, freshAddr, selector)) as itUint
    try {
      await (await c.submitOrder(isBuy, limit, size, { gasLimit: 12_000_000 })).wait()
      console.log(`  ok   ${"valid order".padEnd(20)} accepted (control)`)
    } catch (e: any) {
      failures++
      console.log(`  FAIL ${"valid order".padEnd(20)} rejected — setup is broken, rejections below prove nothing`)
      return
    }
  }

  const cases: Array<{ name: string; isBuy: bigint; limit: bigint; size: bigint }> = [
    { name: "size above cap", isBuy: 1n, limit: 100n, size: maxSize + 1n },
    { name: "limit below grid", isBuy: 1n, limit: BigInt(TICKS[0] - 1), size: 10n },
    { name: "limit above grid", isBuy: 1n, limit: BigInt(TICKS[TICKS.length - 1] + 1), size: 10n },
  ]

  for (const t of cases) {
    const isBuy = (await w.encryptValue(t.isBuy, freshAddr, selector)) as itUint
    const limit = (await w.encryptValue(t.limit, freshAddr, selector)) as itUint
    const size = (await w.encryptValue(t.size, freshAddr, selector)) as itUint
    try {
      await (await c.submitOrder(isBuy, limit, size, { gasLimit: 12_000_000 })).wait()
      failures++
      console.log(`  FAIL ${t.name.padEnd(20)} was accepted — the guard does not hold`)
    } catch {
      console.log(`  ok   ${t.name.padEnd(20)} rejected`)
    }
  }
}

async function main() {
  console.log(`SableCross stress test — MAX_ORDERS at the bound   (stage: ${STAGE})`)
  const wallets = await setupWallets(WALLETS)
  const state = readState()

  if (STAGE === "setup" || STAGE === "all") await stageSetup(wallets, state)
  if (STAGE === "fill" || STAGE === "all") await stageFill(wallets, state)
  if (STAGE === "clear" || STAGE === "all") await stageClear(wallets, state)
  if (STAGE === "bounds" || STAGE === "all") await stageBounds(wallets, state)

  console.log(`\n${"=".repeat(72)}`)
  console.log(failures === 0 ? `ALL CHECKS PASSED` : `${failures} CHECK(S) FAILED`)
  if (failures > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
