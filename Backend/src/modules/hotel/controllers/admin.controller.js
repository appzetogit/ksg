import { z } from 'zod';
import { sendResponse } from '../../../utils/response.js';
import { NotFoundError, ValidationError } from '../../../core/auth/errors.js';
import { invalidateAccountCache } from '../../../core/auth/auth.middleware.js';
import { HOTEL_PARTNER_ROLE, PARTNER_STATUSES, PROPERTY_STATUSES, PROPERTY_TYPES } from '../constants.js';
import { HotelPartner, HotelProperty, HotelBooking, HotelRoomType, HotelPropertyDocument } from '../models/index.js';
import { parse } from '../validators/partner.validators.js';
import {
    isObjectId,
    escapeRegex,
    pageOf,
    propertyJSON,
    roomTypeJSON,
    documentsJSON,
    loadDocuments,
} from '../services/property.service.js';

const handle = (fn) => async (req, res, next) => {
    try {
        return await fn(req, res);
    } catch (err) {
        return next(err);
    }
};

const countBy = async (Model, field, match = {}) => {
    const rows = await Model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
    return Object.fromEntries(rows.map((r) => [r._id ?? 'unknown', r.n]));
};

// Counts per status. The full dashboard (revenue, occupancy, queues) arrives with the
// booking phase.
export const overviewController = async (req, res, next) => {
    try {
        const [partners, properties, bookings] = await Promise.all([
            countBy(HotelPartner, 'status', { isDeleted: { $ne: true } }),
            countBy(HotelProperty, 'status', { isDeleted: { $ne: true } }),
            countBy(HotelBooking, 'status'),
        ]);
        return sendResponse(res, 200, 'Hotel overview', { partners, properties, bookings });
    } catch (err) {
        return next(err);
    }
};

const adminIdOf = (req) => (isObjectId(String(req.user?.userId || '')) ? req.user.userId : undefined);

const partnerAdminJSON = (doc) => {
    const obj = doc.toObject ? doc.toObject({ versionKey: false }) : { ...doc };
    delete obj.__v;
    delete obj.isDeleted;
    delete obj.fcmTokens;
    if (obj.bank) delete obj.bank.razorpayFundAccountId;
    return obj;
};

const pagingQuery = {
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    q: z.string().trim().max(100).optional(),
};

// ─── partners ─────────────────────────────────────────────────────────────

const partnersQuery = z.object({ ...pagingQuery, status: z.enum(PARTNER_STATUSES).optional() });

export const listPartners = handle(async (req, res) => {
    const q = parse(partnersQuery, req.query);
    const { page, limit, skip } = pageOf(q);
    const filter = { isDeleted: { $ne: true } };
    if (q.status) filter.status = q.status;
    if (q.q) {
        const rx = { $regex: escapeRegex(q.q), $options: 'i' };
        filter.$or = [{ name: rx }, { phone: rx }, { email: rx }, { 'kyc.ownerName': rx }];
    }
    const [items, total] = await Promise.all([
        HotelPartner.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
        HotelPartner.countDocuments(filter),
    ]);
    return sendResponse(res, 200, 'Partners', { items: items.map(partnerAdminJSON), page, limit, total });
});

const loadPartner = async (id) => {
    const partner = isObjectId(id) ? await HotelPartner.findOne({ _id: id, isDeleted: { $ne: true } }) : null;
    if (!partner) throw new NotFoundError('Partner not found');
    return partner;
};

export const getPartner = handle(async (req, res) => {
    const partner = await loadPartner(req.params.id);
    const properties = await HotelProperty.find({ partnerId: partner._id, isDeleted: { $ne: true } }).sort({ createdAt: -1 });
    return sendResponse(res, 200, 'Partner', { partner: partnerAdminJSON(partner), properties: properties.map(propertyJSON) });
});

const statusBody = (statuses, needReason) => z.object({
    status: z.enum(statuses),
    reason: z.string().trim().max(500).optional(),
}).strict().refine((b) => !needReason.includes(b.status) || (b.reason && b.reason.length >= 3), {
    message: 'A reason is required for this status',
    path: ['reason'],
});

const partnerStatusSchema = statusBody(['approved', 'rejected', 'blocked', 'pending'], ['rejected', 'blocked']);

export const setPartnerStatus = handle(async (req, res) => {
    const body = parse(partnerStatusSchema, req.body);
    const partner = await loadPartner(req.params.id);
    partner.status = body.status;
    partner.rejectionReason = ['rejected', 'blocked'].includes(body.status) ? body.reason : '';
    if (body.status === 'approved') {
        partner.approvedAt = new Date();
        partner.approvedBy = adminIdOf(req);
    }
    await partner.save();
    // The auth middleware caches account status; drop it so this applies right away.
    invalidateAccountCache(HOTEL_PARTNER_ROLE, String(partner._id));
    return sendResponse(res, 200, `Partner ${body.status}`, { partner: partnerAdminJSON(partner) });
});

// ─── properties ───────────────────────────────────────────────────────────

const propertiesQuery = z.object({
    ...pagingQuery,
    status: z.enum(PROPERTY_STATUSES).optional(),
    type: z.enum(PROPERTY_TYPES).optional(),
    city: z.string().trim().max(80).optional(),
    partnerId: z.string().optional(),
});

export const listProperties = handle(async (req, res) => {
    const q = parse(propertiesQuery, req.query);
    const { page, limit, skip } = pageOf(q);
    const filter = { isDeleted: { $ne: true } };
    if (q.status) filter.status = q.status;
    if (q.type) filter.propertyType = q.type;
    if (q.city) filter['address.city'] = { $regex: `^${escapeRegex(q.city)}$`, $options: 'i' };
    if (q.partnerId) {
        if (!isObjectId(q.partnerId)) throw new ValidationError('partnerId is not a valid id');
        filter.partnerId = q.partnerId;
    }
    if (q.q) {
        const rx = { $regex: escapeRegex(q.q), $options: 'i' };
        filter.$or = [{ name: rx }, { slug: rx }, { 'address.city': rx }, { 'address.area': rx }];
    }
    const [rows, total] = await Promise.all([
        HotelProperty.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
        HotelProperty.countDocuments(filter),
    ]);
    const partners = new Map(
        (await HotelPartner.find({ _id: { $in: rows.map((r) => r.partnerId) } }).select('name phone').lean())
            .map((p) => [String(p._id), { name: p.name, phone: p.phone }]),
    );
    const items = rows.map((r) => ({ ...propertyJSON(r), partner: partners.get(String(r.partnerId)) || null }));
    return sendResponse(res, 200, 'Properties', { items, page, limit, total });
});

const loadProperty = async (id) => {
    const property = isObjectId(id) ? await HotelProperty.findOne({ _id: id, isDeleted: { $ne: true } }) : null;
    if (!property) throw new NotFoundError('Property not found');
    return property;
};

export const getProperty = handle(async (req, res) => {
    const property = await loadProperty(req.params.id);
    const [partner, roomTypes, docs] = await Promise.all([
        HotelPartner.findById(property.partnerId),
        HotelRoomType.find({ propertyId: property._id, isDeleted: { $ne: true } }).sort({ pricePerNight: 1 }),
        loadDocuments(property._id),
    ]);
    return sendResponse(res, 200, 'Property', {
        property: propertyJSON(property),
        partner: partner ? partnerAdminJSON(partner) : null,
        roomTypes: roomTypes.map(roomTypeJSON),
        documents: documentsJSON(docs, property, partner),
    });
});

const propertyStatusSchema = statusBody(['approved', 'rejected', 'suspended', 'pending'], ['rejected', 'suspended']);

/** Upsert the document record's verification state. */
const setVerification = async (property, verificationStatus, adminRemark, adminId) => {
    const doc = (await HotelPropertyDocument.findOne({ propertyId: property._id }))
        || new HotelPropertyDocument({ propertyId: property._id, documents: [] });
    doc.verificationStatus = verificationStatus;
    if (adminRemark !== undefined) doc.adminRemark = adminRemark;
    doc.verifiedAt = new Date();
    doc.verifiedBy = adminId;
    await doc.save();
    return doc;
};

export const setPropertyStatus = handle(async (req, res) => {
    const body = parse(propertyStatusSchema, req.body);
    const property = await loadProperty(req.params.id);
    property.status = body.status;
    property.rejectionReason = ['rejected', 'suspended'].includes(body.status) ? body.reason : '';
    if (body.status === 'approved') {
        property.approvedAt = new Date();
        property.approvedBy = adminIdOf(req);
        await setVerification(property, 'verified', undefined, adminIdOf(req));
    } else if (['rejected', 'suspended'].includes(body.status)) {
        // Off the shelf until the partner switches it back on after re-approval.
        property.isLive = false;
    }
    await property.save();
    return sendResponse(res, 200, `Property ${body.status}`, { property: propertyJSON(property) });
});

const verifySchema = z.object({
    verificationStatus: z.enum(['verified', 'rejected']),
    adminRemark: z.string().trim().max(500).optional(),
}).strict();

export const verifyDocuments = handle(async (req, res) => {
    const body = parse(verifySchema, req.body);
    const property = await loadProperty(req.params.id);
    const doc = await setVerification(property, body.verificationStatus, body.adminRemark ?? '', adminIdOf(req));
    const partner = await HotelPartner.findById(property.partnerId).select('kyc.gstNumber').lean();
    return sendResponse(res, 200, `Documents ${body.verificationStatus}`, documentsJSON(doc, property, partner));
});

const liveSchema = z.object({ isLive: z.boolean() }).strict();

export const setPropertyLive = handle(async (req, res) => {
    const { isLive } = parse(liveSchema, req.body);
    const property = await loadProperty(req.params.id);
    if (isLive && property.status !== 'approved') {
        throw new ValidationError('Only an approved property can be switched live');
    }
    property.isLive = isLive;
    await property.save();
    return sendResponse(res, 200, isLive ? 'Property is live' : 'Property is offline', { property: propertyJSON(property) });
});
