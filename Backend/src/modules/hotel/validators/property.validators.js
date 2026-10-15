import { z } from 'zod';
import {
    PROPERTY_TYPES,
    INVENTORY_TYPES,
    SUITABILITY,
    CANCELLATION_POLICY_TYPES,
    MEAL_PLANS,
    AMENITY_KEYS,
    DOCUMENT_TYPES,
    AVAILABILITY_SOURCES,
    TIME_OF_DAY,
} from '../constants.js';
import { isPrivatePath } from '../../../core/files/privateFiles.js';

const str = (max) => z.string().trim().max(max);

// Photos are shown to everyone. A link into a private upload folder (KYC, licences)
// must not be accepted as one: responses to signed-in callers re-sign private links
// (core/files/privateFiles.js), so storing one would hand out someone's document.
const PRIVATE_LINK = /\/(?:uploads|api\/v1\/files\/p)\/([^?#]+)/;
export const isPublicImageUrl = (s) => {
    const m = PRIVATE_LINK.exec(String(s || ''));
    if (!m) return true;
    let rel = m[1];
    try { rel = decodeURIComponent(rel); } catch { /* keep the raw path */ }
    return !isPrivatePath(rel);
};
const url = str(1000).refine(isPublicImageUrl, 'must be a public photo link, not a private document');
const money = z.number().min(0).max(10_000_000).transform((n) => Math.round(n * 100) / 100);
const count = (min, max) => z.number().int().min(min).max(max);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const location = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
}).strict();

const address = z.object({
    line1: str(200),
    area: str(120),
    city: str(80),
    state: str(80),
    pincode: z.string().trim().regex(/^\d{6}$/, 'Invalid pincode').or(z.literal('')),
    country: str(60),
    fullAddress: str(500),
}).partial().strict();

const typeDetails = z.object({
    hotelCategory: z.enum(['budget', 'premium', 'luxury']),
    starRating: count(1, 5),
    resortType: z.enum(['beach', 'hill', 'jungle', 'desert']),
    pgType: z.enum(['boys', 'girls', 'unisex']),
    hostelType: z.enum(['boys', 'girls', 'mixed']),
    hostLivesOnProperty: z.boolean(),
}).partial().strict();

const propertyFields = {
    name: z.string().trim().min(2).max(120),
    propertyType: z.enum(PROPERTY_TYPES),
    typeDetails,
    suitability: z.enum(SUITABILITY),
    description: str(5000),
    shortDescription: str(200),
    contactNumber: str(16),
    address,
    location,
    nearbyPlaces: z.array(z.object({
        name: z.string().trim().min(1).max(120),
        type: str(60).optional(),
        distanceKm: z.number().min(0).max(1000).optional(),
    }).strict()).max(30),
    coverImage: url,
    images: z.array(url).max(40),
    amenities: z.array(z.enum(AMENITY_KEYS)).max(AMENITY_KEYS.length),
    houseRules: z.array(str(300)).max(40),
    checkInTime: z.string().regex(TIME_OF_DAY, 'must be HH:mm'),
    checkOutTime: z.string().regex(TIME_OF_DAY, 'must be HH:mm'),
    cancellationPolicy: z.object({
        type: z.enum(CANCELLATION_POLICY_TYPES),
        freeCancelHours: count(0, 720),
        refundPercentAfter: z.number().min(0).max(100),
    }).partial().strict(),
};

export const createPropertySchema = z.object(propertyFields)
    .partial()
    .required({ name: true, propertyType: true })
    .strict();

export const updatePropertySchema = z.object(propertyFields).partial().strict();

const roomTypeFields = {
    name: z.string().trim().min(1).max(80),
    description: str(1000),
    inventoryType: z.enum(INVENTORY_TYPES),
    roomCategory: z.enum(['private', 'shared', 'entire']),
    baseAdults: count(1, 50),
    baseChildren: count(0, 50),
    maxAdults: count(1, 50),
    maxChildren: count(0, 50),
    bedsPerRoom: count(1, 50),
    totalInventory: count(1, 1000),
    pricePerNight: money,
    originalPrice: money.nullable(),
    weekendPrice: money.nullable(),
    extraAdultPrice: money,
    extraChildPrice: money,
    mealPlan: z.enum(MEAL_PLANS),
    images: z.array(url).max(30),
    amenities: z.array(z.enum(AMENITY_KEYS)).max(AMENITY_KEYS.length),
    isActive: z.boolean(),
};

export const createRoomTypeSchema = z.object(roomTypeFields)
    .partial()
    .required({ name: true, maxAdults: true, pricePerNight: true, images: true })
    .strict();

export const updateRoomTypeSchema = z.object(roomTypeFields).partial().strict();

export const documentsSchema = z.object({
    documents: z.array(z.object({
        type: z.enum(DOCUMENT_TYPES),
        name: str(120).optional(),
        fileUrl: z.string().trim().min(1).max(1000),
    }).strict()).max(20),
}).strict();

export const liveSchema = z.object({ isLive: z.boolean() }).strict();

// ─── inventory ────────────────────────────────────────────────────────────

export const calendarQuerySchema = z.object({
    propertyId: z.string().optional(),
    roomTypeId: z.string(),
    from: dateStr,
    to: dateStr,
});

export const calendarUpdateSchema = z.object({
    roomTypeId: z.string(),
    from: dateStr,
    to: dateStr,
    priceOverride: money.nullable().optional(),
    closed: z.boolean().optional(),
}).strict().refine((b) => b.priceOverride !== undefined || b.closed !== undefined, {
    message: 'Nothing to change: send priceOverride and/or closed',
});

export const blocksQuerySchema = z.object({
    propertyId: z.string().optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
});

export const createBlockSchema = z.object({
    roomTypeId: z.string(),
    source: z.enum(AVAILABILITY_SOURCES.filter((s) => s !== 'platform')),
    startDate: dateStr,
    endDate: dateStr,
    units: count(1, 1000),
    externalPlatform: str(60).optional(),
    externalReference: str(120).optional(),
    notes: str(500).optional(),
}).strict();
