import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

import dotenv from "dotenv"
dotenv.config()

const config: HardhatUserConfig = {
  defaultNetwork: "coti-testnet",
  solidity: {
    // 0.8.20 is the floor imposed by @coti-io/coti-contracts (MpcCore.sol is ^0.8.20).
    version: "0.8.20",
    settings: {
      // Keep paris: solc >= 0.8.20 targets shanghai by default, which emits PUSH0 —
      // an opcode gcEVM does not support.
      evmVersion: "paris",
      // The clearing kernel holds too many live locals for the legacy codegen
      // ("stack too deep"), so we compile through the IR pipeline. This is also what a
      // real deployment would use, which makes the gas numbers representative rather
      // than optimistic. Precompile staticcalls are never elided or hoisted by solc
      // (it cannot prove them pure), and the spike verifies that empirically: gas must
      // grow linearly with the iteration count.
      viaIR: true,
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    "coti-testnet": {
      url: "https://testnet.coti.io/rpc",
      chainId: 7082400,
      accounts: process.env.SIGNING_KEYS ? process.env.SIGNING_KEYS.split(",") : [],
    },
    "coti-mainnet": {
      url: "https://mainnet.coti.io/rpc",
      chainId: 2632500,
      accounts: process.env.SIGNING_KEYS ? process.env.SIGNING_KEYS.split(",") : [],
    },
  }
};

export default config;
