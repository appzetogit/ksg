// Hotel coupons (phase 9): validation, redemption, release, and the admin/customer
// reads. Models: models/hotelOffer.model.js, models/hotelOfferRedemption.model.js.
// API: docs/hotel-api-contract.md "Phase 9: coupons".
//
//  - validateHotelCoupon() is called by quote and create (booking.service.js) with the
//    stay subtotal; it returns the discount in rupees or throws a 400 with the reason.
//  - redeemHotelCoupon() runs INSIDE the booking-create transaction:
//      * total limit: a conditional $inc ({ usedCount: { $lt: limit } }) on the offer, so
//        two parallel bookings can never take the last use twice (atomic even without a
//        replica set);
//      * per-user limit: counted inside the same transaction. Every redemption writes the
//        offer document, so concurrent redemptions of one offer write-conflict and
//        withTransaction retries the loser, which then sees the winner's row. (On a
//        standalone server, where transactions are no-ops, the per-user limit is
//        best-effort; the total limit is still exact.)
//  - releaseHotelCoupon() gives a use back when the booking is cancelled or expires
//    (a listener on services/bookingEvents.js 'transition'). Idempotent.
//  - Limits are tightened by the Master promo ceiling (core/finance/promoLimits.service.js,
//    vertical 'hotel'), the same as Food and Taxi.

import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../../core/auth/errors.js';
import { effectivePromoLimits, resolvePromoCeiling, tighten } from '../../../core/finance/promoLimits.service.js';
import { logger } from '../../../utils/logger.js';
import { ConflictError } from '../errors.js';
import { PROPERTY_TYPES } from '../constants.js';
import { HotelOffer, OFFER_DISCOUNT_TYPES, OFFER_FUNDING } from '../models/hotelOffer.model.js';
import { HotelOfferRedemption } from '../models/hotelOfferRedemption.model.js';
import { HotelBooking } from '../models/hotelBooking.model.js';
import { HotelProperty } from '../models/hotelProperty.model.js';
import { parse } from '../validators/partner.validators.js';
import { onBookingEvent } from './bookingEvents.js';
import { round2 } from './pricing.service.js';
import { isObjectId } from './property.service.js';
import { runInTransaction } from './inventory.service.js';

export const OFFER_STATES = Object.freeze(['live', 'scheduled', 'paused', 'used_up', 'expired']);

const rupees = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN')}`;
export const normaliseCode = (code) => String(code || '').trim().toUpperCase();

/** Discount in rupees for a subtotal. Pure. */
export const discountFor = (offer, subtotal) => {
    const base = Math.max(0, Number(subtotal) || 0);
    const value = Number(offer.discountValue) || 0;
    let d;
    if (offer.discountType === 'percentage') {
        d = round2((base * Math.min(100, value)) / 100);
        if (Number(offer.maxDiscount) > 0) d = Math.min(d, round2(offer.maxDiscount));
    } else {
        d = round2(value);
    }
    return Math.max(0, Math.min(d, base));
};

/** live | scheduled | paused | used_up | expired, with the limit actually in force. */
export const offerState = (offer, { now = new Date(), totalLimit = null } = {}) => {
    if (offer.validTo && new Date(offer.validTo) <= now) return 'expired';
    if (!offer.isActive) return 'paused';
    if (offer.validFrom && new Date(offer.validFrom) > now) return 'scheduled';
    if (totalLimit !== null && (Number(offer.usedCount) || 0) >= totalLimit) return 'used_up';
    return 'live';
};

const appliesToProperty = (offer, property) => {
    const ids = (offer.propertyIds || []).map(String);
    if (ids.length && !ids.includes(String(property._id))) return false;
    const types = offer.propertyTypes || [];
    if (types.length && !types.includes(property.propertyType)) return false;
    return true;
};

const activeUsesBy = (offerId, userId, session = null) =>
    HotelOfferRedemption.countDocuments({ offerId, userId, status: 'active' }).session(session);

const hasEarlierBooking = (userId) =>
    HotelBooking.exists({ userId, status: { $nin: ['cancelled', 'expired'] } });

/**
 * Check a code for a stay. Throws ValidationError (400) with the reason.
 * @returns {Promise<{ code, discount, funding, offer, limits }>}
 */
export const validateHotelCoupon = async ({ code, userId, property, subtotal, now = new Date() }) => {
    const wanted = normaliseCode(code);
    if (!wanted) throw new ValidationError('Enter a coupon code');
    const offer = await HotelOffer.findOne({ code: wanted }).lean();
    if (!offer) throw new ValidationError(`${wanted} is not a valid coupon code`);
    if (!offer.isActive) throw new ValidationError(`${wanted} is not active right now`);
    if (offer.validFrom && new Date(offer.validFrom) > now) throw new ValidationError(`${wanted} is not active yet`);
    if (offer.validTo && new Date(offer.validTo) <= now) throw new ValidationError(`${wanted} has expired`);
    if (!appliesToProperty(offer, property)) throw new ValidationError(`${wanted} does not apply to this property`);
    if (Number(offer.minBookingAmount) > 0 && subtotal < offer.minBookingAmount) {
        throw new ValidationError(`${wanted} needs a booking of at least ${rupees(offer.minBookingAmount)} before taxes`);
    }

    const limits = await effectivePromoLimits({ vertical: 'hotel', ownPerUser: offer.perUserLimit, ownTotal: offer.usageLimit });
    if (limits.total !== null && (Number(offer.usedCount) || 0) >= limits.total) {
        throw new ValidationError(`${wanted} has been fully used`);
    }
    if (userId) {
        if (limits.perUser !== null && (await activeUsesBy(offer._id, userId)) >= limits.perUser) {
            throw new ValidationError(limits.perUser === 1
                ? `You have already used ${wanted}`
                : `You have already used ${wanted} ${limits.perUser} times, the most allowed`);
        }
        if (offer.firstBookingOnly && (await hasEarlierBooking(userId))) {
            throw new ValidationError(`${wanted} is only for your first hotel booking`);
        }
    }

    const discount = discountFor(offer, subtotal);
    if (!(discount > 0)) throw new ValidationError(`${wanted} gives no discount on this booking`);
    return { code: wanted, discount, funding: offer.funding || 'platform', offer, limits };
};

/**
 * Take one use of a validated coupon for a booking. Call inside the booking-create
 * transaction (pass its session). Throws ValidationError when a limit was reached
 * meanwhile, which aborts the booking.
 */
export const redeemHotelCoupon = async ({ coupon, userId, bookingId, session }) => {
    const { offer, limits } = coupon;
    if (limits.perUser !== null && (await activeUsesBy(offer._id, userId, session)) >= limits.perUser) {
        throw new ValidationError(`You have already used ${coupon.code}`);
    }
    const taken = await HotelOffer.findOneAndUpdate(
        { _id: offer._id, isActive: true, ...(limits.total !== null ? { usedCount: { $lt: limits.total } } : {}) },
        { $inc: { usedCount: 1 } },
        { new: true, session, lean: true },
    );
    if (!taken) throw new ValidationError(`${coupon.code} has just been fully used; please book without it`);
    await HotelOfferRedemption.create([{
        offerId: offer._id,
        code: coupon.code,
        userId,
        bookingId,
        discount: coupon.discount,
        funding: coupon.funding,
        status: 'active',
    }], { session });
};

/**
 * Give the coupon use on a booking back (cancelled / expired / create rolled back).
 * Idempotent: only an 'active' redemption is released, once.
 */
export const releaseHotelCoupon = (bookingId, reason = 'released') =>
    runInTransaction(async (session) => {
        const released = await HotelOfferRedemption.findOneAndUpdate(
            { bookingId, status: 'active' },
            { $set: { status: 'released', releasedAt: new Date(), releaseReason: reason } },
            { new: true, session, lean: true },
        );
        if (released) {
            await HotelOffer.updateOne(
                { _id: released.offerId, usedCount: { $gt: 0 } },
                { $inc: { usedCount: -1 } },
                { session },
            );
        }
        return released;
    });

/** Undo a redemption written by a create that failed on a standalone server. */
export const undoRedemption = async (bookingId) => {
    const r = await HotelOfferRedemption.findOneAndDelete({ bookingId });
    if (r && r.status === 'active') {
        await HotelOffer.updateOne({ _id: r.offerId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
    }
};

// ─── listener ─────────────────────────────────────────────────────────────

const RELEASE_ON = new Set(['cancelled', 'expired']);

export const onOfferTransition = async ({ booking, to } = {}) => {
    if (!booking?._id || !RELEASE_ON.has(to)) return;
    if (!booking.pricing?.couponCode) return;
    const r = await releaseHotelCoupon(booking._id, to);
    if (r) logger.info(`[hotel] coupon ${r.code} released from ${booking.bookingRef || booking._id} (${to})`);
};

let registered = false;
export const registerOfferListeners = () => {
    if (registered) return;
    registered = true;
    onBookingEvent('transition', 'offers', onOfferTransition);
};
registerOfferListeners();

// ─── views ────────────────────────────────────────────────────────────────

const describe = (o) => (o.discountType === 'percentage'
    ? `${o.discountValue}% off${Number(o.maxDiscount) > 0 ? ` up to ${rupees(o.maxDiscount)}` : ''}`
    : `${rupees(o.discountValue)} off`);

export const offerAdminJSON = (o, { ceiling = { total: null, perUser: null }, now = new Date() } = {}) => {
    const totalLimit = tighten(o.usageLimit, ceiling.total);
    return {
        _id: o._id,
        code: o.code,
        title: o.title || '',
        description: o.description || '',
        discountType: o.discountType,
        discountValue: o.discountValue,
        maxDiscount: o.maxDiscount ?? null,
        minBookingAmount: o.minBookingAmount || 0,
        validFrom: o.validFrom || null,
        validTo: o.validTo || null,
        usageLimit: o.usageLimit ?? null,
        perUserLimit: o.perUserLimit ?? null,
        effectiveUsageLimit: totalLimit,
        effectivePerUserLimit: tighten(o.perUserLimit, ceiling.perUser),
        usedCount: o.usedCount || 0,
        firstBookingOnly: Boolean(o.firstBookingOnly),
        propertyIds: (o.propertyIds || []).map(String),
        propertyTypes: o.propertyTypes || [],
        funding: o.funding || 'platform',
        isActive: Boolean(o.isActive),
        state: offerState(o, { now, totalLimit }),
        summary: describe(o),
        createdBy: o.createdBy || null,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
    };
};

/** Public-safe fields only: no limits, usage, funding or property lists. */
export const offerPublicJSON = (o) => ({
    code: o.code,
    title: o.title || '',
    description: o.description || '',
    discountType: o.discountType,
    discountValue: o.discountValue,
    maxDiscount: o.maxDiscount ?? null,
    minBookingAmount: o.minBookingAmount || 0,
    validTo: o.validTo || null,
    firstBookingOnly: Boolean(o.firstBookingOnly),
    summary: describe(o),
});

// ─── admin ────────────────────────────────────────────────────────────────

const objectId = z.string().trim().regex(/^[a-f\d]{24}$/i, 'is not a valid id');
// z.null() first: z.coerce would turn null into the epoch / 0.
const when = z.union([z.null(), z.coerce.date()]);
const optLimit = z.union([z.null(), z.coerce.number().int().min(0).max(10000000)]);
const money = z.coerce.number().finite().min(0).max(10000000);

const offerFields = {
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'must be 3-30 letters, digits, - or _'),
    title: z.string().trim().max(80),
    description: z.string().trim().max(500),
    discountType: z.enum(OFFER_DISCOUNT_TYPES),
    discountValue: z.coerce.number().finite().positive().max(10000000),
    maxDiscount: z.union([z.null(), money]),
    minBookingAmount: money,
    validFrom: when,
    validTo: when,
    usageLimit: optLimit,
    perUserLimit: optLimit,
    firstBookingOnly: z.boolean(),
    propertyIds: z.array(objectId).max(500),
    propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(PROPERTY_TYPES.length),
    funding: z.enum(OFFER_FUNDING),
    isActive: z.boolean(),
};
const createSchema = z.object(offerFields).partial().required({ code: true, discountType: true, discountValue: true });
const updateSchema = z.object(offerFields).partial();
const listSchema = z.object({
    state: z.enum([...OFFER_STATES, 'all']).optional(),
    q: z.string().trim().max(60).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Rules across fields, on the merged document. */
const checkOffer = async (o) => {
    if (o.discountType === 'percentage' && o.discountValue > 100) {
        throw new ValidationError('discountValue: a percentage cannot be more than 100');
    }
    if (o.validFrom && o.validTo && new Date(o.validTo) <= new Date(o.validFrom)) {
        throw new ValidationError('validTo: must be after validFrom');
    }
    const ids = [...new Set((o.propertyIds || []).map(String))];
    if (o.funding === 'partner' && !ids.length) {
        throw new ValidationError('funding: a partner-funded coupon must be limited to specific properties (propertyIds)');
    }
    if (ids.length) {
        const found = await HotelProperty.countDocuments({ _id: { $in: ids }, isDeleted: { $ne: true } });
        if (found !== ids.length) throw new ValidationError('propertyIds: one or more properties do not exist');
    }
    return ids;
};

const duplicate = (err) => {
    if (err?.code === 11000) throw new ConflictError('A hotel coupon with this code already exists');
    throw err;
};

const loadOffer = async (id) => {
    if (!isObjectId(String(id || ''))) throw new NotFoundError('Coupon not found');
    const offer = await HotelOffer.findById(id);
    if (!offer) throw new NotFoundError('Coupon not found');
    return offer;
};

/**
 * ponytail: states depend on the clock and the Master ceiling, so they are worked out
 * per row after loading (up to 1000); hotel coupons are expected in the tens.
 */
export const listOffers = async (query = {}) => {
    const q = parse(listSchema, query);
    const filter = {};
    if (q.q) {
        const rx = { $regex: q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
        filter.$or = [{ code: rx }, { title: rx }];
    }
    const [docs, ceiling] = await Promise.all([
        HotelOffer.find(filter).sort({ createdAt: -1 }).limit(1000).lean(),
        resolvePromoCeiling({ vertical: 'hotel' }),
    ]);
    const now = new Date();
    const all = docs.map((o) => offerAdminJSON(o, { ceiling, now }));
    const counts = Object.fromEntries(OFFER_STATES.map((s) => [s, 0]));
    for (const r of all) counts[r.state] += 1;
    const rows = q.state && q.state !== 'all' ? all.filter((r) => r.state === q.state) : all;
    const limit = q.limit || 20;
    const page = q.page || 1;
    return { items: rows.slice((page - 1) * limit, page * limit), page, limit, total: rows.length, counts };
};

export const getOffer = async (id) => {
    const [offer, ceiling] = await Promise.all([loadOffer(id), resolvePromoCeiling({ vertical: 'hotel' })]);
    return offerAdminJSON(offer.toObject(), { ceiling });
};

export const createOffer = async (body, adminId) => {
    const input = parse(createSchema, body);
    const doc = { funding: 'platform', isActive: true, ...input };
    doc.propertyIds = await checkOffer(doc);
    const offer = await HotelOffer.create({
        ...doc,
        usedCount: 0,
        createdBy: { role: 'admin', ...(isObjectId(String(adminId || '')) ? { id: adminId } : {}) },
    }).catch(duplicate);
    return getOffer(offer._id);
};

export const updateOffer = async (id, body) => {
    const offer = await loadOffer(id);
    const input = parse(updateSchema, body);
    const merged = { ...offer.toObject(), ...input };
    merged.propertyIds = await checkOffer(merged);
    offer.set({ ...input, propertyIds: merged.propertyIds });
    await offer.save().catch(duplicate);
    return getOffer(offer._id);
};

/** Delete an unused coupon. A used one is kept for its bookings' history: pause it instead. */
export const deleteOffer = async (id) => {
    const offer = await loadOffer(id);
    const uses = await HotelOfferRedemption.countDocuments({ offerId: offer._id });
    if (uses > 0) {
        throw new ConflictError(`${offer.code} has been used on ${uses} booking(s) and cannot be deleted; deactivate it instead`);
    }
    await HotelOffer.deleteOne({ _id: offer._id });
    return { _id: offer._id, deleted: true };
};

// ─── customer ─────────────────────────────────────────────────────────────

/**
 * Coupons a customer can use now, for one property when propertyId is given. Hides
 * codes the customer has used up or (first-booking codes) can no longer use.
 */
export const userOffers = async ({ userId, propertyId }) => {
    const now = new Date();
    let property = null;
    if (propertyId) {
        if (!isObjectId(String(propertyId))) throw new ValidationError('propertyId is not a valid id');
        property = await HotelProperty.findById(propertyId).select('_id propertyType').lean();
        if (!property) throw new NotFoundError('Property not found');
    }
    const [docs, ceiling] = await Promise.all([
        HotelOffer.find({
            isActive: true,
            $and: [
                { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
                { $or: [{ validTo: null }, { validTo: { $gt: now } }] },
            ],
        }).sort({ createdAt: -1 }).limit(200).lean(),
        resolvePromoCeiling({ vertical: 'hotel' }),
    ]);
    let firstBooking = null;
    const out = [];
    for (const o of docs) {
        if (property && !appliesToProperty(o, property)) continue;
        const total = tighten(o.usageLimit, ceiling.total);
        if (total !== null && (o.usedCount || 0) >= total) continue;
        if (userId) {
            const perUser = tighten(o.perUserLimit, ceiling.perUser);
            if (perUser !== null && (await activeUsesBy(o._id, userId)) >= perUser) continue;
            if (o.firstBookingOnly) {
                if (firstBooking === null) firstBooking = !(await hasEarlierBooking(userId));
                if (!firstBooking) continue;
            }
        }
        out.push(offerPublicJSON(o));
    }
    return out;
};
