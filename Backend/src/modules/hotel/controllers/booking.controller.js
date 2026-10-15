// Booking endpoints for customers, partners and admins (phase 4).
// Contract: docs/hotel-api-contract.md "Phase 4-5". Logic: services/booking.service.js.

import { sendResponse } from '../../../utils/response.js';
import { NotFoundError } from '../../../core/auth/errors.js';
import { FoodUser } from '../../../core/users/user.model.js';
import { Payment } from '../../../core/payments/models/payment.model.js';
import { Refund } from '../../../core/payments/models/refund.model.js';
import { HotelBooking } from '../models/hotelBooking.model.js';
import { HotelPartner } from '../models/hotelPartner.model.js';
import { HotelProperty } from '../models/hotelProperty.model.js';
import { parse } from '../validators/partner.validators.js';
import {
    userListSchema,
    partnerListSchema,
    adminListSchema,
    reasonSchema,
    partnerCancelSchema,
    checkOutSchema,
    markPaidSchema,
    adminStatusSchema,
    adminRefundSchema,
} from '../validators/booking.validators.js';
import { isObjectId, escapeRegex, pageOf } from '../services/property.service.js';
import { toNightDate, todayIST } from '../services/inventory.service.js';
import * as svc from '../services/booking.service.js';
import { getHotelSettings, updateHotelSettings } from '../services/settings.service.js';

const handle = (fn) => async (req, res, next) => {
    try {
        return await fn(req, res);
    } catch (err) {
        return next(err);
    }
};

const loadBooking = async (filter, id) => {
    if (!isObjectId(String(id || ''))) throw new NotFoundError('Booking not found');
    const booking = await HotelBooking.findOne({ _id: id, ...filter }).lean();
    if (!booking) throw new NotFoundError('Booking not found');
    return booking;
};

const userView = async (booking) => {
    const reviews = await svc.reviewIdsFor([booking]);
    return svc.bookingJSON(booking, 'user', { reviewId: reviews.get(String(booking._id)) });
};

const pageResult = async (filter, query, view, decorate = null) => {
    const { page, limit, skip } = pageOf(query);
    const [rows, total] = await Promise.all([
        HotelBooking.find(filter).sort(view === 'user' ? { checkIn: -1, createdAt: -1 } : { createdAt: -1 }).skip(skip).limit(limit).lean(),
        HotelBooking.countDocuments(filter),
    ]);
    const reviews = view === 'user' ? await svc.reviewIdsFor(rows) : new Map();
    let items = rows.map((b) => svc.bookingJSON(b, view, { reviewId: reviews.get(String(b._id)), summary: true }));
    if (decorate) items = await decorate(items, rows);
    return { items, page, limit, total };
};

/** Check-in date within the inclusive [from, to] range. */
const dateRangeFilter = (from, to) => {
    if (!from && !to) return {};
    return {
        checkIn: {
            ...(from ? { $gte: toNightDate(from, 'from') } : {}),
            ...(to ? { $lte: toNightDate(to, 'to') } : {}),
        },
    };
};

const searchFilter = (q) => {
    if (!q) return {};
    const rx = { $regex: escapeRegex(q), $options: 'i' };
    return { $or: [{ bookingRef: { $regex: escapeRegex(q.toUpperCase()) } }, { 'guestDetails.name': rx }, { 'guestDetails.phone': rx }] };
};

// ─── customer ────────────────────────────────────────────────────────────

const ownFilter = (req) => ({ userId: req.user.userId });

export const quote = handle(async (req, res) =>
    sendResponse(res, 200, 'Quote', await svc.quoteBooking({ userId: req.user.userId, body: req.body })));

export const create = handle(async (req, res) => {
    const { booking, payment } = await svc.createBooking({ userId: req.user.userId, body: req.body });
    return sendResponse(res, 201, booking.status === 'confirmed' ? 'Booking confirmed' : 'Booking created; complete the payment', {
        booking: await userView(booking),
        payment,
    });
});

export const verifyPayment = handle(async (req, res) => {
    const booking = await loadBooking(ownFilter(req), req.params.id);
    const out = await svc.verifyBookingPayment(booking, req.body);
    return sendResponse(res, 200, 'Payment confirmed', { booking: await userView(out) });
});

export const retryPayment = handle(async (req, res) => {
    const booking = await loadBooking(ownFilter(req), req.params.id);
    return sendResponse(res, 200, 'Payment', await svc.retryPayment(booking));
});

const TAB_FILTERS = {
    upcoming: (today) => ({ status: { $in: ['awaiting_payment', 'confirmed'] }, checkIn: { $gte: today } }),
    ongoing: (today) => ({
        $or: [
            { status: 'checked_in' },
            { status: 'confirmed', checkIn: { $lt: today }, checkOut: { $gt: today } },
        ],
    }),
    past: (today) => ({
        $or: [
            { status: { $in: ['checked_out', 'no_show'] } },
            { status: 'confirmed', checkOut: { $lte: today } },
        ],
    }),
    cancelled: () => ({ status: { $in: ['cancelled', 'expired'] } }),
};

export const listMine = handle(async (req, res) => {
    const q = parse(userListSchema, req.query);
    const today = toNightDate(todayIST());
    const filter = { ...ownFilter(req), ...(q.tab ? TAB_FILTERS[q.tab](today) : {}) };
    return sendResponse(res, 200, 'Bookings', await pageResult(filter, q, 'user'));
});

export const getMine = handle(async (req, res) => {
    const booking = await loadBooking(ownFilter(req), req.params.id);
    return sendResponse(res, 200, 'Booking', { booking: await userView(booking) });
});

export const cancelPreview = handle(async (req, res) => {
    const booking = await loadBooking(ownFilter(req), req.params.id);
    if (!svc.userCanCancel(booking)) {
        return sendResponse(res, 200, 'This booking cannot be cancelled online', {
            ...svc.cancellationPreview(booking, { by: 'user' }),
            refundAmount: 0,
            walletRefund: 0,
            gatewayRefund: 0,
            canCancel: false,
        });
    }
    return sendResponse(res, 200, 'Cancellation preview', { ...svc.cancellationPreview(booking, { by: 'user' }), canCancel: true });
});

export const cancelMine = handle(async (req, res) => {
    const { reason } = parse(reasonSchema, req.body);
    const booking = await loadBooking(ownFilter(req), req.params.id);
    const out = await svc.cancelBooking(booking, { by: 'user', actorId: req.user.userId, reason: reason || '' });
    return sendResponse(res, 200, 'Booking cancelled', { booking: await userView(out) });
});

// ─── partner ─────────────────────────────────────────────────────────────

const partnerFilter = (req) => ({ partnerId: req.user.userId });
const partnerActor = (req) => ({ role: 'partner', id: req.user.userId });
const partnerJSON = (b) => ({ booking: svc.bookingJSON(b, 'partner') });

export const partnerList = handle(async (req, res) => {
    const q = parse(partnerListSchema, req.query);
    const filter = {
        ...partnerFilter(req),
        ...(q.status ? { status: q.status } : {}),
        ...(q.propertyId ? { propertyId: q.propertyId } : {}),
        ...dateRangeFilter(q.from, q.to),
        ...searchFilter(q.q),
    };
    return sendResponse(res, 200, 'Bookings', await pageResult(filter, q, 'partner'));
});

export const partnerGet = handle(async (req, res) =>
    sendResponse(res, 200, 'Booking', partnerJSON(await loadBooking(partnerFilter(req), req.params.id))));

export const partnerCheckIn = handle(async (req, res) => {
    const booking = await loadBooking(partnerFilter(req), req.params.id);
    return sendResponse(res, 200, 'Checked in', partnerJSON(await svc.checkInBooking(booking, partnerActor(req))));
});

export const partnerCheckOut = handle(async (req, res) => {
    const { force } = parse(checkOutSchema, req.body);
    const booking = await loadBooking(partnerFilter(req), req.params.id);
    return sendResponse(res, 200, 'Checked out', partnerJSON(await svc.checkOutBooking(booking, partnerActor(req), { force })));
});

export const partnerNoShow = handle(async (req, res) => {
    const booking = await loadBooking(partnerFilter(req), req.params.id);
    return sendResponse(res, 200, 'Marked as no-show', partnerJSON(await svc.noShowBooking(booking, partnerActor(req))));
});

export const partnerMarkPaid = handle(async (req, res) => {
    const { amount } = parse(markPaidSchema, req.body);
    const booking = await loadBooking(partnerFilter(req), req.params.id);
    return sendResponse(res, 200, 'Payment recorded', partnerJSON(await svc.markPaidAtHotel(booking, partnerActor(req), amount)));
});

export const partnerCancel = handle(async (req, res) => {
    const { reason } = parse(partnerCancelSchema, req.body);
    const booking = await loadBooking(partnerFilter(req), req.params.id);
    const out = await svc.cancelBooking(booking, { by: 'partner', actorId: req.user.userId, reason });
    return sendResponse(res, 200, 'Booking cancelled; the guest is refunded in full', partnerJSON(out));
});

// ─── admin ───────────────────────────────────────────────────────────────

const adminActor = (req) => ({ role: 'admin', id: req.user.userId });

const withPeople = async (items, rows) => {
    const partnerIds = [...new Set(rows.map((b) => String(b.partnerId)))];
    const userIds = [...new Set(rows.map((b) => String(b.userId)))];
    const [partners, users] = await Promise.all([
        HotelPartner.find({ _id: { $in: partnerIds } }).select('name phone').lean(),
        FoodUser.find({ _id: { $in: userIds } }).select('name phone').lean(),
    ]);
    const pm = new Map(partners.map((p) => [String(p._id), { name: p.name, phone: p.phone }]));
    const um = new Map(users.map((u) => [String(u._id), { name: u.name, phone: u.phone }]));
    return items.map((b) => ({ ...b, partner: pm.get(String(b.partnerId)) || null, user: um.get(String(b.userId)) || null }));
};

export const adminList = handle(async (req, res) => {
    const q = parse(adminListSchema, req.query);
    const filter = {
        ...(q.status ? { status: q.status } : {}),
        ...(q.propertyId ? { propertyId: q.propertyId } : {}),
        ...(q.partnerId ? { partnerId: q.partnerId } : {}),
        ...dateRangeFilter(q.from, q.to),
        ...searchFilter(q.q),
    };
    return sendResponse(res, 200, 'Bookings', await pageResult(filter, q, 'admin', withPeople));
});

const adminDetail = async (booking) => {
    const [partner, user, property, payments, refunds] = await Promise.all([
        HotelPartner.findById(booking.partnerId).select('name phone email status').lean(),
        FoodUser.findById(booking.userId).select('name phone email').lean(),
        HotelProperty.findById(booking.propertyId).select('name slug status isLive').lean(),
        Payment.find({ subjectModel: 'HotelBooking', subjectId: booking._id }).select('-rawResponse').sort({ createdAt: 1 }).lean(),
        Refund.find({ orderId: booking._id }).sort({ createdAt: 1 }).lean(),
    ]);
    const json = svc.bookingJSON(booking, 'admin');
    const gatewayRefundRows = new Map(refunds.map((r) => [String(r._id), r]));
    const p = booking.payment || {};
    // One row per money movement in. Gateway rows come from core `payments`; the
    // wallet part and cash collected at the hotel are booking-side figures.
    const paymentRows = [
        ...payments.map((r) => ({
            _id: r._id,
            kind: 'online',
            method: r.method,
            amount: r.amount,
            status: r.status,
            razorpayOrderId: r.gatewayOrderId || undefined,
            razorpayPaymentId: r.gatewayPaymentId || undefined,
            paymentId: r._id,
            createdAt: r.createdAt,
        })),
        ...(p.walletAmount > 0 ? [{ kind: 'wallet', method: 'wallet', amount: p.walletAmount, status: 'success', createdAt: booking.createdAt }] : []),
        ...(p.collectedAtHotel > 0 ? [{ kind: 'at_hotel', method: 'cash', amount: p.collectedAtHotel, status: 'success', createdAt: booking.updatedAt }] : []),
    ];
    // The booking's refund log is authoritative (one row per refund, wallet + gateway
    // parts); the core Refund row, when there is one, is attached as `gatewayRefund`.
    const refundRows = json.refunds.map((r) => ({
        ...r,
        createdAt: r.at,
        ...(r.refundId && gatewayRefundRows.get(String(r.refundId)) ? { gatewayRefund: gatewayRefundRows.get(String(r.refundId)) } : {}),
    }));
    return {
        booking: json,
        partner,
        user,
        property,
        payments: paymentRows,
        refunds: refundRows,
        refundable: svc.refundableParts(booking).total,
    };
};

export const adminGet = handle(async (req, res) =>
    sendResponse(res, 200, 'Booking', await adminDetail(await loadBooking({}, req.params.id))));

export const adminSetStatus = handle(async (req, res) => {
    const { status, reason, force } = parse(adminStatusSchema, req.body);
    const booking = await loadBooking({}, req.params.id);
    const actor = adminActor(req);
    if (status === 'checked_in') await svc.checkInBooking(booking, actor, { force });
    else if (status === 'checked_out') await svc.checkOutBooking(booking, actor, { force });
    else if (status === 'no_show') await svc.noShowBooking(booking, actor, { force });
    else await svc.cancelBooking(booking, { by: 'admin', actorId: req.user.userId, reason: reason || '', force });
    return sendResponse(res, 200, 'Booking updated', await adminDetail(await loadBooking({}, req.params.id)));
});

export const adminRefund = handle(async (req, res) => {
    const { amount, reason } = parse(adminRefundSchema, req.body);
    const booking = await loadBooking({}, req.params.id);
    await svc.manualRefund(booking, { amount, reason, adminId: req.user.userId });
    return sendResponse(res, 200, 'Refund issued', await adminDetail(await loadBooking({}, req.params.id)));
});

export const adminGetSettings = handle(async (req, res) =>
    sendResponse(res, 200, 'Hotel settings', await getHotelSettings({ fresh: true })));

export const adminPutSettings = handle(async (req, res) =>
    sendResponse(res, 200, 'Hotel settings saved', await updateHotelSettings(req.body, {
        updatedBy: isObjectId(String(req.user.userId || '')) ? req.user.userId : undefined,
    })));

