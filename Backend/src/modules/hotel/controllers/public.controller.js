import { sendResponse } from '../../../utils/response.js';
import { NotFoundError, ValidationError } from '../../../core/auth/errors.js';
import {
    AMENITIES,
    PROPERTY_TYPES,
    ALLOWED_INVENTORY_TYPES,
    REQUIRED_DOCUMENTS,
    CANCELLATION_POLICY_TYPES,
    MEAL_PLANS,
    SUITABILITY,
} from '../constants.js';
import { HotelProperty } from '../models/hotelProperty.model.js';
import { HotelRoomType } from '../models/hotelRoomType.model.js';
import { searchProperties, listableMatch } from '../services/search.service.js';
import { publicPropertyJSON, roomTypeJSON, isObjectId, round2 } from '../services/property.service.js';
import { quoteNights, parseStay } from '../services/inventory.service.js';

const handle = (fn) => async (req, res, next) => {
    try {
        return await fn(req, res);
    } catch (err) {
        return next(err);
    }
};

export const healthController = (req, res) =>
    sendResponse(res, 200, 'Hotel module is up', { module: 'hotel', status: 'ok' });

// Static catalogue the partner wizard and customer filters are built from, so the
// apps never hardcode a list the server would then reject.
export const catalogueController = (req, res) =>
    sendResponse(res, 200, 'Hotel catalogue', {
        propertyTypes: PROPERTY_TYPES,
        inventoryTypesByProperty: ALLOWED_INVENTORY_TYPES,
        requiredDocuments: REQUIRED_DOCUMENTS,
        amenities: AMENITIES,
        cancellationPolicies: CANCELLATION_POLICY_TYPES,
        mealPlans: MEAL_PLANS,
        suitability: SUITABILITY,
    });

export const searchController = handle(async (req, res) =>
    sendResponse(res, 200, 'Properties', await searchProperties(req.query)));

/** A listable property (approved, live, partner approved) by id or slug, or 404. */
const loadListable = async (idOrSlug) => {
    const key = String(idOrSlug || '').trim();
    if (!key) throw new NotFoundError('Property not found');
    const property = await HotelProperty.findOne({
        ...(await listableMatch()),
        ...(isObjectId(key) ? { _id: key } : { slug: key.toLowerCase() }),
    });
    if (!property) throw new NotFoundError('Property not found');
    return property;
};

const activeRoomTypes = (propertyId) =>
    HotelRoomType.find({ propertyId, isActive: true, isDeleted: { $ne: true } }).sort({ pricePerNight: 1 });

export const propertyDetailController = handle(async (req, res) => {
    const property = await loadListable(req.params.idOrSlug);
    const roomTypes = await activeRoomTypes(property._id);
    return sendResponse(res, 200, 'Property', {
        property: publicPropertyJSON(property),
        roomTypes: roomTypes.map(roomTypeJSON),
    });
});

const intParam = (v, def, min, max, name) => {
    if (v === undefined || v === '') return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
        throw new ValidationError(`${name} must be a whole number from ${min} to ${max}`);
    }
    return n;
};

export const availabilityController = handle(async (req, res) => {
    const { checkIn, checkOut } = req.query;
    if (!checkIn || !checkOut) throw new ValidationError('checkIn and checkOut are required');
    const stay = parseStay(String(checkIn), String(checkOut));
    const adults = intParam(req.query.adults, 2, 1, 100, 'adults');
    const children = intParam(req.query.children, 0, 0, 100, 'children');
    const rooms = intParam(req.query.rooms, 1, 1, 50, 'rooms');

    const property = await loadListable(req.params.id);
    const roomTypes = await activeRoomTypes(property._id);
    const out = await Promise.all(roomTypes.map(async (rt) => {
        const nights = await quoteNights(rt, stay.checkIn, stay.checkOut);
        const available = Math.min(...nights.map((n) => n.available));
        const fits = rooms * rt.maxAdults >= adults && rooms * (rt.maxChildren || 0) >= children;
        return {
            roomTypeId: rt._id,
            name: rt.name,
            available,
            bookable: available >= rooms && fits,
            nightlyPrices: nights.map(({ date, price }) => ({ date, price })),
            total: round2(rooms * nights.reduce((s, n) => s + n.price, 0)),
        };
    }));
    return sendResponse(res, 200, 'Availability', {
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        nights: stay.nights.length,
        roomTypes: out,
    });
});

export const citiesController = handle(async (req, res) => {
    const rows = await HotelProperty.aggregate([
        { $match: { ...(await listableMatch()), 'address.city': { $nin: [null, ''] } } },
        { $group: { _id: { $toLower: '$address.city' }, city: { $first: '$address.city' }, count: { $sum: 1 } } },
        { $sort: { count: -1, city: 1 } },
        { $project: { _id: 0, city: 1, count: 1 } },
    ]);
    return sendResponse(res, 200, 'Cities', rows);
});
