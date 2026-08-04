/**
 * Hand-written minimal ABIs, so the terminal has no build-time coupling to the Hardhat
 * artifacts. Note that COTI's ciphertext types (ctUint64, ctBool) are uint256 on the wire,
 * and ctString is a struct wrapping a uint256 array.
 */

export const CROSS_ABI = [
  "function currentBatch() view returns (uint256)",
  "function allTicks() view returns (uint64[])",
  "function commitWindow() view returns (uint256)",
  "function MAX_ORDERS() view returns (uint32)",
  "function baseToken() view returns (address)",
  "function quoteToken() view returns (address)",
  "function batches(uint256) view returns (uint256 commitDeadline, bool cleared, uint64 clearingPrice, uint64 matchedVolume, uint32 orderCount)",
  "function orderCount(uint256) view returns (uint256)",
  // trader, isBuy, limit, size, fill, claimed — all ciphertexts under the trader's key
  "function sealedOrder(uint256,uint256) view returns (address,uint256,uint256,uint256,uint256,bool)",
] as const

export const MESSAGING_ABI = [
  "function currentEpoch() view returns (uint256)",
  "function epochDuration() view returns (uint64)",
  "function inboxCount(address) view returns (uint256)",
  "function sentCount(address) view returns (uint256)",
  "function getInboxPage(address,uint256,uint256) view returns (uint256[])",
  "function getSentPage(address,uint256,uint256) view returns (uint256[])",
  "function getMessageMetadata(uint256) view returns (address from, address to, uint64 timestamp, uint64 epoch)",
  // ctString is a STRUCT wrapping uint256[], not a bare array — the tuple wrapper matters
  // for decoding, since it adds an offset level.
  "function getRecipientCiphertext(uint256) view returns (tuple(uint256[] value))",
  "function getSenderCiphertext(uint256) view returns (tuple(uint256[] value))",
  "function pendingRewards(uint256,address) view returns (uint256)",
  "function epochRewardPool(uint256) view returns (uint256)",
  "function epochTotalUsageUnits(uint256) view returns (uint256)",
] as const
