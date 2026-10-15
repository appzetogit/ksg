// Partner money (earnings, ledger, withdrawals) and admin withdrawal processing.
// Balances come from the core ledger (core/finance), written by
// services/settlement.listener.js. Contract: docs/hotel-api-contract.md, Phase 4-5.

import mongoose from 'mongoose';
import { z } from 'zod';
import { sendResponse } from '../../../utils/response.js';
import { NotFoundError, ValidationError } from '../../../core/auth/errors.js';
import { append } from '../../../core/finance/ledger.service.js';
import { LedgerEntry } from '../../../core/finance/ledgerEntry.model.js';
import { PartnerBalance } from '../../../core/finance/partnerBalance.model.js';
import { forWithdrawal } from '../../../core/finance/idempotencyKeys.js';
import { ConflictError } from '../errors.js';
import { HotelPartner } from '../models/hotelPartner.model.js';
import { HotelBooking } from '../models/hotelBooking.model.js';
import { HotelWithdrawal, WITHDRAWAL_STATUSES } from '../models/hotelWithdrawal.model.js';
import { parse } from '../validators/partner.validators.js';
import { isObjectId, pageOf, round2 } from '../services/property.service.js';
import { getMoneySettings } from '../services/moneySettings.js';
import { JOB_TYPE, splitOf, prepaidFromBooking } from '../services/settlement.listener.js';
import { todayIST, toNightDate } from '../services/dates.js';

const handle = (fn) => async (req, res, next) => {
    try {
        return await fn(req, res);
    } catch (err) {
        return next(err);
    }
};

const pagingSchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});

const partnerOwner = (partnerId) => ({ ownerType: 'partner', ownerId: String(partnerId) });
// Earnings exclude payouts (WITHDRAWAL) and zero-amount markers.
const EARNING_TYPES = { $nin: ['WITHDRAWAL', 'NON_WALLET'] };

/** First instant of the current IST calendar month. */
export const monthStartIST = (now = new Date()) => toNightDate(`${todayIST(now).slice(0, 7)}-01`);

export const partnerBalanceOf = async (partnerId) => {
    const row = await PartnerBalance.findOne(partnerOwner(partnerId)).lean();
    return round2(row?.balance || 0);
};

const sumEntries = async (match) => {
    const [row] = await LedgerEntry.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    return round2(row?.total || 0);
};

// ─── partner ──────────────────────────────────────────────────────────────

export const earnings = handle(async (req, res) => {
    const partnerId = req.user.userId;
    const owner = { ...partnerOwner(partnerId), vertical: 'hotel' };
    const settings = await getMoneySettings();

    const [balance, totalEarned, thisMonth, open, settledIds] = await Promise.all([
        partnerBalanceOf(partnerId),
        sumEntries({ ...owner, type: EARNING_TYPES }),
        sumEntries({ ...owner, type: EARNING_TYPES, createdAt: { $gte: monthStartIST() } }),
        HotelBooking.find({ partnerId, status: { $in: ['confirmed', 'checked_in', 'checked_out'] } })
            .select('pricing payment status').lean(),
        LedgerEntry.distinct('jobId', { ...owner, jobType: JOB_TYPE, 'metadata.step': 'settle' }),
    ]);

    // What still has to reach the wallet: for each unsettled booking, the online money
    // owed to the hotel less the platform's share (negative for pay-at-hotel).
    const settled = new Set(settledIds.map(String));
    const pendingSettlement = round2(open
        .filter((b) => !settled.has(String(b._id)))
        .reduce((sum, b) => {
            const s = splitOf(b);
            return sum + prepaidFromBooking(b) - s.fee - s.commission;
        }, 0));

    return sendResponse(res, 200, 'Earnings', {
        balance,
        pendingSettlement,
        totalEarned,
        thisMonth,
        withdrawable: Math.max(0, balance),
        minWithdrawal: settings.minWithdrawal,
    });
});

export const ledger = handle(async (req, res) => {
    const q = parse(pagingSchema, req.query);
    const { page, limit, skip } = pageOf(q);
    const filter = { ...partnerOwner(req.user.userId), vertical: 'hotel', type: { $ne: 'NON_WALLET' } };
    const [rows, total] = await Promise.all([
        LedgerEntry.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
        LedgerEntry.countDocuments(filter),
    ]);
    const items = rows.map((e) => ({
        _id: e._id,
        type: e.type,
        amount: e.amount,
        ...(e.metadata?.bookingRef ? { bookingRef: e.metadata.bookingRef } : {}),
        description: e.reason || e.type,
        createdAt: e.createdAt,
        balanceAfter: e.balanceAfter,
    }));
    return sendResponse(res, 200, 'Ledger', { items, page, limit, total });
});

const withdrawalJSON = (w, partner) => ({
    _id: w._id,
    amount: w.amount,
    status: w.status,
    bank: w.bank,
    note: w.note,
    utr: w.utr,
    processedAt: w.processedAt,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    ...(partner !== undefined ? { partnerId: w.partnerId, partner: partner ? { name: partner.name, phone: partner.phone } : null } : {}),
});

const withdrawSchema = z.object({ amount: z.coerce.number().positive().max(10_000_000) });

export const requestWithdrawal = handle(async (req, res) => {
    const partnerId = req.user.userId;
    const amount = round2(parse(withdrawSchema, req.body || {}).amount);
    const { minWithdrawal } = await getMoneySettings();
    if (amount < minWithdrawal) throw new ValidationError(`The minimum withdrawal is Rs ${minWithdrawal}`);

    const partner = await HotelPartner.findById(partnerId).select('bank name phone').lean();
    if (!partner?.bank?.ifsc || !(partner.bank.accountNumberMasked || partner.bank.accountHolder)) {
        throw new ValidationError('Add your bank account (account number and IFSC) in your profile first');
    }
    const balance = await partnerBalanceOf(partnerId);
    if (amount > balance) throw new ConflictError(`You can withdraw at most Rs ${Math.max(0, balance)}`);

    const withdrawal = await HotelWithdrawal.create({
        partnerId,
        amount,
        bank: {
            accountHolder: partner.bank.accountHolder,
            accountNumberMasked: partner.bank.accountNumberMasked,
            ifsc: partner.bank.ifsc,
            bankName: partner.bank.bankName,
        },
        statusHistory: [{ status: 'pending', by: 'partner' }],
    });

    // The hold: the balance moves down now. The $inc is atomic, so two requests racing
    // past the check above cannot both keep money that is not there.
    const hold = await append({
        ...partnerOwner(partnerId),
        vertical: 'hotel',
        jobType: 'hotel_withdrawal',
        jobId: String(withdrawal._id),
        type: 'WITHDRAWAL',
        amount: -amount,
        idempotencyKey: forWithdrawal(String(withdrawal._id), 'requested'),
        actor: { kind: 'partner', id: String(partnerId) },
        reason: 'Withdrawal requested',
    });
    if (hold.entry && hold.entry.balanceAfter < -0.001) {
        await append({
            ...partnerOwner(partnerId),
            vertical: 'hotel',
            jobType: 'hotel_withdrawal',
            jobId: String(withdrawal._id),
            type: 'WITHDRAWAL',
            amount,
            idempotencyKey: forWithdrawal(String(withdrawal._id), 'released'),
            actor: { kind: 'system', id: '' },
            reason: 'Withdrawal released: insufficient balance',
        });
        await HotelWithdrawal.deleteOne({ _id: withdrawal._id });
        throw new ConflictError('Insufficient balance for this withdrawal');
    }
    return sendResponse(res, 201, 'Withdrawal requested', { withdrawal: withdrawalJSON(withdrawal.toObject(), partner) });
});

export const listMyWithdrawals = handle(async (req, res) => {
    const q = parse(pagingSchema, req.query);
    const { page, limit, skip } = pageOf(q);
    const filter = { partnerId: req.user.userId };
    const [rows, total, me] = await Promise.all([
        HotelWithdrawal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        HotelWithdrawal.countDocuments(filter),
        HotelPartner.findById(req.user.userId).select('name phone').lean(),
    ]);
    return sendResponse(res, 200, 'Withdrawals', { items: rows.map((w) => withdrawalJSON(w, me || null)), page, limit, total });
});

// ─── admin ────────────────────────────────────────────────────────────────

const adminListSchema = pagingSchema.extend({ status: z.enum(WITHDRAWAL_STATUSES).optional() });

export const adminListWithdrawals = handle(async (req, res) => {
    const q = parse(adminListSchema, req.query);
    const { page, limit, skip } = pageOf(q);
    const filter = q.status ? { status: q.status } : {};
    const [rows, total] = await Promise.all([
        HotelWithdrawal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        HotelWithdrawal.countDocuments(filter),
    ]);
    const partners = new Map(
        (await HotelPartner.find({ _id: { $in: [...new Set(rows.map((r) => String(r.partnerId)))] } }).select('name phone').lean())
            .map((p) => [String(p._id), p]),
    );
    return sendResponse(res, 200, 'Withdrawals', {
        items: rows.map((w) => withdrawalJSON(w, partners.get(String(w.partnerId)) || null)),
        page,
        limit,
        total,
    });
});

// Which status each target may come from.
const ALLOWED_FROM = {
    approved: ['pending'],
    rejected: ['pending', 'approved'],
    paid: ['pending', 'approved'],
};

const statusSchema = z.object({
    status: z.enum(['approved', 'rejected', 'paid']),
    note: z.string().trim().max(500).optional(),
    utr: z.string().trim().max(64).optional(),
});

export const adminSetWithdrawalStatus = handle(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new NotFoundError('Withdrawal not found');
    const body = parse(statusSchema, req.body || {});
    const adminId = isObjectId(String(req.user?.userId || '')) ? req.user.userId : undefined;

    const set = { status: body.status, processedAt: new Date() };
    if (adminId) set.processedBy = new mongoose.Types.ObjectId(adminId);
    if (body.note !== undefined) set.note = body.note;
    if (body.utr !== undefined) set.utr = body.utr;

    // Conditional on the current status, so two admins cannot both reject (and refund).
    const updated = await HotelWithdrawal.findOneAndUpdate(
        { _id: req.params.id, status: { $in: ALLOWED_FROM[body.status] } },
        { $set: set, $push: { statusHistory: { status: body.status, by: `admin:${adminId || ''}`, note: body.note } } },
        { new: true },
    ).lean();
    if (!updated) {
        const exists = await HotelWithdrawal.findById(req.params.id).select('status').lean();
        if (!exists) throw new NotFoundError('Withdrawal not found');
        throw new ConflictError(`A ${exists.status} withdrawal cannot be marked ${body.status}`);
    }

    if (body.status === 'rejected') {
        await append({
            ...partnerOwner(updated.partnerId),
            vertical: 'hotel',
            jobType: 'hotel_withdrawal',
            jobId: String(updated._id),
            type: 'WITHDRAWAL',
            amount: updated.amount,
            idempotencyKey: forWithdrawal(String(updated._id), 'rejected'),
            actor: { kind: 'admin', id: String(adminId || '') },
            reason: `Withdrawal rejected${body.note ? `: ${body.note}` : ''}`,
        });
    }
    const partner = await HotelPartner.findById(updated.partnerId).select('name phone').lean();
    return sendResponse(res, 200, 'Withdrawal updated', { withdrawal: withdrawalJSON(updated, partner || null) });
});
