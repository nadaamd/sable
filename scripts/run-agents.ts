/**
 * Sable agent layer, end to end on COTI testnet.
 *
 * Three autonomous desks with private mandates negotiate over encrypted on-chain messages,
 * size their commitment from what they learn, submit sealed orders, and settle. No model
 * calls: the strategy is deterministic, so the run is reproducible and every number in it
 * can be checked against `scripts/agents/reference.ts`.
 *
 * Expectations are computed by the reference engine rather than hardcoded, so the contract
 * is being compared against an independent implementation of the mechanism.
 *
 * Staged, because both the commit window and the reward epoch are wall-clock deadlines:
 *   STAGE=setup    wallets, tokens, mint, messaging + cross deploy, approvals
 *   STAGE=rfq      each desk sends an encrypted IOI to each peer
 *   STAGE=submit   desks read their inboxes, decide, and submit sealed orders
 *   STAGE=clear    wait out the window, clear, verify against the reference
 *   STAGE=claim    settle, verify net balances, report what the RFQ saved
 *   STAGE=rewards  claim messaging rewards for the finished epoch
 */
import hre from "hardhat"
import fs from "fs"
import path from "path"
import type { Wallet } from "@coti-io/coti-ethers"
import { setupWallets } from "./utils/traders"
import { Desk } from "./agents/desk"
import { COMMIT_WINDOW, MANDATES, MAX_ORDER_SIZE, MESSAGING_EPOCH, RESCUE_DELAY, TICKS } from "./agents/desks"
import { referenceClear, referenceLegs } from "./agents/reference"
import { counterfactualEscrow, type PlannedOrder } from "./agents/strategy"

const STAGE = (process.env.STAGE ?? "all").toLowerCase()
const STATE = path.join(__dirname, "..", "agents-state.json")

const MINT = 1_000_000
const ALLOWANCE = 500_000
const REWARD_POOL = 5n * 10n ** 16n // 0.05 COTI seeded into the messaging reward epoch
const BATCH = 0

type State = {
  base?: string
  quote?: string
  cross?: string
  messaging?: string
  rfqDone?: boolean
  plans?: PlannedOrder[][]
  submitted?: number
  rfqEpoch?: number
  balancesBefore?: Array<{ base: string; quote: string }>
}

let failures = 0

const readState = (): State => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {})
const writeState = (s: State) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2))
const fmt = (n: bigint | number) => Number(n).toLocaleString("en-US")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function check(label: string, got: bigint | number, want: bigint | number) {
  const ok = BigInt(got) === BigInt(want)
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(42)} got ${String(got).padStart(8)}  want ${String(want).padStart(8)}`)
}

async function buildDesks(wallets: Wallet[], state: State): Promise<Desk[]> {
  const Messaging = await hre.ethers.getContractFactory("DeskMessaging")
  const Cross = await hre.ethers.getContractFactory("SableCross")
  const messaging = Messaging.attach(state.messaging!)
  const cross = Cross.attach(state.cross!)
  return MANDATES.map((m, i) => new Desk(m, wallets[i], messaging, cross))
}

async function tokens(state: State) {
  const Token = await hre.ethers.getContractFactory("TestToken")
  return { base: Token.attach(state.base!) as any, quote: Token.attach(state.quote!) as any }
}

// ------------------------------------------------------------------------ stages

async function stageSetup(wallets: Wallet[], state: State) {
  const deployer = wallets[0]

  console.log(`\n[setup] tokens`)
  const Token = await hre.ethers.getContractFactory("TestToken")
  const base = await Token.connect(deployer).deploy("Sable Base", "sBASE", { gasLimit: 6_000_000 })
  await base.waitForDeployment()
  const quote = await Token.connect(deployer).deploy("Sable Quote", "sQUOTE", { gasLimit: 6_000_000 })
  await quote.waitForDeployment()
  state.base = await base.getAddress()
  state.quote = await quote.getAddress()
  console.log(`  base ${state.base}\n  quote ${state.quote}`)

  console.log(`\n[setup] mint ${fmt(MINT)} of each to each desk`)
  for (const w of wallets) {
    for (const tok of [base, quote]) {
      await (await (tok as any).connect(deployer)["mint(address,uint256)"](w.address, MINT, { gasLimit: 6_000_000 })).wait()
    }
  }

  console.log(`\n[setup] RFQ channel (PrivateMessaging, ${MESSAGING_EPOCH}s epochs, ${Number(REWARD_POOL) / 1e18} COTI pool)`)
  const Messaging = await hre.ethers.getContractFactory("DeskMessaging")
  const messaging = await Messaging.connect(deployer).deploy(MESSAGING_EPOCH, {
    value: REWARD_POOL,
    gasLimit: 8_000_000,
  })
  await messaging.waitForDeployment()
  state.messaging = await messaging.getAddress()
  console.log(`  messaging ${state.messaging}`)

  console.log(`\n[setup] SableCross (K=${TICKS.length} ticks, ${COMMIT_WINDOW}s commit window)`)
  const Cross = await hre.ethers.getContractFactory("SableCross")
  const cross = await Cross.connect(deployer).deploy(state.base!, state.quote!, TICKS, COMMIT_WINDOW, RESCUE_DELAY, MAX_ORDER_SIZE, {
    gasLimit: 12_000_000,
  })
  await cross.waitForDeployment()
  state.cross = await cross.getAddress()
  /*
   * A fresh deployment invalidates every field that tracked progress against the old one.
   *
   * Enumerating those fields by name got this wrong twice: first `submitted`, whose stale value
   * made the submit loop skip and clear() revert on an empty batch, then `plans`, which made the desks reuse a decision taken against a RFQ round that no longer existed. So this
   * keeps the deployment addresses and drops everything else, which cannot go stale by omission.
   */
  for (const k of Object.keys(state) as Array<keyof State>) {
    if (!["base", "quote", "cross", "messaging"].includes(k)) delete state[k]
  }
  writeState(state)
  console.log(`  cross ${state.cross}`)

  console.log(`\n[setup] desks approve escrow`)
  const desks = await buildDesks(wallets, state)
  for (const d of desks) {
    await d.approveEscrow(base, quote, ALLOWANCE)
    console.log(`  ${d.name} approved`)
  }

  state.balancesBefore = []
  for (const d of desks) {
    const b = await d.balances(base, quote)
    state.balancesBefore.push({ base: b.base.toString(), quote: b.quote.toString() })
  }
  writeState(state)
  console.log(`  opening balances recorded`)
}

async function stageRfq(wallets: Wallet[], state: State) {
  const desks = await buildDesks(wallets, state)
  const Messaging = await hre.ethers.getContractFactory("DeskMessaging")
  const messaging = Messaging.attach(state.messaging!) as any

  state.rfqEpoch = Number(await messaging.currentEpoch())

  console.log(`\n[rfq] each desk sends an encrypted IOI to each peer (epoch ${state.rfqEpoch})`)
  let gas = 0n
  for (const d of desks) {
    const g = await d.broadcastIoi(desks)
    gas += g
    console.log(`  ${d.name.padEnd(9)} broadcast  ${fmt(g).padStart(10)} gas`)
  }
  console.log(`  total ${fmt(gas)} gas for ${desks.length * (desks.length - 1)} encrypted messages`)

  state.rfqDone = true
  writeState(state)
}

async function stageSubmit(wallets: Wallet[], state: State) {
  const desks = await buildDesks(wallets, state)

  // Decide once, then persist, so a resumed run submits exactly the same book.
  if (!state.plans) {
    console.log(`\n[submit] desks read their encrypted inboxes and decide`)
    const plans: PlannedOrder[][] = []
    for (const d of desks) {
      const iois = await d.readIois()
      const seen = iois.map((i) => `${i.side === "buy" ? "BUY" : "SELL"} ${i.size}`).join(", ") || "nothing"
      const decision = d.plan(iois, TICKS)
      console.log(`  ${d.name.padEnd(9)} inbox: ${seen}`)
      console.log(`            ${decision.rationale}`)
      console.log(
        `            -> ${decision.orders.map((o) => `${o.isBuy ? "BUY" : "SELL"} ${o.limit}x${o.size}`).join("  ")}`,
      )
      plans.push(decision.orders)
    }
    state.plans = plans
    writeState(state)
  } else {
    console.log(`\n[submit] resuming with the previously decided book`)
  }

  const flat = state.plans!.flatMap((orders, deskIdx) => orders.map((o) => ({ o, deskIdx })))
  const from = state.submitted ?? 0
  console.log(`\n[submit] sealing ${flat.length - from} order(s)`)
  for (let i = from; i < flat.length; i++) {
    const { o, deskIdx } = flat[i]
    const gas = await desks[deskIdx].submitOrder(o)
    console.log(
      `  #${i} ${desks[deskIdx].name.padEnd(9)} ${o.isBuy ? "BUY " : "SELL"} ${String(o.limit).padStart(3)}x${String(o.size).padStart(3)}   ${fmt(gas).padStart(10)} gas`,
    )
    state.submitted = i + 1
    writeState(state)
  }
}

async function stageClear(wallets: Wallet[], state: State) {
  const desks = await buildDesks(wallets, state)
  const Cross = await hre.ethers.getContractFactory("SableCross")
  const cross = Cross.attach(state.cross!) as any

  const meta = await cross.batches(BATCH)
  if (!meta.cleared) {
    const waitMs = Number(meta.commitDeadline) * 1000 - Date.now() + 3000
    if (waitMs > 0) {
      console.log(`\n[clear] commit window open, waiting ${Math.ceil(waitMs / 1000)}s`)
      await sleep(waitMs)
    }
    console.log(`[clear] clearing`)
    const rcpt = await (await cross.connect(wallets[0]).clear({ gasLimit: 120_000_000 })).wait()
    console.log(`  ${fmt(rcpt.gasUsed)} gas`)
  } else {
    console.log(`\n[clear] already cleared — re-running assertions`)
  }

  // The oracle: an independent implementation of the same mechanism.
  const book = state.plans!.flat()
  const expected = referenceClear(book, TICKS)

  const m = await cross.batches(BATCH)
  console.log(`\n[clear] contract vs reference engine`)
  check("clearing price", m.clearingPrice, expected.price)
  check("matched volume", m.matchedVolume, expected.volume)

  console.log(`\n[clear] fills, each decrypted by its own desk`)
  let flatIdx = 0
  const fillsSeen: number[] = []
  for (let d = 0; d < desks.length; d++) {
    const indices = await desks[d].orderIndices(BATCH)
    for (const idx of indices) {
      const fill = await desks[d].readFill(BATCH, idx)
      const o = book[flatIdx]
      check(
        `#${idx} ${desks[d].name} ${o.isBuy ? "BUY" : "SELL"} ${o.limit}x${o.size}`,
        fill,
        expected.fills[flatIdx],
      )
      fillsSeen.push(fill)
      flatIdx++
    }
  }

  console.log(`\n[clear] invariants`)
  const buyFills = book.reduce((s, o, i) => s + (o.isBuy ? fillsSeen[i] : 0), 0)
  const sellFills = book.reduce((s, o, i) => s + (!o.isBuy ? fillsSeen[i] : 0), 0)
  check("buy fills == matched volume", buyFills, expected.volume)
  check("sell fills == matched volume", sellFills, expected.volume)
}

async function stageClaim(wallets: Wallet[], state: State) {
  const desks = await buildDesks(wallets, state)
  const { base, quote } = await tokens(state)

  console.log(`\n[claim] each desk settles its own orders`)
  for (const d of desks) {
    try {
      const gas = await d.claim(BATCH)
      console.log(`  ${d.name.padEnd(9)} ${fmt(gas).padStart(10)} gas`)
    } catch (e: any) {
      console.log(`  ${d.name.padEnd(9)} already claimed`)
    }
  }

  const book = state.plans!.flat()
  const expected = referenceClear(book, TICKS)
  const legs = referenceLegs(book, expected.fills, expected.price)

  console.log(`\n[claim] net token movement, contract vs reference`)
  let flat = 0
  for (let d = 0; d < desks.length; d++) {
    const own = state.plans![d]
    let expBase = 0
    let expQuote = 0
    for (const o of own) {
      expBase += legs[flat].baseOut - (o.isBuy ? 0 : o.size)
      expQuote += legs[flat].quoteOut - (o.isBuy ? o.size * o.limit : 0)
      flat++
    }
    const before = state.balancesBefore![d]
    const now = await desks[d].balances(base, quote)
    check(`${desks[d].name} base delta`, now.base - BigInt(before.base), expBase)
    check(`${desks[d].name} quote delta`, now.quote - BigInt(before.quote), expQuote)
  }

  console.log(`\n[capital] what the encrypted RFQ saved`)
  for (let d = 0; d < desks.length; d++) {
    const actual = desks[d].escrowFor(state.plans![d])
    const blind = counterfactualEscrow(MANDATES[d], TICKS)
    const saved = blind.quote - actual.quote + (blind.base - actual.base)
    console.log(
      saved > 0
        ? `  ${desks[d].name.padEnd(9)} locked ${fmt(actual.quote || actual.base)} instead of ${fmt(blind.quote || blind.base)} — ${fmt(saved)} units freed`
        : `  ${desks[d].name.padEnd(9)} committed in full either way`,
    )
  }

  console.log(`\n[privacy] a desk must not read another's fill`)
  const Cross = await hre.ethers.getContractFactory("SableCross")
  const cross = Cross.attach(state.cross!) as any
  const atlasFirst = (await cross.orderOf(BATCH, 0))[1]
  let leaked: number | null = null
  try {
    leaked = Number(await desks[2].wallet.decryptValue(atlasFirst))
  } catch {
    leaked = null
  }
  if (leaked === expected.fills[0]) {
    failures++
    console.log(`  FAIL Cygnus decrypted Atlas's fill (${leaked})`)
  } else {
    console.log(`  ok   Cygnus cannot recover Atlas's fill of ${expected.fills[0]} (got ${leaked ?? "decrypt error"})`)
  }
}

async function stageRewards(wallets: Wallet[], state: State) {
  const desks = await buildDesks(wallets, state)
  const Messaging = await hre.ethers.getContractFactory("DeskMessaging")
  const messaging = Messaging.attach(state.messaging!) as any

  const epoch = state.rfqEpoch ?? 0
  const now = Number(await messaging.currentEpoch())
  console.log(`\n[rewards] RFQ ran in epoch ${epoch}, current epoch ${now}`)

  if (now <= epoch) {
    // An epoch only pays out once it has ended, so wait for its actual boundary rather
    // than guessing a duration.
    const genesis = Number(await messaging.genesisTimestamp())
    const duration = Number(await messaging.epochDuration())
    const waitMs = (genesis + (epoch + 1) * duration) * 1000 - Date.now() + 5000
    if (waitMs > 0) {
      console.log(`  epoch still active — waiting ${Math.ceil(waitMs / 1000)}s for it to close`)
      await sleep(waitMs)
    }
  }

  console.log(`  the protocol pays desks for the encrypted cells they stored:`)
  for (const d of desks) {
    const pending = await d.pendingRewards(epoch)
    if (pending > 0n) {
      await d.claimRewards(epoch)
      console.log(`  ${d.name.padEnd(9)} claimed ${Number(pending) / 1e18} COTI`)
    } else {
      console.log(`  ${d.name.padEnd(9)} nothing pending`)
    }
  }
}

// -------------------------------------------------------------------------- main

async function main() {
  console.log(`Sable agent layer — COTI testnet   (stage: ${STAGE})`)
  const wallets = await setupWallets(MANDATES.length, MANDATES.map((m) => m.name))
  const state = readState()

  if (STAGE === "setup" || STAGE === "all") await stageSetup(wallets, state)
  if (STAGE === "rfq" || STAGE === "all") await stageRfq(wallets, state)
  if (STAGE === "submit" || STAGE === "all") await stageSubmit(wallets, state)
  if (STAGE === "clear" || STAGE === "all") await stageClear(wallets, state)
  if (STAGE === "claim" || STAGE === "all") await stageClaim(wallets, state)
  if (STAGE === "rewards" || STAGE === "all") await stageRewards(wallets, state)

  console.log(`\n${"=".repeat(72)}`)
  console.log(failures === 0 ? `ALL CHECKS PASSED` : `${failures} CHECK(S) FAILED`)
  if (failures > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
