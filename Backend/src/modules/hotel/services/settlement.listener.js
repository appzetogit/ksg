// Hotel settlement: booking events -> core ledger (HOTEL_INTEGRATION_PLAN.md §4.5).
//
// A LISTENER on services/bookingEvents.js; the booking workstream never calls this.
// Every movement goes through core/finance/ledger.service.append with a key from
// forHotelBooking(bookingId, step, role), so a re-emitted event moves nothing twice.
//
// Money model (all from booking.pricing, rupees):
//   partnerGross = taxableAmount + gstAmount             the hotel's tariff incl. its GST
//   commission   = commissionAmount + commissionGst      the platform's cut
//   fee          = platformFee + platformFeeGst          the platform's booking fee
//   total        = partnerGross + fee (what the guest pays)
//   prepaid P    = what the PLATFORM collected (online + wallet) less refunds so far;
//                  the hotel collected the rest (total - P) at the desk.
//
// On settle (booking reaches settings.settleOn, default checked_out):
//   partner  EARNING     +(P - fee)        if positive: online money owed to the hotel
//            PLATFORM_FEE (P - fee)         if negative: fee the hotel collected for us
//            COMMISSION  -commission
//   platform COMMISSION  +commission, PLATFORM_FEE +fee
// so the hotel nets P - fee - commission in its wallet plus total - P in cash
// = partnerGross - commission, whatever the payment mode:
//   online / wallet  P = total  -> EARNING +partnerGross, COMMISSION -commission
//   pay at hotel     P = 0      -> COMMISSION -commission (and the fee, if any)
//   partial prepaid  in between.
//
// Cancellation / no-show:
//   - already settled -> every settle row is reversed (EARNING by REFUND, the rest by
//     ADJUSTMENT), exactly, from the rows themselves;
//   - then whatever the platform keeps (P - refunds, e.g. a late-cancel fee or a
//     prepaid no-show) is settled pro rata: ratio = retained / total over the full
//     figures, so the hotel still gets its share of retained money.
// A refund on a settled booking that stays settled (admin goodwill refund) reverses
// the same pro-rata share.
//
// Prepaid money is learnt from 'payment' / 'refund' events, recorded as zero-amount
// NON_WALLET marker rows on the platform owner (no balance moves; the figure is in
// metadata). Without markers the payment mode decides (see prepaidFromBooking).

import mongoose from 'mongoose';
import { logger } from '../../../utils/logger.js';
import { append } from '../../../core/finance/ledger.service.js';
import { LedgerEntry } from '../../../core/finance/ledgerEntry.model.js';
import { forHotelBooking } from '../../../core/finance/idempotencyKeys.js';
import { HotelBooking } from '../models/hotelBooking.model.js';
import { onBookingEvent } from './bookingEvents.js';
import { getMoneySettings, SETTLE_ORDER } from './moneySettings.js';

export const PLATFORM_OWNER = Object.freeze({ ownerType: 'platform', ownerId: 'platform' });
export const JOB_TYPE = 'hotel_booking';

const r2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const tiny = (n) => Math.abs(r2(n)) < 0.01;

/** The booking's money split. Pure. */
export const splitOf = (booking) => {
    const p = booking?.pricing || {};
    const partnerGross = r2((p.taxableAmount || 0) + (p.gstAmount || 0));
    const commission = r2((p.commissionAmount || 0) + (p.commissionGst || 0));
    const fee = r2((p.platformFee || 0) + (p.platformFeeGst || 0));
    const total = r2(p.total || partnerGross + fee);
    return { partnerGross, commission, fee, total, partnerNet: r2(partnerGross - commission) };
};

const keyPrefix = (bookingId, step) => `hotel_booking:${bookingId}:${step}:`;

const entriesOf = (bookingId) => LedgerEntry.find({ jobType: JOB_TYPE, jobId: String(bookingId) }).lean();

/** What the platform collected from the guest (online + wallet), when no markers exist. */
export const prepaidFromBooking = (booking) => {
    const pay = booking?.payment || {};
    const { total } = splitOf(booking);
    if (pay.mode === 'pay_at_hotel') return 0;
    if (pay.mode === 'online' || pay.mode === 'wallet') {
        if (['paid', 'partially_refunded', 'refunded'].includes(pay.status)) return total;
        return Math.min(total, r2(pay.amountPaid));
    }
    // partial_prepaid: before the desk marks the balance paid, amountPaid is the advance.
    return Math.min(total, r2(pay.amountPaid));
};

/** Prepaid (online + wallet) and refunded so far, from markers or the booking. */
export const moneyIn = async (booking, entries = null) => {
    const rows = entries || (await entriesOf(booking._id));
    const markers = rows.filter((e) => e.type === 'NON_WALLET');
    const payments = markers.filter((e) => e.metadata?.marker === 'payment' && ['online', 'wallet'].includes(e.metadata?.kind));
    const refunds = markers.filter((e) => e.metadata?.marker === 'refund');
    const paid = payments.length ? r2(payments.reduce((s, e) => s + (e.metadata.amount || 0), 0)) : prepaidFromBooking(booking);
    const refunded = r2(refunds.reduce((s, e) => s + (e.metadata.amount || 0), 0));
    return { paid, refunded };
};

const actorOf = (actor) => {
    const kind = ['system', 'admin', 'partner', 'user'].includes(actor?.role) ? actor.role : 'system';
    return { kind, id: actor?.id ? String(actor.id) : '' };
};

/** One ledger row for a booking; zero amounts are skipped. */
const post = async (booking, { step, role, owner, type, amount, reason, actor, metadata = {} }) => {
    if (tiny(amount) && type !== 'NON_WALLET') return null;
    return append({
        ...owner,
        ownerId: String(owner.ownerId),
        vertical: 'hotel',
        jobType: JOB_TYPE,
        jobId: String(booking._id),
        type,
        amount: type === 'NON_WALLET' ? 0 : r2(amount),
        idempotencyKey: forHotelBooking(String(booking._id), step, role),
        actor: actorOf(actor),
        reason,
        metadata: { bookingRef: booking.bookingRef, propertyId: String(booking.propertyId || ''), step, ...metadata },
    });
};

const partnerOwner = (booking) => ({ ownerType: 'partner', ownerId: String(booking.partnerId) });

/** The settle rows for a booking, scaled by `ratio` (1 = full settlement). */
const settleRows = (booking, { prepaid, ratio = null }) => {
    const s = splitOf(booking);
    const ref = booking.bookingRef || String(booking._id);
    let earning;
    let commission;
    let fee;
    if (ratio === null) {
        earning = r2(prepaid - s.fee);
        commission = s.commission;
        fee = s.fee;
    } else {
        earning = r2(s.partnerGross * ratio);
        commission = r2(s.commission * ratio);
        fee = r2(s.fee * ratio);
    }
    const partner = partnerOwner(booking);
    return [
        earning >= 0
            ? { role: 'partner_earning', owner: partner, type: 'EARNING', amount: earning, reason: `Booking ${ref}: room charges` }
            : { role: 'partner_fee', owner: partner, type: 'PLATFORM_FEE', amount: earning, reason: `Booking ${ref}: platform fee collected at the hotel` },
        { role: 'partner_commission', owner: partner, type: 'COMMISSION', amount: -commission, reason: `Booking ${ref}: commission` },
        { role: 'platform_commission', owner: PLATFORM_OWNER, type: 'COMMISSION', amount: commission, reason: `Booking ${ref}: commission` },
        { role: 'platform_fee', owner: PLATFORM_OWNER, type: 'PLATFORM_FEE', amount: fee, reason: `Booking ${ref}: platform fee` },
    ];
};

const hasStep = (entries, bookingId, step) => entries.some((e) => e.idempotencyKey.startsWith(keyPrefix(bookingId, step)));

/** Settle a booking that reached settleOn. Idempotent. */
export const settleBooking = async (booking, actor) => {
    const entries = await entriesOf(booking._id);
    const { paid, refunded } = await moneyIn(booking, entries);
    const prepaid = Math.max(0, r2(paid - refunded));
    const results = [];
    for (const row of settleRows(booking, { prepaid })) {
        results.push(await post(booking, { step: 'settle', actor, metadata: { prepaid }, ...row }));
    }
    return results.filter(Boolean);
};

/** Undo every settle row, exactly. Idempotent. */
const reverseSettlement = async (booking, actor, entries) => {
    const ref = booking.bookingRef || String(booking._id);
    const rows = entries.filter((e) => e.idempotencyKey.startsWith(keyPrefix(booking._id, 'settle')));
    for (const e of rows) {
        const role = e.idempotencyKey.slice(keyPrefix(booking._id, 'settle').length);
        await post(booking, {
            step: 'reverse',
            role,
            owner: { ownerType: e.ownerType, ownerId: e.ownerId },
            type: e.type === 'EARNING' ? 'REFUND' : 'ADJUSTMENT',
            amount: -e.amount,
            reason: `Booking ${ref}: settlement reversed (${booking.status === 'no_show' ? 'no-show' : 'cancelled'})`,
            actor,
        });
    }
};

/** A cancelled / no-show booking: reverse any settlement, then settle what the platform keeps. */
export const settleCancellation = async (booking, actor) => {
    const entries = await entriesOf(booking._id);
    if (hasStep(entries, booking._id, 'settle')) await reverseSettlement(booking, actor, entries);

    const { paid, refunded } = await moneyIn(booking, entries);
    const refundTotal = Math.max(refunded, r2(booking.cancellation?.refundAmount));
    const retained = Math.max(0, r2(paid - refundTotal));
    const { total } = splitOf(booking);
    if (tiny(retained) || !(total > 0)) return;
    const ratio = Math.min(1, retained / total);
    for (const row of settleRows(booking, { ratio })) {
        await post(booking, { step: 'retained', actor, metadata: { retained }, ...row });
    }
};

/** A refund on a booking that stays settled: the pro-rata share comes back off both sides. */
const settleLateRefund = async (booking, { amount, refundKey }, actor) => {
    const { total } = splitOf(booking);
    if (!(total > 0) || tiny(amount)) return;
    const ratio = Math.min(1, r2(amount) / total);
    const ref = booking.bookingRef || String(booking._id);
    for (const row of settleRows(booking, { ratio })) {
        await post(booking, {
            step: `refund-${refundKey}`,
            role: row.role,
            owner: row.owner,
            type: row.type === 'EARNING' ? 'REFUND' : 'ADJUSTMENT',
            amount: -row.amount,
            reason: `Booking ${ref}: refund to guest`,
            actor,
        });
    }
};

const freshBooking = async (booking) => {
    if (!booking?._id) return null;
    if (mongoose.connection.readyState !== 1) return booking;
    const doc = await HotelBooking.findById(booking._id).lean();
    return doc || booking;
};

// ─── event handlers ──────────────────────────────────────────────────────

export const onTransition = async ({ booking, to, actor } = {}) => {
    const b = await freshBooking(booking);
    if (!b) return;
    if (to === 'cancelled' || to === 'no_show') {
        await settleCancellation({ ...b, status: to }, actor);
        return;
    }
    const { settleOn } = await getMoneySettings();
    const at = SETTLE_ORDER.indexOf(to);
    if (at >= 0 && at >= SETTLE_ORDER.indexOf(settleOn)) await settleBooking(b, actor);
};

export const onPayment = async ({ booking, amount, kind, paymentId } = {}) => {
    if (!booking?._id || !(Number(amount) > 0)) return;
    await post(booking, {
        step: `payment-${paymentId || kind || 'unknown'}`,
        role: 'marker',
        owner: PLATFORM_OWNER,
        type: 'NON_WALLET',
        amount: 0,
        reason: `Booking ${booking.bookingRef || booking._id}: ${kind} payment received`,
        metadata: { marker: 'payment', kind, amount: r2(amount), paymentId: paymentId ? String(paymentId) : '' },
    });
};

export const onRefund = async ({ booking, amount, walletAmount, gatewayAmount, refundId } = {}) => {
    const value = r2(Number(amount) || r2((Number(walletAmount) || 0) + (Number(gatewayAmount) || 0)));
    if (!booking?._id || !(value > 0)) return;
    const refundKey = refundId ? String(refundId) : `${value}-${new Date(booking.updatedAt || Date.now()).getTime()}`;
    await post(booking, {
        step: `refundmark-${refundKey}`,
        role: 'marker',
        owner: PLATFORM_OWNER,
        type: 'NON_WALLET',
        amount: 0,
        reason: `Booking ${booking.bookingRef || booking._id}: refund ${value}`,
        metadata: { marker: 'refund', amount: value, walletAmount: r2(walletAmount), gatewayAmount: r2(gatewayAmount), refundId: refundId ? String(refundId) : '' },
    });

    const b = await freshBooking(booking);
    if (!b || ['cancelled', 'no_show', 'expired'].includes(b.status)) return; // the cancellation path settles it
    const entries = await entriesOf(b._id);
    if (hasStep(entries, b._id, 'settle') && !hasStep(entries, b._id, 'reverse')) {
        await settleLateRefund(b, { amount: value, refundKey }, { role: 'system' });
    }
};

let registered = false;
/** Subscribe once (the routes import this at boot). */
export const registerSettlementListeners = () => {
    if (registered) return;
    registered = true;
    onBookingEvent('transition', 'settlement', onTransition);
    onBookingEvent('payment', 'settlement', onPayment);
    onBookingEvent('refund', 'settlement', onRefund);
    logger.info('[hotel] settlement listeners registered');
};

registerSettlementListeners();
