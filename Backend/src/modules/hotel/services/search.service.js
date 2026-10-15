// Customer search over listable properties (approved + live + partner approved).
//
// One aggregation: optional $geoNear (must be the first stage), property filters,
// a $lookup of the room types that fit the party, and — when dates are given — a
// nested $lookup of the nights in hotel_inventory_days that would stop that room
// type (closed, or fewer than `rooms` left). A property survives only if at least
// one room type fits and has no blocking night. A night with no row yet means full
// capacity (rows are backfilled 365 days ahead).

import { z } from 'zod';
import { ValidationError } from '../../../core/auth/errors.js';
import { PROPERTY_TYPES, AMENITY_KEYS, SUITABILITY } from '../constants.js';
import { HotelPartner } from '../models/hotelPartner.model.js';
import { HotelProperty } from '../models/hotelProperty.model.js';
import { HotelRoomType } from '../models/hotelRoomType.model.js';
import { parse } from '../validators/partner.validators.js';
import { parseStay, toNightDate } from './dates.js';
import { escapeRegex, pageOf, round2 } from './property.service.js';

const csv = (allowed) => z.string().optional().transform((s, ctx) => {
    if (!s) return undefined;
    const list = s.split(',').map((x) => x.trim()).filter(Boolean);
    const bad = allowed ? list.find((x) => !allowed.includes(x)) : null;
    if (bad) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown value "${bad}"` });
        return z.NEVER;
    }
    return list.length ? list : undefined;
});

const num = (min, max) => z.coerce.number().min(min).max(max).optional();
const int = (min, max) => z.coerce.number().int().min(min).max(max).optional();

export const searchQuerySchema = z.object({
    q: z.string().trim().max(100).optional(),
    city: z.string().trim().max(80).optional(),
    lat: num(-90, 90),
    lng: num(-180, 180),
    radiusKm: num(0.1, 1000),
    types: csv(PROPERTY_TYPES),
    amenities: csv(AMENITY_KEYS),
    suitability: z.enum(SUITABILITY).optional(),
    minPrice: num(0, 10_000_000),
    maxPrice: num(0, 10_000_000),
    minRating: num(0, 5),
    checkIn: z.string().optional(),
    checkOut: z.string().optional(),
    adults: int(1, 100),
    children: int(0, 100),
    rooms: int(1, 50),
    sort: z.enum(['relevance', 'price_low', 'price_high', 'rating', 'distance', 'newest']).optional(),
    page: int(1, 10_000),
    limit: int(1, 100),
});

/** Ids of partners whose properties may be listed. */
export const listablePartnerIds = () =>
    HotelPartner.find({ status: 'approved', isDeleted: { $ne: true } }).distinct('_id');

/** Match for listable properties (status, live, not deleted, partner approved). */
export const listableMatch = async () => ({
    ...HotelProperty.publicFilter(),
    partnerId: { $in: await listablePartnerIds() },
});

export const searchProperties = async (rawQuery) => {
    const q = parse(searchQuerySchema, rawQuery);
    const adults = q.adults ?? 2;
    const children = q.children ?? 0;
    const rooms = q.rooms ?? 1;
    const { page, limit, skip } = pageOf(q);

    const hasGeo = q.lat !== undefined || q.lng !== undefined;
    if (hasGeo && (q.lat === undefined || q.lng === undefined)) throw new ValidationError('lat and lng go together');
    if ((q.checkIn && !q.checkOut) || (!q.checkIn && q.checkOut)) {
        throw new ValidationError('checkIn and checkOut go together');
    }
    const stay = q.checkIn ? parseStay(q.checkIn, q.checkOut) : null;
    if (q.minPrice !== undefined && q.maxPrice !== undefined && q.minPrice > q.maxPrice) {
        throw new ValidationError('minPrice cannot be more than maxPrice');
    }

    const match = await listableMatch();
    if (q.city) match['address.city'] = { $regex: `^${escapeRegex(q.city)}$`, $options: 'i' };
    if (q.q) {
        const rx = { $regex: escapeRegex(q.q), $options: 'i' };
        match.$or = [{ name: rx }, { 'address.city': rx }, { 'address.area': rx }];
    }
    if (q.types) match.propertyType = { $in: q.types };
    if (q.amenities) match.amenities = { $all: q.amenities };
    if (q.suitability && q.suitability !== 'none') match.suitability = { $in: [q.suitability, 'both'] };
    else if (q.suitability) match.suitability = 'none';
    if (q.minRating !== undefined) match.avgRating = { $gte: q.minRating };

    const pipeline = [];
    if (hasGeo) {
        pipeline.push({
            $geoNear: {
                near: { type: 'Point', coordinates: [q.lng, q.lat] },
                distanceField: 'distanceMeters',
                maxDistance: (q.radiusKm ?? 50) * 1000,
                spherical: true,
                query: match,
            },
        });
    } else {
        pipeline.push({ $match: match });
    }

    // Room types that can hold the party (rooms × max per room).
    const roomTypePipeline = [
        {
            $match: {
                $expr: {
                    $and: [
                        { $eq: ['$propertyId', '$$pid'] },
                        { $eq: ['$isActive', true] },
                        { $ne: ['$isDeleted', true] },
                        { $gte: [{ $multiply: ['$maxAdults', rooms] }, adults] },
                        { $gte: [{ $multiply: [{ $ifNull: ['$maxChildren', 0] }, rooms] }, children] },
                    ],
                },
            },
        },
    ];
    // Fewer total units than rooms asked for can never work, dates or not.
    roomTypePipeline.push({
        $match: {
            $expr: {
                $gte: [
                    {
                        $cond: [
                            { $eq: ['$inventoryType', 'bed'] },
                            { $multiply: ['$totalInventory', { $ifNull: ['$bedsPerRoom', 1] }] },
                            '$totalInventory',
                        ],
                    },
                    rooms,
                ],
            },
        },
    });
    if (stay) {
        roomTypePipeline.push(
            {
                $lookup: {
                    from: 'hotel_inventory_days',
                    let: { rt: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$roomTypeId', '$$rt'] },
                                        { $gte: ['$date', toNightDate(stay.checkIn)] },
                                        { $lt: ['$date', toNightDate(stay.checkOut)] },
                                        {
                                            $or: [
                                                { $eq: ['$closed', true] },
                                                { $lt: [{ $subtract: ['$capacity', '$booked'] }, rooms] },
                                            ],
                                        },
                                    ],
                                },
                            },
                        },
                        { $limit: 1 },
                        { $project: { _id: 1 } },
                    ],
                    as: 'blocked',
                },
            },
            { $match: { blocked: { $size: 0 } } },
        );
    }
    roomTypePipeline.push({ $project: { pricePerNight: 1, originalPrice: 1 } });

    pipeline.push(
        { $lookup: { from: HotelRoomType.collection.collectionName, let: { pid: '$_id' }, pipeline: roomTypePipeline, as: 'fit' } },
        { $match: { 'fit.0': { $exists: true } } },
        { $addFields: { fitPrice: { $min: '$fit.pricePerNight' } } },
    );
    const priceMatch = {};
    if (q.minPrice !== undefined) priceMatch.$gte = q.minPrice;
    if (q.maxPrice !== undefined) priceMatch.$lte = q.maxPrice;
    if (Object.keys(priceMatch).length) pipeline.push({ $match: { fitPrice: priceMatch } });

    const byRating = { avgRating: -1, totalReviews: -1 };
    const sorts = {
        price_low: { fitPrice: 1 },
        price_high: { fitPrice: -1 },
        rating: byRating,
        newest: { createdAt: -1 },
        distance: hasGeo ? { distanceMeters: 1 } : byRating,
        relevance: hasGeo ? { distanceMeters: 1 } : { ...byRating, createdAt: -1 },
    };
    pipeline.push(
        { $sort: { ...sorts[q.sort || 'relevance'], _id: 1 } },
        {
            $facet: {
                items: [
                    { $skip: skip },
                    { $limit: limit },
                    {
                        $project: {
                            name: 1, slug: 1, propertyType: 1, coverImage: 1,
                            'address.area': 1, 'address.city': 1, location: 1,
                            distanceMeters: 1, avgRating: 1, totalReviews: 1, amenities: 1,
                            fit: 1, fitPrice: 1,
                        },
                    },
                ],
                total: [{ $count: 'n' }],
            },
        },
    );

    const [result] = await HotelProperty.aggregate(pipeline);
    const items = (result?.items || []).map((p) => {
        const cheapest = p.fit.reduce((a, b) => (b.pricePerNight < a.pricePerNight ? b : a), p.fit[0]);
        return {
            _id: p._id,
            name: p.name,
            slug: p.slug,
            propertyType: p.propertyType,
            coverImage: p.coverImage,
            address: { area: p.address?.area || '', city: p.address?.city || '' },
            location: p.location,
            ...(p.distanceMeters !== undefined ? { distanceKm: round2(p.distanceMeters / 1000) } : {}),
            avgRating: p.avgRating || 0,
            totalReviews: p.totalReviews || 0,
            amenities: p.amenities || [],
            startingPrice: p.fitPrice,
            ...(cheapest?.originalPrice > p.fitPrice ? { originalPrice: cheapest.originalPrice } : {}),
            ...(stay ? { available: true } : {}),
        };
    });
    return { items, page, limit, total: result?.total?.[0]?.n || 0 };
};
