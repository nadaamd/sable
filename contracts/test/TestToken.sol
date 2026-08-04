// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@coti-io/coti-contracts/contracts/token/PrivateERC20/PrivateERC20.sol";
import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";

/// @notice Test-only PrivateERC20 with an open mint, for exercising SableCross on testnet.
///         6 decimals, matching COTI's cap for private tokens.
contract TestToken is PrivateERC20 {
    constructor(string memory name_, string memory symbol_) PrivateERC20(name_, symbol_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address account, uint256 amount) public override nonReentrant {
        _mint(account, MpcCore.setPublic256(amount));
    }
}
