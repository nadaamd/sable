// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";
import "@coti-io/coti-contracts/contracts/token/PrivateERC20/IPrivateERC20.sol";

/**
 * @title SableCross
 * @notice A confidential crossing network: a sealed-bid, uniform-price batch auction whose
 *         matching engine runs entirely on encrypted orders.
 *
 * Traders submit orders whose side, limit price and size are all encrypted. At the close of
 * the commit window anyone may trigger clearing. The contract computes the volume-maximising
 * uniform price using garbled circuits, allocates fills pro-rata, and hands each trader a
 * ciphertext only they can decrypt. The clearing price and total matched volume become
 * public — that is the point, price discovery is the public good — while every individual
 * order stays sealed forever, including all unmatched ones.
 *
 * ## What leaks
 *
 * Public:  that an address submitted an order, and when; the clearing price; total matched
 *          volume.
 * Private: side, limit price, size, each trader's fill and settlement legs, and everything
 *          about orders that did not cross.
 *
 * Both token legs are always moved, one of them an encrypted zero, so the *pattern* of
 * transfers never reveals which side an order was on.
 *
 * ## Two invariants this contract depends on
 *
 * 1. `MpcCore.mux(bit, a, b)` evaluates to `bit ? b : a` — INVERTED relative to intuition.
 *    Verified on testnet; see SPIKE.md. The selected value goes LAST. Since you cannot
 *    branch on an encrypted value in Solidity, mux is the only conditional available, so
 *    this inversion touches every conditional below.
 *
 * 2. Fills must sum to the matched volume EXACTLY on both sides, or the contract becomes
 *    insolvent. See `_allocate` for why naive pro-rata breaks this and how the cumulative
 *    quotient formula fixes it.
 */
contract SableCross {
    // ------------------------------------------------------------------- types

    struct Order {
        address trader;
        ctBool isBuy;
        ctUint64 limit;
        ctUint64 size;
        // Written at clearing.
        //
        // `fill` is offboarded to the trader's AES key: only they can read it, and nothing
        // on-chain ever needs it again.
        //
        // The two settlement legs are offboarded to the NETWORK key instead, because
        // `claim` must onBoard them to move tokens — and a user-key ciphertext cannot be
        // onboarded. They are therefore opaque to everyone, including the trader, who does
        // not need them: given their own side, size, fill and the public clearing price,
        // both legs are trivially derivable off-chain.
        ctUint64 fill; // user-readable
        ctUint64 baseOut; // network-readable
        ctUint64 quoteOut; // network-readable
        bool claimed;
    }

    struct BatchMeta {
        uint256 commitDeadline; // 0 until the batch's first order opens it
        bool cleared;
        uint64 clearingPrice; // 0 if nothing crossed
        uint64 matchedVolume;
        uint32 orderCount;
    }

    // ------------------------------------------------------------------ config

    IPrivateERC20 public immutable baseToken;
    IPrivateERC20 public immutable quoteToken;

    /// Public price grid, strictly ascending. Prices are quote units per base unit.
    uint64[] public ticks;

    /// How long a batch accepts orders once its first order arrives.
    uint256 public immutable commitWindow;

    /**
     * Hard cap on orders per batch, so clearing always fits in one transaction.
     *
     * Measured on COTI testnet: clearing plus allocation costs roughly
     * 132k + 164k*n + 103k*n*K + 52k*K gas, plus ~580k per order for allocation.
     * At K = 12 ticks the 120M block limit is reached around n = 48, so 32 leaves a
     * comfortable margin for gas-price variance and future kernel changes.
     */
    uint32 public constant MAX_ORDERS = 32;

    // ------------------------------------------------------------------- state

    uint256 public currentBatch;

    mapping(uint256 => BatchMeta) public batches;
    mapping(uint256 => Order[]) private _orders;
    mapping(uint256 => mapping(address => uint256[])) private _traderOrders;

    // ------------------------------------------------------------------ events

    /// Deliberately carries no amounts — only that someone joined the batch.
    event OrderSubmitted(uint256 indexed batchId, uint256 indexed orderIndex, address indexed trader);
    event BatchOpened(uint256 indexed batchId, uint256 commitDeadline);
    event BatchCleared(uint256 indexed batchId, uint64 clearingPrice, uint64 matchedVolume, uint32 orderCount);
    event Claimed(uint256 indexed batchId, address indexed trader, uint256 orderCount);

    // ------------------------------------------------------------------ errors

    error CommitWindowClosed();
    error CommitWindowOpen();
    error BatchFull();
    error AlreadyCleared();
    error NotCleared();
    error NothingToClaim();
    error TicksNotAscending();
    error EmptyGrid();

    // ------------------------------------------------------------- constructor

    constructor(IPrivateERC20 baseToken_, IPrivateERC20 quoteToken_, uint64[] memory ticks_, uint256 commitWindow_) {
        if (ticks_.length == 0) revert EmptyGrid();
        // Strict ascent is what guarantees demand and supply cross exactly once, which is
        // what makes the argmax the true clearing price rather than a heuristic.
        for (uint256 i = 1; i < ticks_.length; i++) {
            if (ticks_[i] <= ticks_[i - 1]) revert TicksNotAscending();
        }
        baseToken = baseToken_;
        quoteToken = quoteToken_;
        ticks = ticks_;
        commitWindow = commitWindow_;
    }

    // --------------------------------------------------------------- submitting

    /**
     * @notice Submit a sealed order and escrow enough to make the fill binding.
     *
     * A buyer escrows `size * limit` quote (the most it could ever spend, since buyers only
     * cross at prices at or below their limit). A seller escrows `size` base. Both legs are
     * always pulled — the inactive one is an encrypted zero — so an observer cannot infer
     * the side from which token moved.
     */
    function submitOrder(itBool calldata isBuy_, itUint64 calldata limit_, itUint64 calldata size_) external {
        uint256 b = currentBatch;
        BatchMeta storage meta = batches[b];

        if (meta.commitDeadline == 0) {
            meta.commitDeadline = block.timestamp + commitWindow;
            emit BatchOpened(b, meta.commitDeadline);
        } else if (block.timestamp >= meta.commitDeadline) {
            revert CommitWindowClosed();
        }
        if (meta.orderCount >= MAX_ORDERS) revert BatchFull();

        gtBool isBuy = MpcCore.validateCiphertext(isBuy_);
        gtUint64 limit = MpcCore.validateCiphertext(limit_);
        gtUint64 size = MpcCore.validateCiphertext(size_);

        // mux is inverted: mux(bit, a, b) == bit ? b : a.
        gtUint64 escrowQuote = MpcCore.mux(isBuy, uint64(0), MpcCore.mul(size, limit)); // buy ? size*limit : 0
        gtUint64 escrowBase = MpcCore.mux(isBuy, size, uint64(0)); // buy ? 0 : size

        _pull(quoteToken, msg.sender, escrowQuote);
        _pull(baseToken, msg.sender, escrowBase);

        uint256 idx = _orders[b].length;
        _orders[b].push(
            Order({
                trader: msg.sender,
                isBuy: MpcCore.offBoard(isBuy),
                limit: MpcCore.offBoard(limit),
                size: MpcCore.offBoard(size),
                fill: ctUint64.wrap(0),
                baseOut: ctUint64.wrap(0),
                quoteOut: ctUint64.wrap(0),
                claimed: false
            })
        );
        _traderOrders[b][msg.sender].push(idx);
        meta.orderCount = uint32(idx + 1);

        emit OrderSubmitted(b, idx, msg.sender);
    }

    // ----------------------------------------------------------------- clearing

    /**
     * @notice Close the batch and clear it. Permissionless on purpose: no operator can
     *         stall a batch, and none can see inside it either.
     */
    function clear() external {
        uint256 b = currentBatch;
        BatchMeta storage meta = batches[b];

        if (meta.cleared) revert AlreadyCleared();
        // An empty batch was never opened, so there is nothing to close.
        if (meta.commitDeadline == 0 || block.timestamp < meta.commitDeadline) revert CommitWindowOpen();

        uint256 n = _orders[b].length;

        (
            gtUint64[] memory demand,
            gtUint64[] memory supply,
            gtBool[] memory isBuyG,
            gtUint64[] memory limitG,
            gtUint64[] memory sizeG
        ) = _curves(b, n);

        (gtUint64 bestPrice, gtUint64 bestVol) = _argmax(demand, supply);

        // Price discovery goes public; nothing else does.
        uint64 p = MpcCore.decrypt(bestPrice);
        uint64 matched = MpcCore.decrypt(bestVol);

        meta.cleared = true;
        meta.clearingPrice = p;
        meta.matchedVolume = matched;
        currentBatch = b + 1;

        // `matched` is public here, so this branch is legal.
        if (matched > 0) {
            uint256 kStar = _tickIndex(p);
            _allocate(b, n, p, matched, demand[kStar], supply[kStar], isBuyG, limitG, sizeG);
        } else {
            // No cross: every order is refunded in full by `claim`.
            _refundAll(b, n, isBuyG, limitG, sizeG);
        }

        emit BatchCleared(b, p, matched, uint32(n));
    }

    /// Builds the encrypted demand and supply curves, and hands back the onboarded fields.
    ///
    /// Garbled handles stay valid for the whole transaction, so allocation reuses these
    /// rather than onboarding again — re-onboarding costs 3 boundary crossings per order
    /// (~143k gas) for data already in the garbled domain.
    function _curves(uint256 b, uint256 n)
        private
        returns (
            gtUint64[] memory demand,
            gtUint64[] memory supply,
            gtBool[] memory isBuyG,
            gtUint64[] memory limitG,
            gtUint64[] memory sizeG
        )
    {
        uint256 K = ticks.length;
        demand = new gtUint64[](K);
        supply = new gtUint64[](K);
        isBuyG = new gtBool[](n);
        limitG = new gtUint64[](n);
        sizeG = new gtUint64[](n);

        // One encrypted zero shared by every accumulator. Garbled values are immutable —
        // each operation returns a fresh handle — so sharing is safe and saves 2*(K-1)
        // setPublic64 calls.
        gtUint64 zero = MpcCore.setPublic64(uint64(0));
        for (uint256 k = 0; k < K; k++) {
            demand[k] = zero;
            supply[k] = zero;
        }

        for (uint256 i = 0; i < n; i++) {
            Order storage o = _orders[b][i];
            gtBool isBuy = MpcCore.onBoard(o.isBuy);
            gtUint64 limit = MpcCore.onBoard(o.limit);
            gtUint64 size = MpcCore.onBoard(o.size);
            gtBool isSell = MpcCore.not(isBuy);

            isBuyG[i] = isBuy;
            limitG[i] = limit;
            sizeG[i] = size;

            for (uint256 k = 0; k < K; k++) {
                // A buyer joins demand at tick k iff its limit is at or above p_k.
                gtBool bids = MpcCore.and(isBuy, MpcCore.ge(limit, ticks[k]));
                demand[k] = MpcCore.add(demand[k], MpcCore.mux(bids, uint64(0), size));

                gtBool asks = MpcCore.and(isSell, MpcCore.le(limit, ticks[k]));
                supply[k] = MpcCore.add(supply[k], MpcCore.mux(asks, uint64(0), size));
            }
        }
    }

    /// Encrypted argmax of min(demand, supply) over the grid — a mux chain, no branching.
    function _argmax(gtUint64[] memory demand, gtUint64[] memory supply)
        private
        returns (gtUint64 bestPrice, gtUint64 bestVol)
    {
        bestVol = MpcCore.setPublic64(uint64(0));
        bestPrice = MpcCore.setPublic64(uint64(0));
        for (uint256 k = 0; k < ticks.length; k++) {
            gtUint64 crossed = MpcCore.min(demand[k], supply[k]);
            gtBool better = MpcCore.gt(crossed, bestVol);
            bestVol = MpcCore.mux(better, bestVol, crossed);
            // ticks[k] is public, so this overload also spares a setPublic64.
            bestPrice = MpcCore.mux(better, bestPrice, ticks[k]);
        }
    }

    /**
     * @dev Allocates fills and computes each trader's two settlement legs.
     *
     * ## Why not plain `size * matched / sideTotal`
     *
     * Because it makes the contract insolvent. The short side satisfies
     * `sideTotal == matched`, so its ratio is exactly 1 and it never truncates; the long
     * side rounds down. The two sides then move different quantities of base, while
     * solvency requires them to be equal: the contract holds exactly what was escrowed.
     * Concretely, demand 7 against supply 10 with sizes 5 and 5 on the sell side gives
     * buyers 7 base but takes only 6 from sellers — one unit short.
     *
     * ## The fix: cumulative quotients
     *
     *     cum_i  = sum of sizes of same-side participants up to and including i
     *     q_i    = floor(cum_i * V / T)
     *     fill_i = q_i - q_{i-1}
     *
     * The quotients telescope, so the fills sum to floor(T * V / T) = V exactly, on both
     * sides. Each fill still lands within one unit of its ideal pro-rata share, and for the
     * short side (T == V) it reduces to fill_i == size_i. Conservation of value is enforced
     * by the formula rather than by a reconciliation pass.
     *
     * ## Overflow bound
     *
     * `cum * V` must fit in 64 bits. With COTI's 6-decimal cap on private tokens that
     * allows a total book size times matched volume up to ~1.8e19 base units. Widening to
     * gtUint128 is the escape hatch if a market ever needs more.
     */
    function _allocate(
        uint256 b,
        uint256 n,
        uint64 p,
        uint64 matched,
        gtUint64 dTot,
        gtUint64 sTot,
        gtBool[] memory isBuyG,
        gtUint64[] memory limitG,
        gtUint64[] memory sizeG
    ) private {
        gtUint64 zero = MpcCore.setPublic64(uint64(0));

        // Running cumulative sizes, and the running quotient, per side.
        gtUint64 cumBuy = zero;
        gtUint64 cumSell = zero;
        gtUint64 qBuyPrev = zero;
        gtUint64 qSellPrev = zero;

        for (uint256 i = 0; i < n; i++) {
            gtBool isBuy = isBuyG[i];
            gtUint64 size = sizeG[i];

            // In the money at the clearing price? p is public, so these are the cheap
            // compare-against-public variants.
            gtBool inBuy = MpcCore.and(isBuy, MpcCore.ge(limitG[i], p));
            gtBool inSell = MpcCore.and(MpcCore.not(isBuy), MpcCore.le(limitG[i], p));

            // Advance each side's cumulative size by this order's size, if it belongs there.
            cumBuy = MpcCore.add(cumBuy, MpcCore.mux(inBuy, uint64(0), size));
            cumSell = MpcCore.add(cumSell, MpcCore.mux(inSell, uint64(0), size));

            // No division-by-zero guard needed: matched > 0 implies min(dTot, sTot) > 0,
            // so both side totals are strictly positive here.
            gtUint64 qBuy = MpcCore.div(MpcCore.mul(cumBuy, matched), dTot);
            gtUint64 qSell = MpcCore.div(MpcCore.mul(cumSell, matched), sTot);

            gtUint64 fillBuy = MpcCore.sub(qBuy, qBuyPrev);
            gtUint64 fillSell = MpcCore.sub(qSell, qSellPrev);
            qBuyPrev = qBuy;
            qSellPrev = qSell;

            gtUint64 fill = MpcCore.mux(isBuy, fillSell, fillBuy); // buy ? fillBuy : fillSell

            // Settlement legs. `notional` is what this fill costs in quote.
            gtUint64 notional = MpcCore.mul(fill, p);

            // A buyer receives `fill` base and gets back its unspent quote escrow.
            // A seller receives `notional` quote and gets back its undelivered base.
            //
            // On the branch mux discards, the subtraction underflows and wraps — a buyer
            // has no base escrow, a seller no quote escrow. That garbage is never selected.
            // On the live branch there is no underflow: fill <= size, and p <= limit for
            // participating buyers, so notional <= size * limit.
            gtUint64 escrowBase = MpcCore.mux(isBuy, size, uint64(0)); // buy ? 0 : size
            gtUint64 escrowQuote = MpcCore.mux(isBuy, uint64(0), MpcCore.mul(size, limitG[i]));

            gtUint64 baseOut = MpcCore.mux(isBuy, MpcCore.sub(escrowBase, fill), fill);
            gtUint64 quoteOut = MpcCore.mux(isBuy, notional, MpcCore.sub(escrowQuote, notional));

            Order storage o = _orders[b][i];
            o.fill = MpcCore.offBoardToUser(fill, o.trader);
            o.baseOut = MpcCore.offBoard(baseOut);
            o.quoteOut = MpcCore.offBoard(quoteOut);
        }
    }

    /// Nothing crossed: every order's escrow goes back untouched.
    function _refundAll(uint256 b, uint256 n, gtBool[] memory isBuyG, gtUint64[] memory limitG, gtUint64[] memory sizeG)
        private
    {
        gtUint64 zero = MpcCore.setPublic64(uint64(0));
        for (uint256 i = 0; i < n; i++) {
            gtBool isBuy = isBuyG[i];
            gtUint64 baseOut = MpcCore.mux(isBuy, sizeG[i], uint64(0)); // buy ? 0 : size
            gtUint64 quoteOut = MpcCore.mux(isBuy, uint64(0), MpcCore.mul(sizeG[i], limitG[i]));

            Order storage o = _orders[b][i];
            o.fill = MpcCore.offBoardToUser(zero, o.trader);
            o.baseOut = MpcCore.offBoard(baseOut);
            o.quoteOut = MpcCore.offBoard(quoteOut);
        }
    }

    function _tickIndex(uint64 p) private view returns (uint256) {
        for (uint256 k = 0; k < ticks.length; k++) {
            if (ticks[k] == p) return k;
        }
        // Unreachable: the argmax can only select a value from the grid.
        revert("clearing price off grid");
    }

    // ------------------------------------------------------------------ claiming

    /**
     * @notice Collect the caller's fills and refunds for a cleared batch.
     *
     * Pull-based on purpose: each trader pays the gas for their own settlement, so clearing
     * stays a fixed-cost transaction no matter how many traders participated.
     *
     * Both token legs are always sent, one possibly an encrypted zero, so the payout
     * pattern does not reveal which side the trader was on.
     */
    function claim(uint256 batchId) external {
        if (!batches[batchId].cleared) revert NotCleared();

        uint256[] storage mine = _traderOrders[batchId][msg.sender];
        uint256 settled;

        for (uint256 j = 0; j < mine.length; j++) {
            Order storage o = _orders[batchId][mine[j]];
            if (o.claimed) continue;
            o.claimed = true;
            settled++;

            _push(baseToken, msg.sender, MpcCore.onBoard(o.baseOut));
            _push(quoteToken, msg.sender, MpcCore.onBoard(o.quoteOut));
        }

        if (settled == 0) revert NothingToClaim();
        emit Claimed(batchId, msg.sender, settled);
    }

    // --------------------------------------------------------------- token glue

    /// Widen a 64-bit garbled value to the 256-bit width PrivateERC20 speaks.
    function _widen(gtUint64 v) private returns (gtUint256) {
        return MpcCore.add(MpcCore.setPublic256(uint256(0)), v);
    }

    function _pull(IPrivateERC20 token, address from, gtUint64 amount) private {
        token.transferFromGT(from, address(this), _widen(amount));
    }

    function _push(IPrivateERC20 token, address to, gtUint64 amount) private {
        token.transferGT(to, _widen(amount));
    }

    // ------------------------------------------------------------------- views

    function tickCount() external view returns (uint256) {
        return ticks.length;
    }

    function allTicks() external view returns (uint64[] memory) {
        return ticks;
    }

    function orderCount(uint256 batchId) external view returns (uint256) {
        return _orders[batchId].length;
    }

    /// Trader and claim status are public. `fill` is decryptable only by `trader`;
    /// `baseOut`/`quoteOut` are network-key ciphertexts and decryptable by nobody.
    ///
    /// Clients must index the result by POSITION, not by name: ethers returns a Result that
    /// is also an Array, so `Array.prototype.fill` shadows the `fill` output.
    function orderOf(uint256 batchId, uint256 index)
        external
        view
        returns (address trader, ctUint64 fill, ctUint64 baseOut, ctUint64 quoteOut, bool claimed)
    {
        Order storage o = _orders[batchId][index];
        return (o.trader, o.fill, o.baseOut, o.quoteOut, o.claimed);
    }

    function ordersOfTrader(uint256 batchId, address trader) external view returns (uint256[] memory) {
        return _traderOrders[batchId][trader];
    }
}
