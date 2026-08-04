/**
 * Exercises the terminal's chain layer outside React, so ABI decoding and browser-side
 * decryption are verified independently of any rendering.
 *
 * Run: npm run verify   (from frontend/)
 */
import { loadMarket, loadRewards, loadRfq } from "../lib/chain"
import { envDesks } from "../lib/deployment"

async function main() {
  const keys = envDesks()
  console.log(`desk keys loaded: ${keys.length ? keys.map((k) => k.name).join(", ") : "none"}\n`)

  const market = await loadMarket(keys, keys)
  console.log(`batch ${market.batch.id} · phase ${market.batch.phase} · block ${market.blockNumber}`)
  console.log(`ticks ${market.ticks[0]}–${market.ticks[market.ticks.length - 1]} (${market.ticks.length})`)
  console.log(`clearing price ${market.batch.clearingPrice} · matched volume ${market.batch.matchedVolume}\n`)

  console.log(`orders:`)
  for (const o of market.batch.orders) {
    const view = o.plain
      ? `${o.plain.isBuy ? "BUY " : "SELL"} ${o.plain.limit}x${o.plain.size} fill ${o.plain.fill}`
      : `SEALED (ct ${o.ct.limit.toString(16).slice(0, 8)}…)`
    console.log(`  #${o.index} ${(o.deskName ?? "unknown").padEnd(9)} ${view}`)
  }

  const rfq = await loadRfq(keys, keys)
  console.log(`\nrfq messages: ${rfq.length}`)
  for (const m of rfq) {
    console.log(`  #${m.id} ${m.from.slice(0, 8)} -> ${m.to.slice(0, 8)}  ${m.text ?? "(no key)"}`)
  }

  const rewards = await loadRewards(rfq)
  console.log(
    `\nrewards: epoch ${rewards.epoch} · pool ${Number(rewards.pool) / 1e18} COTI · ${rewards.usageUnits} cells`,
  )

  // The claim the interface makes, checked rather than asserted: what you can read depends
  // strictly on which keys you hold.
  console.log(`\nvisibility by keys held:`)
  let bad = 0
  for (const scenario of [{ name: "no keys", held: [] as typeof keys }, ...keys.map((k) => ({ name: k.name, held: [k] }))]) {
    const m = await loadMarket(keys, scenario.held)
    const readable = m.batch.orders.filter((o) => o.plain)
    const mine = m.batch.orders.filter((o) =>
      scenario.held.some((k) => k.address.toLowerCase() === o.trader.toLowerCase()),
    )
    const ok = readable.length === mine.length && readable.every((r) => mine.includes(r))
    if (!ok) bad++
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${scenario.name.padEnd(9)} reads ${readable.length}/${m.batch.orders.length}` +
        ` (owns ${mine.length})`,
    )
  }

  console.log(`\n${bad === 0 ? "VISIBILITY CORRECT — a desk reads exactly its own rows" : `${bad} SCENARIO(S) FAILED`}`)
  if (bad > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
