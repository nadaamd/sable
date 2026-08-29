// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * A plaintext stand-in for COTI's garbled-compute precompile, for unit tests only.
 *
 * SableCross reaches the precompile the ordinary way — `ExtendedOperations(address(0x64)).Op(...)`
 * — so a contract with the same ABI placed at 0x64 with `hardhat_setCode` lets the REAL,
 * UNMODIFIED SableCross run on a local Hardhat node. That matters more than any convenience: a
 * test that needed the contract altered would be testing the alteration.
 *
 * The representation is the whole trick. On COTI a `gt` value is an opaque handle into the
 * garbled store; here the handle IS the plaintext. Every operation is then the obvious one, and
 * onBoard/offBoard/decrypt are the identity.
 *
 * WHAT THIS DOES NOT TEST. Confidentiality is a property of the real precompile, and it is gone
 * here by construction — in these tests every value is readable. This mock is for the contract's
 * LOGIC: clearing, allocation, escrow, settlement, access control. Privacy is covered on real
 * infrastructure by scripts/cross-e2e.ts, where trader B genuinely fails to decrypt trader A's
 * fill. The two are complements, not substitutes.
 *
 * Two semantics must be copied rather than invented, or the tests would validate behaviour the
 * chain does not have:
 *
 *  1. MUX IS INVERTED. `Mux(bit, a, b)` returns `bit ? b : a`, not `bit ? a : b`. This is
 *     undocumented upstream, was found by probing (see GasSpike.probeMux), and SableCross is
 *     written against it. Implement it the intuitive way here and every escrow in the contract
 *     silently swaps sides while the tests still pass.
 *
 *  2. ARITHMETIC WRAPS, IT DOES NOT REVERT. `_allocate` evaluates BOTH arms of every mux, so for
 *     a buy it computes `sub(escrowBase = 0, fill)` and throws the result away. On COTI that
 *     underflows to a large number harmlessly. Solidity 0.8 would revert, so everything here is
 *     `unchecked` and masked to the operand width — which is also what makes the contract's
 *     bounds check testable, since that check exists precisely because oversized values wrap.
 */
contract MockMpcPrecompile {
    /* --------------------------------------------------------------- widths --
     * metaData packs the operand types: bytes3 is (typeA, typeB, argsFlag) and bytes1 is the
     * type alone. Byte 0 is the result width in both, which is all this needs.
     * MPC_TYPE = { SBOOL, SUINT8, SUINT16, SUINT32, SUINT64, SUINT128, SUINT256 }.
     */
    function _mask(uint8 t) private pure returns (uint256) {
        if (t == 0) return 1;
        if (t == 1) return type(uint8).max;
        if (t == 2) return type(uint16).max;
        if (t == 3) return type(uint32).max;
        if (t == 4) return type(uint64).max;
        if (t == 5) return type(uint128).max;
        return type(uint256).max;
    }

    function _m3(bytes3 meta) private pure returns (uint256) {
        return _mask(uint8(meta[0]));
    }

    function _m1(bytes1 meta) private pure returns (uint256) {
        return _mask(uint8(meta));
    }

    // ------------------------------------------------------- moving values in and out
    // All identities: on COTI these cross the boundary between garbled and encrypted forms,
    // and here there is only one form.

    function OnBoard(bytes1, uint256 ct) external pure returns (uint256) {
        return ct;
    }

    function OffBoard(bytes1, uint256 gt) external pure returns (uint256) {
        return gt;
    }

    function OffBoardToUser(bytes1, uint256 gt, bytes calldata) external pure returns (uint256) {
        return gt;
    }

    function SetPublic(bytes1 meta, uint256 v) external pure returns (uint256) {
        return v & _m1(meta);
    }

    function Decrypt(bytes1, uint256 a) external pure returns (uint256) {
        return a;
    }

    function ValidateCiphertext(bytes1, uint256 ciphertext, bytes calldata) external pure returns (uint256) {
        return ciphertext;
    }

    // ------------------------------------------------------------------ arithmetic
    // unchecked throughout: see note 2 in the contract docstring.

    function Add(bytes3 meta, uint256 a, uint256 b) external pure returns (uint256) {
        unchecked {
            return (a + b) & _m3(meta);
        }
    }

    function Sub(bytes3 meta, uint256 a, uint256 b) external pure returns (uint256) {
        unchecked {
            return (a - b) & _m3(meta);
        }
    }

    function Mul(bytes3 meta, uint256 a, uint256 b) external pure returns (uint256) {
        unchecked {
            return (a * b) & _m3(meta);
        }
    }

    function Div(bytes3 meta, uint256 a, uint256 b) external pure returns (uint256) {
        // SableCross only divides by a side's depth at the clearing price, which is non-zero
        // whenever anything crossed. Returning 0 rather than reverting keeps a mock failure
        // from masquerading as a contract failure if that ever stops holding.
        if (b == 0) return 0;
        unchecked {
            return (a / b) & _m3(meta);
        }
    }

    // ------------------------------------------------------------------ predicates
    // gtBool is 0 or 1.

    function And(bytes3, uint256 a, uint256 b) external pure returns (uint256) {
        return a & b;
    }

    function Or(bytes3, uint256 a, uint256 b) external pure returns (uint256) {
        return a | b;
    }

    function Not(bytes1, uint256 a) external pure returns (uint256) {
        return a == 0 ? 1 : 0;
    }

    function Ge(bytes3, uint256 a, uint256 b) external pure returns (uint256) {
        return a >= b ? 1 : 0;
    }

    function Gt(bytes3, uint256 a, uint256 b) external pure returns (uint256) {
        return a > b ? 1 : 0;
    }

    function Le(bytes3, uint256 a, uint256 b) external pure returns (uint256) {
        return a <= b ? 1 : 0;
    }

    function Lt(bytes3, uint256 a, uint256 b) external pure returns (uint256) {
        return a < b ? 1 : 0;
    }

    function Eq(bytes3, uint256 a, uint256 b) external pure returns (uint256) {
        return a == b ? 1 : 0;
    }

    function Min(bytes3, uint256 a, uint256 b) external pure returns (uint256) {
        return a < b ? a : b;
    }

    function Max(bytes3, uint256 a, uint256 b) external pure returns (uint256) {
        return a > b ? a : b;
    }

    /// INVERTED, deliberately. See note 1 in the contract docstring.
    function Mux(bytes3, uint256 bit, uint256 a, uint256 b) external pure returns (uint256) {
        return bit != 0 ? b : a;
    }
}
