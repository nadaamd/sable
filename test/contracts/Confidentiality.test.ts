/**
 * What SableCross reveals, and to whom.
 *
 * There are two different questions behind the word "private", and only one of them can be
 * answered here.
 *
 * CRYPTOGRAPHIC SECRECY — can an outsider recover a value from what is on chain — is a property
 * of COTI's real precompile. It is gone by construction in these tests, where every value is
 * plaintext. It is covered by scripts/cross-e2e.ts on the testnet, where trader B genuinely
 * fails to decrypt trader A's fill.
 *
 * STRUCTURAL CONFIDENTIALITY — what the contract chooses to reveal, and which key it binds each
 * value to — is a property of SableCross itself, and it is exactly what a recording mock can
 * settle. The mock logs every Decrypt and every OffBoardToUser with its recipient, so "the
 * contract only ever reveals an admissibility bit, the clearing price and the matched volume"
 * stops being a claim about the source and becomes an assertion about a run.
 *
 * That distinction matters because the second class is where the catastrophic, silent bugs live.
 * Offboarding A's fill to B's key leaks everything, and it would leave the arithmetic, the
 * balances and the conservation checks all perfectly correct.
 */
import { expect } from "chai"
import { buy, sell, sealed, fixture, submit, passWindow, decrypted, bindings } from "./helpers"

describe("SableCross — confidentiality", () => {
  describe("what is decrypted", () => {
    it("reveals one admissibility bit per order and nothing else while submitting", async () => {
      const { cross, signers, recorder } = await fixture()
      await recorder.resetLog()

      const book = [buy(103, 37), sell(98, 20), buy(101, 28)]
      await submit(cross, signers, book)

      const seen = await decrypted(recorder)
      expect(seen).to.have.lengthOf(book.length, "one decrypt per submission, no more")
      expect(seen.every((v) => v === 1)).to.equal(true, "each is an admissibility bit, and admissible")
    })

    it("reveals exactly the clearing price and the matched volume when clearing", async () => {
      const { cross, signers, recorder } = await fixture()
      const book = [buy(103, 37), buy(101, 28), buy(99, 20), sell(98, 20), sell(100, 35), sell(101, 10)]
      await submit(cross, signers, book)
      await passWindow()

      await recorder.resetLog()
      await cross.clear()

      const seen = await decrypted(recorder)
      const meta = await cross.batches(0)
      expect(seen).to.deep.equal(
        [Number(meta.clearingPrice), Number(meta.matchedVolume)],
        "clearing reveals the price and the volume, in that order, and nothing else",
      )
    })

    it("reveals nothing at all when settling", async () => {
      const { cross, signers, recorder } = await fixture()
      await submit(cross, signers, [buy(101, 20), sell(100, 20)])
      await passWindow()
      await cross.clear()

      await recorder.resetLog()
      await cross.connect(signers[0]).claim(0)
      await cross.connect(signers[1]).claim(0)

      expect(await decrypted(recorder)).to.deep.equal([], "claiming must decrypt nothing")
    })

    it("never decrypts a side, a limit or a size across a whole lifecycle", async () => {
      /*
       * The disclosure surface as the page states it, tested as a whole rather than per call.
       * Sizes are chosen outside the tick range so "no decrypted value is any order's size" is
       * unambiguous — the clearing price is legitimately public and is itself a tick.
       */
      const { cross, signers, recorder } = await fixture()
      const book = [buy(103, 37), buy(101, 28), buy(99, 20), sell(98, 35), sell(100, 22), sell(101, 41)]
      await recorder.resetLog()

      await submit(cross, signers, book)
      await passWindow()
      await cross.clear()
      for (const s of signers.slice(0, 3)) await cross.connect(s).claim(0)

      const seen = await decrypted(recorder)
      const meta = await cross.batches(0)
      const allowed = new Set([0, 1, Number(meta.clearingPrice), Number(meta.matchedVolume)])
      for (const v of seen) {
        expect(allowed.has(v)).to.equal(true, `decrypted ${v}, which is not on the public list`)
      }

      const sizes = new Set(book.map((o) => o.size))
      for (const v of seen) expect(sizes.has(v)).to.equal(false, `a size (${v}) reached the clear`)

      // And the fills, which are the thing each desk alone may read.
      for (let i = 0; i < book.length; i++) {
        const fill = Number((await cross.orderOf(0, i))[1])
        if (fill !== 0 && !allowed.has(fill)) {
          expect(seen.includes(fill)).to.equal(false, `fill ${fill} of order ${i} was decrypted`)
        }
      }
    })
  })

  describe("who each value is bound to", () => {
    it("binds a submitter's private mirrors to the submitter alone", async () => {
      // isBuyMine, limitMine and sizeMine exist so a desk can audit its own open orders. If they
      // were bound to anyone else the whole book would be readable by that party.
      const { cross, signers, recorder } = await fixture()
      await recorder.resetLog()
      await cross.connect(signers[1]).submitOrder(sealed(true), sealed(103), sealed(37))

      const bound = await bindings(recorder)
      expect(bound).to.have.lengthOf(3, "side, limit and size are mirrored")
      for (const b of bound) {
        expect(b.to).to.equal(signers[1].address, "a mirror escaped to another address")
      }
      expect(bound.map((b) => b.value)).to.deep.equal([1, 103, 37], "and they carry the real values")
    })

    it("binds every fill to its own trader, never to another", async () => {
      /*
       * The bug this exists to catch: `offBoardToUser(fill, someoneElse)`. It leaks a desk's fill
       * to a party that should never see it, and it leaves the arithmetic, the balances and every
       * conservation check perfectly correct — so nothing else in this suite would notice.
       */
      const { cross, signers, recorder } = await fixture()
      const book = [buy(103, 37), buy(101, 28), buy(99, 20), sell(98, 20), sell(100, 35), sell(101, 10)]
      await submit(cross, signers, book)
      await passWindow()

      await recorder.resetLog()
      await cross.clear()

      const bound = await bindings(recorder)
      expect(bound).to.have.lengthOf(book.length, "one fill offboarded per order")
      for (let i = 0; i < book.length; i++) {
        const owner = (await cross.orderOf(0, i))[0]
        expect(bound[i].to).to.equal(owner, `order ${i}'s fill went to the wrong key`)
        expect(bound[i].value).to.equal(Number((await cross.orderOf(0, i))[1]))
      }
    })

    it("binds a zero fill to its owner when the batch does not cross", async () => {
      // The refund path is a separate branch, and a leak there would only show on the batches
      // where nothing matched — the quietest possible failure.
      const { cross, signers, recorder } = await fixture()
      const book = [buy(97, 10), sell(103, 4), buy(96, 5)]
      await submit(cross, signers, book)
      await passWindow()

      await recorder.resetLog()
      await cross.clear()

      const meta = await cross.batches(0)
      expect(Number(meta.matchedVolume)).to.equal(0)

      const bound = await bindings(recorder)
      expect(bound).to.have.lengthOf(book.length)
      for (let i = 0; i < book.length; i++) {
        const owner = (await cross.orderOf(0, i))[0]
        expect(bound[i].to).to.equal(owner, `order ${i}'s zero fill went to the wrong key`)
        expect(bound[i].value).to.equal(0)
      }
    })

    it("keeps two traders' orders bound to different keys in the same batch", async () => {
      // A single-trader test would pass even if the contract bound every fill to msg.sender of
      // the clearing transaction, which is the most natural way to write this bug.
      const { cross, signers, recorder } = await fixture()
      await cross.connect(signers[0]).submitOrder(sealed(true), sealed(102), sealed(30))
      await cross.connect(signers[1]).submitOrder(sealed(false), sealed(100), sealed(30))
      await passWindow()

      await recorder.resetLog()
      // Cleared by a third party, who must end up holding none of it.
      await cross.connect(signers[4]).clear()

      const bound = await bindings(recorder)
      expect(bound.map((b) => b.to)).to.deep.equal([signers[0].address, signers[1].address])
      expect(bound.some((b) => b.to === signers[4].address)).to.equal(
        false,
        "the caller of clear() must not be bound anything",
      )
    })
  })
})
