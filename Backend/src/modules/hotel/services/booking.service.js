// Hotel bookings: quote, create, pay (Razorpay + KSG wallet), the status machine,
// cancellation and refunds, and the unpaid-hold expiry job.
// Plan: HOTEL_INTEGRATION_PLAN.md §4.2-4.4; API: docs/hotel-api-contract.md "Phase 4-5".
//
// Rules worth knowing before changing anything here:
//  - Every status change goes through transition(): an allowed-transitions table and
//    an atomic findOneAndUpdate({ _id, status: from }), so two actors (verify vs the
//    expiry job, partner vs customer) can never both win. Inventory is released in the
//    same transaction as the status change.
//  - bookingEvents ('transition' | 'payment' | 'refund') are emitted only AFTER the
//    commit, exactly once per change, by the code path that won it. Listeners (ledger
//    settlement, notifications) live in the other workstream.
//  - Money is idempotent on keys: wallet moves on CustomerWallet referenceKey, gateway
//    payments on the Razorpay order id (payments.facade.recordPayment), refunds on
//    booking.refunds[].key.
//  - Dates are IST nights (services/dates.js); stays are [checkIn, checkOut).

import mongoose from 'mongoose';
import { NotFoundError, ValidationError } from '../../../core/auth/errors.js';
import { recordPayment } from '../../../core/payments/payments.facade.js';
import { Payment } from '../../../core/payments/models/payment.model.js';
import { Refund } from '../../../core/payments/models/refund.model.js';
import { initiateRefund } from '../../../core/payments/refund.service.js';
import { capturedAmountMatches, toPaise } from '../../../core/payments/capturedAmount.js';
import { resolveMasterFees } from '../../../core/finance/platformFees.service.js';
import { logger } from '../../../utils/logger.js';
import { ConflictError } from '../errors.js';
import { HotelBooking } from '../models/hotelBooking.model.js';
import { HotelProperty } from '../models/hotelProperty.model.js';
import { HotelRoomType } from '../models/hotelRoomType.model.js';
import { HotelAvailability } from '../models/hotelAvailability.model.js';
import { HotelReview } from '../models/hotelReview.model.js';
import { parse } from '../validators/partner.validators.js';
import { quoteSchema, createBookingSchema, verifyPaymentSchema } from '../validators/booking.validators.js';
import { listableMatch } from './search.service.js';
import { isObjectId } from './property.service.js';
import {
    ensureInventoryDays,
    reserve,
    release,
    runInTransaction,
    quoteNights,
    parseStay,
    toNightDate,
    toDateString,
    todayIST,
    IST_OFFSET_MS,
} from './inventory.service.js';
import { priceStay, round2, customerPricing } from './pricing.service.js';
import { getHotelSettings } from './settings.service.js';
import { bookingEvents } from './bookingEvents.js';
// Importing offer.service also registers its 'transition' listener (coupon release).
import { validateHotelCoupon, redeemHotelCoupon, undoRedemption } from './offer.service.js';
import { gateway } from './gateway.js';
import { ensureWallet, walletBalance, debitWallet, creditWallet } from './wallet.js';

// ─── tables ───────────────────────────────────────────────────────────────

/** from -> allowed next statuses. Creation (from null) is handled by createBooking. */
export const TRANSITIONS = Object.freeze({
    awaiting_payment: Object.freeze(['confirmed', 'cancelled', 'expired']),
    confirmed: Object.freeze(['checked_in', 'cancelled', 'no_show']),
    // checked_in -> cancelled is admin-only (enforced in cancelBooking).
    checked_in: Object.freeze(['checked_out', 'cancelled']),
    checked_out: Object.freeze([]),
    cancelled: Object.freeze([]),
    no_show: Object.freeze([]),
    expired: Object.freeze([]),
});

export const canTransition = (from, to) => Boolean(TRANSITIONS[from]?.includes(to));

/** Statuses that give rooms back (from max(today, checkIn) to checkOut). */
const RELEASING = new Set(['cancelled', 'expired', 'no_show', 'checked_out']);

export const SYSTEM_ACTOR = Object.freeze({ role: 'system' });

// Paise-exact arithmetic on rupee amounts.
const add = (...xs) => xs.reduce((s, x) => s + toPaise(x), 0) / 100;
const sub = (a, ...xs) => (toPaise(a) - xs.reduce((s, x) => s + toPaise(x), 0)) / 100;

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

/** True when config/standaloneTransactions.js has turned transactions into no-ops. */
const transactionsAreNoops = () =>
    mongoose.mongo?.ClientSession?.prototype?.withTransaction?.name === 'withTransactionNoop';

const emit = (event, payload) => {
    try {
        bookingEvents.emit(event, payload);
    } catch (err) {
        // onBookingEvent isolates listeners; this guards a raw .on() that throws.
        logger.error(`[hotel] ${event} listener threw: ${err?.message || err}`);
    }
};

// ─── time & policy ────────────────────────────────────────────────────────

/** The moment the guest may check in: checkIn date at the property's check-in time, IST. */
export const checkInMoment = (booking) => {
    const [h, m] = String(booking.snapshot?.checkInTime || '12:00').split(':').map(Number);
    const night = booking.checkIn instanceof Date ? booking.checkIn : toNightDate(booking.checkIn);
    return new Date(night.getTime() + ((h || 0) * 60 + (m || 0)) * 60 * 1000);
};

const fmtIST = (date) => {
    const d = new Date(date.getTime() + IST_OFFSET_MS);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} IST`;
};

/**
 * The policy as it applies at `now`.
 * @returns {{ percent, freeCancellationUntil: Date|null, policyText }}
 */
export const policyTerms = (policy, checkInAt, now = new Date()) => {
    const type = policy?.type || 'moderate';
    if (type === 'non_refundable') {
        return { percent: 0, freeCancellationUntil: null, policyText: 'Non-refundable: nothing is refunded on cancellation.' };
    }
    const hours = Number(policy?.freeCancelHours) || 0;
    const after = Math.min(100, Math.max(0, Number(policy?.refundPercentAfter) || 0));
    const until = new Date(checkInAt.getTime() - hours * 3600 * 1000);
    const percent = now < until ? 100 : after;
    const afterText = after > 0 ? `${after}% of the amount paid is refunded` : 'nothing is refunded';
    return {
        percent,
        freeCancellationUntil: until,
        policyText: `Free cancellation until ${fmtIST(until)}. After that, ${afterText}.`,
    };
};

// ─── stay context (quote and create) ─────────────────────────────────────

/** Split payNow into a wallet part and a gateway part (gateway part 0 or >= Rs 1). */
export const splitPayNow = (payNow, balance, useWallet) => {
    if (!(payNow > 0) || !useWallet) return { walletAmount: 0, onlineAmount: payNow > 0 ? payNow : 0 };
    let walletAmount = round2(Math.max(0, Math.min(balance, payNow)));
    let onlineAmount = sub(payNow, walletAmount);
    if (onlineAmount > 0 && onlineAmount < 1) {
        // Razorpay's minimum is Rs 1: leave at least that much for the gateway.
        walletAmount = round2(Math.max(0, payNow - 1));
        onlineAmount = sub(payNow, walletAmount);
    }
    return { walletAmount, onlineAmount };
};

const loadStayContext = async (input, { userId = null } = {}) => {
    const q = input;
    const stay = parseStay(q.checkIn, q.checkOut);

    const property = await HotelProperty.findOne({ ...(await listableMatch()), _id: q.propertyId });
    if (!property) throw new NotFoundError('Property not found');
    const roomType = await HotelRoomType.findOne({
        _id: q.roomTypeId,
        propertyId: property._id,
        isActive: true,
        isDeleted: { $ne: true },
    });
    if (!roomType) throw new NotFoundError('Room type not found');

    const settings = await getHotelSettings();
    if (q.paymentMode === 'pay_at_hotel' && !settings.allowPayAtHotel) {
        throw new ValidationError('Pay at hotel is not available; choose online or part payment');
    }

    const fits = q.rooms * roomType.maxAdults >= q.adults && q.rooms * (roomType.maxChildren || 0) >= q.children;
    const nights = await quoteNights(roomType, stay.checkIn, stay.checkOut);
    const minAvailable = Math.min(...nights.map((n) => n.available));
    const available = fits && minAvailable >= q.rooms;

    const fees = await resolveMasterFees('hotel', property.zoneId);
    const platformFee = fees.platformFee > 0
        ? { fee: fees.platformFee, gstRate: fees.platformFeeGstRate ?? 18 }
        : null;

    const price = (coupon) => priceStay({
        roomType,
        nights,
        rooms: q.rooms,
        adults: q.adults,
        children: q.children,
        paymentMode: q.paymentMode,
        coupon,
        settings,
        platformFee,
    });
    let priced = price(null);

    // Coupon (services/offer.service.js): checked against the stay subtotal, then the
    // stay is priced again with the discount. A bad code is a 400 with the reason.
    let coupon = null;
    if (q.couponCode && String(q.couponCode).trim()) {
        coupon = await validateHotelCoupon({
            code: q.couponCode,
            userId,
            property,
            roomType,
            subtotal: priced.pricing.subtotal,
        });
        priced = price({ code: coupon.code, discount: coupon.discount, funding: coupon.funding });
    }

    return { q, stay, property, roomType, settings, nights, fits, available, minAvailable, priced, coupon };
};

const policyOf = (property) => ({
    type: property.cancellationPolicy?.type || 'moderate',
    freeCancelHours: property.cancellationPolicy?.freeCancelHours ?? 24,
    refundPercentAfter: property.cancellationPolicy?.refundPercentAfter ?? 0,
});

const checkInMomentFor = (property, checkIn) =>
    checkInMoment({ checkIn, snapshot: { checkInTime: property.checkInTime } });

/** POST /user/bookings/quote: price and availability, no hold. */
export const quoteBooking = async ({ userId, body }) => {
    const input = parse(quoteSchema, body);
    const ctx = await loadStayContext(input, { userId });
    const { q, stay, property, settings, priced } = ctx;
    const policy = policyOf(property);
    const terms = policyTerms(policy, checkInMomentFor(property, stay.checkIn));
    const balance = userId && priced.payNow > 0 ? await walletBalance(userId) : 0;
    return {
        propertyId: String(property._id),
        roomTypeId: String(ctx.roomType._id),
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        nights: stay.nights.length,
        rooms: q.rooms,
        guests: { adults: q.adults, children: q.children },
        available: ctx.available,
        paymentMode: q.paymentMode,
        pricing: customerPricing(priced.pricing),
        nightlyPrices: ctx.nights.map(({ date, price }) => ({ date, price })),
        payNow: priced.payNow,
        payAtHotel: priced.payAtHotel,
        walletApplicable: splitPayNow(priced.payNow, balance, true).walletAmount,
        cancellationPolicy: policy,
        ...(terms.freeCancellationUntil ? { freeCancellationUntil: terms.freeCancellationUntil.toISOString() } : {}),
        holdMinutes: settings.paymentHoldMinutes,
        ...(ctx.coupon ? { coupon: { code: ctx.coupon.code, title: ctx.coupon.offer.title || '', discount: ctx.coupon.discount } } : {}),
    };
};

// ─── create ──────────────────────────────────────────────────────────────

const makeBookingRef = () =>
    `KSGH${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, '0')}`.toUpperCase();

const addressLine = (property) => {
    const a = property.address || {};
    return a.fullAddress || [a.line1, a.area, a.city, a.state, a.pincode].filter(Boolean).join(', ');
};

const paymentStatusFor = ({ total, amountPaid, refundedAmount = 0 }) => {
    if (refundedAmount > 0) return refundedAmount >= amountPaid ? 'refunded' : 'partially_refunded';
    if (amountPaid <= 0) return 'pending';
    return amountPaid >= total ? 'paid' : 'partially_paid';
};

/** The Razorpay checkout object the client opens. */
const checkoutPayload = (booking) => ({
    razorpayOrderId: booking.payment.razorpayOrderId,
    amount: toPaise(booking.payment.onlineAmount),
    currency: 'INR',
    keyId: gateway.keyId(),
    name: 'KSG',
    description: `${booking.snapshot?.propertyName || 'Hotel stay'} · ${booking.bookingRef}`,
    prefill: {
        name: booking.guestDetails?.name || '',
        contact: booking.guestDetails?.phone || '',
        email: booking.guestDetails?.email || '',
    },
});

/** Make sure an awaiting_payment booking has a Razorpay order; returns the checkout object. */
const ensureGatewayOrder = async (booking) => {
    if (!booking.payment.razorpayOrderId) {
        const order = await gateway.createOrder({
            amountPaise: toPaise(booking.payment.onlineAmount),
            receipt: `hotel_${booking.bookingRef}`.slice(0, 40),
            notes: {
                vertical: 'hotel',
                bookingId: String(booking._id),
                bookingRef: booking.bookingRef,
                userId: String(booking.userId),
            },
        });
        await HotelBooking.updateOne(
            { _id: booking._id, status: 'awaiting_payment', 'payment.razorpayOrderId': null },
            { $set: { 'payment.razorpayOrderId': order.id } },
        );
        const fresh = await HotelBooking.findById(booking._id).lean();
        if (fresh.payment.razorpayOrderId === order.id) {
            await recordPayment({
                vertical: 'hotel',
                userId: booking.userId,
                amount: booking.payment.onlineAmount,
                method: 'razorpay',
                gateway: 'razorpay',
                status: 'created',
                gatewayOrderId: order.id,
                subjectId: booking._id,
                metadata: { bookingRef: booking.bookingRef },
            }).catch((err) => logger.error(`[hotel] payment attempt not recorded for ${booking.bookingRef}: ${err.message}`));
        }
        booking = fresh;
    }
    return checkoutPayload(booking);
};

/**
 * How many unpaid online holds (awaiting_payment, hold not yet ended) one customer may
 * have at once. Each hold takes rooms off sale for paymentHoldMinutes, so without a cap
 * one account could keep a property "sold out" by re-booking without paying.
 */
export const MAX_ACTIVE_HOLDS_PER_USER = 3;

/** 409 (code too_many_holds) when the customer already has the maximum unpaid holds. */
export const assertHoldCapacity = async (userId, now = new Date()) => {
    const holds = await HotelBooking.countDocuments({
        userId,
        status: 'awaiting_payment',
        'payment.expiresAt': { $gt: now },
    });
    if (holds >= MAX_ACTIVE_HOLDS_PER_USER) {
        throw new ConflictError(
            `You already have ${holds} bookings waiting for payment. Complete or cancel one of them before booking again.`,
            { code: 'too_many_holds' },
        );
    }
};

/** POST /user/bookings. */
export const createBooking = async ({ userId, body }) => {
    const input = parse(createBookingSchema, body);
    const ctx = await loadStayContext(input, { userId });
    const { q, stay, property, roomType, settings, priced, coupon } = ctx;
    if (!ctx.fits) {
        throw new ValidationError(`${roomType.name} fits at most ${roomType.maxAdults} adult(s) and ${roomType.maxChildren || 0} child(ren) per room`);
    }
    if (!ctx.available) throw new ConflictError('Sold out: not enough rooms for these dates');

    const { payNow, payAtHotel } = priced;
    let split = { walletAmount: 0, onlineAmount: payNow };
    if (input.useWallet && payNow > 0) {
        await ensureWallet(userId);
        split = splitPayNow(payNow, await walletBalance(userId), true);
    }
    const { walletAmount, onlineAmount } = split;
    const status = onlineAmount > 0 ? 'awaiting_payment' : 'confirmed';
    if (status === 'awaiting_payment') await assertHoldCapacity(userId);
    const now = new Date();
    const actor = { role: 'user', id: userId };
    const bookingId = new mongoose.Types.ObjectId();

    const doc = {
        _id: bookingId,
        bookingRef: makeBookingRef(),
        userId,
        propertyId: property._id,
        partnerId: property.partnerId,
        roomTypeId: roomType._id,
        ...(property.zoneId ? { zoneId: property.zoneId } : {}),
        snapshot: {
            propertyName: property.name,
            propertyType: property.propertyType,
            roomTypeName: roomType.name,
            address: addressLine(property),
            coverImage: property.coverImage,
            checkInTime: property.checkInTime,
            checkOutTime: property.checkOutTime,
            cancellationPolicy: policyOf(property),
        },
        checkIn: toNightDate(stay.checkIn),
        checkOut: toNightDate(stay.checkOut),
        nights: stay.nights.length,
        rooms: q.rooms,
        guests: { adults: q.adults, children: q.children },
        guestDetails: {
            name: input.guestDetails.name,
            phone: input.guestDetails.phone,
            ...(input.guestDetails.email ? { email: input.guestDetails.email } : {}),
        },
        ...(input.specialRequests ? { specialRequests: input.specialRequests } : {}),
        pricing: priced.pricing,
        payment: {
            mode: q.paymentMode,
            status: paymentStatusFor({ total: priced.pricing.total, amountPaid: walletAmount }),
            amountPaid: walletAmount,
            amountDue: sub(priced.pricing.total, walletAmount),
            walletAmount,
            payNow,
            onlineAmount,
            ...(status === 'awaiting_payment'
                ? { expiresAt: new Date(now.getTime() + settings.paymentHoldMinutes * 60 * 1000) }
                : {}),
        },
        status,
        statusHistory: [{
            status,
            at: now,
            by: actor,
            note: status === 'confirmed'
                ? (payNow > 0 ? 'Paid from wallet' : `Pay at hotel (Rs ${payAtHotel})`)
                : 'Waiting for online payment',
        }],
        source: 'app',
    };

    // Rows must exist before the transaction (see inventory.service.js header).
    await ensureInventoryDays(roomType, stay.checkIn, stay.checkOut);

    let reserved = false;
    let redeemed = false;
    try {
        await runInTransaction(async (session) => {
            reserved = false;
            redeemed = false;
            await reserve({ roomTypeId: roomType._id, checkIn: stay.checkIn, checkOut: stay.checkOut, units: q.rooms, session });
            reserved = true;
            if (coupon) {
                // Total and per-user limits, atomically; a use taken meanwhile aborts here.
                await redeemHotelCoupon({ coupon, userId, bookingId, session });
                redeemed = true;
            }
            await HotelAvailability.create([{
                propertyId: property._id,
                roomTypeId: roomType._id,
                source: 'platform',
                bookingId,
                startDate: doc.checkIn,
                endDate: doc.checkOut,
                units: q.rooms,
                createdBy: 'system',
            }], { session });
            await HotelBooking.create([doc], { session });
            // Last, so on a replica set an insufficient balance rolls everything back.
            if (walletAmount > 0) {
                await debitWallet({
                    userId,
                    amount: walletAmount,
                    referenceKey: `hotel:${bookingId}:debit`,
                    description: `Hotel booking ${doc.bookingRef}`,
                    metadata: { bookingId: String(bookingId), bookingRef: doc.bookingRef },
                    session,
                });
            }
        });
    } catch (err) {
        if (transactionsAreNoops()) {
            // Standalone server: nothing rolled back. Undo what this attempt wrote.
            if (reserved) {
                await release({ roomTypeId: roomType._id, checkIn: stay.checkIn, checkOut: stay.checkOut, units: q.rooms }).catch(() => {});
            }
            if (redeemed) await undoRedemption(bookingId).catch(() => {});
            await HotelAvailability.deleteOne({ bookingId }).catch(() => {});
            await HotelBooking.deleteOne({ _id: bookingId }).catch(() => {});
        }
        throw err;
    }

    let booking = await HotelBooking.findById(bookingId).lean();
    emit('transition', { booking, from: null, to: status, actor });
    if (walletAmount > 0) emit('payment', { booking, amount: walletAmount, kind: 'wallet' });

    let payment = null;
    if (status === 'awaiting_payment') {
        try {
            payment = await ensureGatewayOrder(booking);
        } catch (err) {
            // No way to pay: give the rooms and any wallet money back straight away.
            logger.error(`[hotel] gateway order failed for ${booking.bookingRef}: ${err.message}`);
            await expireBooking(bookingId, { note: 'Payment gateway unavailable' }).catch((e) =>
                logger.error(`[hotel] could not expire ${booking.bookingRef}: ${e.message}`));
            throw httpError(err.statusCode || 502, err.message || 'Payment gateway unavailable');
        }
        booking = await HotelBooking.findById(bookingId).lean();
    }
    return { booking, payment };
};

// ─── status machine ──────────────────────────────────────────────────────

/** Give back rooms from max(today, checkIn) to checkOut and trim/delete the ledger row. */
const releaseInventory = async (booking, session) => {
    const checkIn = toDateString(booking.checkIn);
    const checkOut = toDateString(booking.checkOut);
    const today = todayIST();
    const from = checkIn > today ? checkIn : today;
    if (from >= checkOut) return;
    await release({ roomTypeId: booking.roomTypeId, checkIn: from, checkOut, units: booking.rooms || 1, session });
    if (from === checkIn) {
        await HotelAvailability.deleteOne({ bookingId: booking._id }, { session });
    } else {
        await HotelAvailability.updateOne({ bookingId: booking._id }, { $set: { endDate: toNightDate(from) } }, { session });
    }
};

/**
 * Move a booking to `to`. Atomic on the current status; releases inventory in the same
 * transaction when the new status gives rooms back; emits after commit.
 *
 * @param {object|string} bookingOrId
 * @param {string} to
 * @param {{ role, id? }} actor
 * @param {object} [extra]
 * @param {string} [extra.note]
 * @param {object} [extra.set]      extra $set fields
 * @param {object} [extra.match]    extra filter conditions
 * @param {Array}  [extra.events]   [[name, payload]] emitted after commit, before 'transition'
 * @returns {Promise<{ booking, from, to }>}
 */
export const transition = async (bookingOrId, to, actor, extra = {}) => {
    const id = bookingOrId?._id || bookingOrId;
    const current = bookingOrId?.status ? bookingOrId : await HotelBooking.findById(id).lean();
    if (!current) throw new NotFoundError('Booking not found');
    const from = current.status;
    if (!canTransition(from, to)) {
        throw new ConflictError(`A ${from.replace('_', ' ')} booking cannot be moved to ${to.replace('_', ' ')}`);
    }
    const by = { role: actor?.role || 'system', ...(actor?.id && isObjectId(String(actor.id)) ? { id: actor.id } : {}) };
    const now = new Date();

    const updated = await runInTransaction(async (session) => {
        const doc = await HotelBooking.findOneAndUpdate(
            { _id: id, status: from, ...(extra.match || {}) },
            {
                $set: { status: to, ...(extra.set || {}) },
                $push: { statusHistory: { status: to, at: now, by, ...(extra.note ? { note: extra.note } : {}) } },
            },
            { new: true, session, lean: true },
        );
        if (!doc) return null;
        if (RELEASING.has(to)) await releaseInventory(doc, session);
        return doc;
    });
    if (!updated) {
        throw new ConflictError('This booking was changed by someone else; reload and try again', { code: 'stale' });
    }
    for (const [name, payload] of extra.events || []) emit(name, { ...payload, booking: updated });
    emit('transition', { booking: updated, from, to, actor: by });
    return { booking: updated, from, to };
};

// ─── refunds ─────────────────────────────────────────────────────────────

/** What the platform still holds for this booking: wallet + online, less refunds. */
export const refundableParts = (booking) => {
    const p = booking.payment || {};
    const wallet = Math.max(0, sub(p.walletAmount || 0, p.walletRefunded || 0));
    const online = Math.max(0, sub(p.onlinePaid || 0, p.gatewayRefunded || 0));
    return { wallet, online, total: add(wallet, online) };
};

/** Split a refund amount: back to the card/UPI first, then the wallet. */
export const splitRefund = (booking, amount) => {
    const parts = refundableParts(booking);
    const amt = Math.min(round2(amount), parts.total);
    const gatewayAmount = Math.min(amt, parts.online);
    return { amount: amt, gatewayAmount, walletAmount: sub(amt, gatewayAmount) };
};

/** Rupees, rounded to paise, as an aggregation expression over `expr`. */
const roundExpr = (expr) => ({ $round: [expr, 2] });
const fieldOr0 = (path) => ({ $ifNull: [path, 0] });
/** What is still refundable from one source, as an aggregation expression. */
const heldExpr = (paidPath, refundedPath) => ({ $subtract: [fieldOr0(paidPath), fieldOr0(refundedPath)] });
// Float slack when comparing rupee amounts that were summed in the database.
const CAP_SLACK = 0.001;

/** payment.status from the stored figures, as an aggregation expression (paymentStatusFor). */
const paymentStatusExpr = {
    $switch: {
        branches: [
            {
                case: { $gt: [fieldOr0('$payment.refundedAmount'), 0] },
                then: {
                    $cond: [
                        { $gte: [{ $add: [fieldOr0('$payment.refundedAmount'), CAP_SLACK] }, fieldOr0('$payment.amountPaid')] },
                        'refunded',
                        'partially_refunded',
                    ],
                },
            },
            { case: { $lte: [fieldOr0('$payment.amountPaid'), 0] }, then: 'pending' },
            {
                case: { $gte: [{ $add: [fieldOr0('$payment.amountPaid'), CAP_SLACK] }, fieldOr0('$pricing.total')] },
                then: 'paid',
            },
        ],
        default: 'partially_paid',
    },
};

/**
 * Claim a refund: one atomic update that (a) refuses a key already used, (b) refuses
 * more than the platform still holds per source (wallet / gateway), and (c) reserves
 * the amounts by adding them to walletRefunded / gatewayRefunded / refundedAmount
 * straight away. Two refunds racing (a partner cancel and an admin manual refund, say)
 * therefore can never together pay out more than was paid in.
 * @returns the claimed booking, or null
 */
const claimRefund = (bookingId, entry) => HotelBooking.findOneAndUpdate(
    {
        _id: bookingId,
        'refunds.key': { $ne: entry.key },
        $expr: {
            $and: [
                { $lte: [entry.walletAmount, { $add: [heldExpr('$payment.walletAmount', '$payment.walletRefunded'), CAP_SLACK] }] },
                { $lte: [entry.gatewayAmount, { $add: [heldExpr('$payment.onlinePaid', '$payment.gatewayRefunded'), CAP_SLACK] }] },
            ],
        },
    },
    [{
        $set: {
            // $literal: a reason that starts with '$' must stay text, not a field path.
            refunds: { $concatArrays: [{ $ifNull: ['$refunds', []] }, [{ $literal: entry }]] },
            'payment.walletRefunded': roundExpr({ $add: [fieldOr0('$payment.walletRefunded'), entry.walletAmount] }),
            'payment.gatewayRefunded': roundExpr({ $add: [fieldOr0('$payment.gatewayRefunded'), entry.gatewayAmount] }),
            'payment.refundedAmount': roundExpr({ $add: [fieldOr0('$payment.refundedAmount'), entry.amount] }),
        },
    }],
    { new: true, lean: true },
);

/**
 * Pay a refund once per `key`: wallet part to the customer's KSG wallet, gateway part
 * through core refunds (a Refund row via refund.service.initiateRefund, then Razorpay).
 * Emits 'refund' with what actually moved.
 *
 * Never refunds more than the platform still holds for the booking, per source, even
 * under concurrency (see claimRefund). With `clamp` (the default) a request that no
 * longer fits -- another refund landed in between -- is cut down to what is left;
 * without it, it is refused ({ capped: true }).
 */
export const applyRefund = async (bookingId, { key, walletAmount = 0, gatewayAmount = 0, reason = '', by = 'system', clamp = true }) => {
    walletAmount = round2(walletAmount);
    gatewayAmount = round2(gatewayAmount);
    let amount = add(walletAmount, gatewayAmount);
    if (!(amount > 0)) return { booking: await HotelBooking.findById(bookingId).lean(), refunded: 0 };

    let claimed = null;
    for (let attempt = 0; attempt < 3 && !claimed; attempt++) {
        claimed = await claimRefund(bookingId, {
            key, amount, walletAmount, gatewayAmount, status: 'pending', reason, by, at: new Date(),
        });
        if (claimed) break;
        const current = await HotelBooking.findById(bookingId).lean();
        if (!current) throw new NotFoundError('Booking not found');
        if ((current.refunds || []).some((r) => r.key === key)) return { booking: current, refunded: 0, duplicate: true };
        // Over the cap: someone else refunded meanwhile.
        if (!clamp) return { booking: current, refunded: 0, capped: true };
        const left = refundableParts(current);
        walletAmount = Math.min(walletAmount, left.wallet);
        gatewayAmount = Math.min(gatewayAmount, left.online);
        amount = add(walletAmount, gatewayAmount);
        if (!(amount > 0)) return { booking: current, refunded: 0, capped: true };
    }
    if (!claimed) return { booking: await HotelBooking.findById(bookingId).lean(), refunded: 0, capped: true };

    let walletDone = 0;
    let gatewayDone = 0;
    let refundId;
    let gatewayRefundId;
    let failed = false;

    if (walletAmount > 0) {
        try {
            await creditWallet({
                userId: claimed.userId,
                amount: walletAmount,
                referenceKey: `hotel:${bookingId}:refund:${key}`,
                description: `Refund for hotel booking ${claimed.bookingRef}`,
                metadata: { bookingId: String(bookingId), bookingRef: claimed.bookingRef, reason },
            });
            walletDone = walletAmount;
        } catch (err) {
            failed = true;
            logger.error(`[hotel] wallet refund failed for ${claimed.bookingRef}: ${err.message}`);
        }
    }

    if (gatewayAmount > 0) {
        try {
            const paymentRow = await Payment.findOne({ gatewayOrderId: claimed.payment.razorpayOrderId, vertical: 'hotel' });
            if (!paymentRow) throw new Error('no payment row for this booking');
            const refund = await initiateRefund({
                paymentId: String(paymentRow._id),
                orderId: String(bookingId),
                userId: String(claimed.userId),
                amount: gatewayAmount,
                reason: reason || `Hotel booking ${claimed.bookingRef}`,
                refundTo: 'gateway',
            });
            refundId = refund._id;
            try {
                const rz = await gateway.refund(claimed.payment.razorpayPaymentId, gatewayAmount, {
                    bookingRef: claimed.bookingRef,
                    key,
                });
                gatewayRefundId = rz?.id;
                await Refund.updateOne({ _id: refundId }, {
                    $set: { status: 'processed', gatewayRefundId: rz?.id || '', processedAt: new Date() },
                });
                gatewayDone = gatewayAmount;
                // claimed.payment.gatewayRefunded already includes this refund (reserved).
                if (toPaise(claimed.payment.gatewayRefunded || 0) >= toPaise(claimed.payment.onlinePaid || 0)) {
                    await Payment.updateOne({ _id: paymentRow._id }, { $set: { status: 'refunded' } });
                }
            } catch (err) {
                await Refund.updateOne({ _id: refundId }, { $set: { status: 'failed', metadata: { error: err.message } } });
                throw err;
            }
        } catch (err) {
            failed = true;
            logger.error(`[hotel] gateway refund failed for ${claimed.bookingRef}: ${err.message}`);
        }
    }

    const refundedNow = add(walletDone, gatewayDone);
    // `amount` stays what was requested; walletAmount/gatewayAmount become what actually
    // moved, so a 'failed' entry shows exactly which part still needs doing. The part
    // reserved by the claim that did not move is handed back.
    const patch = {
        status: failed ? 'failed' : 'processed',
        walletAmount: walletDone,
        gatewayAmount: gatewayDone,
        ...(refundId ? { refundId } : {}),
        ...(gatewayRefundId ? { gatewayRefundId } : {}),
    };
    const walletBack = sub(walletAmount, walletDone);
    const gatewayBack = sub(gatewayAmount, gatewayDone);
    const pipeline = [{
        $set: {
            refunds: {
                $map: {
                    input: '$refunds',
                    as: 'r',
                    in: { $cond: [{ $eq: ['$$r.key', key] }, { $mergeObjects: ['$$r', { $literal: patch }] }, '$$r'] },
                },
            },
            'payment.walletRefunded': roundExpr({ $subtract: [fieldOr0('$payment.walletRefunded'), walletBack] }),
            'payment.gatewayRefunded': roundExpr({ $subtract: [fieldOr0('$payment.gatewayRefunded'), gatewayBack] }),
            'payment.refundedAmount': roundExpr({ $subtract: [fieldOr0('$payment.refundedAmount'), add(walletBack, gatewayBack)] }),
        },
    }];
    if (refundedNow > 0) pipeline.push({ $set: { 'payment.status': paymentStatusExpr } });
    const booking = await HotelBooking.findOneAndUpdate(
        { _id: bookingId, 'refunds.key': key },
        pipeline,
        { new: true, lean: true },
    );
    if (refundedNow > 0) {
        emit('refund', {
            booking,
            amount: refundedNow,
            walletAmount: walletDone,
            gatewayAmount: gatewayDone,
            ...(refundId ? { refundId: String(refundId) } : {}),
        });
    }
    return { booking, refunded: refundedNow, failed };
};

// ─── cancellation ────────────────────────────────────────────────────────

/** Refund figures for a cancellation by `by` at `now` (no writes). */
export const cancellationPreview = (booking, { by = 'user', now = new Date() } = {}) => {
    const policy = booking.snapshot?.cancellationPolicy || {};
    const terms = policyTerms(policy, checkInMoment(booking), now);
    // Partner/admin cancellations, and unconfirmed holds, always refund in full.
    const percent = by === 'user' && booking.status === 'confirmed' ? terms.percent : 100;
    const parts = refundableParts(booking);
    const refundAmount = round2((parts.total * percent) / 100);
    const split = splitRefund(booking, refundAmount);
    return {
        refundAmount: split.amount,
        refundPercent: percent,
        walletRefund: split.walletAmount,
        gatewayRefund: split.gatewayAmount,
        policyText: terms.policyText,
        ...(terms.freeCancellationUntil ? { freeCancellationUntil: terms.freeCancellationUntil.toISOString() } : {}),
    };
};

/** Can the guest cancel it themselves right now? */
export const userCanCancel = (booking, now = new Date()) =>
    ['awaiting_payment', 'confirmed'].includes(booking.status) && now < checkInMoment(booking);

/**
 * Cancel. by: 'user' (policy refund, before check-in time), 'partner' or 'admin'
 * (full refund). Returns the updated booking.
 */
export const cancelBooking = async (booking, { by, actorId, reason = '', force = false }) => {
    const cancellable = by === 'admin' ? ['awaiting_payment', 'confirmed', 'checked_in'] : ['awaiting_payment', 'confirmed'];
    if (!cancellable.includes(booking.status)) {
        throw new ConflictError(`A ${booking.status.replace('_', ' ')} booking cannot be cancelled`);
    }
    const now = new Date();
    if (by === 'user' && !userCanCancel(booking, now)) {
        throw new ConflictError('This booking can no longer be cancelled online; please contact the property');
    }
    if (by === 'partner' && !force && toDateString(booking.checkOut) <= todayIST(now)) {
        throw new ConflictError('This stay has already ended');
    }
    const preview = cancellationPreview(booking, { by, now });
    const { booking: cancelled } = await transition(booking, 'cancelled', { role: by, id: actorId }, {
        note: reason || undefined,
        set: {
            cancellation: { by, reason, at: now, refundAmount: preview.refundAmount },
            'payment.amountDue': 0,
        },
    });
    if (preview.refundAmount > 0) {
        const { booking: refunded } = await applyRefund(cancelled._id, {
            key: 'cancel',
            walletAmount: preview.walletRefund,
            gatewayAmount: preview.gatewayRefund,
            reason: `Cancelled by ${by}${reason ? `: ${reason}` : ''}`,
            by,
        });
        return refunded;
    }
    return cancelled;
};

/** awaiting_payment -> expired, rooms released, wallet part refunded. */
export const expireBooking = async (bookingId, { note = 'Payment window ended', now = null } = {}) => {
    const { booking } = await transition(bookingId, 'expired', SYSTEM_ACTOR, {
        note,
        set: { 'payment.amountDue': 0 },
        ...(now ? { match: { 'payment.expiresAt': { $lte: now } } } : {}),
    });
    const wallet = refundableParts(booking).wallet;
    if (wallet > 0) {
        const { booking: refunded } = await applyRefund(booking._id, {
            key: 'expiry',
            walletAmount: wallet,
            reason: note,
            by: 'system',
        });
        return refunded;
    }
    if (booking.payment.amountPaid <= 0) {
        await HotelBooking.updateOne({ _id: booking._id }, { $set: { 'payment.status': 'failed' } });
    }
    return HotelBooking.findById(booking._id).lean();
};

/**
 * The expiry job: every awaiting_payment booking whose hold has ended. Safe to run
 * concurrently (each expiry is a conditional transition).
 */
export const expireStaleBookings = async ({ now = new Date(), limit = 200 } = {}) => {
    const stale = await HotelBooking.find({ status: 'awaiting_payment', 'payment.expiresAt': { $lte: now } })
        .select('_id').sort({ 'payment.expiresAt': 1 }).limit(limit).lean();
    let expired = 0;
    for (const { _id } of stale) {
        try {
            await expireBooking(_id, { now });
            expired++;
        } catch (err) {
            if (err?.statusCode !== 409) logger.error(`[hotel] expiry failed for ${_id}: ${err.message}`);
        }
    }
    return { scanned: stale.length, expired };
};

// ─── payment confirmation ────────────────────────────────────────────────

/**
 * A second capture on an order whose booking already holds a different payment (the
 * guest paid twice, or a late authorisation was auto-captured). It is not part of the
 * booking's money, so it is refunded on its own, straight to the gateway, once per
 * payment id (refunds[].key `stray:<paymentId>`). Booking totals are not touched.
 */
const refundStrayCapture = async (booking, { paymentId, amount }) => {
    const key = `stray:${paymentId}`;
    const claimed = await HotelBooking.findOneAndUpdate(
        { _id: booking._id, 'refunds.key': { $ne: key } },
        {
            $push: {
                refunds: {
                    key, amount, walletAmount: 0, gatewayAmount: amount, status: 'pending',
                    reason: 'Duplicate payment on this booking', by: 'system', at: new Date(),
                },
            },
        },
        { new: true, lean: true },
    );
    if (!claimed) return HotelBooking.findById(booking._id).lean();
    logger.error(`[hotel] DUPLICATE CAPTURE ${paymentId} (Rs ${amount}) on ${booking.bookingRef}; refunding it`);
    let status = 'processed';
    let gatewayRefundId;
    try {
        const rz = await gateway.refund(paymentId, amount, { bookingRef: booking.bookingRef, key });
        gatewayRefundId = rz?.id;
    } catch (err) {
        status = 'failed';
        logger.error(`[hotel] duplicate-capture refund failed for ${booking.bookingRef} (${paymentId}): ${err.message}`);
    }
    return HotelBooking.findOneAndUpdate(
        { _id: booking._id, 'refunds.key': key },
        { $set: { 'refunds.$.status': status, ...(gatewayRefundId ? { 'refunds.$.gatewayRefundId': gatewayRefundId } : {}) } },
        { new: true, lean: true },
    );
};

/** Late capture (booking already expired/cancelled): send the money straight back. */
const refundLateCapture = async (booking, { paymentId, amount, orderId }) => {
    if (booking.payment.razorpayPaymentId && booking.payment.razorpayPaymentId !== paymentId) {
        return refundStrayCapture(booking, { paymentId, amount });
    }
    await recordPayment({
        vertical: 'hotel',
        userId: booking.userId,
        amount,
        method: 'razorpay',
        gateway: 'razorpay',
        status: 'success',
        gatewayOrderId: orderId,
        gatewayPaymentId: paymentId,
        subjectId: booking._id,
        metadata: { bookingRef: booking.bookingRef, lateCapture: true },
    });
    // Record what was captured so applyRefund can address the gateway part.
    await HotelBooking.updateOne(
        { _id: booking._id, 'payment.razorpayPaymentId': { $in: [null, ''] } },
        { $set: { 'payment.razorpayPaymentId': paymentId, 'payment.onlinePaid': amount, 'payment.amountPaid': add(booking.payment.amountPaid || 0, amount) } },
    );
    const fresh = await HotelBooking.findById(booking._id).lean();
    if (fresh.payment.razorpayPaymentId !== paymentId) return refundStrayCapture(fresh, { paymentId, amount });
    emit('payment', { booking: fresh, amount, kind: 'online', paymentId });
    const { booking: refunded } = await applyRefund(booking._id, {
        key: `late:${paymentId}`,
        gatewayAmount: amount,
        reason: `Payment arrived after the booking was ${booking.status}`,
        by: 'system',
    });
    return refunded;
};

/**
 * Mark an awaiting_payment booking paid by a captured gateway payment. Shared by
 * /verify-payment and the Razorpay webhook; idempotent on the payment id.
 * @returns {{ booking, outcome: 'confirmed'|'already'|'late_refunded' }}
 */
export const confirmOnlinePayment = async (bookingId, { orderId, paymentId, capturedPaise, source }) => {
    const booking = await HotelBooking.findById(bookingId).lean();
    if (!booking) throw new NotFoundError('Booking not found');
    if (booking.payment.razorpayOrderId !== orderId) throw new ValidationError('Payment does not belong to this booking');
    if (booking.payment.razorpayPaymentId === paymentId) return { booking, outcome: 'already' };

    const verdict = capturedAmountMatches(capturedPaise, booking.payment.onlineAmount);
    if (!verdict.matches) {
        logger.error(`[hotel] AMOUNT MISMATCH (${verdict.reason}) on ${booking.bookingRef}: captured ${verdict.capturedPaise}, expected ${verdict.expectedPaise}`);
        throw new ValidationError('Paid amount does not match this booking');
    }
    const amount = booking.payment.onlineAmount;

    if (booking.status !== 'awaiting_payment') {
        const refunded = await refundLateCapture(booking, { paymentId, amount, orderId });
        return { booking: refunded, outcome: 'late_refunded' };
    }

    const paymentRow = await recordPayment({
        vertical: 'hotel',
        userId: booking.userId,
        amount,
        method: 'razorpay',
        gateway: 'razorpay',
        status: 'success',
        gatewayOrderId: orderId,
        gatewayPaymentId: paymentId,
        subjectId: booking._id,
        metadata: { bookingRef: booking.bookingRef, source },
    });

    const amountPaid = add(booking.payment.amountPaid || 0, amount);
    try {
        const { booking: confirmed } = await transition(booking, 'confirmed', SYSTEM_ACTOR, {
            note: `Paid online (${source})`,
            match: { 'payment.razorpayOrderId': orderId },
            set: {
                'payment.razorpayPaymentId': paymentId,
                'payment.paymentId': paymentRow?._id,
                'payment.onlinePaid': amount,
                'payment.amountPaid': amountPaid,
                'payment.amountDue': sub(booking.pricing.total, amountPaid),
                'payment.status': paymentStatusFor({ total: booking.pricing.total, amountPaid }),
            },
            events: [['payment', { amount, kind: 'online', paymentId }]],
        });
        return { booking: confirmed, outcome: 'confirmed' };
    } catch (err) {
        if (err?.statusCode !== 409) throw err;
        // Lost a race: the other path confirmed it (same payment) or it expired meanwhile.
        const now = await HotelBooking.findById(bookingId).lean();
        if (now.payment.razorpayPaymentId === paymentId) return { booking: now, outcome: 'already' };
        const refunded = await refundLateCapture(now, { paymentId, amount, orderId });
        return { booking: refunded, outcome: 'late_refunded' };
    }
};

/** POST /user/bookings/:id/verify-payment. */
export const verifyBookingPayment = async (booking, body) => {
    const input = parse(verifyPaymentSchema, body);
    if (booking.payment.razorpayOrderId !== input.razorpayOrderId) {
        throw new ValidationError('Payment does not belong to this booking');
    }
    if (booking.payment.razorpayPaymentId === input.razorpayPaymentId) return booking; // idempotent
    if (!gateway.verifySignature(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature)) {
        throw new ValidationError('Payment signature is invalid');
    }
    const payment = await gateway.fetchPayment(input.razorpayPaymentId, {
        orderId: input.razorpayOrderId,
        expectedPaise: toPaise(booking.payment.onlineAmount),
    });
    if (!payment || payment.order_id !== input.razorpayOrderId) {
        throw new ValidationError('Payment does not belong to this booking');
    }
    if (payment.status !== 'captured') {
        throw new ValidationError(`Payment is not complete yet (status: ${payment.status}); please try again shortly`);
    }
    const { booking: out, outcome } = await confirmOnlinePayment(booking._id, {
        orderId: input.razorpayOrderId,
        paymentId: input.razorpayPaymentId,
        capturedPaise: payment.amount,
        source: 'verify',
    });
    if (outcome === 'late_refunded') {
        throw new ConflictError('The payment window ended before this payment arrived; it has been refunded');
    }
    return out;
};

/**
 * Razorpay webhook hook (core/payments/controllers/razorpayWebhook.controller.js).
 * @returns {Promise<boolean>} true when the order belongs to a hotel booking.
 */
export const handleHotelPaymentCaptured = async (paymentEntity) => {
    const orderId = paymentEntity?.order_id;
    if (!orderId) return false;
    const booking = await HotelBooking.findOne({ 'payment.razorpayOrderId': orderId }).select('_id bookingRef').lean();
    if (!booking) return false;
    try {
        const { outcome } = await confirmOnlinePayment(booking._id, {
            orderId,
            paymentId: paymentEntity.id,
            capturedPaise: paymentEntity.amount,
            source: 'webhook',
        });
        logger.info(`[hotel] webhook payment.captured ${booking.bookingRef}: ${outcome}`);
    } catch (err) {
        logger.error(`[hotel] webhook payment.captured ${booking.bookingRef} not applied: ${err.message}`);
        // A 4xx (amount or order mismatch) can never succeed: acknowledge it. Anything
        // else (database or gateway trouble) must be retried by Razorpay -- swallowing it
        // left captured money on a booking that then expired with nobody refunding it.
        if (!err?.statusCode || err.statusCode >= 500) {
            throw Object.assign(err instanceof Error ? err : new Error(String(err)), { retryable: true });
        }
    }
    return true;
};

/** POST /user/bookings/:id/retry-payment. */
export const retryPayment = async (booking) => {
    if (booking.status !== 'awaiting_payment') {
        throw new ConflictError(booking.status === 'expired'
            ? 'The payment window has ended; please book again'
            : 'This booking is not waiting for payment');
    }
    if (booking.payment.expiresAt && new Date(booking.payment.expiresAt) <= new Date()) {
        throw new ConflictError('The payment window has ended; please book again');
    }
    return ensureGatewayOrder(booking);
};

// ─── partner / admin actions ─────────────────────────────────────────────

/**
 * confirmed -> checked_in. Date rule: on/after the check-in date and before the
 * check-out date (admin `force` skips it).
 */
export const checkInBooking = async (booking, actor, { force = false } = {}) => {
    const today = todayIST();
    if (!force) {
        if (today < toDateString(booking.checkIn)) throw new ConflictError('Check-in opens on the check-in date');
        if (today >= toDateString(booking.checkOut)) throw new ConflictError('This stay has already ended');
    }
    return (await transition(booking, 'checked_in', actor, { note: force ? 'Checked in (override)' : undefined })).booking;
};

/** checked_in -> checked_out. An unpaid balance needs `force`. */
export const checkOutBooking = async (booking, actor, { force = false } = {}) => {
    const due = Number(booking.payment?.amountDue) || 0;
    if (due > 0 && !force) {
        throw new ConflictError(`Rs ${due} is still unpaid. Record it with mark-paid, or check out with force.`);
    }
    return (await transition(booking, 'checked_out', actor, {
        note: due > 0 ? `Checked out with Rs ${due} unpaid` : undefined,
    })).booking;
};

/** confirmed -> no_show. Only after the check-in day (admin `force` skips it). */
export const noShowBooking = async (booking, actor, { force = false } = {}) => {
    if (!force && todayIST() <= toDateString(booking.checkIn)) {
        throw new ConflictError('A no-show can be marked only after the check-in day');
    }
    return (await transition(booking, 'no_show', actor, { note: force ? 'No-show (override)' : undefined })).booking;
};

/** Record cash/UPI collected at the property. */
export const markPaidAtHotel = async (booking, actor, amount) => {
    amount = round2(amount);
    if (!['confirmed', 'checked_in', 'checked_out'].includes(booking.status)) {
        throw new ConflictError(`Payments cannot be recorded on a ${booking.status.replace('_', ' ')} booking`);
    }
    const due = Number(booking.payment.amountDue) || 0;
    if (!(amount > 0) || amount > due) throw new ValidationError(`amount must be more than 0 and at most the balance due (Rs ${due})`);
    const amountPaid = add(booking.payment.amountPaid || 0, amount);
    const updated = await HotelBooking.findOneAndUpdate(
        { _id: booking._id, status: booking.status, 'payment.amountDue': booking.payment.amountDue },
        {
            $set: {
                'payment.amountPaid': amountPaid,
                'payment.amountDue': sub(due, amount),
                'payment.collectedAtHotel': add(booking.payment.collectedAtHotel || 0, amount),
                'payment.status': paymentStatusFor({ total: booking.pricing.total, amountPaid, refundedAmount: booking.payment.refundedAmount || 0 }),
            },
        },
        { new: true, lean: true },
    );
    if (!updated) throw new ConflictError('This booking was changed by someone else; reload and try again');
    emit('payment', { booking: updated, amount, kind: 'at_hotel', actor: { role: actor.role, id: actor.id } });
    return updated;
};

/** Admin manual refund, capped at what the platform still holds for the booking. */
export const manualRefund = async (booking, { amount, reason, adminId }) => {
    const parts = refundableParts(booking);
    if (round2(amount) > parts.total) {
        throw new ValidationError(`At most Rs ${parts.total} can be refunded on this booking`);
    }
    const split = splitRefund(booking, amount);
    const n = (booking.refunds || []).filter((r) => r.key.startsWith('manual:')).length;
    const { booking: out, failed, duplicate, capped } = await applyRefund(booking._id, {
        key: `manual:${n + 1}`,
        walletAmount: split.walletAmount,
        gatewayAmount: split.gatewayAmount,
        reason,
        by: 'admin',
        clamp: false,
    });
    if (duplicate || capped) throw new ConflictError('Another refund was just recorded on this booking; reload and try again');
    if (failed) throw httpError(502, 'The refund could not be completed; see the booking refunds for details');
    logger.info(`[hotel] manual refund Rs ${split.amount} on ${booking.bookingRef} by admin ${adminId}`);
    return out;
};

// ─── views ───────────────────────────────────────────────────────────────

/** Booking JSON for 'user' | 'partner' | 'admin'. */
export const bookingJSON = (doc, view, { reviewId = null, summary = false, now = new Date() } = {}) => {
    if (!doc) return null;
    const b = { ...doc };
    delete b.__v;
    delete b.notificationsSent;
    b.checkIn = toDateString(doc.checkIn);
    b.checkOut = toDateString(doc.checkOut);
    const p = doc.payment || {};
    b.payment = {
        mode: p.mode,
        status: p.status,
        amountPaid: p.amountPaid || 0,
        amountDue: p.amountDue || 0,
        walletAmount: p.walletAmount || 0,
        payNow: p.payNow || 0,
        onlineAmount: p.onlineAmount || 0,
        onlinePaid: p.onlinePaid || 0,
        collectedAtHotel: p.collectedAtHotel || 0,
        refundedAmount: p.refundedAmount || 0,
        ...(doc.status === 'awaiting_payment' && p.expiresAt ? { expiresAt: p.expiresAt } : {}),
        ...(view === 'admin' ? {
            razorpayOrderId: p.razorpayOrderId,
            razorpayPaymentId: p.razorpayPaymentId,
            paymentId: p.paymentId,
            walletRefunded: p.walletRefunded || 0,
            gatewayRefunded: p.gatewayRefunded || 0,
        } : {}),
    };
    b.refunds = (doc.refunds || []).map((r) => ({
        amount: r.amount,
        walletAmount: r.walletAmount,
        gatewayAmount: r.gatewayAmount,
        status: r.status,
        reason: r.reason,
        by: r.by,
        at: r.at,
        ...(view === 'admin' ? { key: r.key, refundId: r.refundId, gatewayRefundId: r.gatewayRefundId } : {}),
    }));
    if (doc.review || reviewId) b.reviewId = doc.review || reviewId;
    delete b.review;
    if (view === 'user') {
        delete b.partnerId;
        b.pricing = customerPricing(doc.pricing);
        b.statusHistory = (doc.statusHistory || []).map((h) => ({ status: h.status, at: h.at, by: { role: h.by?.role }, ...(h.note ? { note: h.note } : {}) }));
        b.canCancel = userCanCancel(doc, now);
        b.canReview = doc.status === 'checked_out' && !b.reviewId;
    }
    if (view === 'partner') {
        // The hotel needs the guest's name and contact (guestDetails), not the
        // customer's platform account id or who-did-what account ids.
        delete b.userId;
        b.statusHistory = (doc.statusHistory || []).map((h) => ({ status: h.status, at: h.at, by: { role: h.by?.role }, ...(h.note ? { note: h.note } : {}) }));
    }
    if (summary) delete b.statusHistory;
    return b;
};

/** Review ids by booking id, for canReview. */
export const reviewIdsFor = async (bookings) => {
    const ids = bookings.filter((b) => b.status === 'checked_out' && !b.review).map((b) => b._id);
    if (!ids.length) return new Map();
    const rows = await HotelReview.find({ bookingId: { $in: ids } }).select('_id bookingId').lean();
    return new Map(rows.map((r) => [String(r.bookingId), r._id]));
};
