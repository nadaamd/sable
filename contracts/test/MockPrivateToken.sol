// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";

/**
 * A plaintext stand-in for a COTI PrivateERC20, for unit tests only.
 *
 * SableCross calls exactly two methods on its tokens — `transferFromGT` to take escrow and
 * `transferGT` to pay out — so the mock implements those and not the other thirty on
 * IPrivateERC20. The constructor takes the token as an address, so nothing needs the full
 * interface to be satisfied.
 *
 * Balances are plaintext and readable, which is the point: the assertions in these tests are
 * "escrow in equals payout out, to the unit", and that is only checkable if somebody can see
 * the units. On real infrastructure nobody can, which is why the on-chain e2e has to reach the
 * same conclusion by a different route.
 *
 * ONE DELIBERATE DIFFERENCE FROM COTI. A real PrivateERC20 transfer cannot branch on an
 * encrypted balance, so an over-transfer silently moves nothing. This mock REVERTS instead.
 * That makes the double strictly stricter than reality, which is the right direction for a test
 * double: if SableCross ever tries to pay out more than it holds, this stops the test dead
 * instead of quietly settling for less and leaving the books looking balanced.
 */
contract MockPrivateToken {
    error InsufficientBalance(address from, uint256 have, uint256 want);
    error InsufficientAllowance(address owner, address spender, uint256 have, uint256 want);

    mapping(address => uint256) public balanceOfPlain;
    mapping(address => mapping(address => uint256)) public allowancePlain;

    function mint(address to, uint256 amount) external {
        balanceOfPlain[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowancePlain[msg.sender][spender] = amount;
    }

    function transferGT(address to, gtUint256 value) external {
        _move(msg.sender, to, gtUint256.unwrap(value));
    }

    function transferFromGT(address from, address to, gtUint256 value) external {
        uint256 amount = gtUint256.unwrap(value);
        uint256 allowed = allowancePlain[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance(from, msg.sender, allowed, amount);
        allowancePlain[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) private {
        uint256 have = balanceOfPlain[from];
        if (have < amount) revert InsufficientBalance(from, have, amount);
        balanceOfPlain[from] = have - amount;
        balanceOfPlain[to] += amount;
    }
}
