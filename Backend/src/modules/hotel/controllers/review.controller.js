// Reviews: a guest reviews a completed stay (one per booking), the public reads approved
// ones, the partner replies, an admin moderates. property.avgRating / totalReviews are
// recomputed from approved reviews after every create and status change.

import mongoose from 'mongoose';
import { z } from 'zod';
import { sendResponse } from '../../../utils/response.js';
import { NotFoundError, ValidationError } from '../../../core/auth/errors.js';
import { FoodUser } from '../../../core/users/user.model.js';
import { ConflictError } from '../errors.js';
import { HotelBooking } from '../models/hotelBooking.model.js';
import { HotelReview } from '../models/hotelReview.model.js';
import { HotelProperty } from '../models/hotelProperty.model.js';
import { parse } from '../validators/partner.validators.js';
import { isObjectId, pageOf, loadOwnProperty } from '../services/property.service.js';
import { getMoneySettings } from '../services/moneySettings.js';

const handle = (fn) => async (req, res, next) => {
    try {
        return await fn(req, res);
    } catch (err) {
        return next(err);
    }
};

const pagingSchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Guest';

export const reviewJSON = (r, { userName, full = false, property } = {}) => ({
    _id: r._id,
    propertyId: r.propertyId,
    bookingId: r.bookingId,
    rating: r.rating,
    ...(r.subRatings && Object.values(r.subRatings).some((v) => v != null) ? { subRatings: r.subRatings } : {}),
    comment: r.comment || '',
    photos: r.photos || [],
    ...(r.reply?.text ? { reply: { text: r.reply.text, at: r.reply.at } } : {}),
    user: { name: full ? (userName || 'Guest') : firstName(userName) },
    status: r.status,
    createdAt: r.createdAt,
    ...(property ? { property: { _id: property._id, name: property.name } } : {}),
});

const namesOf = async (rows) => {
    const ids = [...new Set(rows.map((r) => String(r.userId)))].filter(isObjectId);
    if (!ids.length) return new Map();
    const users = await FoodUser.find({ _id: { $in: ids } }).select('name').lean();
    return new Map(users.map((u) => [String(u._id), u.name]));
};

const propertiesOf = async (rows) => {
    const ids = [...new Set(rows.map((r) => String(r.propertyId)))];
    const props = await HotelProperty.find({ _id: { $in: ids } }).select('name').lean();
    return new Map(props.map((p) => [String(p._id), p]));
};

/** Approved-review figures for a property: { avgRating, totalReviews, breakdown }. */
export const ratingSummary = async (propertyId) => {
    const rows = await HotelReview.aggregate([
        { $match: { propertyId: new mongoose.Types.ObjectId(String(propertyId)), status: 'approved' } },
        { $group: { _id: '$rating', n: { $sum: 1 } } },
    ]);
    const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let total = 0;
    let sum = 0;
    for (const r of rows) {
        const star = Math.min(5, Math.max(1, Math.round(r._id)));
        breakdown[star] += r.n;
        total += r.n;
        sum += r._id * r.n;
    }
    return { avgRating: total ? Math.round((sum / total) * 10) / 10 : 0, totalReviews: total, breakdown };
};

/** Write the approved-review average and count onto the property. */
export const recomputePropertyRating = async (propertyId) => {
    const { avgRating, totalReviews } = await ratingSummary(propertyId);
    await HotelProperty.updateOne({ _id: propertyId }, { $set: { avgRating, totalReviews } });
    return { avgRating, totalReviews };
};

// ─── customer ─────────────────────────────────────────────────────────────

const stars = z.coerce.number().int().min(1).max(5);
const createSchema = z.object({
    bookingId: z.string().trim(),
    rating: stars,
    subRatings: z.object({
        cleanliness: stars.optional(),
        location: stars.optional(),
        service: stars.optional(),
        value: stars.optional(),
    }).optional(),
    comment: z.string().trim().max(2000).optional(),
    photos: z.array(z.string().trim().url().max(500)).max(10).optional(),
});

export const createReview = handle(async (req, res) => {
    const body = parse(createSchema, req.body || {});
    const userId = String(req.user.userId);
    const booking = isObjectId(body.bookingId) ? await HotelBooking.findById(body.bookingId).lean() : null;
    if (!booking || String(booking.userId) !== userId) throw new NotFoundError('Booking not found');
    if (booking.status !== 'checked_out') throw new ValidationError('You can review a stay after you check out');
    if (booking.review || (await HotelReview.exists({ bookingId: booking._id }))) {
        throw new ConflictError('You have already reviewed this stay');
    }

    const { reviewAutoApprove } = await getMoneySettings();
    let review;
    try {
        review = await HotelReview.create({
            userId,
            propertyId: booking.propertyId,
            bookingId: booking._id,
            rating: body.rating,
            subRatings: body.subRatings,
            comment: body.comment || '',
            photos: body.photos || [],
            status: reviewAutoApprove ? 'approved' : 'pending',
        });
    } catch (err) {
        if (err?.code === 11000) throw new ConflictError('You have already reviewed this stay');
        throw err;
    }
    await HotelBooking.updateOne({ _id: booking._id }, { $set: { review: review._id } });
    await recomputePropertyRating(booking.propertyId);
    const user = await FoodUser.findById(userId).select('name').lean();
    return sendResponse(res, 201, 'Review saved', { review: reviewJSON(review.toObject(), { userName: user?.name }) });
});

// ─── public ───────────────────────────────────────────────────────────────

export const publicReviews = handle(async (req, res) => {
    const q = parse(pagingSchema, req.query);
    const { page, limit, skip } = pageOf(q);
    if (!isObjectId(req.params.id)) throw new NotFoundError('Property not found');
    const property = await HotelProperty.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).select('_id').lean();
    if (!property) throw new NotFoundError('Property not found');

    const filter = { propertyId: property._id, status: 'approved' };
    const [rows, total, summary] = await Promise.all([
        HotelReview.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
        HotelReview.countDocuments(filter),
        ratingSummary(property._id),
    ]);
    const names = await namesOf(rows);
    return sendResponse(res, 200, 'Reviews', {
        items: rows.map((r) => reviewJSON(r, { userName: names.get(String(r.userId)) })),
        page,
        limit,
        total,
        summary,
    });
});

// ─── partner ──────────────────────────────────────────────────────────────

const partnerListSchema = pagingSchema.extend({ propertyId: z.string().trim().optional() });

export const partnerReviews = handle(async (req, res) => {
    const q = parse(partnerListSchema, req.query);
    const { page, limit, skip } = pageOf(q);
    let propertyIds;
    if (q.propertyId) propertyIds = [(await loadOwnProperty(req.user.userId, q.propertyId))._id];
    else propertyIds = await HotelProperty.find({ partnerId: req.user.userId, isDeleted: { $ne: true } }).distinct('_id');

    const filter = { propertyId: { $in: propertyIds } };
    const [rows, total] = await Promise.all([
        HotelReview.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
        HotelReview.countDocuments(filter),
    ]);
    const [names, props] = await Promise.all([namesOf(rows), propertiesOf(rows)]);
    return sendResponse(res, 200, 'Reviews', {
        items: rows.map((r) => reviewJSON(r, { userName: names.get(String(r.userId)), property: props.get(String(r.propertyId)) })),
        page,
        limit,
        total,
    });
});

const replySchema = z.object({ text: z.string().trim().min(1).max(1000) });

export const replyToReview = handle(async (req, res) => {
    const { text } = parse(replySchema, req.body || {});
    const review = isObjectId(req.params.id) ? await HotelReview.findById(req.params.id) : null;
    if (!review) throw new NotFoundError('Review not found');
    await loadOwnProperty(req.user.userId, String(review.propertyId)).catch(() => {
        throw new NotFoundError('Review not found');
    });
    review.reply = { text, at: new Date() };
    await review.save();
    const names = await namesOf([review]);
    return sendResponse(res, 200, 'Reply saved', { review: reviewJSON(review.toObject(), { userName: names.get(String(review.userId)) }) });
});

// ─── admin ────────────────────────────────────────────────────────────────

const adminListSchema = pagingSchema.extend({
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    propertyId: z.string().trim().optional(),
});

export const adminReviews = handle(async (req, res) => {
    const q = parse(adminListSchema, req.query);
    const { page, limit, skip } = pageOf(q);
    const filter = {};
    if (q.status) filter.status = q.status;
    if (q.propertyId) {
        if (!isObjectId(q.propertyId)) throw new ValidationError('Invalid propertyId');
        filter.propertyId = q.propertyId;
    }
    const [rows, total] = await Promise.all([
        HotelReview.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
        HotelReview.countDocuments(filter),
    ]);
    const [names, props] = await Promise.all([namesOf(rows), propertiesOf(rows)]);
    return sendResponse(res, 200, 'Reviews', {
        items: rows.map((r) => reviewJSON(r, { userName: names.get(String(r.userId)), full: true, property: props.get(String(r.propertyId)) })),
        page,
        limit,
        total,
    });
});

const adminStatusSchema = z.object({ status: z.enum(['approved', 'rejected']) });

export const adminSetReviewStatus = handle(async (req, res) => {
    const { status } = parse(adminStatusSchema, req.body || {});
    const review = isObjectId(req.params.id)
        ? await HotelReview.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true }).lean()
        : null;
    if (!review) throw new NotFoundError('Review not found');
    await recomputePropertyRating(review.propertyId);
    const names = await namesOf([review]);
    return sendResponse(res, 200, 'Review updated', { review: reviewJSON(review, { userName: names.get(String(review.userId)), full: true }) });
});
