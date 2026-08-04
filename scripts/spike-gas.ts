/**
 * Sable — gas spike.
 *
 * Answers the one question that gates the whole architecture: how many orders (n) and
 * price ticks (K) can a uniform-price batch clear in a single COTI transaction?
 *
 * It also doubles as a correctness test. The seeded book below has a hand-computed
 * answer (clearing price 100, matched volume 100), so a wrong result tells us the mux
 * semantics are the reverse of what we assumed — which no amount of gas data would.
 *
 * Staged and resumable, because faucet COTI is finite:
 *   STAGE=probe   deploy + mux/bool semantics + seed the book   (~11 tx)
 *   STAGE=micro   per-operation marginal cost                   (~19 tx)
 *   STAGE=kernel  the real clearing kernel, gas curve           (~7 tx)
 *   STAGE=all     everything
 */
import hre from "hardhat"
import fs from "fs"
import path from "path"
import { setupAccounts } from "./utils/accounts"
import type { itUint } from "@coti-io/coti-ethers"

const BLOCK_GAS_LIMIT = 120_000_000
const STAGE = (process.env.STAGE ?? "all").toLowerCase()
const STATE = path.join(__dirname, "..", "spike-state.json")
const REPORT = path.join(__dirname, "..", "spike-report.json")

/** Public price grid. K = 12 ticks, one COTI unit apart. */
const TICKS: number[] = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106]

/** The seeded book. isBuy, limit, size — see the header for the expected clearing. */
const BOOK: Array<{ isBuy: boolean; limit: number; size: number }> = [
  { isBuy: true, limit: 103, size: 50 },
  { isBuy: true, limit: 101, size: 30 },
  { isBuy: true, limit: 100, size: 20 },
  { isBuy: true, limit: 98, size: 10 },
  { isBuy: false, limit: 97, size: 40 },
  { isBuy: false, limit: 99, size: 25 },
  { isBuy: false, limit: 100, size: 35 },
  { isBuy: false, limit: 104, size: 15 },
]
const EXPECTED_PRICE = 100n
const EXPECTED_VOLUME = 100n

/**
 * Second scenario, for pro-rata: a book whose cross is DELIBERATELY unbalanced, since
 * a rationing rule is untested on a balanced one.
 *
 * At the clearing tick 101: demand = 100 (the 102 and 101 buys), supply = 85, so
 * matched = 85 and the buy side is rationed to 85%. Sizes are chosen so every quotient
 * is an exact integer — no rounding ambiguity in the assertions.
 */
const PRORATA_BOOK: Array<{ isBuy: boolean; limit: number; size: number; expect: bigint }> = [
  { isBuy: true, limit: 102, size: 60, expect: 51n }, // 60 * 85 / 100
  { isBuy: true, limit: 101, size: 40, expect: 34n }, // 40 * 85 / 100
  { isBuy: true, limit: 100, size: 20, expect: 0n }, //  out of the money at 101
  { isBuy: false, limit: 99, size: 30, expect: 30n }, // short side -> full fill
  { isBuy: false, limit: 100, size: 30, expect: 30n },
  { isBuy: false, limit: 101, size: 25, expect: 25n },
]
const PRORATA_PRICE = 101n
const PRORATA_VOLUME = 85n

type State = { address?: string; seeded?: number }
type Measurement = { label: string; gas: number; note?: string }

const results: Measurement[] = []
const readState = (): State => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {})
const writeState = (s: State) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2))
const fmt = (n: number | bigint) => Number(n).toLocaleString("en-US")
/** JSON.stringify replacer: the expected-fill literals are BigInt. */
const bigintSafe = (_k: string, v: any) => (typeof v === "bigint" ? v.toString() : v)

async function main() {
  const [owner] = await setupAccounts()
  const provider = hre.ethers.provider
  const balStart = await provider.getBalance(owner.address)

  console.log(`\nSable gas spike — COTI testnet`)
  console.log(`  signer   ${owner.address}`)
  console.log(`  balance  ${Number(balStart) / 1e18} COTI`)
  console.log(`  stage    ${STAGE}`)
  console.log(`  block gas limit  ${fmt(BLOCK_GAS_LIMIT)}\n`)

  if (balStart === 0n) throw new Error(`Wallet is empty. Fund it free at https://faucet.coti.io`)

  const state = readState()
  const spike = await getOrDeploy(owner, state)

  if (STAGE === "probe" || STAGE === "all") await runProbes(owner, spike, state)
  if (STAGE === "micro" || STAGE === "all") await runMicro(owner, spike)
  if (STAGE === "kernel" || STAGE === "all") await runKernel(owner, spike, state)
  // Last: it replaces the book with the unbalanced scenario.
  if (STAGE === "prorata" || STAGE === "all") await runProRata(owner, spike, state)

  const balEnd = await provider.getBalance(owner.address)
  report(balStart, balEnd)
}

// --------------------------------------------------------------------- helpers

/** Sized gas limit: trust estimateGas when the node can give one, else fall back. */
async function gasFor(c: any, method: string, args: any[], fallback: number): Promise<number> {
  try {
    const est = await c[method].estimateGas(...args)
    return Math.min(BLOCK_GAS_LIMIT, Math.ceil(Number(est) * 1.4))
  } catch {
    return Math.min(BLOCK_GAS_LIMIT, fallback)
  }
}

/** Send, wait, record gasUsed. Failures are recorded rather than fatal. */
async function measure(label: string, c: any, method: string, args: any[], fallback: number): Promise<number> {
  const gasLimit = await gasFor(c, method, args, fallback)
  try {
    const tx = await c[method](...args, { gasLimit })
    const rcpt = await tx.wait()
    const gas = Number(rcpt.gasUsed)
    results.push({ label, gas })
    console.log(`  ${label.padEnd(38)} ${fmt(gas).padStart(12)} gas`)
    return gas
  } catch (e: any) {
    const note = String(e?.shortMessage ?? e?.message ?? e).slice(0, 110)
    results.push({ label, gas: -1, note })
    console.log(`  ${label.padEnd(38)} ${"FAILED".padStart(12)}  ${note}`)
    return -1
  }
}

const encrypt = async (owner: any, v: bigint, addr: string, selector: string) =>
  (await owner.encryptValue(v, addr, selector)) as itUint

async function getOrDeploy(owner: any, state: State) {
  const Factory = await hre.ethers.getContractFactory("GasSpike")

  if (state.address) {
    console.log(`Reusing GasSpike at ${state.address}\n`)
    return Factory.attach(state.address).connect(owner) as any
  }

  console.log(`Deploying GasSpike...`)
  const c = await Factory.connect(owner).deploy({ gasLimit: 12_000_000 })
  await c.waitForDeployment()
  const address = await c.getAddress()
  const rcpt = await c.deploymentTransaction()!.wait()
  results.push({ label: "deploy GasSpike", gas: Number(rcpt!.gasUsed) })
  console.log(`  deployed at ${address} (${fmt(rcpt!.gasUsed)} gas)\n`)

  state.address = address
  state.seeded = 0
  writeState(state)
  return c as any
}

// ---------------------------------------------------------------------- probes

async function runProbes(owner: any, spike: any, state: State) {
  console.log(`[probe] mux semantics`)
  await measure("probeMux", spike, "probeMux", [], 3_000_000)
  const onTrue = await spike.muxOnTrue()
  const onFalse = await spike.muxOnFalse()
  // We passed mux(bit, a=111, b=222).
  const semantics =
    onTrue === 111n && onFalse === 222n
      ? "mux(bit, a, b) == bit ? a : b   [as assumed]"
      : onTrue === 222n && onFalse === 111n
        ? "mux(bit, a, b) == bit ? b : a   *** INVERTED — swap every mux in the kernel ***"
        : `unexpected: onTrue=${onTrue} onFalse=${onFalse}`
  console.log(`  -> onTrue=${onTrue} onFalse=${onFalse}`)
  console.log(`  -> ${semantics}\n`)
  results.push({ label: "MUX SEMANTICS", gas: 0, note: semantics })

  console.log(`[probe] seed the book (${BOOK.length} orders)`)
  const addr = await spike.getAddress()
  const selector = spike.seedOrder.fragment.selector
  for (let i = state.seeded ?? 0; i < BOOK.length; i++) {
    const o = BOOK[i]
    // isBuy is validated as itBool on-chain; the type tag is the contract's choice, so
    // a plain 0/1 inputtext is what the client sends.
    const isBuy = await encrypt(owner, o.isBuy ? 1n : 0n, addr, selector)
    const limit = await encrypt(owner, BigInt(o.limit), addr, selector)
    const size = await encrypt(owner, BigInt(o.size), addr, selector)
    const gas = await measure(
      `seedOrder #${i} ${o.isBuy ? "BUY " : "SELL"} ${o.limit}x${o.size}`,
      spike,
      "seedOrder",
      [isBuy, limit, size],
      6_000_000,
    )
    if (gas < 0) throw new Error(`Seeding failed at order ${i} — itBool inputtext likely rejected.`)
    state.seeded = i + 1
    writeState(state)
  }
  console.log()
}

// ----------------------------------------------------------------- micro-ops

/**
 * Marginal cost per operation = (gas at hi iters - gas at lo iters) / (hi - lo).
 * The subtraction cancels tx base cost, calldata, onboarding and the sink write.
 */
async function runMicro(owner: any, spike: any) {
  const LO = 1
  const HI = 6
  const addr = await spike.getAddress()

  const seed = await encrypt(owner, 42n, addr, spike.benchValidate.fragment.selector)

  const ops: Array<[string, string, any[]]> = [
    ["validateCiphertext", "benchValidate", [seed]],
    ["onBoard(ctUint64)", "benchOnBoard", []],
    ["setPublic64", "benchSetPublic", []],
    ["ge(gtUint64, public)", "benchGePublic", []],
    ["and(gtBool, gtBool)", "benchAnd", []],
    ["mux(cond, gt, public 0)", "benchMuxPublicZero", []],
    ["add(gtUint64, gtUint64)", "benchAdd", []],
    ["mul(gtUint64, public)", "benchMulPublic", []],
    ["div(gtUint64, gtUint64)", "benchDiv", []],
    ["min(gtUint64, gtUint64)", "benchMin", []],
    ["offBoardToUser", "benchOffBoardToUser", []],
  ]

  console.log(`[micro] marginal cost per garbled op (iters ${LO} vs ${HI})`)
  const marginals: Record<string, number> = {}
  for (const [label, method, args] of ops) {
    const lo = await measure(`${label} @${LO}`, spike, method, [...args, LO], 8_000_000)
    const hi = await measure(`${label} @${HI}`, spike, method, [...args, HI], 30_000_000)
    if (lo > 0 && hi > 0) {
      const per = Math.round((hi - lo) / (HI - LO))
      marginals[label] = per
      results.push({ label: `MARGINAL ${label}`, gas: per })
      console.log(`  ${"".padEnd(38)} -> ${fmt(per).padStart(10)} gas/op`)
    }
  }

  // Linearity check on one op: if gas is linear in iters, nothing was optimised away.
  const MID = 3
  const g1 = results.find((r) => r.label === `mux(cond, gt, public 0) @${LO}`)?.gas ?? -1
  const g6 = results.find((r) => r.label === `mux(cond, gt, public 0) @${HI}`)?.gas ?? -1
  const g3 = await measure(`mux linearity check @${MID}`, spike, "benchMuxPublicZero", [MID], 20_000_000)
  if (g1 > 0 && g3 > 0 && g6 > 0) {
    const slopeA = (g3 - g1) / (MID - LO)
    const slopeB = (g6 - g1) / (HI - LO)
    const drift = Math.abs(slopeA - slopeB) / slopeB
    const verdict = drift < 0.05 ? "LINEAR — no elision, measurements valid" : `NON-LINEAR (drift ${(drift * 100).toFixed(1)}%) — investigate`
    console.log(`  -> ${verdict}`)
    results.push({ label: "LINEARITY", gas: 0, note: verdict })
  }
  console.log()
}

// ------------------------------------------------------------------- kernel

async function runKernel(owner: any, spike: any, state: State) {
  const seeded = Number(await spike.orderCount())
  if (seeded < BOOK.length) throw new Error(`Only ${seeded} orders seeded — run STAGE=probe first.`)

  // Gas curve: enough (n, K) points to fit  gas = a + b*n + c*n*K + d*K.
  const configs: Array<[number, number]> = [
    [1, 4],
    [1, 8],
    [2, 8],
    [4, 8],
    [8, 8],
    [1, 12],
    [4, 12],
  ]

  console.log(`[kernel] clearing gas curve (n orders x K ticks)`)
  const points: Array<{ n: number; K: number; gas: number }> = []
  for (const [n, K] of configs) {
    const gas = await measure(`benchClear n=${n} K=${K}`, spike, "benchClear", [n, TICKS.slice(0, K), false], BLOCK_GAS_LIMIT)
    if (gas > 0) points.push({ n, K, gas })
  }
  console.log()

  // The correctness run: full book, full grid, reveal the clearing price publicly.
  console.log(`[kernel] correctness — full book n=${BOOK.length} K=${TICKS.length}, reveal=true`)
  const gas = await measure(`benchClear FULL reveal`, spike, "benchClear", [BOOK.length, TICKS, true], BLOCK_GAS_LIMIT)
  if (gas > 0) {
    points.push({ n: BOOK.length, K: TICKS.length, gas })
    const price = await spike.lastClearingPrice()
    const volume = await spike.lastMatchedVolume()
    const ok = price === EXPECTED_PRICE && volume === EXPECTED_VOLUME
    const verdict = ok
      ? `CORRECT — price ${price}, volume ${volume}`
      : `WRONG — got price ${price} vol ${volume}, expected ${EXPECTED_PRICE}/${EXPECTED_VOLUME}`
    console.log(`  -> ${verdict}`)
    results.push({ label: "CLEARING CORRECTNESS", gas: 0, note: verdict })
  }
  console.log()

  if (points.length >= 4) fitAndSize(points)
  fs.writeFileSync(REPORT, JSON.stringify({ ticks: TICKS, book: BOOK, points, results }, null, 2))
}

// ---------------------------------------------------------- pro-rata allocation

async function runProRata(owner: any, spike: any, state: State) {
  const addr = await spike.getAddress()
  const selector = spike.seedOrder.fragment.selector
  const n = PRORATA_BOOK.length

  console.log(`[prorata] swap in the unbalanced book (${n} orders)`)
  await measure("resetOrders", spike, "resetOrders", [], 2_000_000)
  state.seeded = 0
  writeState(state)

  for (const o of PRORATA_BOOK) {
    const isBuy = await encrypt(owner, o.isBuy ? 1n : 0n, addr, selector)
    const limit = await encrypt(owner, BigInt(o.limit), addr, selector)
    const size = await encrypt(owner, BigInt(o.size), addr, selector)
    const gas = await measure(
      `seedOrder ${o.isBuy ? "BUY " : "SELL"} ${o.limit}x${o.size}`,
      spike,
      "seedOrder",
      [isBuy, limit, size],
      6_000_000,
    )
    if (gas < 0) throw new Error(`Failed to seed the pro-rata book.`)
  }

  // Same (n, K) with clearing only, so the allocation overhead can be isolated.
  console.log(`\n[prorata] baseline vs allocation, n=${n} K=${TICKS.length}`)
  const clearOnly = await measure(`benchClear (no allocation)`, spike, "benchClear", [n, TICKS, false], BLOCK_GAS_LIMIT)
  const withAlloc = await measure(`clearAndAllocate`, spike, "clearAndAllocate", [n, TICKS], BLOCK_GAS_LIMIT)

  if (clearOnly > 0 && withAlloc > 0) {
    const overhead = withAlloc - clearOnly
    console.log(`  -> allocation overhead ${fmt(overhead)} gas total, ${fmt(Math.round(overhead / n))} gas/order`)
    results.push({ label: "PRORATA OVERHEAD per order", gas: Math.round(overhead / n) })
  }
  if (withAlloc < 0) {
    console.log(`  -> allocation FAILED — see the error above`)
    return
  }

  // Clearing outcome must still be right.
  const price = await spike.lastClearingPrice()
  const volume = await spike.lastMatchedVolume()
  const crossOk = price === PRORATA_PRICE && volume === PRORATA_VOLUME
  console.log(
    `\n[prorata] cross: price ${price} volume ${volume} — ${crossOk ? "CORRECT" : `WRONG, expected ${PRORATA_PRICE}/${PRORATA_VOLUME}`}`,
  )

  // And every individual fill, decrypted with the trader's own AES key.
  console.log(`[prorata] fills (decrypted by the owning trader):`)
  let allOk = crossOk
  let sum = 0n
  for (let i = 0; i < n; i++) {
    const ct = await spike.fills(i)
    const got = BigInt(await owner.decryptValue(ct))
    const o = PRORATA_BOOK[i]
    const ok = got === o.expect
    if (!ok) allOk = false
    if (o.isBuy) sum += got
    console.log(
      `  ${o.isBuy ? "BUY " : "SELL"} ${String(o.limit).padStart(3)}x${String(o.size).padStart(3)}` +
        `  fill ${String(got).padStart(3)}  expected ${String(o.expect).padStart(3)}  ${ok ? "ok" : "MISMATCH"}`,
    )
  }
  console.log(`  buy-side fills sum to ${sum} (matched volume ${volume}${sum === volume ? ", no dust" : `, dust ${volume - sum}`})`)

  const verdict = allOk ? "ENCRYPTED PRO-RATA CORRECT" : "ENCRYPTED PRO-RATA WRONG"
  console.log(`\n  -> ${verdict}`)
  results.push({ label: "PRORATA CORRECTNESS", gas: 0, note: verdict })
  fs.writeFileSync(REPORT, JSON.stringify({ ticks: TICKS, prorataBook: PRORATA_BOOK, results }, bigintSafe, 2))
}

/** Least squares on gas = a + b*n + c*n*K + d*K, then answer the sizing question. */
function fitAndSize(points: Array<{ n: number; K: number; gas: number }>) {
  const X = points.map((p) => [1, p.n, p.n * p.K, p.K])
  const y = points.map((p) => p.gas)
  const beta = leastSquares(X, y)
  if (!beta) {
    console.log(`[fit] singular system — not enough distinct points`)
    return
  }
  const [a, b, c, d] = beta
  const predict = (n: number, K: number) => a + b * n + c * n * K + d * K

  console.log(`[fit] gas(n, K) = ${Math.round(a)} + ${Math.round(b)}*n + ${Math.round(c)}*n*K + ${Math.round(d)}*K`)
  const err = points.map((p) => Math.abs(predict(p.n, p.K) - p.gas) / p.gas)
  console.log(`      max residual ${(Math.max(...err) * 100).toFixed(1)}%`)

  // 80% of the block limit: leave room for gas price swings and node variance.
  const budget = BLOCK_GAS_LIMIT * 0.8
  console.log(`\n[sizing] max orders per single clearing tx, budget ${fmt(Math.round(budget))} gas (80% of block):`)
  for (const K of [4, 8, 12, 16]) {
    let n = 0
    while (predict(n + 1, K) <= budget && n < 5000) n++
    console.log(`  K=${String(K).padStart(2)} ticks  ->  n = ${String(n).padStart(4)} orders   (${fmt(Math.round(predict(n, K)))} gas)`)
  }
  console.log(`\n[verdict] single-transaction clearing is ${predict(20, 12) <= budget ? "VIABLE" : "NOT viable"} at the n=20, K=12 target.`)
  console.log(`          gas(20, 12) = ${fmt(Math.round(predict(20, 12)))}`)
  if (predict(20, 12) > budget) {
    const perOrder = b + c * 12
    console.log(`          -> shard: ~${Math.floor(budget / perOrder)} orders per clearChunk() tx at K=12.`)
  }
}

/** Normal equations with Gaussian elimination. Small, dense, well-conditioned enough. */
function leastSquares(X: number[][], y: number[]): number[] | null {
  const p = X[0].length
  const A: number[][] = Array.from({ length: p }, () => Array(p + 1).fill(0))
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) A[i][j] = X.reduce((s, r) => s + r[i] * r[j], 0)
    A[i][p] = X.reduce((s, r, k) => s + r[i] * y[k], 0)
  }
  for (let i = 0; i < p; i++) {
    let piv = i
    for (let r = i + 1; r < p; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r
    if (Math.abs(A[piv][i]) < 1e-9) return null
    ;[A[i], A[piv]] = [A[piv], A[i]]
    for (let r = 0; r < p; r++) {
      if (r === i) continue
      const f = A[r][i] / A[i][i]
      for (let cc = i; cc <= p; cc++) A[r][cc] -= f * A[i][cc]
    }
  }
  return A.map((row, i) => row[p] / A[i][i])
}

function report(balStart: bigint, balEnd: bigint) {
  const spent = Number(balStart - balEnd) / 1e18
  console.log(`\n${"=".repeat(64)}`)
  console.log(`spent ${spent.toFixed(6)} COTI  |  remaining ${(Number(balEnd) / 1e18).toFixed(6)} COTI`)
  const failed = results.filter((r) => r.gas === -1)
  if (failed.length) {
    console.log(`\n${failed.length} call(s) FAILED:`)
    for (const f of failed) console.log(`  ${f.label}: ${f.note}`)
  }
  console.log(`report -> ${REPORT}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
