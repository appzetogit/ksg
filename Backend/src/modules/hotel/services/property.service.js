// Shared property helpers: slugs, zone lookup, denormalised prices, booking guards,
// required documents and the JSON shapes the API returns.

import mongoose from 'mongoose';
import { NotFoundError } from '../../../core/auth/errors.js';
import { loadActiveZones, resolveZoneIdForPoint } from '../../food/shared/zoneMatching.js';
import { logger } from '../../../utils/logger.js';
import { REQUIRED_DOCUMENTS } from '../constants.js';
import { HotelProperty } from '../models/hotelProperty.model.js';
import { HotelRoomType } from '../models/hotelRoomType.model.js';
import { HotelBooking } from '../models/hotelBooking.model.js';
import { HotelPropertyDocument } from '../models/hotelPropertyDocument.model.js';
import { todayStartIST } from './dates.js';

/** Bookings that still hold a room. */
export const ACTIVE_BOOKING_STATUSES = Object.freeze(['awaiting_payment', 'confirmed', 'checked_in']);

export const isObjectId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id);

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** {lat, lng} -> GeoJSON Point. */
export const toPoint = ({ lat, lng }) => ({ type: 'Point', coordinates: [lng, lat] });

export const slugify = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'property';

/** A slug no other property uses: name-city, then -2, -3, ... */
export const uniqueSlug = async (name, city, excludeId = null) => {
    const base = slugify([name, city].filter(Boolean).join(' '));
    for (let i = 1; i < 50; i++) {
        const candidate = i === 1 ? base : `${base}-${i}`;
        const clash = await HotelProperty.exists({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
        if (!clash) return candidate;
    }
    return `${base}-${new mongoose.Types.ObjectId().toString().slice(-6)}`;
};

/** The food zone containing the point, or undefined. Never throws. */
export const resolveZoneId = async (point) => {
    try {
        const [lng, lat] = point?.coordinates || [];
        const zoneId = resolveZoneIdForPoint(lat, lng, await loadActiveZones());
        return zoneId ? new mongoose.Types.ObjectId(zoneId) : undefined;
    } catch (err) {
        logger.warn(`[hotel] zone lookup failed: ${err.message}`);
        return undefined;
    }
};

/**
 * Keep property.startingPrice / originalPrice equal to the cheapest active room type.
 * Called whenever a room type is created, edited or deactivated.
 */
export const refreshPropertyPrices = async (propertyId, { session } = {}) => {
    const cheapest = await HotelRoomType.findOne({ propertyId, isActive: true, isDeleted: { $ne: true } })
        .sort({ pricePerNight: 1 })
        .select('pricePerNight originalPrice')
        .session(session || null)
        .lean();
    let update;
    if (!cheapest) update = { $unset: { startingPrice: 1, originalPrice: 1 } };
    else if (cheapest.originalPrice > cheapest.pricePerNight) {
        update = { $set: { startingPrice: cheapest.pricePerNight, originalPrice: cheapest.originalPrice } };
    } else update = { $set: { startingPrice: cheapest.pricePerNight }, $unset: { originalPrice: 1 } };
    await HotelProperty.updateOne({ _id: propertyId }, update, session ? { session } : {});
};

/** True when the property (or one room type) has a booking that still holds a room. */
export const hasUpcomingBookings = (filter) =>
    HotelBooking.exists({ ...filter, status: { $in: ACTIVE_BOOKING_STATUSES }, checkOut: { $gte: todayStartIST() } });

/** Documents this property must upload; GST certificate too if the partner is GST-registered. */
export const requiredDocumentTypes = (propertyType, partner) => {
    const list = [...(REQUIRED_DOCUMENTS[propertyType] || [])];
    if (partner?.kyc?.gstNumber && !list.includes('gst_certificate')) list.push('gst_certificate');
    return list;
};

/** PropertyDocuments API shape (a property with no record yet gets an empty one). */
export const documentsJSON = (doc, property, partner) => {
    const requiredTypes = requiredDocumentTypes(property.propertyType, partner);
    const obj = doc ? (doc.toObject ? doc.toObject({ versionKey: false }) : { ...doc }) : null;
    return {
        propertyId: property._id,
        documents: (obj?.documents || []).map((d) => ({ ...d, isRequired: requiredTypes.includes(d.type) })),
        verificationStatus: obj?.verificationStatus || 'pending',
        adminRemark: obj?.adminRemark || '',
        ...(obj?.verifiedAt ? { verifiedAt: obj.verifiedAt } : {}),
        requiredTypes,
    };
};

export const loadDocuments = (propertyId) => HotelPropertyDocument.findOne({ propertyId });

const plain = (doc) => (doc?.toObject ? doc.toObject({ versionKey: false }) : { ...doc });

/** Property as the partner and admin see it. */
export const propertyJSON = (doc) => {
    const obj = plain(doc);
    delete obj.__v;
    delete obj.isDeleted;
    return obj;
};

/** Property as customers see it. */
export const publicPropertyJSON = (doc) => {
    const obj = propertyJSON(doc);
    delete obj.approvedBy;
    delete obj.approvedAt;
    delete obj.rejectionReason;
    delete obj.zoneId;
    return obj;
};

export const roomTypeJSON = (doc) => {
    const obj = plain(doc);
    delete obj.__v;
    delete obj.isDeleted;
    return obj;
};

/** A partner's own, non-deleted property, or 404 (also for someone else's). */
export const loadOwnProperty = async (partnerId, id) => {
    if (!isObjectId(id)) throw new NotFoundError('Property not found');
    const property = await HotelProperty.findOne({ _id: id, partnerId, isDeleted: { $ne: true } });
    if (!property) throw new NotFoundError('Property not found');
    return property;
};

/** A room type of a property the partner owns, or 404. */
export const loadOwnRoomType = async (partnerId, roomTypeId, propertyId = null) => {
    if (!isObjectId(roomTypeId)) throw new NotFoundError('Room type not found');
    const roomType = await HotelRoomType.findOne({ _id: roomTypeId, isDeleted: { $ne: true } });
    if (!roomType || (propertyId && String(roomType.propertyId) !== String(propertyId))) {
        throw new NotFoundError('Room type not found');
    }
    const property = await loadOwnProperty(partnerId, String(roomType.propertyId)).catch(() => null);
    if (!property) throw new NotFoundError('Room type not found');
    return { roomType, property };
};

/** Pagination from a parsed query: { page, limit, skip }. */
export const pageOf = ({ page = 1, limit = 20 } = {}) => {
    const p = Math.max(1, Math.floor(Number(page) || 1));
    const l = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
    return { page: p, limit: l, skip: (p - 1) * l };
};
