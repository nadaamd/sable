/**
 * GO / NO-GO before hitting record.
 *
 * A demo take dies for boring reasons: the RPC sheds load mid-poll and the terminal renders
 * an error, or the desk keys in `.env.local` belong to a market that no longer has the orders
 * they unlock, so clicking a desk reveals nothing on camera. Both are invisible until you are
 * already recording.
 *
 * So this checks, read-only and for zero gas, exactly the things the camera will show — and
 * samples RPC availability rather than assuming it, because during one outage it measured
 * 4/10 and no amount of retry makes that comfortable to record against.
 *
 *   npm run preflight
 *
 * It deliberately does NOT write. Nothing here can change what you are about to film.
 */
import fs from "fs"
import path from "path"
import { Contract, FetchRequest, JsonRpcProvider } from "ethers"

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "https://testnet.coti.io/rpc"
const CHAIN_ID = 7082400
const ENV_LOCAL = path.join(__dirname, "..", "frontend", ".env.local")
const DEPLOYMENT = path.join(__dirname, "..", "frontend", "lib", "deployment.ts")

/** RPC samples. Enough to distinguish "healthy" from "flaky" without taking a minute. */
const SAMPLES = 10
/** Below this, a multi-call page load is likely to show an error at some point. */
const GO_THRESHOLD = 0.9

const CROSS_ABI = [
  "function allTicks() view returns (uint64[])",
  "function MAX_ORDERS() view returns (uint32)",
  "function currentBatch() view returns (uint256)",
  "function batches(uint256) view returns (uint256 commitDeadline, bool cleared, uint64 clearingPrice, uint64 matchedVolume, uint32 orderCount)",
  "function sealedOrder(uint256,uint256) view returns (address trader, uint256 isBuy, uint256 limit, uint256 size, uint256 fill, bool claimed)",
]
// There is no total-messages getter; traffic is counted per address, which is why the
// terminal enumerates from the desks it knows. Same here.
const MESSAGING_ABI = [
  "function currentEpoch() view returns (uint256)",
  "function sentCount(address) view returns (uint256)",
]

let blockers = 0
let warnings = 0

const ok = (label: string, detail: string) => console.log(`  \x1b[32mGO  \x1b[0m ${label.padEnd(12)} ${detail}`)
const warn = (label: string, detail: string) => {
  warnings++
  console.log(`  \x1b[33mWARN\x1b[0m ${label.padEnd(12)} ${detail}`)
}
const bad = (label: string, detail: string) => {
  blockers++
  console.log(`  \x1b[31mSTOP\x1b[0m ${label.padEnd(12)} ${detail}`)
}
const note = (detail: string) => console.log(`       ${"".padEnd(12)} ${detail}`)

function resilient(url: string): JsonRpcProvider {
  const req = new FetchRequest(url)
  req.timeout = 20_000
  req.retryFunc = async (_r, resp, attempt) => {
    const transient = resp.statusCode === 0 || resp.statusCode === 429 || resp.statusCode >= 500
    if (!transient || attempt >= 4) return false
    await new Promise((r) => setTimeout(r, 200 * 2 ** attempt))
    return true
  }
  return new JsonRpcProvider(req, CHAIN_ID, { staticNetwork: true })
}

/** Raw fetch, deliberately without retry — retry would hide the number we want to measure. */
async function sampleAvailability(): Promise<{ up: number; ms: number[] }> {
  let up = 0
  const ms: number[] = []
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = Date.now()
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: i, method: "eth_blockNumber", params: [] }),
        signal: AbortSignal.timeout(12_000),
      })
      if (res.ok) {
        up++
        ms.push(Date.now() - t0)
      }
    } catch {
      /* counted as down */
    }
  }
  return { up, ms }
}

/** The committed defaults are what a fresh clone films, so read them rather than a state file. */
function defaultAddresses(): { cross?: string; messaging?: string } {
  if (!fs.existsSync(DEPLOYMENT)) return {}
  const src = fs.readFileSync(DEPLOYMENT, "utf8")
  const grab = (name: string) => src.match(new RegExp(`NEXT_PUBLIC_${name} \\?\\? "(0x[a-fA-F0-9]{40})"`))?.[1]
  return { cross: grab("CROSS"), messaging: grab("MESSAGING") }
}

function envDesks(): Array<{ name: string; address: string }> {
  if (!fs.existsSync(ENV_LOCAL)) return []
  const line = fs
    .readFileSync(ENV_LOCAL, "utf8")
    .split("\n")
    .find((l) => l.startsWith("NEXT_PUBLIC_DEMO_DESKS="))
  if (!line) return []
  try {
    const raw = line.slice("NEXT_PUBLIC_DEMO_DESKS=".length).trim().replace(/^'|'$/g, "").replace(/^"|"$/g, "")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((d: any) => ({ name: d.name, address: d.address })) : []
  } catch {
    return []
  }
}

async function main() {
  console.log(`\nSable — preflight for recording        (read-only, zero gas)\n`)

  // --- 1. is the network safe to film against right now? -------------------
  const { up, ms } = await sampleAvailability()
  const pct = up / SAMPLES
  const median = ms.length ? ms.sort((a, b) => a - b)[Math.floor(ms.length / 2)] : 0
  const detail = `${up}/${SAMPLES} calls ok (${(pct * 100).toFixed(0)}%), median ${median}ms`
  if (pct >= GO_THRESHOLD) ok("rpc", detail)
  else if (pct > 0) {
    warn("rpc", detail)
    note(`below ${GO_THRESHOLD * 100}% — the terminal retries 4x per call, but a live`)
    note(`clear() is a single shot. Record the terminal now, defer any tx.`)
  } else {
    bad("rpc", `${detail} — the RPC is down, nothing will render`)
  }
  if (pct === 0) {
    console.log(`\n\x1b[31mNO-GO\x1b[0m — wait for the RPC and re-run.\n`)
    process.exitCode = 1
    return
  }

  const provider = resilient(RPC)
  const { cross: crossAddr, messaging: msgAddr } = defaultAddresses()
  if (!crossAddr) {
    bad("addresses", `could not read committed defaults from frontend/lib/deployment.ts`)
    process.exitCode = 1
    return
  }

  // --- 2. the market the terminal opens on ---------------------------------
  const c = new Contract(crossAddr, CROSS_ABI, provider)
  const [ticksRaw, maxOrders, currentRaw] = await Promise.all([c.allTicks(), c.MAX_ORDERS(), c.currentBatch()])
  const ticks = (ticksRaw as bigint[]).map(Number)
  const current = Number(currentRaw)

  // Mirror the terminal's own fallback: it shows the last batch that actually has orders.
  let id = current
  let meta = await c.batches(id)
  if (Number(meta[4]) === 0 && current > 0) {
    id = current - 1
    meta = await c.batches(id)
  }
  const orderCount = Number(meta[4])
  const cleared = Boolean(meta[1])
  const price = Number(meta[2])
  const volume = Number(meta[3])

  ok("market", `${crossAddr}`)
  note(`${ticks.length} ticks ${ticks[0]}..${ticks[ticks.length - 1]}, MAX_ORDERS ${maxOrders}`)

  if (orderCount === 0) {
    bad("terminal", `every batch is empty — the camera would show an empty book`)
    note(`fix: STAGE=setup npm run agents && STAGE=rfq ... && STAGE=submit ...`)
  } else {
    ok("terminal", `opens on batch ${id} — ${orderCount} sealed rows`)
    if (cleared) note(`cleared: price ${price}, volume ${volume} (both public, as they should be)`)
    else note(`NOT cleared yet — good for the "sealed" shot, no price to show yet`)
  }

  // --- 3. do the keys on disk actually unlock rows on camera? --------------
  const desks = envDesks()
  if (desks.length === 0) {
    bad("keys", `no desks in frontend/.env.local — nothing will unlock on camera`)
    note(`fix: npm run frontend:config`)
  } else {
    const traders: string[] = []
    for (let i = 0; i < orderCount; i++) traders.push(((await c.sealedOrder(id, i))[0] as string).toLowerCase())

    let matched = 0
    ok("keys", `${desks.length} desk${desks.length === 1 ? "" : "s"} in frontend/.env.local`)
    for (const d of desks) {
      const owns = traders.filter((t) => t === d.address.toLowerCase()).length
      matched += owns
      const flag = owns === 0 ? "\x1b[31m" : ""
      note(`${flag}${d.name.padEnd(9)} ${d.address}  unlocks ${owns} of ${orderCount} rows\x1b[0m`)
    }
    if (matched === 0) {
      bad("keys", `no key matches any order in this batch — the reveal shot will not work`)
      note(`the keys belong to a different market. fix: npm run frontend:config`)
    } else {
      // Holding every desk's key is normal for a 3-desk demo and is not a problem — but
      // unlocking them all on camera reveals the whole book and destroys the shot. The
      // contrast the video needs is one key open against the rest still sealed.
      const best = desks
        .map((d) => ({ d, owns: traders.filter((t) => t === d.address.toLowerCase()).length }))
        .sort((a, b) => b.owns - a.owns)[0]
      note(`on camera unlock ONE desk only — ${best.d.name} shows ${best.owns} rows`)
      note(`resolved against ${orderCount - best.owns} still sealed. Unlocking all ${desks.length}`)
      note(`reveals the whole book and loses the contrast.`)
      if (matched < orderCount) {
        note(`${orderCount - matched} row(s) belong to no known desk — sealed even with every key`)
      }
    }
  }

  // --- 4. the RFQ feed ------------------------------------------------------
  if (msgAddr && desks.length > 0) {
    try {
      const m = new Contract(msgAddr, MESSAGING_ABI, provider)
      const epoch = Number(await m.currentEpoch())
      let sent = 0
      for (const d of desks) sent += Number(await m.sentCount(d.address))
      if (sent === 0) {
        warn("rfq", `0 messages sent by these desks — the negotiation panel will be empty`)
        note(`fix: STAGE=rfq npm run agents`)
      } else {
        ok("rfq", `${sent} encrypted messages sent by the demo desks, epoch ${epoch}`)
      }
    } catch (e) {
      warn("rfq", `could not read ${msgAddr}: ${(e as Error).message.slice(0, 60)}`)
    }
  }

  // --- verdict -------------------------------------------------------------
  console.log(`\n${"=".repeat(72)}`)
  if (blockers > 0) {
    console.log(`\x1b[31mNO-GO\x1b[0m — ${blockers} blocker(s) above. Fix, then re-run.\n`)
    process.exitCode = 1
    return
  }
  console.log(
    warnings > 0
      ? `\x1b[33mGO, with ${warnings} caveat(s)\x1b[0m — read the WARN lines before recording.`
      : `\x1b[32mREADY TO RECORD\x1b[0m`,
  )
  console.log(`
  cd frontend && npm run dev        then film http://localhost:3000
  the book opens fully sealed; clicking a desk key resolves only its own rows.
  shot list and narration: VIDEO.md\n`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
