// The customer's one KSG wallet (core/wallet/customerWallet.model.js), as used by
// hotel bookings. Every move carries a `referenceKey` and is refused when a row with
// that key already exists, so a retried request, a webhook racing /verify or a
// re-run job can never move the same money twice. Balance guard and the row push are
// one atomic update (same pattern as food's applyWalletMove).

import mongoose from 'mongoose';
import { CustomerWallet } from '../../../core/wallet/customerWallet.model.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/** Create the wallet if missing (outside any transaction, before guarded updates). */
export const ensureWallet = (userId) =>
    CustomerWallet.updateOne(
        { userId: oid(userId) },
        { $setOnInsert: { userId: oid(userId), balance: 0, transactions: [] } },
        { upsert: true },
    );

export const walletBalance = async (userId, { session } = {}) => {
    const w = await CustomerWallet.findOne({ userId: oid(userId) }).select('balance').session(session || null).lean();
    return Number(w?.balance) || 0;
};

const alreadyApplied = async (userId, referenceKey, session) =>
    Boolean(await CustomerWallet.exists({ userId: oid(userId), 'transactions.referenceKey': referenceKey }).session(session || null));

/**
 * Debit. Returns { applied: true } or { applied: false, duplicate: true } when the key
 * was already used; throws a 400 on insufficient balance.
 */
export const debitWallet = async ({ userId, amount, referenceKey, description, metadata = {}, session = null }) => {
    if (!(amount > 0)) return { applied: false };
    const res = await CustomerWallet.updateOne(
        { userId: oid(userId), balance: { $gte: amount }, 'transactions.referenceKey': { $ne: referenceKey } },
        {
            $inc: { balance: -amount },
            $push: {
                transactions: {
                    $each: [{
                        type: 'deduction',
                        kind: 'debit',
                        amount,
                        status: 'Completed',
                        description,
                        title: description,
                        referenceKey,
                        metadata: { source: 'hotel_booking', vertical: 'hotel', ...metadata },
                    }],
                    $position: 0,
                },
            },
        },
        session ? { session } : {},
    );
    if (res.modifiedCount === 1) return { applied: true };
    if (await alreadyApplied(userId, referenceKey, session)) return { applied: false, duplicate: true };
    throw Object.assign(new Error('Insufficient wallet balance'), { statusCode: 400 });
};

/** Credit (refund). Idempotent on referenceKey. */
export const creditWallet = async ({ userId, amount, referenceKey, description, metadata = {}, session = null }) => {
    if (!(amount > 0)) return { applied: false };
    if (!session) await ensureWallet(userId);
    const res = await CustomerWallet.updateOne(
        { userId: oid(userId), 'transactions.referenceKey': { $ne: referenceKey } },
        {
            $inc: { balance: amount },
            $push: {
                transactions: {
                    $each: [{
                        type: 'refund',
                        kind: 'credit',
                        amount,
                        status: 'Completed',
                        description,
                        title: description,
                        referenceKey,
                        metadata: { source: 'hotel_refund', vertical: 'hotel', ...metadata },
                    }],
                    $position: 0,
                },
            },
        },
        session ? { session } : {},
    );
    return res.modifiedCount === 1 ? { applied: true } : { applied: false, duplicate: true };
};
