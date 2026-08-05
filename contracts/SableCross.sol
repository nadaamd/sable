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
        // Network-key copies: opaque to everyone, and what the clearing kernel consumes.
        ctBool isBuy;
        ctUint64 limit;
        ctUint64 size;
        // Mirrors under the trader's own key, so a desk can audit its open orders against
        // the chain instead of trusting its local state. Worth ~210k gas per submission,
        // and it is what lets a client show you your row while every other row stays
        // unreadable — including to us.
        ctBool isBuyMine;
        ctUint64 limitMine;
        ctUint64 sizeMine;
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
     * How long after the commit window closes before a batch may be abandoned and refunded.
     *
     * Set this generously on a real market. A premature rescue is not profitable for anyone,
     * but it does cancel a batch that could have crossed, so a short delay is a griefing
     * vector. The constructor enforces at least one further commit window.
     */
    uint256 public immutable rescueDelay;

    /**
     * Largest size a single order may carry, in base units.
     *
     * This is not a policy choice, it is an arithmetic one. Allocation computes
     * `cum * matched`, and both factors are bounded by a side's total interest T, so the
     * product is bounded by T². With T <= MAX_ORDERS * maxOrderSize, keeping
     * MAX_ORDERS * maxOrderSize within 32 bits keeps T² inside 64 bits — exactly, since
     * (2^32 - 1)² < 2^64. The constructor enforces it.
     *
     * A market needing larger sizes needs the allocation arithmetic widened to gtUint128;
     * silently wrapping would corrupt every fill in the batch without raising anything.
     */
    uint64 public immutable maxOrderSize;

    /**
     * Hard cap on orders per batch, so clearing always fits in one transaction.
     *
     * MEASURED AT THIS BOUND, not extrapolated — an uncleanable batch traps its escrow and
     * freezes the market permanently (see `rescue`), so the cap is the one number here that
     * a model must not be trusted for. `scripts/stress-max-orders.ts` clears a full batch:
     *
     *   n = 32, K = 12  ->  66,651,243 gas   (55.5% of the 120M block limit)
     *
     * That came in 24.6% above the GasSpike model this cap was originally sized from
     * (132k + 408k*n + 103k*n*K + 52k*K), because SableCross additionally writes three
     * ciphertexts per order — fill under the trader's key, baseOut/quoteOut under the
     * network key — which the instrumented kernel does not. The overhead is a per-order
     * constant: 414,109 gas/order at n = 6 and 411,461 at n = 32, agreeing to 0.6%. So the
     * model's shape held and only its per-order coefficient was wrong.
     *
     * For this contract at K = 12:  clear(n) = 778,955 + 2,058,509*n
     *   -> ~46 orders at 80% of a block, ~58 at the limit.
     *
     * 32 therefore leaves 1.8x headroom for gas-price variance and future kernel changes.
     * Raising it requires re-running the stress test, not re-evaluating the formula.
     */
    uint32 public constant MAX_ORDERS = 32;

    // ------------------------------------------------------------------- state

    uint256 public currentBatch;

    mapping(uint256 => BatchMeta) public batches;
    mapping(uint256 => Order[]) private _orders;
    mapping(uint256 => mapping(address => uint256[])) private _traderOrders;

    /// How many orders of an abandoned batch have had their escrow released so far.
    mapping(uint256 => uint256) public rescueProgress;

    // ------------------------------------------------------------------ events

    /// Deliberately carries no amounts — only that someone joined the batch.
    event OrderSubmitted(uint256 indexed batchId, uint256 indexed orderIndex, address indexed trader);
    event BatchOpened(uint256 indexed batchId, uint256 commitDeadline);
    event BatchCleared(uint256 indexed batchId, uint64 clearingPrice, uint64 matchedVolume, uint32 orderCount);
    event Claimed(uint256 indexed batchId, address indexed trader, uint256 orderCount);
    event BatchRescued(uint256 indexed batchId, uint256 ordersReleased, bool complete);

    // ------------------------------------------------------------------ errors

    error CommitWindowClosed();
    error CommitWindowOpen();
    error BatchFull();
    error AlreadyCleared();
    error NotCleared();
    error NothingToClaim();
    error TicksNotAscending();
    error EmptyGrid();
    error RescueTooEarly();
    error NothingToRescue();
    error RescueDelayTooShort();
    error SizeCapTooHigh();
    error OrderOutsideBounds();

    // ------------------------------------------------------------- constructor

    constructor(
        IPrivateERC20 baseToken_,
        IPrivateERC20 quoteToken_,
        uint64[] memory ticks_,
        uint256 commitWindow_,
        uint256 rescueDelay_,
        uint64 maxOrderSize_
    ) {
        if (ticks_.length == 0) revert EmptyGrid();
        // Strict ascent is what guarantees demand and supply cross exactly once, which is
        // what makes the argmax the true clearing price rather than a heuristic.
        for (uint256 i = 1; i < ticks_.length; i++) {
            if (ticks_[i] <= ticks_[i - 1]) revert TicksNotAscending();
        }
        // A rescue cancels a batch, so it must never be reachable while a legitimate clear
        // still could be.
        if (rescueDelay_ < commitWindow_) revert RescueDelayTooShort();

        uint64 topTick = ticks_[ticks_.length - 1];
        // Allocation multiplies two quantities each bounded by a side's total interest, so
        // keep MAX_ORDERS * maxOrderSize inside 32 bits: (2^32 - 1)^2 < 2^64.
        if (uint256(MAX_ORDERS) * uint256(maxOrderSize_) > type(uint32).max) revert SizeCapTooHigh();
        // Escrow and notional multiply a size by a price on the grid.
        if (uint256(maxOrderSize_) * uint256(topTick) > type(uint64).max) revert SizeCapTooHigh();
        if (maxOrderSize_ == 0) revert SizeCapTooHigh();

        baseToken = baseToken_;
        quoteToken = quoteToken_;
        ticks = ticks_;
        commitWindow = commitWindow_;
        rescueDelay = rescueDelay_;
        maxOrderSize = maxOrderSize_;
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

        /*
         * Bounds check. This is the one place the contract deliberately decrypts something:
         * a single bit saying whether the order is admissible.
         *
         * It has to happen. Solidity cannot branch on an encrypted value, so without this
         * an oversized order would silently wrap the allocation arithmetic and corrupt every
         * fill in the batch — with no revert and no visible symptom, because the operands are
         * encrypted. Clamping instead would leak nothing but would silently alter the
         * trader's stated intent, which is worse than telling them their order was rejected.
         *
         * What leaks is exactly one bit, about admissibility rather than content, and the
         * trader learns it from the revert anyway. COTI's own PrivateERC20 decrypts an
         * allowance-sufficiency bit the same way.
         *
         * Bounding the limit to the grid costs nothing economically: a bid above the top tick
         * behaves identically to one at the top tick, since the clearing price is always a
         * grid point.
         */
        gtBool admissible = MpcCore.and(
            MpcCore.le(size, maxOrderSize),
            MpcCore.and(MpcCore.ge(limit, ticks[0]), MpcCore.le(limit, ticks[ticks.length - 1]))
        );
        if (!MpcCore.decrypt(admissible)) revert OrderOutsideBounds();

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
                isBuyMine: MpcCore.offBoardToUser(isBuy, msg.sender),
                limitMine: MpcCore.offBoardToUser(limit, msg.sender),
                sizeMine: MpcCore.offBoardToUser(size, msg.sender),
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

    // ------------------------------------------------------------------ rescue

    /**
     * @notice Abandon a batch that cannot be cleared and give every escrow back.
     *
     * ## Why this exists
     *
     * Without it, one uncleanable batch bricks the whole market, permanently. `currentBatch`
     * only advances inside `clear()`, and `claim()` requires a cleared batch — so if clearing
     * ever becomes impossible (it is O(n·K) and could exceed the block gas limit, or revert
     * for any unforeseen reason) then every escrow in that batch is locked forever AND no
     * further batch can ever open. "Funds are stuck and the market is dead" is not an
     * acceptable failure mode for a mechanism holding other people's money.
     *
     * ## Why it is chunked
     *
     * An escape hatch that can fail the same way as the thing it rescues is not an escape
     * hatch. Rescue is O(n) rather than O(n·K) so it is already far cheaper than clearing,
     * but `count` lets it be drained over several transactions regardless, so no batch size
     * can trap it.
     *
     * Permissionless, like clearing: nobody should need an operator's cooperation to get
     * their own escrow back.
     */
    function rescue(uint256 count) external {
        uint256 b = currentBatch;
        BatchMeta storage meta = batches[b];

        // Only the live batch can be uncleared — clearing advances the counter — so this is
        // the only batch that could ever be stuck.
        if (meta.cleared) revert AlreadyCleared();
        if (meta.commitDeadline == 0) revert NothingToRescue();
        if (block.timestamp < meta.commitDeadline + rescueDelay) revert RescueTooEarly();

        uint256 n = _orders[b].length;
        uint256 from = rescueProgress[b];
        if (from >= n) revert NothingToRescue();
        uint256 to = from + count;
        if (to > n) to = n;

        for (uint256 i = from; i < to; i++) {
            Order storage o = _orders[b][i];
            gtBool isBuy = MpcCore.onBoard(o.isBuy);
            gtUint64 limit = MpcCore.onBoard(o.limit);
            gtUint64 size = MpcCore.onBoard(o.size);

            // Full escrow back, nothing matched. Inverted mux: mux(bit, a, b) == bit ? b : a.
            o.baseOut = MpcCore.offBoard(MpcCore.mux(isBuy, size, uint64(0)));
            o.quoteOut = MpcCore.offBoard(MpcCore.mux(isBuy, uint64(0), MpcCore.mul(size, limit)));
            o.fill = MpcCore.offBoardToUser(MpcCore.setPublic64(uint64(0)), o.trader);
        }

        rescueProgress[b] = to;
        bool complete = to == n;

        if (complete) {
            // Mark it settled with no cross, which unlocks `claim`, and advance the counter so
            // the market lives again.
            meta.cleared = true;
            meta.clearingPrice = 0;
            meta.matchedVolume = 0;
            currentBatch = b + 1;
        }

        emit BatchRescued(b, to - from, complete);
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

    /**
     * @notice Everything a client needs to render one row of the blotter.
     *
     * The ciphertexts returned here are all under `trader`'s key. Anyone may read the call;
     * only the owning desk can decrypt the result. That is the whole design in one getter:
     * the book is public, and unreadable.
     *
     * Index the result by POSITION — ethers returns a Result that is also an Array, so
     * `Array.prototype.fill` shadows the `fill` output.
     */
    function sealedOrder(uint256 batchId, uint256 index)
        external
        view
        returns (address trader, ctBool isBuy, ctUint64 limit, ctUint64 size, ctUint64 fill, bool claimed)
    {
        Order storage o = _orders[batchId][index];
        return (o.trader, o.isBuyMine, o.limitMine, o.sizeMine, o.fill, o.claimed);
    }
}
