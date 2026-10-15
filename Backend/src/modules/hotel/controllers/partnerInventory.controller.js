// Partner (approved): inventory calendar, blocks (walk-in / external / manual) and the
// phase-2 dashboard.

import mongoose from 'mongoose';
import { sendResponse } from '../../../utils/response.js';
import { NotFoundError, ValidationError } from '../../../core/auth/errors.js';
import { HotelProperty } from '../models/hotelProperty.model.js';
import { HotelRoomType } from '../models/hotelRoomType.model.js';
import { HotelAvailability } from '../models/hotelAvailability.model.js';
import { HotelInventoryDay } from '../models/hotelInventoryDay.model.js';
import { parse } from '../validators/partner.validators.js';
import {
    calendarQuerySchema,
    calendarUpdateSchema,
    blocksQuerySchema,
    createBlockSchema,
} from '../validators/property.validators.js';
import { loadOwnProperty, loadOwnRoomType, isObjectId } from '../services/property.service.js';
import {
    getCalendar,
    ensureInventoryDays,
    reserve,
    release,
    runInTransaction,
    toNightDate,
    toDateString,
    addDays,
    daysBetween,
    todayIST,
} from '../services/inventory.service.js';

const handle = (fn) => async (req, res, next) => {
    try {
        return await fn(req, res);
    } catch (err) {
        return next(err);
    }
};

export const CALENDAR_MAX_DAYS = 92;
export const BULK_MAX_DAYS = 366;
export const BLOCK_MAX_NIGHTS = 366;

/** Inclusive [from, to] calendar range -> nights count, with bounds checks. */
const rangeDays = (from, to, max) => {
    toNightDate(from, 'from');
    toNightDate(to, 'to');
    const n = daysBetween(from, to) + 1;
    if (n < 1) throw new ValidationError('to must be on or after from');
    if (n > max) throw new ValidationError(`The range can be at most ${max} days`);
    return n;
};

// ─── calendar ─────────────────────────────────────────────────────────────

export const getInventory = handle(async (req, res) => {
    const q = parse(calendarQuerySchema, req.query);
    const { roomType } = await loadOwnRoomType(req.user.userId, q.roomTypeId, q.propertyId || null);
    rangeDays(q.from, q.to, CALENDAR_MAX_DAYS);
    const days = await getCalendar(roomType, q.from, addDays(q.to, 1));
    return sendResponse(res, 200, 'Inventory', { roomTypeId: roomType._id, days });
});

export const putInventory = handle(async (req, res) => {
    const body = parse(calendarUpdateSchema, req.body);
    const { roomType } = await loadOwnRoomType(req.user.userId, body.roomTypeId);
    rangeDays(body.from, body.to, BULK_MAX_DAYS);
    const end = addDays(body.to, 1);
    await ensureInventoryDays(roomType, body.from, end);

    const update = {};
    if (body.closed !== undefined) update.$set = { closed: body.closed };
    if (body.priceOverride === null) update.$unset = { priceOverride: 1 };
    else if (body.priceOverride !== undefined) update.$set = { ...(update.$set || {}), priceOverride: body.priceOverride };

    const result = await HotelInventoryDay.updateMany(
        { roomTypeId: roomType._id, date: { $gte: toNightDate(body.from), $lt: toNightDate(end) } },
        update,
    );
    const days = daysBetween(body.from, end) <= CALENDAR_MAX_DAYS ? await getCalendar(roomType, body.from, end) : undefined;
    return sendResponse(res, 200, 'Inventory updated', {
        roomTypeId: roomType._id,
        updated: result.modifiedCount,
        ...(days ? { days } : {}),
    });
});

// ─── blocks ───────────────────────────────────────────────────────────────

const blockJSON = (row, names) => ({
    _id: row._id,
    propertyId: row.propertyId,
    roomTypeId: row.roomTypeId,
    roomTypeName: names?.get(String(row.roomTypeId)) || undefined,
    source: row.source,
    startDate: toDateString(row.startDate),
    endDate: toDateString(row.endDate),
    units: row.units,
    externalPlatform: row.externalPlatform,
    externalReference: row.externalReference,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
});

export const listBlocks = handle(async (req, res) => {
    const q = parse(blocksQuerySchema, req.query);
    let propertyIds;
    if (q.propertyId) propertyIds = [(await loadOwnProperty(req.user.userId, q.propertyId))._id];
    else {
        propertyIds = await HotelProperty.find({ partnerId: req.user.userId, isDeleted: { $ne: true } }).distinct('_id');
    }
    const filter = { propertyId: { $in: propertyIds }, source: { $ne: 'platform' } };
    // Overlap with [from, to] (inclusive calendar range).
    if (q.to) filter.startDate = { $lt: toNightDate(addDays(q.to, 1)) };
    if (q.from) filter.endDate = { $gt: toNightDate(q.from) };

    const rows = await HotelAvailability.find(filter).sort({ startDate: 1 }).limit(500).lean();
    const names = new Map(
        (await HotelRoomType.find({ _id: { $in: [...new Set(rows.map((r) => String(r.roomTypeId)))] } })
            .select('name').lean()).map((r) => [String(r._id), r.name]),
    );
    return sendResponse(res, 200, 'Blocks', rows.map((r) => blockJSON(r, names)));
});

export const createBlock = handle(async (req, res) => {
    const body = parse(createBlockSchema, req.body);
    const { roomType, property } = await loadOwnRoomType(req.user.userId, body.roomTypeId);
    toNightDate(body.startDate, 'startDate');
    toNightDate(body.endDate, 'endDate');
    const nights = daysBetween(body.startDate, body.endDate);
    if (nights < 1) throw new ValidationError('endDate must be after startDate');
    if (nights > BLOCK_MAX_NIGHTS) throw new ValidationError(`A block can cover at most ${BLOCK_MAX_NIGHTS} nights`);
    if (body.startDate < todayIST()) throw new ValidationError('startDate cannot be in the past');

    // Rows first, outside the transaction (see reserve()).
    await ensureInventoryDays(roomType, body.startDate, body.endDate);
    // Reserve the nights and write the ledger row together; a night without room → 409.
    const row = await runInTransaction(async (session) => {
        await reserve({
            roomTypeId: roomType._id,
            checkIn: body.startDate,
            checkOut: body.endDate,
            units: body.units,
            session,
        });
        const [created] = await HotelAvailability.create([{
            propertyId: property._id,
            roomTypeId: roomType._id,
            source: body.source,
            externalPlatform: body.externalPlatform,
            externalReference: body.externalReference,
            startDate: toNightDate(body.startDate),
            endDate: toNightDate(body.endDate),
            units: body.units,
            notes: body.notes,
            createdBy: 'partner',
        }], { session });
        return created;
    });
    return sendResponse(res, 201, 'Block created', blockJSON(row.toObject(), new Map([[String(roomType._id), roomType.name]])));
});

export const deleteBlock = handle(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new NotFoundError('Block not found');
    const row = await HotelAvailability.findById(req.params.id);
    if (!row || row.source === 'platform') throw new NotFoundError('Block not found');
    await loadOwnProperty(req.user.userId, String(row.propertyId)).catch(() => {
        throw new NotFoundError('Block not found');
    });

    await runInTransaction(async (session) => {
        const gone = await HotelAvailability.deleteOne({ _id: row._id }, { session });
        if (gone.deletedCount !== 1) throw new NotFoundError('Block not found');
        await release({
            roomTypeId: row.roomTypeId,
            checkIn: toDateString(row.startDate),
            checkOut: toDateString(row.endDate),
            units: row.units,
            session,
        });
    });
    return sendResponse(res, 200, 'Block removed', { _id: row._id });
});

// ─── dashboard ────────────────────────────────────────────────────────────

export const dashboard = handle(async (req, res) => {
    const rows = await HotelProperty.aggregate([
        { $match: { partnerId: new mongoose.Types.ObjectId(req.user.userId), isDeleted: { $ne: true } } },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                live: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'approved'] }, '$isLive'] }, 1, 0] } },
                pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
            },
        },
    ]);
    const { total = 0, live = 0, pending = 0 } = rows[0] || {};
    // Booking figures arrive with the booking phase.
    return sendResponse(res, 200, 'Dashboard', {
        properties: { total, live, pending },
        todayArrivals: 0,
        todayDepartures: 0,
        upcomingBookings: 0,
        revenueThisMonth: 0,
    });
});
