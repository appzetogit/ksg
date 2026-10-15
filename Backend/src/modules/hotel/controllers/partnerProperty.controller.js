// Partner: properties, room types, documents, submit and live toggle.
// A pending partner may build drafts and submit them; going live needs both the
// property and the partner approved.

import { sendResponse } from '../../../utils/response.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../core/auth/errors.js';
import { ConflictError } from '../errors.js';
import { isInventoryTypeAllowed, ALLOWED_INVENTORY_TYPES } from '../constants.js';
import { HotelPartner } from '../models/hotelPartner.model.js';
import { HotelProperty } from '../models/hotelProperty.model.js';
import { HotelRoomType } from '../models/hotelRoomType.model.js';
import { HotelPropertyDocument } from '../models/hotelPropertyDocument.model.js';
import { parse } from '../validators/partner.validators.js';
import {
    createPropertySchema,
    updatePropertySchema,
    createRoomTypeSchema,
    updateRoomTypeSchema,
    documentsSchema,
    liveSchema,
} from '../validators/property.validators.js';
import {
    toPoint,
    uniqueSlug,
    resolveZoneId,
    refreshPropertyPrices,
    hasUpcomingBookings,
    requiredDocumentTypes,
    documentsJSON,
    loadDocuments,
    propertyJSON,
    roomTypeJSON,
    loadOwnProperty,
} from '../services/property.service.js';
import { backfillInventory, applyCapacity, runInTransaction } from '../services/inventory.service.js';

const handle = (fn) => async (req, res, next) => {
    try {
        return await fn(req, res);
    } catch (err) {
        return next(err);
    }
};

const partnerIdOf = (req) => req.user.userId;

const loadPartner = async (req) => {
    const partner = await HotelPartner.findById(partnerIdOf(req));
    if (!partner || partner.isDeleted) throw new NotFoundError('Partner account not found');
    return partner;
};

/** Merge a nested partial (address, typeDetails, cancellationPolicy) into the doc. */
const mergeNested = (doc, key, patch) => {
    const current = doc[key]?.toObject ? doc[key].toObject() : (doc[key] || {});
    doc[key] = { ...current, ...patch };
};

const applyPropertyBody = async (property, body) => {
    const { location, address, typeDetails, cancellationPolicy, ...flat } = body;
    property.set(flat);
    if (address) mergeNested(property, 'address', address);
    if (typeDetails) mergeNested(property, 'typeDetails', typeDetails);
    if (cancellationPolicy) mergeNested(property, 'cancellationPolicy', cancellationPolicy);
    if (location) {
        property.location = toPoint(location);
        property.zoneId = await resolveZoneId(property.location);
    }
};

// ─── properties ───────────────────────────────────────────────────────────

export const listProperties = handle(async (req, res) => {
    const rows = await HotelProperty.find({ partnerId: partnerIdOf(req), isDeleted: { $ne: true } })
        .sort({ createdAt: -1 });
    return sendResponse(res, 200, 'Properties', rows.map(propertyJSON));
});

export const createProperty = handle(async (req, res) => {
    const body = parse(createPropertySchema, req.body);
    const property = new HotelProperty({ partnerId: partnerIdOf(req), status: 'draft', isLive: false });
    await applyPropertyBody(property, body);
    property.slug = await uniqueSlug(property.name, property.address?.city);
    await property.save();
    return sendResponse(res, 201, 'Property created', { property: propertyJSON(property) });
});

export const getProperty = handle(async (req, res) => {
    const property = await loadOwnProperty(partnerIdOf(req), req.params.id);
    const [roomTypes, docs, partner] = await Promise.all([
        HotelRoomType.find({ propertyId: property._id, isDeleted: { $ne: true } }).sort({ pricePerNight: 1 }),
        loadDocuments(property._id),
        HotelPartner.findById(partnerIdOf(req)).select('kyc.gstNumber').lean(),
    ]);
    return sendResponse(res, 200, 'Property', {
        property: propertyJSON(property),
        roomTypes: roomTypes.map(roomTypeJSON),
        documents: documentsJSON(docs, property, partner),
    });
});

// Fields whose change means an admin must look at the property again.
const REVIEW_FIELDS = ['name', 'propertyType', 'location', 'address'];

export const updateProperty = handle(async (req, res) => {
    const body = parse(updatePropertySchema, req.body);
    const property = await loadOwnProperty(partnerIdOf(req), req.params.id);

    if (body.propertyType && body.propertyType !== property.propertyType) {
        const active = await HotelRoomType.find({ propertyId: property._id, isActive: true, isDeleted: { $ne: true } })
            .select('inventoryType name').lean();
        const bad = active.find((rt) => !isInventoryTypeAllowed(body.propertyType, rt.inventoryType));
        if (bad) {
            throw new ValidationError(
                `Room type "${bad.name}" sells by ${bad.inventoryType}, which a ${body.propertyType} cannot. `
                + `Allowed: ${ALLOWED_INVENTORY_TYPES[body.propertyType].join(', ')}`,
            );
        }
    }

    const snapshot = () => REVIEW_FIELDS.map((f) => {
        const v = property.get(f);
        if (f === 'location') return JSON.stringify(v?.coordinates || null);
        if (f === 'address') {
            const a = v?.toObject ? v.toObject() : (v || {});
            return JSON.stringify(Object.keys(a).sort().filter((k) => a[k]).map((k) => [k, a[k]]));
        }
        return v;
    });
    const before = snapshot();
    await applyPropertyBody(property, body);
    const after = snapshot();
    const needsReview = property.status === 'approved' && before.some((v, i) => v !== after[i]);
    if (needsReview) property.status = 'pending';
    await property.save();
    return sendResponse(
        res,
        200,
        needsReview ? 'Property updated and sent back for approval' : 'Property updated',
        { property: propertyJSON(property) },
    );
});

export const deleteProperty = handle(async (req, res) => {
    const property = await loadOwnProperty(partnerIdOf(req), req.params.id);
    if (await hasUpcomingBookings({ propertyId: property._id })) {
        throw new ConflictError('This property has upcoming bookings. Cancel or complete them before deleting it.');
    }
    property.isDeleted = true;
    property.isLive = false;
    await property.save();
    return sendResponse(res, 200, 'Property deleted', { _id: property._id });
});

// ─── room types ───────────────────────────────────────────────────────────

const assertInventoryType = (property, inventoryType) => {
    if (!isInventoryTypeAllowed(property.propertyType, inventoryType)) {
        throw new ValidationError(
            `A ${property.propertyType} cannot sell by ${inventoryType}. `
            + `Allowed: ${ALLOWED_INVENTORY_TYPES[property.propertyType].join(', ')}`,
        );
    }
};

export const createRoomType = handle(async (req, res) => {
    const property = await loadOwnProperty(partnerIdOf(req), req.params.id);
    const body = parse(createRoomTypeSchema, req.body);
    const allowed = ALLOWED_INVENTORY_TYPES[property.propertyType] || [];
    const inventoryType = body.inventoryType || (allowed.length === 1 ? allowed[0] : undefined);
    if (!inventoryType) throw new ValidationError(`inventoryType is required (one of ${allowed.join(', ')})`);
    assertInventoryType(property, inventoryType);

    const roomType = new HotelRoomType({
        ...body,
        inventoryType,
        totalInventory: inventoryType === 'entire' ? 1 : body.totalInventory,
        propertyId: property._id,
    });
    if (roomType.totalInventory == null) throw new ValidationError('totalInventory is required');
    if (roomType.originalPrice === null) roomType.originalPrice = undefined;
    if (roomType.weekendPrice === null) roomType.weekendPrice = undefined;
    await roomType.save();

    await backfillInventory(roomType);
    await refreshPropertyPrices(property._id);
    return sendResponse(res, 201, 'Room type created', { roomType: roomTypeJSON(roomType) });
});

const loadRoomTypeOf = async (property, roomTypeId) => {
    const roomType = /^[a-f\d]{24}$/i.test(roomTypeId || '')
        ? await HotelRoomType.findOne({ _id: roomTypeId, propertyId: property._id, isDeleted: { $ne: true } })
        : null;
    if (!roomType) throw new NotFoundError('Room type not found');
    return roomType;
};

export const updateRoomType = handle(async (req, res) => {
    const property = await loadOwnProperty(partnerIdOf(req), req.params.id);
    const roomType = await loadRoomTypeOf(property, req.params.roomTypeId);
    const body = parse(updateRoomTypeSchema, req.body);

    const before = roomType.sellableUnits();
    const wasActive = roomType.isActive;
    const { originalPrice, weekendPrice, ...rest } = body;
    roomType.set(rest);
    if (originalPrice !== undefined) roomType.originalPrice = originalPrice ?? undefined;
    if (weekendPrice !== undefined) roomType.weekendPrice = weekendPrice ?? undefined;
    if (roomType.inventoryType === 'entire') roomType.totalInventory = 1;
    assertInventoryType(property, roomType.inventoryType);

    if (body.isActive === false && wasActive && await hasUpcomingBookings({ roomTypeId: roomType._id })) {
        throw new ConflictError('This room type has upcoming bookings and cannot be deactivated.');
    }

    await roomType.validate();
    if (roomType.sellableUnits() !== before) {
        // Capacity check and the room type write are one unit: refuse (409) when a
        // future night already has more booked than the new capacity.
        await runInTransaction(async (session) => {
            await applyCapacity(roomType, { session });
            await roomType.save({ session });
        });
    } else {
        await roomType.save();
    }
    if (roomType.isActive) await backfillInventory(roomType);
    await refreshPropertyPrices(property._id);
    return sendResponse(res, 200, 'Room type updated', { roomType: roomTypeJSON(roomType) });
});

export const deleteRoomType = handle(async (req, res) => {
    const property = await loadOwnProperty(partnerIdOf(req), req.params.id);
    const roomType = await loadRoomTypeOf(property, req.params.roomTypeId);
    if (await hasUpcomingBookings({ roomTypeId: roomType._id })) {
        throw new ConflictError('This room type has upcoming bookings and cannot be deleted.');
    }
    roomType.isActive = false;
    await roomType.save();
    await refreshPropertyPrices(property._id);
    return sendResponse(res, 200, 'Room type deactivated', { roomType: roomTypeJSON(roomType) });
});

// ─── documents ────────────────────────────────────────────────────────────

export const putDocuments = handle(async (req, res) => {
    const property = await loadOwnProperty(partnerIdOf(req), req.params.id);
    const { documents } = parse(documentsSchema, req.body);
    const partner = await HotelPartner.findById(partnerIdOf(req)).select('kyc.gstNumber').lean();
    const required = requiredDocumentTypes(property.propertyType, partner);

    const existing = await HotelPropertyDocument.findOne({ propertyId: property._id });
    const previous = new Map((existing?.documents || []).map((d) => [`${d.type}|${d.fileUrl}`, d.uploadedAt]));
    const now = new Date();
    const doc = existing || new HotelPropertyDocument({ propertyId: property._id });
    doc.documents = documents.map((d) => ({
        ...d,
        isRequired: required.includes(d.type),
        uploadedAt: previous.get(`${d.type}|${d.fileUrl}`) || now,
    }));
    // New files need a fresh look from an admin.
    doc.verificationStatus = 'pending';
    doc.verifiedAt = undefined;
    doc.verifiedBy = undefined;
    await doc.save();
    return sendResponse(res, 200, 'Documents saved', documentsJSON(doc, property, partner));
});

// ─── submit & live ────────────────────────────────────────────────────────

export const submitProperty = handle(async (req, res) => {
    const property = await loadOwnProperty(partnerIdOf(req), req.params.id);
    if (!['draft', 'rejected'].includes(property.status)) {
        throw new ConflictError(`Only a draft or rejected property can be submitted (this one is ${property.status})`);
    }
    const partner = await loadPartner(req);

    const problems = [];
    if (!property.address?.city) problems.push('the property address needs a city');
    if (!property.location?.coordinates?.length) problems.push('set the property location on the map');
    if (!property.coverImage) problems.push('a cover image is required');
    // `images` is the gallery without the cover; a copy of the cover is not counted twice.
    const gallery = new Set((property.images || []).filter((u) => u && u !== property.coverImage));
    if ((property.coverImage ? 1 : 0) + gallery.size < 3) {
        problems.push('at least 3 photos (including the cover) are required');
    }

    const activeRoomTypes = await HotelRoomType.countDocuments({
        propertyId: property._id, isActive: true, isDeleted: { $ne: true },
    });
    if (!activeRoomTypes) problems.push('add at least one active room type');

    const docs = await loadDocuments(property._id);
    const uploaded = new Set((docs?.documents || []).map((d) => d.type));
    const missing = requiredDocumentTypes(property.propertyType, partner).filter((t) => !uploaded.has(t));
    if (missing.length) problems.push(`missing documents: ${missing.join(', ')}`);

    if (!partner.kyc?.ownerName || !partner.kyc?.panNumber) {
        problems.push('complete your KYC (owner name and PAN) in your profile');
    }
    if (problems.length) throw new ValidationError(`Cannot submit: ${problems.join('; ')}`);

    property.status = 'pending';
    property.rejectionReason = '';
    await property.save();
    return sendResponse(res, 200, 'Property submitted for approval', { property: propertyJSON(property) });
});

export const setLive = handle(async (req, res) => {
    const { isLive } = parse(liveSchema, req.body);
    const property = await loadOwnProperty(partnerIdOf(req), req.params.id);
    if (isLive) {
        const partner = await loadPartner(req);
        if (partner.status !== 'approved') {
            throw new ForbiddenError('Your hotel partner account must be approved before a property can go live.');
        }
        if (property.status !== 'approved') {
            throw new ForbiddenError('This property must be approved before it can go live.');
        }
    }
    property.isLive = isLive;
    await property.save();
    return sendResponse(res, 200, isLive ? 'Property is live' : 'Property is offline', { property: propertyJSON(property) });
});
