// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";

/// @title Sable gas spike
/// @notice Measures the real cost of the garbled-circuit clearing kernel on gcEVM,
///         so we can size a batch auction: n orders x K price ticks.
///
/// Two things are measured here:
///   1. Micro-ops — call each bench twice (iters = 1, then iters = N) and take the
///      delta. That cancels tx base cost, calldata, validateCiphertext and the sink
///      write, leaving the true marginal cost of one garbled operation.
///   2. The real kernel — `benchClear` is the actual clearing code we intend to ship,
///      so its gas curve is the number that decides the architecture.
///
/// !! MpcCore.mux IS INVERTED !!
/// Measured on testnet via probeMux: mux(bit, a, b) evaluates to `bit ? b : a`, not
/// `bit ? a : b`. The selected value must go in the LAST argument. This is invisible
/// from Solidity (mux delegates straight to the precompile) and undocumented, and
/// getting it backwards silently inverts the entire clearing — every conditional would
/// select exactly the orders that should not participate, on encrypted data, with no
/// error raised. Any new mux call must respect this.
contract GasSpike {
    struct Order {
        ctBool isBuy;
        ctUint64 limit;
        ctUint64 size;
    }

    Order[] public orders;

    // Storage sinks keep results live so no branch of the loop is dead code.
    ctUint64 public sink64;
    ctBool public sinkBool;

    // Results of the mux semantics probe (see probeMux).
    uint64 public muxOnTrue;
    uint64 public muxOnFalse;

    // Public outcome of the last clearing run.
    uint64 public lastClearingPrice;
    uint64 public lastMatchedVolume;

    // ------------------------------------------------------------------ setup

    /// @notice Store one encrypted order so the kernel bench has real data to chew on.
    function seedOrder(itBool calldata isBuy, itUint64 calldata limit, itUint64 calldata size) external {
        orders.push(
            Order({
                isBuy: MpcCore.offBoard(MpcCore.validateCiphertext(isBuy)),
                limit: MpcCore.offBoard(MpcCore.validateCiphertext(limit)),
                size: MpcCore.offBoard(MpcCore.validateCiphertext(size))
            })
        );
    }

    function orderCount() external view returns (uint256) {
        return orders.length;
    }

    // ------------------------------------------------------- correctness probe

    /// @notice Establishes whether mux(bit, a, b) means `bit ? a : b` or `bit ? b : a`.
    ///         Everything in the clearing kernel depends on getting this right.
    function probeMux() external {
        gtUint64 a = MpcCore.setPublic64(uint64(111));
        gtUint64 b = MpcCore.setPublic64(uint64(222));
        muxOnTrue = MpcCore.decrypt(MpcCore.mux(MpcCore.setPublic(true), a, b));
        muxOnFalse = MpcCore.decrypt(MpcCore.mux(MpcCore.setPublic(false), a, b));
    }

    // ---------------------------------------------------------- micro-op bench

    function benchValidate(itUint64 calldata v, uint256 iters) external {
        gtUint64 g;
        for (uint256 i = 0; i < iters; i++) {
            g = MpcCore.validateCiphertext(v);
        }
        sink64 = MpcCore.offBoard(g);
    }

    function benchOnBoard(uint256 iters) external {
        ctUint64 stored = orders[0].limit;
        gtUint64 g;
        for (uint256 i = 0; i < iters; i++) {
            g = MpcCore.onBoard(stored);
        }
        sink64 = MpcCore.offBoard(g);
    }

    function benchSetPublic(uint256 iters) external {
        gtUint64 g;
        for (uint256 i = 0; i < iters; i++) {
            g = MpcCore.setPublic64(uint64(i + 1));
        }
        sink64 = MpcCore.offBoard(g);
    }

    /// Comparison of an encrypted limit against a PUBLIC tick price — the variant the
    /// kernel uses, since the price grid is public.
    function benchGePublic(uint256 iters) external {
        gtUint64 v = MpcCore.onBoard(orders[0].limit);
        gtBool c;
        for (uint256 i = 0; i < iters; i++) {
            c = MpcCore.ge(v, uint64(i + 1));
        }
        sinkBool = MpcCore.offBoard(c);
    }

    function benchAnd(uint256 iters) external {
        gtBool x = MpcCore.onBoard(orders[0].isBuy);
        gtBool y = MpcCore.setPublic(true);
        gtBool c;
        for (uint256 i = 0; i < iters; i++) {
            c = MpcCore.and(x, y);
        }
        sinkBool = MpcCore.offBoard(c);
    }

    /// mux(cond, size, 0) with a public zero — the kernel's accumulation gate.
    function benchMuxPublicZero(uint256 iters) external {
        gtUint64 size = MpcCore.onBoard(orders[0].size);
        gtBool cond = MpcCore.onBoard(orders[0].isBuy);
        gtUint64 g;
        for (uint256 i = 0; i < iters; i++) {
            g = MpcCore.mux(cond, size, uint64(0));
        }
        sink64 = MpcCore.offBoard(g);
    }

    function benchAdd(uint256 iters) external {
        gtUint64 a = MpcCore.onBoard(orders[0].size);
        gtUint64 acc = MpcCore.setPublic64(uint64(0));
        for (uint256 i = 0; i < iters; i++) {
            acc = MpcCore.add(acc, a);
        }
        sink64 = MpcCore.offBoard(acc);
    }

    function benchMin(uint256 iters) external {
        gtUint64 a = MpcCore.onBoard(orders[0].size);
        gtUint64 b = MpcCore.onBoard(orders[0].limit);
        gtUint64 g;
        for (uint256 i = 0; i < iters; i++) {
            g = MpcCore.min(a, b);
        }
        sink64 = MpcCore.offBoard(g);
    }

    function benchOffBoardToUser(uint256 iters) external {
        gtUint64 a = MpcCore.onBoard(orders[0].size);
        ctUint64 c;
        for (uint256 i = 0; i < iters; i++) {
            c = MpcCore.offBoardToUser(a, msg.sender);
        }
        sink64 = c;
    }

    // -------------------------------------------------------- the real kernel

    /// @notice Uniform-price batch clearing over `n` encrypted orders and a public
    ///         price grid. This is the shape we intend to ship — measure it, don't
    ///         extrapolate from micro-ops.
    ///
    /// demand(k) = sum over buyers with limit >= p_k of size
    /// supply(k) = sum over sellers with limit <= p_k of size
    /// crossed(k) = min(demand(k), supply(k)); the clearing tick maximises crossed.
    ///
    /// No Solidity branch ever touches an encrypted value: every conditional is a mux.
    function benchClear(uint256 n, uint64[] calldata ticks, bool reveal) external {
        uint256 K = ticks.length;

        gtUint64[] memory demand = new gtUint64[](K);
        gtUint64[] memory supply = new gtUint64[](K);
        for (uint256 k = 0; k < K; k++) {
            demand[k] = MpcCore.setPublic64(uint64(0));
            supply[k] = MpcCore.setPublic64(uint64(0));
        }

        // Onboard each order ONCE, then amortise it across all K ticks.
        for (uint256 i = 0; i < n; i++) {
            gtBool isBuy = MpcCore.onBoard(orders[i].isBuy);
            gtBool isSell = MpcCore.not(isBuy);
            gtUint64 limit = MpcCore.onBoard(orders[i].limit);
            gtUint64 size = MpcCore.onBoard(orders[i].size);

            for (uint256 k = 0; k < K; k++) {
                // mux is INVERTED (see probeMux): mux(bit, a, b) == bit ? b : a.
                // So the wanted value goes in the LAST slot and the fallback first.
                gtBool bids = MpcCore.and(isBuy, MpcCore.ge(limit, ticks[k]));
                demand[k] = MpcCore.add(demand[k], MpcCore.mux(bids, uint64(0), size));

                gtBool asks = MpcCore.and(isSell, MpcCore.le(limit, ticks[k]));
                supply[k] = MpcCore.add(supply[k], MpcCore.mux(asks, uint64(0), size));
            }
        }

        // Encrypted argmax over the K ticks — a mux chain, no branching.
        gtUint64 bestVol = MpcCore.setPublic64(uint64(0));
        gtUint64 bestPrice = MpcCore.setPublic64(uint64(0));
        for (uint256 k = 0; k < K; k++) {
            gtUint64 crossed = MpcCore.min(demand[k], supply[k]);
            gtBool better = MpcCore.gt(crossed, bestVol);
            // Inverted mux again: keep `bestVol` unless `better`, in which case `crossed`.
            bestVol = MpcCore.mux(better, bestVol, crossed);
            // ticks[k] is public, so the RHS-public overload also spares a setPublic64.
            bestPrice = MpcCore.mux(better, bestPrice, ticks[k]);
        }

        if (reveal) {
            // Price discovery is the public good: clearing price and total volume go
            // public, while every individual order stays sealed forever.
            lastClearingPrice = MpcCore.decrypt(bestPrice);
            lastMatchedVolume = MpcCore.decrypt(bestVol);
        } else {
            sink64 = MpcCore.offBoard(bestVol);
        }
    }
}
