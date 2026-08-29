/**
 * Unit tests for SableCross, against a plaintext stand-in for COTI's precompile.
 *
 * The contract is UNMODIFIED. MpcCore reaches the garbled backend as an ordinary interface call
 * to address 0x64, so putting MockMpcPrecompile's code there with `hardhat_setCode` lets the real
 * contract run on a local node. Nothing here is a reimplementation of the contract's logic; if it
 * were, it would be testing the reimplementation.
 *
 * WHAT THESE CANNOT TEST. Confidentiality is a property of the real precompile and is gone here
 * by construction — every value in these tests is readable. Privacy is covered on real
 * infrastructure by scripts/cross-e2e.ts, where trader B genuinely fails to decrypt trader A's
 * fill. These cover the other half: clearing, allocation, escrow, settlement and access control,
 * which had no coverage at all and which the testnet run only exercises on one happy path.
 *
 *   npm run test:contracts
 */
import { expect } from "chai"
import { referenceClear } from "../../scripts/agents/reference"
import {
  TICKS,
  MAX_ORDER_SIZE,
  buy,
  sell,
  sealed,
  sum,
  fixture,
  submit,
  passWindow,
  results,
} from "./helpers"

describe("SableCross", () => {
  describe("clearing", () => {
    it("clears a crossing book exactly where the reference engine says", async () => {
      // The contract checked against the oracle, not against a number somebody typed. That oracle
      // is itself unit-tested in test/clearing.test.ts, so this closes the loop.
      const { cross, signers } = await fixture()
      const book = [buy(103, 37), buy(101, 28), buy(99, 20), sell(98, 20), sell(100, 35), sell(101, 10)]
      await submit(cross, signers, book)
      await passWindow()
      await cross.clear()

      const expected = referenceClear(book, TICKS)
      const meta = await cross.batches(0)
      expect(Number(meta.clearingPrice)).to.equal(expected.price)
      expect(Number(meta.matchedVolume)).to.equal(expected.volume)

      const got = await results(cross, book.length)
      expect(got.map((r) => r.fill)).to.deep.equal(expected.fills)
    })

    it("resolves a tie to the lowest tick", async () => {
      // Every tick crosses exactly 1, so only the tie-break decides. _argmax uses a strict
      // MpcCore.gt, so a later tick matching the incumbent must not displace it.
      const { cross, signers } = await fixture()
      await submit(cross, signers, [buy(106, 1), sell(95, 1)])
      await passWindow()
      await cross.clear()

      const meta = await cross.batches(0)
      expect(Number(meta.matchedVolume)).to.equal(1)
      expect(Number(meta.clearingPrice)).to.equal(TICKS[0])
    })

    it("rations the short side and the fills total the volume on both sides", async () => {
      const { cross, signers } = await fixture()
      const book = [buy(105, 10), buy(105, 10), buy(105, 10), sell(95, 20)]
      await submit(cross, signers, book)
      await passWindow()
      await cross.clear()

      const meta = await cross.batches(0)
      const volume = Number(meta.matchedVolume)
      expect(volume).to.equal(20)

      const got = await results(cross, book.length)
      const buys = got.slice(0, 3).map((r) => r.fill)
      expect(sum(buys)).to.equal(volume, "buy fills must total the volume")
      expect(got[3].fill).to.equal(volume, "the lone seller takes the whole volume")
      buys.forEach((f) => expect(f).to.be.at.most(10, "no fill may exceed its order"))
    })

    it("clears a book that does not cross at nothing", async () => {
      const { cross, signers } = await fixture()
      const book = [buy(97, 10), buy(96, 5), sell(103, 10), sell(104, 5)]
      await submit(cross, signers, book)
      await passWindow()
      await cross.clear()

      const meta = await cross.batches(0)
      expect(Number(meta.clearingPrice)).to.equal(0)
      expect(Number(meta.matchedVolume)).to.equal(0)
      expect((await results(cross, book.length)).map((r) => r.fill)).to.deep.equal([0, 0, 0, 0])
    })
  })

  describe("value", () => {
    it("returns every escrowed unit when nothing crosses", async () => {
      const { cross, base, quote, signers } = await fixture()
      const before = {
        base: Number(await base.balanceOfPlain(signers[0].address)),
        quote: Number(await quote.balanceOfPlain(signers[0].address)),
      }
      // Both orders from the same trader, so one claim settles both.
      await cross.connect(signers[0]).submitOrder(sealed(true), sealed(97), sealed(10))
      await cross.connect(signers[0]).submitOrder(sealed(false), sealed(103), sealed(4))
      await passWindow()
      await cross.clear()
      await cross.connect(signers[0]).claim(0)

      expect(Number(await base.balanceOfPlain(signers[0].address))).to.equal(before.base)
      expect(Number(await quote.balanceOfPlain(signers[0].address))).to.equal(before.quote)
    })

    it("settles a crossing batch with the contract holding nothing afterwards", async () => {
      // The solvency statement, end to end: whatever went into escrow came back out, in both
      // tokens, leaving the contract flat. If the cumulative-quotient allocation lost or invented
      // a unit, the contract would finish holding a remainder or fail to pay someone.
      const { cross, base, quote, signers, crossAddr } = await fixture()
      const book = [buy(103, 37), buy(101, 28), buy(99, 20), sell(98, 20), sell(100, 35), sell(101, 10)]
      await submit(cross, signers, book)
      await passWindow()
      await cross.clear()
      for (const s of signers.slice(0, 3)) await cross.connect(s).claim(0)

      expect(Number(await base.balanceOfPlain(crossAddr))).to.equal(0, "base left in the contract")
      expect(Number(await quote.balanceOfPlain(crossAddr))).to.equal(0, "quote left in the contract")
    })
  })

  describe("guards", () => {
    it("rejects an order above the size cap", async () => {
      const { cross, signers } = await fixture()
      await expect(
        cross.connect(signers[0]).submitOrder(sealed(true), sealed(101), sealed(MAX_ORDER_SIZE + 1)),
      ).to.be.revertedWithCustomError(cross, "OrderOutsideBounds")
    })

    it("rejects a limit off either end of the grid", async () => {
      const { cross, signers } = await fixture()
      await expect(
        cross.connect(signers[0]).submitOrder(sealed(true), sealed(94), sealed(10)),
      ).to.be.revertedWithCustomError(cross, "OrderOutsideBounds")
      await expect(
        cross.connect(signers[0]).submitOrder(sealed(false), sealed(107), sealed(10)),
      ).to.be.revertedWithCustomError(cross, "OrderOutsideBounds")
    })

    it("rejects a submission once the window has closed", async () => {
      const { cross, signers } = await fixture()
      await submit(cross, signers, [buy(101, 5)])
      await passWindow()
      await expect(
        cross.connect(signers[1]).submitOrder(sealed(false), sealed(100), sealed(5)),
      ).to.be.revertedWithCustomError(cross, "CommitWindowClosed")
    })

    it("refuses to clear while the window is still open", async () => {
      const { cross, signers } = await fixture()
      await submit(cross, signers, [buy(101, 5), sell(100, 5)])
      await expect(cross.clear()).to.be.revertedWithCustomError(cross, "CommitWindowOpen")
    })

    it("rolls the market forward, so a cleared batch cannot be re-cleared", async () => {
      /*
       * Written first to expect AlreadyCleared, which is what the error list suggests. It reverts
       * with CommitWindowOpen instead, and that is the more interesting fact: clear() ends with
       * `currentBatch = b + 1`, so the second call is not looking at the cleared batch at all —
       * it is looking at a fresh one that nobody has opened. AlreadyCleared is unreachable from
       * clear() for that reason and stands as a guard on rescue().
       *
       * The property worth holding is the roll-forward itself: one clearing closes exactly one
       * batch and the market stays open behind it.
       */
      const { cross, signers } = await fixture()
      await submit(cross, signers, [buy(101, 5), sell(100, 5)])
      await passWindow()
      expect(await cross.currentBatch()).to.equal(0n)
      await cross.clear()

      expect(await cross.currentBatch()).to.equal(1n, "clearing must advance the batch")
      expect((await cross.batches(0)).cleared).to.equal(true)
      await expect(cross.clear()).to.be.revertedWithCustomError(cross, "CommitWindowOpen")
    })

    it("keeps taking orders into the next batch after a clearing", async () => {
      const { cross, signers } = await fixture()
      await submit(cross, signers, [buy(101, 5), sell(100, 5)])
      await passWindow()
      await cross.clear()

      await cross.connect(signers[0]).submitOrder(sealed(true), sealed(102), sealed(7))
      expect(await cross.orderCount(1)).to.equal(1n)
      expect(await cross.orderCount(0)).to.equal(2n, "the closed batch must not grow")
    })

    it("refuses to claim before clearing, and pays only once after", async () => {
      const { cross, signers } = await fixture()
      await cross.connect(signers[0]).submitOrder(sealed(true), sealed(101), sealed(5))
      await cross.connect(signers[1]).submitOrder(sealed(false), sealed(100), sealed(5))

      await expect(cross.connect(signers[0]).claim(0)).to.be.revertedWithCustomError(cross, "NotCleared")

      await passWindow()
      await cross.clear()
      await cross.connect(signers[0]).claim(0)
      await expect(cross.connect(signers[0]).claim(0)).to.be.revertedWithCustomError(
        cross,
        "NothingToClaim",
      )
    })
  })
})
