/**
 * Does clearing really cost the same gas on two books that share no order?
 *
 * The landing page says so — "Clearing cost the same gas, to the unit, on two books sharing no
 * order" — and nothing in this repo measured it. The structural argument is sound (the kernel
 * cannot branch on an encrypted value, so it runs the same circuit whatever the values are) and
 * the gas curve in spike-report.json is consistent with it, gas moving only with n and K. But
 * consistent is not measured, and the page claims measured.
 *
 * This settles it. Two books of the SAME length over the SAME grid, sharing no order and not even
 * the same outcome: A crosses heavily, B does not cross at all. If the kernel leaked through gas,
 * a batch that matches 65 units and a batch that matches nothing is where it would show.
 *
 *   npx hardhat run scripts/gas-uniformity.ts --network coti-testnet
 *
 * Uses GasSpike, the instrumented copy of the clearing kernel, so nothing here touches a live
 * SableCross or anybody's escrow.
 */
import hre from "hardhat"
import { setupAccounts } from "./utils/accounts"
import type { itUint } from "@coti-io/coti-ethers"

const BLOCK_GAS_LIMIT = 120_000_000
const TICKS = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106]

type Order = { isBuy: boolean; limit: number; size: number }

/** Clears at 101 on a volume of 65 — the book the agents actually produce. */
const BOOK_A: Order[] = [
  { isBuy: true, limit: 103, size: 37 },
  { isBuy: true, limit: 101, size: 28 },
  { isBuy: true, limit: 99, size: 20 },
  { isBuy: false, limit: 98, size: 20 },
  { isBuy: false, limit: 100, size: 35 },
  { isBuy: false, limit: 101, size: 10 },
]

/** Never crosses: every bid sits below every ask. No limit and no size in common with A. */
const BOOK_B: Order[] = [
  { isBuy: true, limit: 96, size: 11 },
  { isBuy: true, limit: 95, size: 42 },
  { isBuy: true, limit: 97, size: 8 },
  { isBuy: false, limit: 104, size: 19 },
  { isBuy: false, limit: 106, size: 33 },
  { isBuy: false, limit: 105, size: 27 },
]

const fmt = (n: number) => n.toLocaleString("en-US")

async function send(c: any, method: string, args: any[], fallback: number): Promise<number> {
  let gasLimit = fallback
  try {
    const est = await c[method].estimateGas(...args)
    gasLimit = Math.min(BLOCK_GAS_LIMIT, Math.ceil(Number(est) * 1.4))
  } catch {
    /* fall back to the ceiling; estimation on garbled calls is unreliable */
  }
  const tx = await c[method](...args, { gasLimit })
  const rcpt = await tx.wait()
  // gasUsed from the receipt, not an estimate: "to the unit" has to mean the unit.
  return Number(rcpt!.gasUsed)
}

async function seed(spike: any, owner: any, book: Order[]) {
  const addr = await spike.getAddress()
  const selector = spike.seedOrder.fragment.selector
  const enc = async (v: bigint) => (await owner.encryptValue(v, addr, selector)) as itUint
  for (const o of book) {
    await send(
      spike,
      "seedOrder",
      [await enc(o.isBuy ? 1n : 0n), await enc(BigInt(o.limit)), await enc(BigInt(o.size))],
      6_000_000,
    )
  }
}

async function main() {
  const [owner] = await setupAccounts()
  console.log(`\nGas uniformity — two books, same shape, no order in common\n`)

  const spike = await (await hre.ethers.getContractFactory("GasSpike")).connect(owner).deploy()
  await spike.waitForDeployment()
  console.log(`  GasSpike ${await spike.getAddress()}\n`)

  /*
   * Each book is measured TWICE, and only the second run counts.
   *
   * The first attempt at this compared one run of each and reported a 17,100 gas difference,
   * which is not a leak — it is 22,100 minus 5,000, the EVM's own gap between initialising a
   * zero storage slot and overwriting a non-zero one. benchClear ends in `sink64 = offBoard(...)`,
   * so whichever book runs first pays to initialise that slot and every book after it does not.
   * Measure once each and the answer is a property of the ORDER OF THE EXPERIMENT.
   *
   * The same 17,100 shows up between the first and second order a trader submits, for the same
   * reason and with nothing to do with buy versus sell.
   */
  const runs: Array<{ label: string; cold: number; warm: number }> = []
  for (const [label, book] of [
    ["A  crosses at 101, volume 65", BOOK_A],
    ["B  does not cross at all    ", BOOK_B],
  ] as Array<[string, Order[]]>) {
    await send(spike, "resetOrders", [], 500_000)
    await seed(spike, owner, book)
    const cold = await send(spike, "benchClear", [book.length, TICKS, false], BLOCK_GAS_LIMIT)
    const warm = await send(spike, "benchClear", [book.length, TICKS, false], BLOCK_GAS_LIMIT)
    console.log(`  ${label}   first ${fmt(cold).padStart(11)}   repeat ${fmt(warm).padStart(11)} gas`)
    runs.push({ label, cold, warm })
  }

  const [a, b] = runs
  console.log(`\n${"=".repeat(72)}`)
  console.log(`  n = ${BOOK_A.length} orders, K = ${TICKS.length} ticks, identical for both books`)
  console.log(`  cold-slot artefact, A: ${fmt(a.cold - a.warm)} gas   (expect 17,100 on the first ever run)`)
  console.log(`  A repeat vs B repeat:  ${fmt(Math.abs(a.warm - b.warm))} gas`)

  const delta = Math.abs(a.warm - b.warm)
  if (delta === 0) {
    console.log(`\n  IDENTICAL TO THE UNIT. A batch that matches 65 units and a batch that matches`)
    console.log(`  nothing cost the same gas, so the kernel leaks nothing through it.`)
  } else {
    console.log(`\n  NOT IDENTICAL — ${fmt(delta)} gas apart once storage warmth is controlled for.`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
