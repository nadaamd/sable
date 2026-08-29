/**
 * Shared harness for the contract tests.
 *
 * The one idea worth restating: MpcCore reaches COTI's garbled backend as an ordinary interface
 * call to address 0x64, so putting MockMpcPrecompile's code there with `hardhat_setCode` lets the
 * REAL, UNMODIFIED SableCross run on a local node.
 */
import hre from "hardhat"

export const TICKS = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106]
export const WINDOW = 150
export const RESCUE_DELAY = 300
export const MAX_ORDER_SIZE = 1_000
export const MPC_PRECOMPILE = "0x0000000000000000000000000000000000000064"

export type Order = { isBuy: boolean; limit: number; size: number }
export const buy = (limit: number, size: number): Order => ({ isBuy: true, limit, size })
export const sell = (limit: number, size: number): Order => ({ isBuy: false, limit, size })

/** An `itUint64`/`itBool`: the mock's ValidateCiphertext returns the ciphertext, so it IS the value. */
export const sealed = (v: number | boolean) => ({
  ciphertext: typeof v === "boolean" ? (v ? 1 : 0) : v,
  signature: "0x",
})

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export async function fixture(ticks: number[] = TICKS, maxOrderSize = MAX_ORDER_SIZE) {
  const signers = await hre.ethers.getSigners()

  const factory = await hre.ethers.getContractFactory("MockMpcPrecompile")
  const mock = await factory.deploy()
  await mock.waitForDeployment()
  const code = await hre.ethers.provider.getCode(await mock.getAddress())
  await hre.network.provider.send("hardhat_setCode", [MPC_PRECOMPILE, code])
  // The log lives in the storage AT 0x64, not at the address the mock was deployed to.
  const recorder = factory.attach(MPC_PRECOMPILE) as any

  const Token = await hre.ethers.getContractFactory("MockPrivateToken")
  // Typed loosely: typechain's generated types are gitignored and out of tsconfig's scope.
  const base = (await Token.deploy()) as any
  const quote = (await Token.deploy()) as any
  await base.waitForDeployment()
  await quote.waitForDeployment()

  const cross = (await (await hre.ethers.getContractFactory("SableCross")).deploy(
    await base.getAddress(),
    await quote.getAddress(),
    ticks,
    WINDOW,
    RESCUE_DELAY,
    maxOrderSize,
  )) as any
  await cross.waitForDeployment()
  const crossAddr = await cross.getAddress()

  for (const s of signers.slice(0, 6)) {
    for (const t of [base, quote]) {
      await t.mint(s.address, 10_000_000)
      await t.connect(s).approve(crossAddr, 10_000_000)
    }
  }

  return { cross, base, quote, signers, crossAddr, recorder }
}

/** Submit a book, rotating over three traders so several parties are involved. */
export async function submit(cross: any, signers: any[], book: Order[]) {
  for (let i = 0; i < book.length; i++) {
    const o = book[i]
    await cross.connect(signers[i % 3]).submitOrder(sealed(o.isBuy), sealed(o.limit), sealed(o.size))
  }
}

export async function passWindow() {
  await hre.network.provider.send("evm_increaseTime", [WINDOW + 1])
  await hre.network.provider.send("evm_mine")
}

/** Every order's settled numbers, readable only because the backend is a mock. */
export async function results(cross: any, n: number) {
  const out: Array<{ fill: number; baseOut: number; quoteOut: number }> = []
  for (let i = 0; i < n; i++) {
    const o = await cross.orderOf(0, i)
    out.push({ fill: Number(o[1]), baseOut: Number(o[2]), quoteOut: Number(o[3]) })
  }
  return out
}

/** Everything the contract decrypted since the log was last reset. */
export async function decrypted(recorder: any): Promise<number[]> {
  const n = Number(await recorder.decryptCount())
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(Number(await recorder.decryptedAt(i)))
  return out
}

/** Every value offboarded to a user since the log was last reset, with its recipient. */
export async function bindings(recorder: any): Promise<Array<{ value: number; to: string }>> {
  const n = Number(await recorder.bindCount())
  const out: Array<{ value: number; to: string }> = []
  for (let i = 0; i < n; i++) {
    const b = await recorder.bindingAt(i)
    out.push({ value: Number(b[0]), to: String(b[1]) })
  }
  return out
}
