/**
 * Does the escape hatch actually work?
 *
 * `rescue()` exists because an uncleanable batch would otherwise lock every escrow in it and
 * freeze the market permanently — `currentBatch` only advances inside `clear()`. An untested
 * escape hatch is worth nothing, so this drives the whole path:
 *
 *   1. a rescue before the delay has elapsed must be REJECTED
 *   2. after the delay it must release escrow in chunks
 *   3. the batch must end up settled with no cross, and the market must advance
 *   4. every trader must get their full escrow back — nothing matched, nothing kept
 *   5. a new batch must be usable afterwards, proving the freeze is lifted
 *
 * Uses a deliberately short window and delay so the whole thing runs in one go. On a real
 * market the delay should be generous: a premature rescue cancels a batch that could have
 * cleared, which is a griefing vector rather than a theft one.
 */
import hre from "hardhat"
import type { Wallet } from "@coti-io/coti-ethers"
import type { itUint } from "@coti-io/coti-ethers"
import { setupWallets } from "./utils/traders"

const TICKS = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106]
const COMMIT_WINDOW = 60
const RESCUE_DELAY = 60
const MAX_ORDER_SIZE = 100_000_000
const MINT = 1_000_000
const ALLOWANCE = 500_000

/** Two buys and one sell that WOULD have crossed — so a rescue is visibly a cancellation. */
const BOOK = [
  { isBuy: true, limit: 102, size: 40 },
  { isBuy: true, limit: 101, size: 30 },
  { isBuy: false, limit: 99, size: 50 },
]

let failures = 0
const fmt = (n: bigint | number) => Number(n).toLocaleString("en-US")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function check(label: string, got: bigint | number, want: bigint | number) {
  const ok = BigInt(got) === BigInt(want)
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(40)} got ${String(got).padStart(9)}  want ${String(want).padStart(9)}`)
}

function pass(label: string) {
  console.log(`  ok   ${label}`)
}

function fail(label: string) {
  failures++
  console.log(`  FAIL ${label}`)
}

async function readBalance(token: any, w: Wallet): Promise<bigint> {
  const ct = await token.connect(w)["balanceOf(address)"](w.address)
  return BigInt(await w.decryptValue256(ct))
}

async function main() {
  console.log(`SableCross rescue path\n`)
  const wallets = await setupWallets(3)
  const deployer = wallets[0]

  const Token = await hre.ethers.getContractFactory("TestToken")
  const base = await Token.connect(deployer).deploy("Rescue Base", "rBASE", { gasLimit: 6_000_000 })
  await base.waitForDeployment()
  const quote = await Token.connect(deployer).deploy("Rescue Quote", "rQUOTE", { gasLimit: 6_000_000 })
  await quote.waitForDeployment()

  for (const w of wallets) {
    for (const tok of [base, quote]) {
      await (await (tok as any).connect(deployer)["mint(address,uint256)"](w.address, MINT, { gasLimit: 6_000_000 })).wait()
    }
  }

  const Cross = await hre.ethers.getContractFactory("SableCross")
  const cross = await Cross.connect(deployer).deploy(
    await base.getAddress(),
    await quote.getAddress(),
    TICKS,
    COMMIT_WINDOW,
    RESCUE_DELAY,
    MAX_ORDER_SIZE,
    { gasLimit: 12_000_000 },
  )
  await cross.waitForDeployment()
  const crossAddr = await cross.getAddress()
  console.log(`  cross ${crossAddr} (window ${COMMIT_WINDOW}s, rescue delay ${RESCUE_DELAY}s)\n`)

  for (const w of wallets) {
    for (const tok of [base, quote]) {
      await (await (tok as any).connect(w)["approve(address,uint256)"](crossAddr, ALLOWANCE, { gasLimit: 6_000_000 })).wait()
    }
  }

  const before: Array<{ base: bigint; quote: bigint }> = []
  for (const w of wallets) before.push({ base: await readBalance(base, w), quote: await readBalance(quote, w) })

  // --- submit a book that would have crossed -------------------------------
  console.log(`[submit] a book that WOULD have crossed, then abandon it`)
  const selector = (cross as any).submitOrder.fragment.selector
  for (let i = 0; i < BOOK.length; i++) {
    const o = BOOK[i]
    const w = wallets[i]
    const c = (cross as any).connect(w)
    const isBuy = (await w.encryptValue(o.isBuy ? 1n : 0n, crossAddr, selector)) as itUint
    const limit = (await w.encryptValue(BigInt(o.limit), crossAddr, selector)) as itUint
    const size = (await w.encryptValue(BigInt(o.size), crossAddr, selector)) as itUint
    await (await c.submitOrder(isBuy, limit, size, { gasLimit: 12_000_000 })).wait()
    console.log(`  #${i} ${o.isBuy ? "BUY " : "SELL"} ${o.limit}x${o.size} escrowed`)
  }

  // --- 1. too early --------------------------------------------------------
  console.log(`\n[guard] rescue before the delay must be rejected`)
  try {
    await (await (cross as any).connect(deployer).rescue(1, { gasLimit: 30_000_000 })).wait()
    fail("rescue succeeded while the commit window was still open")
  } catch {
    pass("rejected while the window is open")
  }

  const meta0 = await (cross as any).batches(0)
  const rescueAt = Number(meta0.commitDeadline) + RESCUE_DELAY
  let waitMs = Number(meta0.commitDeadline) * 1000 - Date.now() + 3000
  if (waitMs > 0) {
    console.log(`  waiting ${Math.ceil(waitMs / 1000)}s for the commit window to close`)
    await sleep(waitMs)
  }
  try {
    await (await (cross as any).connect(deployer).rescue(1, { gasLimit: 30_000_000 })).wait()
    fail("rescue succeeded before the rescue delay elapsed")
  } catch {
    pass("rejected after the window but before the rescue delay")
  }

  waitMs = rescueAt * 1000 - Date.now() + 3000
  if (waitMs > 0) {
    console.log(`  waiting a further ${Math.ceil(waitMs / 1000)}s for the rescue delay`)
    await sleep(waitMs)
  }

  // --- 2. chunked release --------------------------------------------------
  console.log(`\n[rescue] release in chunks of 2, then 1`)
  let r = await (await (cross as any).connect(deployer).rescue(2, { gasLimit: 60_000_000 })).wait()
  console.log(`  chunk 1: ${fmt(r.gasUsed)} gas`)
  check("rescueProgress after chunk 1", await (cross as any).rescueProgress(0), 2)
  check("batch still not settled", (await (cross as any).batches(0)).cleared ? 1 : 0, 0)
  check("market still on batch 0", await (cross as any).currentBatch(), 0)

  r = await (await (cross as any).connect(wallets[1]).rescue(5, { gasLimit: 60_000_000 })).wait()
  console.log(`  chunk 2: ${fmt(r.gasUsed)} gas  (called by a different address — permissionless)`)
  check("rescueProgress after chunk 2", await (cross as any).rescueProgress(0), BOOK.length)

  // --- 3. batch settled with no cross, market unfrozen ---------------------
  console.log(`\n[rescue] batch state`)
  const meta = await (cross as any).batches(0)
  check("cleared", meta.cleared ? 1 : 0, 1)
  check("clearing price", meta.clearingPrice, 0)
  check("matched volume", meta.matchedVolume, 0)
  check("market advanced", await (cross as any).currentBatch(), 1)

  try {
    await (await (cross as any).connect(deployer).rescue(1, { gasLimit: 30_000_000 })).wait()
    fail("a settled batch could be rescued again")
  } catch {
    pass("a settled batch cannot be rescued again")
  }

  // --- 4. everyone gets their full escrow back ----------------------------
  console.log(`\n[claim] full refunds, nothing matched`)
  for (const w of wallets) {
    await (await (cross as any).connect(w).claim(0, { gasLimit: 30_000_000 })).wait()
  }
  for (let i = 0; i < wallets.length; i++) {
    const now = { base: await readBalance(base, wallets[i]), quote: await readBalance(quote, wallets[i]) }
    check(`trader ${i} base delta`, now.base - before[i].base, 0)
    check(`trader ${i} quote delta`, now.quote - before[i].quote, 0)
  }

  // --- 5. the market still works -----------------------------------------
  console.log(`\n[liveness] a new batch opens after a rescue`)
  const w = wallets[0]
  const c = (cross as any).connect(w)
  const isBuy = (await w.encryptValue(1n, crossAddr, selector)) as itUint
  const limit = (await w.encryptValue(100n, crossAddr, selector)) as itUint
  const size = (await w.encryptValue(5n, crossAddr, selector)) as itUint
  await (await c.submitOrder(isBuy, limit, size, { gasLimit: 12_000_000 })).wait()
  check("orders in the new batch", await (cross as any).orderCount(1), 1)
  pass("the freeze is lifted — a rescued market keeps trading")

  console.log(`\n${"=".repeat(72)}`)
  console.log(failures === 0 ? `ALL CHECKS PASSED` : `${failures} CHECK(S) FAILED`)
  if (failures > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
