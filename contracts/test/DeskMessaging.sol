// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@coti-io/coti-contracts/contracts/messaging/PrivateMessaging.sol";

/// @notice Deployable instance of COTI's PrivateMessaging, used as the desks' RFQ channel.
///         Exists only so Hardhat compiles the dependency; it adds nothing of its own.
///         Messages are end-to-end encrypted: only sender and recipient can read a chunk.
contract DeskMessaging is PrivateMessaging {
    constructor(uint64 epochDurationSeconds) payable PrivateMessaging(epochDurationSeconds) {}
}
